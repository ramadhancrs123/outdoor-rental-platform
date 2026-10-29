BEGIN;

-- Cover every hiking-domain FK flagged by Supabase's performance advisor.
-- No existing rental/admin table or index is modified.
CREATE INDEX IF NOT EXISTS hiking_admin_audit_actor_admin_idx ON public.hiking_admin_audit (actor_admin_id);
CREATE INDEX IF NOT EXISTS hiking_booking_events_booking_idx ON public.hiking_booking_events (booking_id);
CREATE INDEX IF NOT EXISTS hiking_booking_providers_source_idx ON public.hiking_booking_providers (source_id);
CREATE INDEX IF NOT EXISTS hiking_bookings_provider_idx ON public.hiking_bookings (provider_id);
CREATE INDEX IF NOT EXISTS hiking_bookings_trail_idx ON public.hiking_bookings (trail_id);
CREATE INDEX IF NOT EXISTS hiking_checkpoints_elevation_source_idx ON public.hiking_checkpoints (elevation_source_id);
CREATE INDEX IF NOT EXISTS hiking_checkpoints_source_idx ON public.hiking_checkpoints (source_id);
CREATE INDEX IF NOT EXISTS hiking_daily_quotas_source_idx ON public.hiking_daily_quotas (source_id);
CREATE INDEX IF NOT EXISTS hiking_media_source_idx ON public.hiking_media (source_id);
CREATE INDEX IF NOT EXISTS hiking_media_verified_by_admin_idx ON public.hiking_media (verified_by_admin_id);
CREATE INDEX IF NOT EXISTS hiking_mountain_weather_areas_weather_area_idx ON public.hiking_mountain_weather_areas (weather_area_id);
CREATE INDEX IF NOT EXISTS hiking_mountains_operator_idx ON public.hiking_mountains (operator_id);
CREATE INDEX IF NOT EXISTS hiking_mountains_primary_source_idx ON public.hiking_mountains (primary_source_id);
CREATE INDEX IF NOT EXISTS hiking_mountains_volcanic_status_source_idx ON public.hiking_mountains (volcanic_status_source_id);
CREATE INDEX IF NOT EXISTS hiking_operators_source_idx ON public.hiking_operators (source_id);
CREATE INDEX IF NOT EXISTS hiking_route_imports_imported_by_admin_idx ON public.hiking_route_imports (imported_by_admin_id);
CREATE INDEX IF NOT EXISTS hiking_route_imports_reviewed_by_admin_idx ON public.hiking_route_imports (reviewed_by_admin_id);
CREATE INDEX IF NOT EXISTS hiking_route_imports_source_idx ON public.hiking_route_imports (source_id);
CREATE INDEX IF NOT EXISTS hiking_route_imports_trail_idx ON public.hiking_route_imports (trail_id);
CREATE INDEX IF NOT EXISTS hiking_route_versions_created_by_admin_idx ON public.hiking_route_versions (created_by_admin_id);
CREATE INDEX IF NOT EXISTS hiking_route_versions_import_idx ON public.hiking_route_versions (import_id);
CREATE INDEX IF NOT EXISTS hiking_route_versions_source_idx ON public.hiking_route_versions (source_id);
CREATE INDEX IF NOT EXISTS hiking_safety_advisories_mountain_idx ON public.hiking_safety_advisories (mountain_id);
CREATE INDEX IF NOT EXISTS hiking_safety_advisories_recorded_by_admin_idx ON public.hiking_safety_advisories (recorded_by_admin_id);
CREATE INDEX IF NOT EXISTS hiking_safety_advisories_source_idx ON public.hiking_safety_advisories (source_id);
CREATE INDEX IF NOT EXISTS hiking_safety_advisories_trail_idx ON public.hiking_safety_advisories (trail_id);
CREATE INDEX IF NOT EXISTS hiking_trail_status_history_recorded_by_admin_idx ON public.hiking_trail_status_history (recorded_by_admin_id);
CREATE INDEX IF NOT EXISTS hiking_trail_status_history_source_idx ON public.hiking_trail_status_history (source_id);
CREATE INDEX IF NOT EXISTS hiking_trail_weather_areas_weather_area_idx ON public.hiking_trail_weather_areas (weather_area_id);
CREATE INDEX IF NOT EXISTS hiking_trails_booking_provider_idx ON public.hiking_trails (booking_provider_id);
CREATE INDEX IF NOT EXISTS hiking_trails_difficulty_grade_source_idx ON public.hiking_trails (difficulty_grade_source_id);
CREATE INDEX IF NOT EXISTS hiking_trails_operational_status_source_idx ON public.hiking_trails (operational_status_source_id);
CREATE INDEX IF NOT EXISTS hiking_trails_operator_idx ON public.hiking_trails (operator_id);
CREATE INDEX IF NOT EXISTS hiking_trails_route_source_idx ON public.hiking_trails (route_source_id);

COMMIT;