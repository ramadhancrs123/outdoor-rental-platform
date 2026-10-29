BEGIN;

-- Keep published hiking image objects private at the Storage layer.
-- The catalog Edge Function returns five-minute signed URLs only after checking
-- the catalog feature flag and published-media metadata. No public bucket bypass.
UPDATE storage.buckets
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/avif']::text[]
WHERE id = 'hiking-public-media';

DROP POLICY IF EXISTS hiking_published_media_storage_read ON storage.objects;
DROP POLICY IF EXISTS hiking_public_media_read ON storage.objects;
DROP POLICY IF EXISTS hiking_public_media_write ON storage.objects;

COMMIT;
