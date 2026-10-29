BEGIN;

ALTER TABLE public.hiking_media
  ADD COLUMN IF NOT EXISTS content_sha256 text;
ALTER TABLE public.hiking_media
  DROP CONSTRAINT IF EXISTS hiking_media_content_sha256_format;
ALTER TABLE public.hiking_media
  ADD CONSTRAINT hiking_media_content_sha256_format
  CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[a-fA-F0-9]{64}$');
CREATE INDEX IF NOT EXISTS hiking_media_content_sha256_idx
  ON public.hiking_media (content_sha256) WHERE content_sha256 IS NOT NULL;

COMMENT ON COLUMN public.hiking_media.content_sha256 IS
  'SHA-256 checksum of uploaded media bytes for duplicate detection and provenance verification.';

COMMIT;