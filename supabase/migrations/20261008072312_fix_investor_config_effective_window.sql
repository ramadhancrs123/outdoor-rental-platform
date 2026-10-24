CREATE OR REPLACE FUNCTION app_private.command_set_investor_finance_config(
  p_usaha_id uuid,p_investor_id uuid,p_pengelola_akun_admin_id uuid,
  p_investor_percentage numeric,p_operational_reserve_amount numeric,
  p_period_start_day smallint,p_period_end_day smallint,p_effective_from date,
  p_idempotency_key text,p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.assert_investor_admin(p_usaha_id);
  v_existing public.investor_participation%rowtype;
  v_next_effective date;
  v_new_id uuid:=gen_random_uuid();
  v_existing_response jsonb;
  v_existing_hash text;
  v_idempotency_id uuid;
  v_hash text;
  v_response jsonb;
  v_closed boolean;
BEGIN
  IF p_investor_percentage IS NULL OR p_investor_percentage<0 OR p_investor_percentage>100 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: persentase investor harus 0-100' USING ERRCODE='22023';
  END IF;
  IF p_operational_reserve_amount IS NULL OR p_operational_reserve_amount<0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: reserve operasional tidak valid' USING ERRCODE='22023';
  END IF;
  IF p_period_start_day IS NULL OR p_period_start_day NOT BETWEEN 1 AND 31
     OR p_period_end_day IS NULL OR p_period_end_day<p_period_start_day OR p_period_end_day>31 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: rentang periode tidak valid' USING ERRCODE='22023';
  END IF;
  IF p_effective_from IS NULL OR p_effective_from <>
     (date_trunc('month',p_effective_from)::date+(p_period_start_day-1)) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: effective_from harus tepat pada hari mulai periode' USING ERRCODE='22023';
  END IF;
  IF nullif(btrim(p_idempotency_key),'') IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.investor i
    WHERE i.usaha_id=p_usaha_id AND i.investor_id=p_investor_id AND i.status='active'
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: investor aktif tidak ditemukan' USING ERRCODE='P0002';
  END IF;
  IF NOT EXISTS(
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id=aa.akun_admin_id
     AND ku.usaha_id=p_usaha_id
     AND ku.status='active'
     AND ku.revoked_at IS NULL
    WHERE aa.akun_admin_id=p_pengelola_akun_admin_id
      AND aa.status='active'
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: akun pengelola aktif tidak ditemukan pada usaha' USING ERRCODE='P0002';
  END IF;
  v_hash:=md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'investor_id',p_investor_id,
    'pengelola_akun_admin_id',p_pengelola_akun_admin_id,
    'percentage',p_investor_percentage,'reserve',p_operational_reserve_amount,
    'start',p_period_start_day,'end',p_period_end_day,'effective',p_effective_from
  )::text);
  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,auth.uid(),btrim(p_idempotency_key),'set_investor_finance_config',v_hash)
  ON CONFLICT(usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;
  IF v_idempotency_id IS NULL THEN
    SELECT response_body,request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id AND actor_auth_user_id=auth.uid()
      AND command_name='set_investor_finance_config' AND key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE='40001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text||':'||p_investor_id::text,0));
  SELECT * INTO v_existing
  FROM public.investor_participation p
  WHERE p.usaha_id=p_usaha_id AND p.investor_id=p_investor_id
    AND p.status='active' AND p.effective_from=p_effective_from
  FOR UPDATE;
  SELECT EXISTS(
    SELECT 1 FROM public.investor_finance_period p
    WHERE p.usaha_id=p_usaha_id AND p.period_start=p_effective_from
  ) INTO v_closed;
  IF v_closed THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: periode sudah closed, konfigurasi tidak dapat diubah' USING ERRCODE='23514';
  END IF;
  IF v_existing.participation_id IS NOT NULL THEN
    UPDATE public.investor_participation
    SET percentage=p_investor_percentage,
        operational_reserve_amount=p_operational_reserve_amount,
        pengelola_akun_admin_id=p_pengelola_akun_admin_id,
        period_start_day=p_period_start_day,
        period_end_day=p_period_end_day
    WHERE participation_id=v_existing.participation_id;
  ELSE
    SELECT min(p.effective_from) INTO v_next_effective
    FROM public.investor_participation p
    WHERE p.usaha_id=p_usaha_id AND p.investor_id=p_investor_id
      AND p.status='active' AND p.effective_from>p_effective_from;
    UPDATE public.investor_participation p
    SET effective_until=p_effective_from
    WHERE p.usaha_id=p_usaha_id AND p.investor_id=p_investor_id
      AND p.status='active'
      AND (p.effective_until IS NULL OR p.effective_until>p_effective_from)
      AND p.effective_from<p_effective_from;
    INSERT INTO public.investor_participation(
      participation_id,usaha_id,investor_id,percentage,basis_type,
      period_start_day,period_end_day,effective_from,effective_until,status,
      operational_reserve_amount,pengelola_akun_admin_id
    ) VALUES(
      v_new_id,p_usaha_id,p_investor_id,p_investor_percentage,'net_operational_result',
      p_period_start_day,p_period_end_day,p_effective_from,v_next_effective,'active',
      p_operational_reserve_amount,p_pengelola_akun_admin_id
    );
  END IF;
  v_response:=jsonb_build_object(
    'participation_id',coalesce(v_existing.participation_id,v_new_id),
    'investor_id',p_investor_id,'percentage',p_investor_percentage,
    'operational_reserve_amount',p_operational_reserve_amount,
    'pengelola_akun_admin_id',p_pengelola_akun_admin_id,
    'period_start_day',p_period_start_day,'period_end_day',p_period_end_day,
    'effective_from',p_effective_from,'effective_until',v_next_effective,
    'basis_type','net_operational_result'
  );
  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  ) VALUES(
    p_usaha_id,auth.uid(),v_admin_id,'set_investor_finance_config','investor_participation',
    coalesce(v_existing.participation_id,v_new_id),'admin-command',p_request_id,v_response
  );
  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES(
    p_usaha_id,'investor.config.changed','investor_participation',
    coalesce(v_existing.participation_id,v_new_id),v_response
  );
  UPDATE public.idempotency_key
  SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$;