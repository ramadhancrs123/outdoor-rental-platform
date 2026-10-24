
-- Fix generic trigger-record field access in realtime broadcast.
-- PL/pgSQL NEW/OLD are generic records; field references that do not exist
-- on the current TG table can raise 42703 before the CASE branch is selected.
CREATE OR REPLACE FUNCTION app_private.broadcast_investor_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_row_new jsonb := CASE WHEN TG_OP='DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  v_row_old jsonb := CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  v_row jsonb := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_usaha_id uuid;
  v_event_id uuid := gen_random_uuid();
  v_event_seq bigint;
  v_type text;
  v_key text;
  v_aggregate_id uuid;
  v_payload jsonb;
BEGIN
  v_usaha_id := nullif(v_row->>'usaha_id','')::uuid;

  v_type := CASE TG_TABLE_NAME
    WHEN 'transaksi_keuangan' THEN 'finance.changed'
    WHEN 'investor' THEN 'investor.changed'
    WHEN 'investor_participation' THEN 'investor.config.changed'
    WHEN 'akun_keuangan' THEN 'finance.account.changed'
    WHEN 'pergerakan_akun_keuangan' THEN 'finance.account.movement.changed'
    WHEN 'investor_finance_period' THEN 'investor.period.changed'
    WHEN 'investor_period_allocation' THEN 'investor.allocation.changed'
    WHEN 'operator_period_allocation' THEN 'investor.operator_allocation.changed'
    ELSE 'investor.changed'
  END;

  v_key := CASE TG_TABLE_NAME
    WHEN 'transaksi_keuangan' THEN 'transaksi_keuangan_id'
    WHEN 'investor' THEN 'investor_id'
    WHEN 'investor_participation' THEN 'participation_id'
    WHEN 'akun_keuangan' THEN 'akun_keuangan_id'
    WHEN 'pergerakan_akun_keuangan' THEN 'pergerakan_akun_keuangan_id'
    WHEN 'investor_finance_period' THEN 'period_id'
    WHEN 'investor_period_allocation' THEN 'allocation_id'
    WHEN 'operator_period_allocation' THEN 'allocation_id'
    ELSE NULL
  END;

  v_aggregate_id := nullif(coalesce(v_row_new->>v_key,v_row_old->>v_key),'')::uuid;

  IF v_usaha_id IS NULL THEN
    RETURN COALESCE(NEW,OLD);
  END IF;

  v_payload := jsonb_build_object(
    'event_id',v_event_id,
    'aggregate_id',v_aggregate_id,
    'occurred_at',clock_timestamp()
  );

  BEGIN
    INSERT INTO public.investor_realtime_event(
      event_id,usaha_id,event_type,aggregate_type,aggregate_id,payload
    ) VALUES(
      v_event_id,v_usaha_id,v_type,TG_TABLE_NAME,v_aggregate_id,v_payload
    )
    RETURNING event_seq INTO v_event_seq;

    BEGIN
      PERFORM realtime.send(
        v_payload||jsonb_build_object('event_seq',v_event_seq),
        v_type,'finance:usaha:'||v_usaha_id::text,true
      );

      UPDATE public.investor_realtime_event
      SET delivered_at=clock_timestamp(),
          attempt_count=attempt_count+1,
          last_error=NULL
      WHERE event_seq=v_event_seq;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.investor_realtime_event
      SET attempt_count=attempt_count+1,last_error=SQLERRM
      WHERE event_seq=v_event_seq;
    END;
  EXCEPTION WHEN OTHERS THEN
    -- Never turn realtime/journal failure into a Finance business failure.
    NULL;
  END;

  RETURN COALESCE(NEW,OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.get_investor_realtime_checkpoint(p_usaha_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_access text := app_private.assert_investor_read_access(p_usaha_id);
  v_seq bigint;
  v_at timestamptz;
BEGIN
  SELECT max(event_seq),max(occurred_at)
  INTO v_seq,v_at
  FROM public.investor_realtime_event
  WHERE usaha_id=p_usaha_id;

  RETURN jsonb_build_object(
    'principal',v_access,
    'last_event_seq',coalesce(v_seq,0),
    'last_event_at',v_at
  );
END;
$function$;
