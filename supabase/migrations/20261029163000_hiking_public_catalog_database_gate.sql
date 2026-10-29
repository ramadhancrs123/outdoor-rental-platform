BEGIN;

-- Public catalog visibility is controlled centrally and fails closed.
-- This helper exposes only one Boolean; it does not expose arbitrary feature flags.
CREATE OR REPLACE FUNCTION app_private.hiking_public_catalog_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((
    SELECT f.is_enabled
    FROM public.hiking_feature_flags AS f
    WHERE f.flag_key = 'public_hiking_catalog_enabled'
  ), false);
$function$;

REVOKE ALL ON FUNCTION app_private.hiking_public_catalog_enabled() FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA app_private TO anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.hiking_public_catalog_enabled() TO anon, authenticated;

DROP POLICY IF EXISTS hiking_sources_public_read ON public.hiking_data_sources;
CREATE POLICY hiking_sources_public_read ON public.hiking_data_sources
  FOR SELECT TO anon, authenticated
  USING (is_public AND is_active AND (SELECT app_private.hiking_public_catalog_enabled()));

DROP POLICY IF EXISTS hiking_operators_public_read ON public.hiking_operators;
CREATE POLICY hiking_operators_public_read ON public.hiking_operators
  FOR SELECT TO anon, authenticated
  USING (is_public AND verification_status = 'verified' AND (SELECT app_private.hiking_public_catalog_enabled()));

DROP POLICY IF EXISTS hiking_mountains_public_read ON public.hiking_mountains;
CREATE POLICY hiking_mountains_public_read ON public.hiking_mountains
  FOR SELECT TO anon, authenticated
  USING (publication_status = 'published' AND (SELECT app_private.hiking_public_catalog_enabled()));

DROP POLICY IF EXISTS hiking_trails_public_read ON public.hiking_trails;
CREATE POLICY hiking_trails_public_read ON public.hiking_trails
  FOR SELECT TO anon, authenticated
  USING (
    publication_status = 'published'
    AND (SELECT app_private.hiking_public_catalog_enabled())
    AND EXISTS (
      SELECT 1 FROM public.hiking_mountains m
      WHERE m.mountain_id = hiking_trails.mountain_id
        AND m.publication_status = 'published'
    )
  );

DROP POLICY IF EXISTS hiking_checkpoints_public_read ON public.hiking_checkpoints;
CREATE POLICY hiking_checkpoints_public_read ON public.hiking_checkpoints
  FOR SELECT TO anon, authenticated
  USING (
    publication_status = 'published'
    AND (SELECT app_private.hiking_public_catalog_enabled())
    AND EXISTS (
      SELECT 1 FROM public.hiking_trails t
      JOIN public.hiking_mountains m ON m.mountain_id = t.mountain_id
      WHERE t.trail_id = hiking_checkpoints.trail_id
        AND t.publication_status = 'published'
        AND m.publication_status = 'published'
    )
  );

DROP POLICY IF EXISTS hiking_weather_areas_public_read ON public.hiking_weather_areas;
CREATE POLICY hiking_weather_areas_public_read ON public.hiking_weather_areas
  FOR SELECT TO anon, authenticated
  USING (is_active AND (SELECT app_private.hiking_public_catalog_enabled()));

DROP POLICY IF EXISTS hiking_mountain_weather_areas_public_read ON public.hiking_mountain_weather_areas;
CREATE POLICY hiking_mountain_weather_areas_public_read ON public.hiking_mountain_weather_areas
  FOR SELECT TO anon, authenticated
  USING (
    (SELECT app_private.hiking_public_catalog_enabled())
    AND EXISTS (
      SELECT 1 FROM public.hiking_mountains m
      WHERE m.mountain_id = hiking_mountain_weather_areas.mountain_id
        AND m.publication_status = 'published'
    )
    AND EXISTS (
      SELECT 1 FROM public.hiking_weather_areas wa
      WHERE wa.weather_area_id = hiking_mountain_weather_areas.weather_area_id
        AND wa.is_active
    )
  );

DROP POLICY IF EXISTS hiking_trail_weather_areas_public_read ON public.hiking_trail_weather_areas;
CREATE POLICY hiking_trail_weather_areas_public_read ON public.hiking_trail_weather_areas
  FOR SELECT TO anon, authenticated
  USING (
    (SELECT app_private.hiking_public_catalog_enabled())
    AND EXISTS (
      SELECT 1 FROM public.hiking_trails t
      JOIN public.hiking_mountains m ON m.mountain_id = t.mountain_id
      WHERE t.trail_id = hiking_trail_weather_areas.trail_id
        AND t.publication_status = 'published'
        AND m.publication_status = 'published'
    )
    AND EXISTS (
      SELECT 1 FROM public.hiking_weather_areas wa
      WHERE wa.weather_area_id = hiking_trail_weather_areas.weather_area_id
        AND wa.is_active
    )
  );

DROP POLICY IF EXISTS hiking_safety_advisories_public_read ON public.hiking_safety_advisories;
CREATE POLICY hiking_safety_advisories_public_read ON public.hiking_safety_advisories
  FOR SELECT TO anon, authenticated
  USING (
    publication_status = 'published'
    AND (SELECT app_private.hiking_public_catalog_enabled())
    AND starts_at <= now()
    AND (expires_at IS NULL OR expires_at > now())
    AND (
      (mountain_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.hiking_mountains m
        WHERE m.mountain_id = hiking_safety_advisories.mountain_id
          AND m.publication_status = 'published'
      ))
      OR
      (trail_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.hiking_trails t
        JOIN public.hiking_mountains m ON m.mountain_id = t.mountain_id
        WHERE t.trail_id = hiking_safety_advisories.trail_id
          AND t.publication_status = 'published'
          AND m.publication_status = 'published'
      ))
    )
  );

DROP POLICY IF EXISTS hiking_daily_quotas_public_read ON public.hiking_daily_quotas;
CREATE POLICY hiking_daily_quotas_public_read ON public.hiking_daily_quotas
  FOR SELECT TO anon, authenticated
  USING (
    (SELECT app_private.hiking_public_catalog_enabled())
    AND is_official
    AND verified_at IS NOT NULL
    AND verified_at >= (now() - interval '24 hours')
    AND (valid_until IS NULL OR valid_until > now())
    AND EXISTS (
      SELECT 1 FROM public.hiking_trails t
      JOIN public.hiking_mountains m ON m.mountain_id = t.mountain_id
      WHERE t.trail_id = hiking_daily_quotas.trail_id
        AND t.publication_status = 'published'
        AND m.publication_status = 'published'
    )
  );

DROP POLICY IF EXISTS hiking_media_public_read ON public.hiking_media;
CREATE POLICY hiking_media_public_read ON public.hiking_media
  FOR SELECT TO anon, authenticated
  USING (
    (SELECT app_private.hiking_public_catalog_enabled())
    AND bucket_id = 'hiking-public-media'
    AND publication_status = 'published'
    AND permission_status IN ('verified_open','permission_granted')
    AND (
      (mountain_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.hiking_mountains m
        WHERE m.mountain_id = hiking_media.mountain_id
          AND m.publication_status = 'published'
      ))
      OR
      (trail_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.hiking_trails t
        JOIN public.hiking_mountains m ON m.mountain_id = t.mountain_id
        WHERE t.trail_id = hiking_media.trail_id
          AND t.publication_status = 'published'
          AND m.publication_status = 'published'
      ))
    )
  );

COMMIT;
