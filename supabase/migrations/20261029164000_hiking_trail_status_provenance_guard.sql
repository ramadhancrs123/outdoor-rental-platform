CREATE OR REPLACE FUNCTION public.hiking_admin_set_trail_status(
  p_trail_id uuid,
  p_new_status text,
  p_source_id uuid,
  p_source_url text,
  p_verification_status text,
  p_notes text,
  p_actor_admin_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_old_status text;
  v_history_id uuid;
  v_source public.hiking_data_sources%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.akun_admin aa
    WHERE aa.akun_admin_id = p_actor_admin_id
      AND aa.status = 'active'
      AND aa.role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'ACTIVE_SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF p_new_status IS NULL OR p_new_status NOT IN ('open','closed','limited','temporarily_suspended','unknown') THEN
    RAISE EXCEPTION 'INVALID_TRAIL_STATUS' USING ERRCODE = '22023';
  END IF;

  IF p_new_status = 'unknown' THEN
    -- Unknown is an explicit fail-safe state and must not carry a false verification claim.
    p_source_id := NULL;
    p_source_url := NULL;
    p_verification_status := 'unverified';
  ELSE
    IF p_verification_status NOT IN ('official','operator_verified') THEN
      RAISE EXCEPTION 'VERIFIED_SOURCE_REQUIRED_FOR_PUBLIC_TRAIL_STATUS' USING ERRCODE = '42501';
    END IF;
    IF p_source_id IS NULL OR p_source_url IS NULL OR p_source_url !~* '^https://' THEN
      RAISE EXCEPTION 'TRAIL_STATUS_SOURCE_REQUIRED' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_source
    FROM public.hiking_data_sources
    WHERE source_id = p_source_id
    FOR SHARE;

    IF NOT FOUND OR v_source.is_active IS NOT TRUE
       OR v_source.permission_status NOT IN ('verified_open','permission_granted') THEN
      RAISE EXCEPTION 'TRAIL_STATUS_SOURCE_PERMISSION_NOT_CLEARED' USING ERRCODE = '42501';
    END IF;

    IF p_verification_status = 'official' AND v_source.source_type <> 'official_agency' THEN
      RAISE EXCEPTION 'OFFICIAL_TRAIL_STATUS_REQUIRES_OFFICIAL_AGENCY_SOURCE' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT t.operational_status INTO v_old_status
  FROM public.hiking_trails t
  WHERE t.trail_id = p_trail_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRAIL_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.hiking_trails
  SET operational_status = p_new_status,
      operational_status_source_id = p_source_id,
      operational_status_source_url = p_source_url,
      operational_status_checked_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE trail_id = p_trail_id;

  INSERT INTO public.hiking_trail_status_history (
    trail_id, previous_status, new_status, source_id, source_url,
    effective_at, checked_at, recorded_by_admin_id, verification_status, notes
  ) VALUES (
    p_trail_id, v_old_status, p_new_status, p_source_id, p_source_url,
    pg_catalog.now(), pg_catalog.now(), p_actor_admin_id, p_verification_status,
    NULLIF(pg_catalog.btrim(COALESCE(p_notes, '')), '')
  ) RETURNING history_id INTO v_history_id;

  RETURN v_history_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.hiking_admin_set_trail_status(uuid,text,uuid,text,text,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hiking_admin_set_trail_status(uuid,text,uuid,text,text,text,uuid)
  TO service_role;
