BEGIN;

-- Complete the provider relationship after both isolated hiking tables exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hiking_trails_booking_provider_fk'
      AND conrelid = 'public.hiking_trails'::regclass
  ) THEN
    ALTER TABLE public.hiking_trails
      ADD CONSTRAINT hiking_trails_booking_provider_fk
      FOREIGN KEY (booking_provider_id)
      REFERENCES public.hiking_booking_providers(provider_id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Make the first future client contract explicit: public views are read-only.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.hiking_data_sources, public.hiking_operators, public.hiking_mountains,
  public.hiking_trails, public.hiking_checkpoints, public.hiking_weather_areas,
  public.hiking_mountain_weather_areas, public.hiking_trail_weather_areas,
  public.hiking_safety_advisories, public.hiking_daily_quotas,
  public.hiking_weather_alerts, public.hiking_weather_alert_areas
FROM anon, authenticated;

-- No public/authenticated access to booking PII, integration state, raw route files,
-- raw CAP documents, caches, or operational audit tables.
REVOKE ALL ON public.hiking_route_imports, public.hiking_trail_status_history,
  public.hiking_weather_cache, public.hiking_weather_alert_feed_state,
  public.hiking_booking_providers, public.hiking_feature_flags,
  public.hiking_bookings, public.hiking_booking_participants, public.hiking_booking_events
FROM anon, authenticated;

COMMIT;