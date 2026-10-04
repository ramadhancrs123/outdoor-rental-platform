-- Rental period calculation preview contract.
-- Returns elapsed duration, daily period projection, and tolerance deadline
-- for transparent presentation before rental lines are selected.

CREATE OR REPLACE FUNCTION app_private.command_preview_rental_period(
  p_usaha_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_timezone text;
  v_tolerance_hours numeric;
  v_elapsed_seconds numeric;
  v_elapsed_hours numeric;
  v_elapsed_days numeric;
  v_daily_periods integer;
  v_tolerance_deadline timestamptz;
  v_start_local timestamp;
  v_end_local timestamp;
  v_excess_seconds numeric;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL OR p_jadwal_mulai IS NULL OR p_jadwal_kembali IS NULL
     OR p_jadwal_kembali <= p_jadwal_mulai THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: jadwal rental tidak valid' USING ERRCODE = '22023';
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

  SELECT u.timezone, coalesce(u.default_tolerance_hours, 10)
    INTO v_timezone, v_tolerance_hours
  FROM public.usaha u
  WHERE u.usaha_id = p_usaha_id
    AND u.status = 'active';

  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  v_elapsed_seconds := extract(epoch FROM (p_jadwal_kembali - p_jadwal_mulai));
  v_elapsed_hours := round(v_elapsed_seconds / 3600.0, 2);
  v_elapsed_days := round(v_elapsed_seconds / 86400.0, 2);
  v_daily_periods := greatest(1, ceil(v_elapsed_seconds / 86400.0)::integer);
  v_excess_seconds := greatest(0, v_elapsed_seconds - 86400);

  v_tolerance_deadline := p_jadwal_kembali + make_interval(hours => v_tolerance_hours);
  v_start_local := p_jadwal_mulai AT TIME ZONE v_timezone;
  v_end_local := p_jadwal_kembali AT TIME ZONE v_timezone;

  RETURN jsonb_build_object(
    'start_at', p_jadwal_mulai,
    'end_at', p_jadwal_kembali,
    'timezone', v_timezone,
    'start_local', v_start_local,
    'end_local', v_end_local,
    'elapsed_seconds', v_elapsed_seconds,
    'elapsed_hours', v_elapsed_hours,
    'elapsed_days', v_elapsed_days,
    'daily_periods', v_daily_periods,
    'is_over_24_hours', v_elapsed_seconds > 86400,
    'excess_over_24h_seconds', v_excess_seconds,
    'tolerance_hours', v_tolerance_hours,
    'tolerance_deadline', v_tolerance_deadline,
    'tolerance_deadline_local', v_tolerance_deadline AT TIME ZONE v_timezone
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.command_preview_rental_period(
  p_usaha_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.command_preview_rental_period($1, $2, $3);
$function$;

REVOKE ALL ON FUNCTION public.command_preview_rental_period(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.command_preview_rental_period(uuid, timestamptz, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.command_preview_rental_period(uuid, timestamptz, timestamptz) FROM service_role;
GRANT EXECUTE ON FUNCTION public.command_preview_rental_period(uuid, timestamptz, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';