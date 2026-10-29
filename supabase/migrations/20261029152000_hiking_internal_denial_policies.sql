BEGIN;

-- Explicit deny policies document the intended backend-only tables and avoid relying
-- solely on absent grants/default-deny behavior. service_role remains the trusted worker.
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'hiking_route_imports',
    'hiking_trail_status_history',
    'hiking_weather_cache',
    'hiking_weather_alert_feed_state',
    'hiking_booking_providers',
    'hiking_feature_flags',
    'hiking_bookings',
    'hiking_booking_participants',
    'hiking_booking_events'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_deny_client_roles', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      v_table || '_deny_client_roles', v_table
    );
  END LOOP;
END $$;

COMMIT;