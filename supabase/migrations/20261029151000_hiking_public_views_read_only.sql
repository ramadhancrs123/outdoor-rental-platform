BEGIN;

-- Supabase projects may have broad default privileges on newly-created views.
-- Explicitly enforce a read-only public surface even if inherited defaults exist.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.v_public_hiking_mountains,
     public.v_public_hiking_trails,
     public.v_public_hiking_checkpoints,
     public.v_public_hiking_weather_alerts,
     public.v_public_hiking_safety_advisories,
     public.v_public_hiking_availability
FROM anon, authenticated;

GRANT SELECT
  ON public.v_public_hiking_mountains,
     public.v_public_hiking_trails,
     public.v_public_hiking_checkpoints,
     public.v_public_hiking_weather_alerts,
     public.v_public_hiking_safety_advisories,
     public.v_public_hiking_availability
TO anon, authenticated;

-- Never publish an alert without a finite, future expiry timestamp.
DROP POLICY IF EXISTS hiking_weather_alerts_public_read ON public.hiking_weather_alerts;
CREATE POLICY hiking_weather_alerts_public_read
  ON public.hiking_weather_alerts
  FOR SELECT TO anon, authenticated
  USING (
    status = 'Actual'
    AND message_type IN ('Alert','Update')
    AND COALESCE(effective_at, sent_at, now()) <= now()
    AND expires_at IS NOT NULL
    AND expires_at > now()
  );

DROP POLICY IF EXISTS hiking_weather_alert_areas_public_read ON public.hiking_weather_alert_areas;
CREATE POLICY hiking_weather_alert_areas_public_read
  ON public.hiking_weather_alert_areas
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hiking_weather_alerts a
      WHERE a.alert_id = hiking_weather_alert_areas.alert_id
        AND a.status = 'Actual'
        AND a.message_type IN ('Alert','Update')
        AND COALESCE(a.effective_at, a.sent_at, now()) <= now()
        AND a.expires_at IS NOT NULL
        AND a.expires_at > now()
    )
  );

CREATE OR REPLACE VIEW public.v_public_hiking_weather_alerts
WITH (security_invoker = true, security_barrier = true)
AS
SELECT a.alert_id, a.identifier, a.sender, a.sent_at, a.message_type, a.category,
  a.event, a.urgency, a.severity, a.certainty, a.headline, a.description, a.instruction,
  a.language, a.effective_at, a.onset_at, a.expires_at, a.web_url, a.source_url,
  a.last_fetched_at,
  'BMKG'::text AS source_name,
  'Sumber data: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)'::text AS source_attribution,
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'description', ar.area_description,
      'province', ar.province_name,
      'regency', ar.regency_name,
      'district', ar.district_name,
      'admin_codes', ar.admin_codes,
      'geometry', ar.area_geometry_geojson
    ) ORDER BY ar.area_description)
    FROM public.hiking_weather_alert_areas ar WHERE ar.alert_id = a.alert_id
  ), '[]'::jsonb) AS affected_areas
FROM public.hiking_weather_alerts a
WHERE a.status='Actual' AND a.message_type IN ('Alert','Update')
  AND COALESCE(a.effective_at, a.sent_at, now()) <= now()
  AND a.expires_at IS NOT NULL AND a.expires_at > now();

COMMIT;