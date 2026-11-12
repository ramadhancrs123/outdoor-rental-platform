-- Cover the archive actor foreign key and avoid a currently unused date index.
CREATE INDEX IF NOT EXISTS idx_akasha_smart_booking_archive_archived_by
  ON app_private.akasha_smart_booking_archive (archived_by);

DROP INDEX IF EXISTS app_private.idx_akasha_smart_booking_archive_archived_at;
