-- ADR-009: rental tolerance operational controls.
-- Backend source of truth for configurable default tolerance, audited tolerance
-- extension, optional hourly late-fee assessment, and deadline notifications.

ALTER TABLE public.usaha
  ADD COLUMN IF NOT EXISTS late_fee_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS late_fee_per_hour numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.usaha
  DROP CONSTRAINT IF EXISTS usaha_late_fee_per_hour_check;

ALTER TABLE public.usaha
  ADD CONSTRAINT usaha_late_fee_per_hour_check CHECK (late_fee_per_hour >= 0);

ALTER TABLE public.usaha
  DROP CONSTRAINT IF EXISTS usaha_default_tolerance_hours_check;

ALTER TABLE public.usaha
  ADD CONSTRAINT usaha_default_tolerance_hours_check CHECK (default_tolerance_hours >= 0);

COMMENT ON COLUMN public.usaha.late_fee_enabled IS
  'Optional hourly late-fee assessment after tolerance deadline. Disabled by default.';
COMMENT ON COLUMN public.usaha.late_fee_per_hour IS
  'Hourly late-fee assessment rate in the business currency, normally IDR.';

CREATE TABLE IF NOT EXISTS public.riwayat_toleransi_penyewaan (
  riwayat_toleransi_penyewaan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  penyewaan_id uuid NOT NULL,
  tolerance_sebelum timestamptz NOT NULL,
  tolerance_sesudah timestamptz NOT NULL,
  tambahan_menit integer NOT NULL,
  alasan text NOT NULL,
  actor_akun_admin_id uuid NOT NULL,
  request_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT riwayat_toleransi_penyewaan_usaha_fk
    FOREIGN KEY (usaha_id) REFERENCES public.usaha (usaha_id) ON DELETE RESTRICT,
  CONSTRAINT riwayat_toleransi_penyewaan_rental_fk
    FOREIGN KEY (usaha_id, penyewaan_id)
    REFERENCES public.penyewaan (usaha_id, penyewaan_id) ON DELETE RESTRICT,
  CONSTRAINT riwayat_toleransi_penyewaan_actor_fk
    FOREIGN KEY (usaha_id, actor_akun_admin_id)
    REFERENCES public.keanggotaan_usaha (usaha_id, akun_admin_id) ON DELETE RESTRICT,
  CONSTRAINT riwayat_toleransi_penyewaan_additional_minutes_check
    CHECK (tambahan_menit > 0),
  CONSTRAINT riwayat_toleransi_penyewaan_reason_check
    CHECK (btrim(alasan) <> '' AND length(alasan) <= 2000),
  CONSTRAINT riwayat_toleransi_penyewaan_deadline_check
    CHECK (tolerance_sesudah > tolerance_sebelum)
);

CREATE INDEX IF NOT EXISTS riwayat_toleransi_penyewaan_rental_idx
  ON public.riwayat_toleransi_penyewaan (usaha_id, penyewaan_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS riwayat_toleransi_penyewaan_actor_idx
  ON public.riwayat_toleransi_penyewaan (usaha_id, actor_akun_admin_id, occurred_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS riwayat_toleransi_penyewaan_request_idx
  ON public.riwayat_toleransi_penyewaan (usaha_id, request_id)
  WHERE request_id IS NOT NULL;

ALTER TABLE public.riwayat_toleransi_penyewaan ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.riwayat_toleransi_penyewaan TO authenticated;

DROP POLICY IF EXISTS tolerance_history_select_member ON public.riwayat_toleransi_penyewaan;
CREATE POLICY tolerance_history_select_member
  ON public.riwayat_toleransi_penyewaan
  FOR SELECT
  TO authenticated
  USING (app_private.has_usaha_access(usaha_id));

-- RPC: update per-business rental policy.
CREATE OR REPLACE FUNCTION app_private.command_update_rental_policy(
  p_usaha_id uuid,
  p_default_tolerance_hours numeric,
  p_late_fee_enabled boolean,
  p_late_fee_per_hour numeric,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_response jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;
  IF p_usaha_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id wajib diisi' USING ERRCODE = '22023';
  END IF;
  IF p_default_tolerance_hours IS NULL OR p_default_tolerance_hours < 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: default tolerance tidak boleh negatif' USING ERRCODE = '22023';
  END IF;
  IF p_late_fee_per_hour IS NULL OR p_late_fee_per_hour < 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tarif denda per jam tidak boleh negatif' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_late_fee_enabled, false) AND p_late_fee_per_hour <= 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tarif denda per jam harus lebih besar dari 0 saat fitur denda aktif' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi' USING ERRCODE = '22023';
  END IF;

  SELECT aa.akun_admin_id
  INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id = aa.akun_admin_id
   AND ku.status = 'active'
   AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id = v_auth_user_id
    AND aa.status = 'active'
    AND ku.usaha_id = p_usaha_id;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE = '42501';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'default_tolerance_hours', p_default_tolerance_hours,
    'late_fee_enabled', coalesce(p_late_fee_enabled, false),
    'late_fee_per_hour', p_late_fee_per_hour
  )::text);

  INSERT INTO public.idempotency_key (
    usaha_id, actor_auth_user_id, key, command_name, request_hash
  )
  VALUES (
    p_usaha_id, v_auth_user_id, btrim(p_idempotency_key),
    'update_rental_policy', v_request_hash
  )
  ON CONFLICT (usaha_id, actor_auth_user_id, command_name, key)
  DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body, ik.request_hash
    INTO v_existing_response, v_existing_hash
    FROM public.idempotency_key ik
    WHERE ik.usaha_id = p_usaha_id
      AND ik.actor_auth_user_id = v_auth_user_id
      AND ik.command_name = 'update_rental_policy'
      AND ik.key = btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE = '23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE = '40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text || ':rental-policy', 0));

  UPDATE public.usaha
  SET default_tolerance_hours = p_default_tolerance_hours,
      late_fee_enabled = coalesce(p_late_fee_enabled, false),
      late_fee_per_hour = p_late_fee_per_hour,
      updated_at = now()
  WHERE usaha_id = p_usaha_id
    AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id,
    action, entity_type, entity_id, source_application,
    request_id, change_summary, reason
  )
  VALUES (
    p_usaha_id, v_auth_user_id, v_admin_id,
    'update', 'usaha', p_usaha_id, 'admin-command',
    p_request_id,
    jsonb_build_object(
      'default_tolerance_hours', p_default_tolerance_hours,
      'late_fee_enabled', coalesce(p_late_fee_enabled, false),
      'late_fee_per_hour', p_late_fee_per_hour,
      'applies_to', 'new_rentals_only'
    ),
    'Memperbarui master aturan waktu penyewaan.'
  );

  v_response := jsonb_build_object(
    'usaha_id', p_usaha_id,
    'default_tolerance_hours', p_default_tolerance_hours,
    'late_fee_enabled', coalesce(p_late_fee_enabled, false),
    'late_fee_per_hour', p_late_fee_per_hour
  );

  UPDATE public.idempotency_key
  SET response_status = 200, response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_update_rental_policy(uuid,numeric,boolean,numeric,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_update_rental_policy(uuid,numeric,boolean,numeric,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.command_update_rental_policy(
  p_usaha_id uuid,
  p_default_tolerance_hours numeric,
  p_late_fee_enabled boolean,
  p_late_fee_per_hour numeric,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT app_private.command_update_rental_policy(
    p_usaha_id, p_default_tolerance_hours, p_late_fee_enabled,
    p_late_fee_per_hour, p_idempotency_key, p_request_id
  );
$function$;

REVOKE ALL ON FUNCTION public.command_update_rental_policy(uuid,numeric,boolean,numeric,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.command_update_rental_policy(uuid,numeric,boolean,numeric,text,uuid) TO authenticated;

-- RPC: extend a specific rental tolerance without rewriting scheduled return.
CREATE OR REPLACE FUNCTION app_private.command_extend_rental_tolerance(
  p_usaha_id uuid,
  p_penyewaan_id uuid,
  p_additional_minutes integer,
  p_reason text,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_rental public.penyewaan%ROWTYPE;
  v_old_deadline timestamptz;
  v_new_deadline timestamptz;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_response jsonb;
  v_history_id uuid;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;
  IF p_usaha_id IS NULL OR p_penyewaan_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id dan penyewaan_id wajib diisi' USING ERRCODE = '22023';
  END IF;
  IF p_additional_minutes IS NULL OR p_additional_minutes <= 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tambahan waktu toleransi harus lebih besar dari 0 menit' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' OR length(p_reason) > 2000 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: alasan wajib diisi dan maksimal 2000 karakter' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi' USING ERRCODE = '22023';
  END IF;

  SELECT aa.akun_admin_id
  INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id = aa.akun_admin_id
   AND ku.status = 'active'
   AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id = v_auth_user_id
    AND aa.status = 'active'
    AND ku.usaha_id = p_usaha_id;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE = '42501';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'penyewaan_id', p_penyewaan_id,
    'additional_minutes', p_additional_minutes,
    'reason', btrim(p_reason)
  )::text);

  INSERT INTO public.idempotency_key (
    usaha_id, actor_auth_user_id, key, command_name, request_hash
  )
  VALUES (
    p_usaha_id, v_auth_user_id, btrim(p_idempotency_key),
    'extend_rental_tolerance', v_request_hash
  )
  ON CONFLICT (usaha_id, actor_auth_user_id, command_name, key)
  DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body, ik.request_hash
    INTO v_existing_response, v_existing_hash
    FROM public.idempotency_key ik
    WHERE ik.usaha_id = p_usaha_id
      AND ik.actor_auth_user_id = v_auth_user_id
      AND ik.command_name = 'extend_rental_tolerance'
      AND ik.key = btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE = '23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE = '40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_penyewaan_id::text, 0));

  SELECT *
  INTO v_rental
  FROM public.penyewaan
  WHERE usaha_id = p_usaha_id
    AND penyewaan_id = p_penyewaan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: penyewaan tidak ditemukan dalam Usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  IF v_rental.status NOT IN ('active', 'return_in_progress') THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: tambahan toleransi hanya dapat diberikan pada rental yang masih berjalan' USING ERRCODE = '23514';
  END IF;

  IF v_rental.actual_return_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: rental sudah memiliki waktu pengembalian selesai' USING ERRCODE = '23514';
  END IF;

  v_old_deadline := coalesce(v_rental.tolerance_deadline, v_rental.jadwal_kembali);
  v_new_deadline := v_old_deadline + make_interval(mins => p_additional_minutes);

  UPDATE public.penyewaan
  SET tolerance_deadline = v_new_deadline,
      updated_at = now()
  WHERE usaha_id = p_usaha_id
    AND penyewaan_id = p_penyewaan_id;

  INSERT INTO public.riwayat_toleransi_penyewaan (
    usaha_id, penyewaan_id, tolerance_sebelum, tolerance_sesudah,
    tambahan_menit, alasan, actor_akun_admin_id, request_id
  )
  VALUES (
    p_usaha_id, p_penyewaan_id, v_old_deadline, v_new_deadline,
    p_additional_minutes, btrim(p_reason), v_admin_id, p_request_id
  )
  RETURNING riwayat_toleransi_penyewaan_id INTO v_history_id;

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id,
    action, entity_type, entity_id, source_application,
    request_id, change_summary, reason
  )
  VALUES (
    p_usaha_id, v_auth_user_id, v_admin_id,
    'extend_tolerance', 'penyewaan', p_penyewaan_id,
    'admin-command', p_request_id,
    jsonb_build_object(
      'jadwal_kembali', v_rental.jadwal_kembali,
      'tolerance_sebelum', v_old_deadline,
      'tolerance_sesudah', v_new_deadline,
      'tambahan_menit', p_additional_minutes,
      'history_id', v_history_id
    ),
    btrim(p_reason)
  );

  INSERT INTO public.outbox_event (
    usaha_id, event_type, aggregate_type, aggregate_id, payload
  )
  VALUES (
    p_usaha_id,
    'rental.tolerance_extended',
    'penyewaan',
    p_penyewaan_id,
    jsonb_build_object(
      'rental_id', p_penyewaan_id,
      'old_deadline', v_old_deadline,
      'new_deadline', v_new_deadline,
      'additional_minutes', p_additional_minutes,
      'reason', btrim(p_reason),
      'admin_id', v_admin_id
    )
  );

  v_response := jsonb_build_object(
    'penyewaan_id', p_penyewaan_id,
    'nomor_penyewaan', v_rental.nomor_penyewaan,
    'jadwal_kembali', v_rental.jadwal_kembali,
    'tolerance_sebelum', v_old_deadline,
    'tolerance_sesudah', v_new_deadline,
    'tambahan_menit', p_additional_minutes,
    'history_id', v_history_id
  );

  UPDATE public.idempotency_key
  SET response_status = 200, response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_extend_rental_tolerance(uuid,uuid,integer,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_extend_rental_tolerance(uuid,uuid,integer,text,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.command_extend_rental_tolerance(
  p_usaha_id uuid,
  p_penyewaan_id uuid,
  p_additional_minutes integer,
  p_reason text,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT app_private.command_extend_rental_tolerance(
    p_usaha_id, p_penyewaan_id, p_additional_minutes,
    p_reason, p_idempotency_key, p_request_id
  );
$function$;

REVOKE ALL ON FUNCTION public.command_extend_rental_tolerance(uuid,uuid,integer,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.command_extend_rental_tolerance(uuid,uuid,integer,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.calculate_rental_late_fee(
  p_usaha_id uuid,
  p_penyewaan_id uuid,
  p_as_of timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_rental public.penyewaan%ROWTYPE;
  v_enabled boolean;
  v_rate numeric(14,2);
  v_effective_return timestamptz;
  v_late_seconds numeric;
  v_billable_hours integer;
  v_amount numeric(14,2);
  v_state text;
BEGIN
  IF NOT app_private.has_usaha_access(p_usaha_id) THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rental
  FROM public.penyewaan
  WHERE usaha_id = p_usaha_id AND penyewaan_id = p_penyewaan_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: penyewaan tidak ditemukan dalam Usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  SELECT late_fee_enabled, late_fee_per_hour
  INTO v_enabled, v_rate
  FROM public.usaha
  WHERE usaha_id = p_usaha_id;

  v_effective_return := coalesce(v_rental.actual_return_completed_at, p_as_of);

  v_late_seconds := greatest(
    0,
    extract(epoch FROM (
      v_effective_return - coalesce(v_rental.tolerance_deadline, v_rental.jadwal_kembali)
    ))
  );

  v_billable_hours := CASE
    WHEN v_late_seconds <= 0 THEN 0
    ELSE ceil(v_late_seconds / 3600.0)::integer
  END;

  v_amount := CASE
    WHEN coalesce(v_enabled, false) THEN round(v_billable_hours * coalesce(v_rate, 0), 2)
    ELSE 0
  END;

  v_state := CASE
    WHEN p_as_of < v_rental.jadwal_kembali THEN 'before_due'
    WHEN coalesce(v_rental.tolerance_deadline, v_rental.jadwal_kembali) >= p_as_of THEN 'in_tolerance'
    ELSE 'tolerance_expired'
  END;

  RETURN jsonb_build_object(
    'enabled', coalesce(v_enabled, false),
    'rate_per_hour', coalesce(v_rate, 0),
    'billable_hours', v_billable_hours,
    'amount', v_amount,
    'state', v_state,
    'effective_return_at', v_rental.actual_return_completed_at,
    'calculated_at', p_as_of,
    'tolerance_deadline', v_rental.tolerance_deadline
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.calculate_rental_late_fee(uuid,uuid,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.calculate_rental_late_fee(uuid,uuid,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.calculate_rental_late_fee(
  p_usaha_id uuid,
  p_penyewaan_id uuid,
  p_as_of timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT app_private.calculate_rental_late_fee(p_usaha_id, p_penyewaan_id, p_as_of);
$function$;

REVOKE ALL ON FUNCTION public.calculate_rental_late_fee(uuid,uuid,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_rental_late_fee(uuid,uuid,timestamptz) TO authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS outbox_rental_deadline_dedupe_idx
  ON public.outbox_event (usaha_id, (payload ->> 'dedupe_key'))
  WHERE event_type IN (
    'rental.return_due',
    'rental.tolerance_warning_30m',
    'rental.tolerance_expired'
  );

CREATE OR REPLACE FUNCTION app_private.generate_rental_deadline_notifications(p_limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 2000);
  v_rental public.penyewaan%ROWTYPE;
  v_now timestamptz := now();
  v_due integer := 0;
  v_warning integer := 0;
  v_expired integer := 0;
  v_inserted integer;
  v_due_key text;
  v_warning_key text;
  v_expired_key text;
BEGIN
  FOR v_rental IN
    SELECT r.*
    FROM public.penyewaan r
    WHERE r.status IN ('active', 'return_in_progress')
      AND r.actual_return_completed_at IS NULL
      AND r.jadwal_kembali IS NOT NULL
      AND r.tolerance_deadline IS NOT NULL
    ORDER BY r.jadwal_kembali, r.penyewaan_id
    LIMIT v_limit
  LOOP
    v_due_key := v_rental.penyewaan_id::text || ':due:' || extract(epoch FROM v_rental.jadwal_kembali)::bigint::text;
    v_warning_key := v_rental.penyewaan_id::text || ':warning30:' || extract(epoch FROM v_rental.tolerance_deadline)::bigint::text;
    v_expired_key := v_rental.penyewaan_id::text || ':expired:' || extract(epoch FROM v_rental.tolerance_deadline)::bigint::text;

    IF v_now >= v_rental.jadwal_kembali THEN
      INSERT INTO public.outbox_event (
        usaha_id,event_type,aggregate_type,aggregate_id,payload
      )
      VALUES (
        v_rental.usaha_id,'rental.return_due','penyewaan',v_rental.penyewaan_id,
        jsonb_build_object(
          'rental_id',v_rental.penyewaan_id,
          'rental_number',v_rental.nomor_penyewaan,
          'scheduled_return_at',v_rental.jadwal_kembali,
          'tolerance_deadline',v_rental.tolerance_deadline,
          'dedupe_key',v_due_key
        )
      )
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      v_due := v_due + v_inserted;
    END IF;

    IF v_now >= (v_rental.tolerance_deadline - interval '30 minutes')
       AND v_now < v_rental.tolerance_deadline THEN
      INSERT INTO public.outbox_event (
        usaha_id,event_type,aggregate_type,aggregate_id,payload
      )
      VALUES (
        v_rental.usaha_id,'rental.tolerance_warning_30m','penyewaan',v_rental.penyewaan_id,
        jsonb_build_object(
          'rental_id',v_rental.penyewaan_id,
          'rental_number',v_rental.nomor_penyewaan,
          'scheduled_return_at',v_rental.jadwal_kembali,
          'tolerance_deadline',v_rental.tolerance_deadline,
          'dedupe_key',v_warning_key
        )
      )
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      v_warning := v_warning + v_inserted;
    END IF;

    IF v_now >= v_rental.tolerance_deadline THEN
      INSERT INTO public.outbox_event (
        usaha_id,event_type,aggregate_type,aggregate_id,payload
      )
      VALUES (
        v_rental.usaha_id,'rental.tolerance_expired','penyewaan',v_rental.penyewaan_id,
        jsonb_build_object(
          'rental_id',v_rental.penyewaan_id,
          'rental_number',v_rental.nomor_penyewaan,
          'scheduled_return_at',v_rental.jadwal_kembali,
          'tolerance_deadline',v_rental.tolerance_deadline,
          'dedupe_key',v_expired_key
        )
      )
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      v_expired := v_expired + v_inserted;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'due_events_inserted', v_due,
    'warning_events_inserted', v_warning,
    'expired_events_inserted', v_expired,
    'checked', v_limit,
    'calculated_at', v_now
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.generate_rental_deadline_notifications(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.generate_rental_deadline_notifications(integer) TO service_role;

DO $cron$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'rental-deadline-notifier';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
  PERFORM cron.schedule(
    'rental-deadline-notifier',
    '* * * * *',
    $$SELECT app_private.generate_rental_deadline_notifications(500);$$
  );
END;
$cron$;

-- Reservation -> rental used a historical hard-coded 10-hour tolerance.
-- Rebuild it from its current live definition so new rentals use the tenant master.
DO $replace$
DECLARE
  v_def text;
  v_old text := 'v_tolerance_deadline := p_jadwal_kembali + interval ''10 hours'';';
  v_new text := 'v_tolerance_deadline := p_jadwal_kembali + pg_catalog.make_interval(secs => coalesce((SELECT u.default_tolerance_hours FROM public.usaha u WHERE u.usaha_id = p_usaha_id), 10)::double precision * 3600);';
BEGIN
  SELECT pg_get_functiondef('app_private.command_create_rental_from_reservation(uuid,uuid,timestamptz,timestamptz,text,uuid)'::regprocedure)
  INTO v_def;
  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION 'RECONCILIATION_ERROR: expected reservation rental tolerance writer was not found';
  END IF;
  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END;
$replace$;

-- Add timing event rendering to the existing notification consumer.
DO $consumer$
DECLARE
  v_def text;
  v_marker text := '        ELSE
          NULL;
      END CASE;';
  v_insert text := $insert$
        WHEN 'rental.return_due' THEN
          v_notify := true;
          SELECT r.nomor_penyewaan INTO v_label
          FROM public.penyewaan r
          WHERE r.usaha_id = v_event.usaha_id
            AND r.penyewaan_id = v_event.aggregate_id;
          v_source_exists := found;
          v_label := coalesce(v_label, v_event.payload->>'rental_number', v_event.aggregate_id::text);
          v_title := 'Waktu pengembalian telah habis';
          v_message := 'Penyewaan ' || v_label || ' sudah melewati jadwal kembali dan masuk masa toleransi.';
          v_action_target := '/penyewaan/' || v_event.aggregate_id::text;

        WHEN 'rental.tolerance_warning_30m' THEN
          v_notify := true;
          SELECT r.nomor_penyewaan INTO v_label
          FROM public.penyewaan r
          WHERE r.usaha_id = v_event.usaha_id
            AND r.penyewaan_id = v_event.aggregate_id;
          v_source_exists := found;
          v_label := coalesce(v_label, v_event.payload->>'rental_number', v_event.aggregate_id::text);
          v_title := 'Toleransi tinggal 30 menit';
          v_message := 'Penyewaan ' || v_label || ' tinggal 30 menit sebelum batas toleransi berakhir.';
          v_action_target := '/penyewaan/' || v_event.aggregate_id::text;

        WHEN 'rental.tolerance_expired' THEN
          v_notify := true;
          SELECT r.nomor_penyewaan INTO v_label
          FROM public.penyewaan r
          WHERE r.usaha_id = v_event.usaha_id
            AND r.penyewaan_id = v_event.aggregate_id;
          v_source_exists := found;
          v_label := coalesce(v_label, v_event.payload->>'rental_number', v_event.aggregate_id::text);
          v_title := 'Batas toleransi telah berakhir';
          v_message := 'Penyewaan ' || v_label || ' sudah melewati batas toleransi. Periksa pengembalian dan konsekuensi yang berlaku.';
          v_action_target := '/penyewaan/' || v_event.aggregate_id::text;

$insert$ || v_marker;
BEGIN
  SELECT pg_get_functiondef('app_private.consume_notification_outbox(integer)'::regprocedure)
  INTO v_def;
  IF position(v_marker in v_def) = 0 THEN
    RAISE EXCEPTION 'RECONCILIATION_ERROR: notification consumer marker not found';
  END IF;
  v_def := replace(v_def, v_marker, v_insert);
  EXECUTE v_def;
END;
$consumer$;

GRANT SELECT ON public.pemberitahuan TO authenticated;

DO $realtime$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='pemberitahuan'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pemberitahuan;
  END IF;
END;
$realtime$;
