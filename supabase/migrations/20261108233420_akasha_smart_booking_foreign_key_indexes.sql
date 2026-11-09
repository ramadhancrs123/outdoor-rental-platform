-- Additive query-planning indexes for AKASHA SMART BOOKING foreign keys.
-- These indexes are isolated to the app_private booking bounded context.
-- No operational rental, catalog, sales, or inventory table is changed.

CREATE INDEX IF NOT EXISTS akasha_smart_booking_permintaan_fk_idx
  ON app_private.akasha_smart_booking (permintaan_sewa_id)
  WHERE permintaan_sewa_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS akasha_smart_booking_penyewa_fk_idx
  ON app_private.akasha_smart_booking (penyewa_id)
  WHERE penyewa_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS akasha_smart_booking_reviewed_by_fk_idx
  ON app_private.akasha_smart_booking (reviewed_by)
  WHERE reviewed_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS akasha_smart_booking_access_tenant_fk_idx
  ON app_private.akasha_smart_booking_customer_access (usaha_id, smart_booking_id);

CREATE INDEX IF NOT EXISTS akasha_smart_booking_session_tenant_fk_idx
  ON app_private.akasha_smart_booking_customer_session (usaha_id, smart_booking_id);

CREATE INDEX IF NOT EXISTS akasha_smart_booking_session_access_fk_idx
  ON app_private.akasha_smart_booking_customer_session (smart_booking_access_id);

CREATE INDEX IF NOT EXISTS akasha_smart_booking_change_tenant_fk_idx
  ON app_private.akasha_smart_booking_change_request (usaha_id, smart_booking_id);

CREATE INDEX IF NOT EXISTS akasha_smart_booking_change_requested_by_fk_idx
  ON app_private.akasha_smart_booking_change_request (requested_by_admin_id)
  WHERE requested_by_admin_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS akasha_smart_booking_change_resolved_by_fk_idx
  ON app_private.akasha_smart_booking_change_request (resolved_by_admin_id)
  WHERE resolved_by_admin_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS akasha_smart_booking_event_tenant_fk_idx
  ON app_private.akasha_smart_booking_activity_event (usaha_id, smart_booking_id);

CREATE INDEX IF NOT EXISTS akasha_smart_booking_event_actor_fk_idx
  ON app_private.akasha_smart_booking_activity_event (actor_admin_id)
  WHERE actor_admin_id IS NOT NULL;
