-- This migration hardens the existing Rental Outdoor event/notification pipeline.
-- A per-environment internal token is generated in Vault; plaintext is never committed.
DO $vault_setup$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'rental_internal_trigger_token') THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'rental_internal_trigger_token',
      'Internal auth token for trusted database cron and webhook calls to Rental Outdoor Edge Functions'
    );
  END IF;
END
$vault_setup$;


ALTER TABLE public.webhook_delivery_log
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.webhook_delivery_log
  DROP CONSTRAINT IF EXISTS webhook_delivery_log_status_check;
ALTER TABLE public.webhook_delivery_log
  ADD CONSTRAINT webhook_delivery_log_status_check
  CHECK (status = ANY (ARRAY['queued','pending','processing','success','failed','timeout']::text[]));

CREATE UNIQUE INDEX IF NOT EXISTS webhook_delivery_event_endpoint_unique_idx
  ON public.webhook_delivery_log (webhook_endpoint_id, outbox_event_id);

ALTER TABLE public.fcm_notification_queue
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
CREATE INDEX IF NOT EXISTS fcm_notification_queue_ready_idx
  ON public.fcm_notification_queue (status, next_attempt_at, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS fcm_notification_outbox_dedupe_idx
  ON public.fcm_notification_queue (usaha_id, user_type, fcm_token, (data ->> 'outbox_event_id'))
  WHERE data ? 'outbox_event_id';

CREATE OR REPLACE FUNCTION public.verify_internal_trigger_token(p_token text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT p_token IS NOT NULL AND length(p_token) >= 32
     AND EXISTS (SELECT 1 FROM vault.decrypted_secrets s
                 WHERE s.name = 'rental_internal_trigger_token'
                   AND s.decrypted_secret = p_token);
$function$;
REVOKE ALL ON FUNCTION public.verify_internal_trigger_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_internal_trigger_token(text) TO service_role;

CREATE OR REPLACE FUNCTION app_private.start_webhook_delivery()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_token text; v_request_id bigint;
BEGIN
  IF NEW.status IS DISTINCT FROM 'queued' THEN RETURN NEW; END IF;
  SELECT s.decrypted_secret INTO v_token
  FROM vault.decrypted_secrets s
  WHERE s.name = 'rental_internal_trigger_token' LIMIT 1;
  IF v_token IS NULL OR length(v_token) < 32 THEN
    RAISE WARNING 'Webhook dispatch skipped: internal token is not configured in Vault';
    RETURN NEW;
  END IF;
  BEGIN
    SELECT net.http_post(
      url := 'https://nbirkybutpvtrqifaxlt.supabase.co/functions/v1/webhook-dispatcher',
      body := jsonb_build_object(
        'type', TG_OP, 'schema', TG_TABLE_SCHEMA, 'table', TG_TABLE_NAME,
        'record', to_jsonb(NEW), 'old_record', NULL
      ),
      headers := jsonb_build_object('Content-Type','application/json','x-internal-token',v_token),
      timeout_milliseconds := 5000
    ) INTO v_request_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Unable to enqueue webhook-dispatcher request for delivery %: %', NEW.delivery_log_id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION app_private.start_webhook_delivery() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_webhook_delivery_dispatch ON public.webhook_delivery_log;
CREATE TRIGGER trg_webhook_delivery_dispatch
  AFTER INSERT ON public.webhook_delivery_log
  FOR EACH ROW WHEN (NEW.status = 'queued')
  EXECUTE FUNCTION app_private.start_webhook_delivery();

CREATE OR REPLACE FUNCTION public.dispatch_webhook_event(p_outbox_event_id uuid, p_event_type text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_event public.outbox_event%ROWTYPE;
  v_endpoint public.webhook_endpoint%ROWTYPE;
  v_webhook_payload jsonb;
  v_delivery_log_id uuid;
  v_dispatched integer := 0;
BEGIN
  SELECT o.* INTO v_event FROM public.outbox_event o WHERE o.outbox_event_id = p_outbox_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Outbox event not found'; END IF;
  IF p_event_type IS DISTINCT FROM v_event.event_type OR p_payload IS DISTINCT FROM v_event.payload THEN
    RAISE EXCEPTION 'Webhook event type/payload does not match persisted outbox event';
  END IF;
  IF v_event.usaha_id IS NULL THEN
    RETURN jsonb_build_object('dispatched', 0, 'reason', 'event_has_no_tenant');
  END IF;

  FOR v_endpoint IN
    SELECT we.* FROM public.webhook_endpoint we
    WHERE we.usaha_id = v_event.usaha_id
      AND we.is_active = true
      AND (we.events_filter IS NULL OR cardinality(we.events_filter) = 0 OR v_event.event_type = ANY(we.events_filter))
  LOOP
    v_webhook_payload := jsonb_build_object(
      'event_id', v_event.outbox_event_id,
      'event_type', v_event.event_type,
      'timestamp', now(),
      'data', v_event.payload
    );
    v_delivery_log_id := NULL;

    INSERT INTO public.webhook_delivery_log (
      webhook_endpoint_id,outbox_event_id,attempt_number,request_payload,request_headers,status,next_retry_at,updated_at
    ) VALUES (
      v_endpoint.webhook_endpoint_id,v_event.outbox_event_id,1,v_webhook_payload,
      jsonb_build_object(
        'Content-Type','application/json',
        'X-Webhook-Event',v_event.event_type,
        'X-Webhook-ID',v_event.outbox_event_id::text,
        'User-Agent','Akasha-Outdoor-Webhook/1.0'
      ),
      'queued',NULL,now()
    )
    ON CONFLICT (webhook_endpoint_id, outbox_event_id) DO NOTHING
    RETURNING delivery_log_id INTO v_delivery_log_id;

    IF v_delivery_log_id IS NOT NULL THEN v_dispatched := v_dispatched + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('dispatched', v_dispatched);
END;
$function$;
REVOKE ALL ON FUNCTION public.dispatch_webhook_event(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_webhook_event(uuid, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.get_webhook_retries_ready(p_limit integer DEFAULT 50)
RETURNS SETOF public.webhook_delivery_log
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT wdl.*
  FROM public.webhook_delivery_log wdl
  JOIN public.webhook_endpoint we ON we.webhook_endpoint_id = wdl.webhook_endpoint_id
  WHERE we.is_active = true
    AND (
      (wdl.status IN ('queued','pending') AND wdl.created_at <= now() - interval '60 seconds')
      OR (wdl.status IN ('failed','timeout') AND wdl.next_retry_at IS NOT NULL AND wdl.next_retry_at <= now())
      OR (wdl.status = 'processing' AND coalesce(wdl.updated_at,wdl.created_at) <= now() - interval '10 minutes')
    )
  ORDER BY coalesce(wdl.next_retry_at,wdl.created_at), wdl.created_at
  LIMIT least(greatest(coalesce(p_limit,50),1),200);
$function$;
REVOKE ALL ON FUNCTION public.get_webhook_retries_ready(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_webhook_retries_ready(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_fcm_notification_batch(p_limit integer DEFAULT 50)
RETURNS SETOF public.fcm_notification_queue
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_limit integer := least(greatest(coalesce(p_limit,50),1),200);
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT q.queue_id FROM public.fcm_notification_queue q
    WHERE (q.status='pending' AND (q.next_attempt_at IS NULL OR q.next_attempt_at <= now()))
       OR (q.status='processing' AND coalesce(q.updated_at,q.created_at) <= now() - interval '10 minutes')
    ORDER BY q.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  )
  UPDATE public.fcm_notification_queue q
  SET status='processing',attempt_count=coalesce(q.attempt_count,0)+1,
      next_attempt_at=NULL,updated_at=now()
  FROM candidates c
  WHERE q.queue_id=c.queue_id
  RETURNING q.*;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_fcm_notification_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_fcm_notification_batch(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.send_fcm_push_notification(
  p_usaha_id uuid,p_user_type text,p_title text,p_body text,
  p_data jsonb DEFAULT '{}'::jsonb,p_priority text DEFAULT 'high'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_tokens_found integer := 0; v_queued integer := 0;
BEGIN
  IF p_user_type IS NULL OR p_user_type NOT IN ('admin','investor') THEN
    RAISE EXCEPTION 'Invalid user_type; must be admin or investor';
  END IF;
  IF p_priority IS NULL OR p_priority NOT IN ('high','normal') THEN
    RAISE EXCEPTION 'Invalid priority; must be high or normal';
  END IF;
  IF p_usaha_id IS NULL OR nullif(btrim(p_title),'') IS NULL OR nullif(btrim(p_body),'') IS NULL THEN
    RAISE EXCEPTION 'usaha_id, title, and body are required';
  END IF;

  SELECT count(*)::integer INTO v_tokens_found
  FROM public.user_devices ud
  WHERE ud.usaha_id=p_usaha_id AND ud.user_type=p_user_type AND ud.is_active=true
    AND nullif(btrim(ud.fcm_token),'') IS NOT NULL;

  IF v_tokens_found=0 THEN
    RETURN jsonb_build_object('success',false,'message','No active FCM tokens found','tokens_found',0,'queued',0,'failed',0);
  END IF;

  INSERT INTO public.fcm_notification_queue (
    usaha_id,user_type,fcm_token,title,body,data,priority,status,next_attempt_at
  )
  SELECT ud.usaha_id,ud.user_type,ud.fcm_token,p_title,p_body,coalesce(p_data,'{}'::jsonb),p_priority,'pending',NULL
  FROM public.user_devices ud
  WHERE ud.usaha_id=p_usaha_id AND ud.user_type=p_user_type AND ud.is_active=true
    AND nullif(btrim(ud.fcm_token),'') IS NOT NULL
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_queued = ROW_COUNT;
  RETURN jsonb_build_object('success',true,'tokens_found',v_tokens_found,'queued',v_queued,'failed',0);
END;
$function$;
REVOKE ALL ON FUNCTION public.send_fcm_push_notification(uuid,text,text,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_fcm_push_notification(uuid,text,text,text,jsonb,text) TO service_role;

REVOKE ALL ON FUNCTION public.consume_notification_outbox(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_notification_outbox(integer) TO service_role;
REVOKE ALL ON FUNCTION public.generate_damage_check_notifications(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_rental_deadline_notifications_extended(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_late_fees_scheduled(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.emit_damage_found_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.emit_extension_notification_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.emit_payment_completed_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.emit_payout_completed_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.emit_profit_shared_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.emit_rental_notification_event() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.v_webhook_health WITH (security_invoker = true) AS
SELECT
  we.webhook_endpoint_id, we.usaha_id, we.nama, we.endpoint_url, we.is_active,
  we.consecutive_failures, we.last_status, we.last_triggered_at,
  count(wdl.delivery_log_id) FILTER (WHERE wdl.status='success' AND wdl.created_at >= now()-interval '24 hours') AS success_24h,
  count(wdl.delivery_log_id) FILTER (WHERE wdl.status IN ('failed','timeout') AND wdl.created_at >= now()-interval '24 hours') AS failed_24h,
  count(wdl.delivery_log_id) FILTER (
    WHERE ((wdl.status IN ('queued','pending') AND wdl.created_at <= now()-interval '60 seconds')
       OR (wdl.status IN ('failed','timeout') AND wdl.next_retry_at IS NOT NULL AND wdl.next_retry_at <= now())
       OR (wdl.status='processing' AND coalesce(wdl.updated_at,wdl.created_at) <= now()-interval '10 minutes'))
  ) AS pending_retry,
  avg(wdl.duration_ms) FILTER (WHERE wdl.status='success' AND wdl.created_at >= now()-interval '24 hours') AS avg_duration_ms_24h
FROM public.webhook_endpoint we
LEFT JOIN public.webhook_delivery_log wdl ON wdl.webhook_endpoint_id=we.webhook_endpoint_id
GROUP BY we.webhook_endpoint_id;

DO $cron_jobs$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'fcm-queue-processor' LIMIT 1;
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.alter_job(
      job_id := v_job_id,
      schedule := '* * * * *',
      command := $job$
        SELECT net.http_post(
          url := 'https://nbirkybutpvtrqifaxlt.supabase.co/functions/v1/process-fcm-queue-cron',
          body := jsonb_build_object('limit', 50),
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-internal-token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'rental_internal_trigger_token')
          ),
          timeout_milliseconds := 5000
        );
      $job$,
      active := true
    );
  END IF;

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'webhook-retry-processor' LIMIT 1;
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.alter_job(
      job_id := v_job_id,
      schedule := '* * * * *',
      command := $job$
        SELECT net.http_post(
          url := 'https://nbirkybutpvtrqifaxlt.supabase.co/functions/v1/webhook-retry-processor',
          body := jsonb_build_object('limit', 50),
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-internal-token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'rental_internal_trigger_token')
          ),
          timeout_milliseconds := 5000
        );
      $job$,
      active := true
    );
  END IF;
END
$cron_jobs$;

