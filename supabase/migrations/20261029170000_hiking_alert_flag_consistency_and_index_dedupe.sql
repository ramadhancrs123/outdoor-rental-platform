BEGIN;

-- The alert rollout switch must govern both the Edge Function and direct
-- Data API/view reads. Return only a Boolean, and fail closed if the flag is absent.
CREATE OR REPLACE FUNCTION app_private.hiking_nowcast_alerts_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((
    SELECT f.is_enabled
    FROM public.hiking_feature_flags AS f
    WHERE f.flag_key = 'bmkg_nowcast_alerts_enabled'
  ), false);
$function$;

REVOKE ALL ON FUNCTION app_private.hiking_nowcast_alerts_enabled() FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA app_private TO anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.hiking_nowcast_alerts_enabled() TO anon, authenticated;

DROP POLICY IF EXISTS hiking_weather_alerts_public_read ON public.hiking_weather_alerts;
CREATE POLICY hiking_weather_alerts_public_read ON public.hiking_weather_alerts
  FOR SELECT TO anon, authenticated
  USING (
    (SELECT app_private.hiking_nowcast_alerts_enabled())
    AND status = 'Actual'
    AND message_type IN ('Alert', 'Update')
    AND COALESCE(effective_at, sent_at, now()) <= now()
    AND expires_at IS NOT NULL
    AND expires_at > now()
  );

DROP POLICY IF EXISTS hiking_weather_alert_areas_public_read ON public.hiking_weather_alert_areas;
CREATE POLICY hiking_weather_alert_areas_public_read ON public.hiking_weather_alert_areas
  FOR SELECT TO anon, authenticated
  USING (
    (SELECT app_private.hiking_nowcast_alerts_enabled())
    AND EXISTS (
      SELECT 1
      FROM public.hiking_weather_alerts AS a
      WHERE a.alert_id = hiking_weather_alert_areas.alert_id
        AND a.status = 'Actual'
        AND a.message_type IN ('Alert', 'Update')
        AND COALESCE(a.effective_at, a.sent_at, now()) <= now()
        AND a.expires_at IS NOT NULL
        AND a.expires_at > now()
    )
  );

-- Keep one partial unique index per invariant; the paired indexes have
-- identical definitions and enforce the same condition redundantly.
DROP INDEX IF EXISTS public.hiking_mountain_weather_areas_one_primary_idx;
DROP INDEX IF EXISTS public.hiking_trail_weather_areas_one_primary_idx;

COMMIT;
