BEGIN;

ALTER TABLE public.hiking_media
  ALTER COLUMN bucket_id SET DEFAULT 'hiking-media-staging';
ALTER TABLE public.hiking_media
  DROP CONSTRAINT IF EXISTS hiking_media_target_path;
ALTER TABLE public.hiking_media
  ADD CONSTRAINT hiking_media_target_path CHECK (
    bucket_id IN ('hiking-media-staging','hiking-public-media')
    AND storage_path !~ '(^/|\.\.|\\)'
  );

DROP POLICY IF EXISTS hiking_media_public_read ON public.hiking_media;
CREATE POLICY hiking_media_public_read ON public.hiking_media
  FOR SELECT TO anon, authenticated
  USING (
    bucket_id='hiking-public-media'
    AND publication_status='published'
    AND permission_status IN ('verified_open','permission_granted')
    AND (
      (mountain_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.hiking_mountains m WHERE m.mountain_id=hiking_media.mountain_id AND m.publication_status='published'))
      OR
      (trail_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.hiking_trails t JOIN public.hiking_mountains m ON m.mountain_id=t.mountain_id WHERE t.trail_id=hiking_media.trail_id AND t.publication_status='published' AND m.publication_status='published'))
    )
  );

CREATE OR REPLACE VIEW public.v_public_hiking_media
WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  media.media_id, media.mountain_id, m.slug AS mountain_slug,
  media.trail_id, t.slug AS trail_slug, media.media_type, media.bucket_id,
  media.storage_path, media.alt_text, media.caption, media.sort_order,
  media.source_reference_url, media.permission_status, media.verified_at
FROM public.hiking_media media
LEFT JOIN public.hiking_mountains m ON m.mountain_id=media.mountain_id AND m.publication_status='published'
LEFT JOIN public.hiking_trails t ON t.trail_id=media.trail_id AND t.publication_status='published'
WHERE media.bucket_id='hiking-public-media'
  AND media.publication_status='published'
  AND media.permission_status IN ('verified_open','permission_granted')
  AND ((media.mountain_id IS NOT NULL AND m.mountain_id IS NOT NULL)
    OR (media.trail_id IS NOT NULL AND t.trail_id IS NOT NULL));

INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES (
  'hiking-media-staging','hiking-media-staging',false,10485760,
  ARRAY['image/jpeg','image/png','image/webp','image/avif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public=false,
  file_size_limit=10485760,
  allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp','image/avif']::text[];

-- No anon/authenticated Storage policies for the staging bucket; only trusted backend storage operations.
COMMIT;