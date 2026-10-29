CREATE OR REPLACE FUNCTION public.hiking_admin_map_weather_area(
  p_target_type text,
  p_target_id uuid,
  p_weather_area_id uuid,
  p_purpose text,
  p_is_primary boolean,
  p_source_reference_url text,
  p_actor_admin_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_active boolean;
  v_result jsonb;
BEGIN
  IF p_target_type IS NULL OR p_target_type NOT IN ('mountain','trail')
     OR p_target_id IS NULL OR p_weather_area_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_WEATHER_MAPPING_TARGET' USING ERRCODE = '22023';
  END IF;
  IF p_source_reference_url IS NULL OR p_source_reference_url !~* '^https://' THEN
    RAISE EXCEPTION 'WEATHER_MAPPING_SOURCE_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF p_purpose IS NULL THEN
    RAISE EXCEPTION 'INVALID_WEATHER_MAPPING_PURPOSE' USING ERRCODE = '22023';
  END IF;
  IF p_target_type = 'mountain' AND p_purpose NOT IN ('basecamp','mountain_foot','nearby','reference') THEN
    RAISE EXCEPTION 'INVALID_MOUNTAIN_MAPPING_PURPOSE' USING ERRCODE = '22023';
  END IF;
  IF p_target_type = 'trail' AND p_purpose NOT IN ('basecamp','trail_head','nearby','reference') THEN
    RAISE EXCEPTION 'INVALID_TRAIL_MAPPING_PURPOSE' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.akun_admin a
    WHERE a.akun_admin_id = p_actor_admin_id
      AND a.role = 'super_admin'
      AND a.status = 'active'
  ) THEN
    RAISE EXCEPTION 'ACTIVE_SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT wa.is_active INTO v_active
  FROM public.hiking_weather_areas wa
  WHERE wa.weather_area_id = p_weather_area_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WEATHER_AREA_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'WEATHER_AREA_INACTIVE' USING ERRCODE = '23514';
  END IF;

  IF p_target_type = 'mountain' THEN
    PERFORM 1 FROM public.hiking_mountains m
    WHERE m.mountain_id = p_target_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'MOUNTAIN_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF COALESCE(p_is_primary, false) THEN
      UPDATE public.hiking_mountain_weather_areas
      SET is_primary = false WHERE mountain_id = p_target_id;
    END IF;
    INSERT INTO public.hiking_mountain_weather_areas
      (mountain_id, weather_area_id, purpose, is_primary, verified_at, source_reference_url)
    VALUES (p_target_id, p_weather_area_id, p_purpose, COALESCE(p_is_primary, false), now(), p_source_reference_url)
    ON CONFLICT (mountain_id, weather_area_id, purpose)
    DO UPDATE SET is_primary = EXCLUDED.is_primary, verified_at = EXCLUDED.verified_at,
                  source_reference_url = EXCLUDED.source_reference_url
    RETURNING jsonb_build_object(
      'mountain_id', mountain_id, 'weather_area_id', weather_area_id,
      'purpose', purpose, 'is_primary', is_primary,
      'verified_at', verified_at, 'source_reference_url', source_reference_url
    ) INTO v_result;
  ELSE
    PERFORM 1 FROM public.hiking_trails t
    WHERE t.trail_id = p_target_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TRAIL_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF COALESCE(p_is_primary, false) THEN
      UPDATE public.hiking_trail_weather_areas
      SET is_primary = false WHERE trail_id = p_target_id;
    END IF;
    INSERT INTO public.hiking_trail_weather_areas
      (trail_id, weather_area_id, purpose, is_primary, verified_at, source_reference_url)
    VALUES (p_target_id, p_weather_area_id, p_purpose, COALESCE(p_is_primary, false), now(), p_source_reference_url)
    ON CONFLICT (trail_id, weather_area_id, purpose)
    DO UPDATE SET is_primary = EXCLUDED.is_primary, verified_at = EXCLUDED.verified_at,
                  source_reference_url = EXCLUDED.source_reference_url
    RETURNING jsonb_build_object(
      'trail_id', trail_id, 'weather_area_id', weather_area_id,
      'purpose', purpose, 'is_primary', is_primary,
      'verified_at', verified_at, 'source_reference_url', source_reference_url
    ) INTO v_result;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.hiking_admin_map_weather_area(text,uuid,uuid,text,boolean,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hiking_admin_map_weather_area(text,uuid,uuid,text,boolean,text,uuid)
  TO service_role;
