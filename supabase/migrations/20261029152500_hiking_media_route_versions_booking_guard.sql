BEGIN;

CREATE TABLE IF NOT EXISTS public.hiking_media (
  media_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mountain_id uuid REFERENCES public.hiking_mountains(mountain_id) ON DELETE CASCADE,
  trail_id uuid REFERENCES public.hiking_trails(trail_id) ON DELETE CASCADE,
  bucket_id text NOT NULL DEFAULT 'hiking-public-media',
  storage_path text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('cover','gallery','route_preview','basecamp','operator_logo','other')),
  alt_text text NOT NULL,
  caption text,
  sort_order integer NOT NULL DEFAULT 0,
  source_id uuid REFERENCES public.hiking_data_sources(source_id) ON DELETE SET NULL,
  source_reference_url text,
  permission_status text NOT NULL DEFAULT 'unknown'
    CHECK (permission_status IN ('verified_open','permission_granted','permission_required','unknown','restricted')),
  publication_status text NOT NULL DEFAULT 'draft'
    CHECK (publication_status IN ('draft','pending_review','published','archived')),
  verified_by_admin_id uuid REFERENCES public.akun_admin(akun_admin_id) ON DELETE SET NULL,
  verified_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hiking_media_exactly_one_target CHECK (
    ((mountain_id IS NOT NULL)::integer + (trail_id IS NOT NULL)::integer) = 1
  ),
  CONSTRAINT hiking_media_path_unique UNIQUE (bucket_id, storage_path),
  CONSTRAINT hiking_media_alt_text_len CHECK (char_length(btrim(alt_text)) BETWEEN 3 AND 240),
  CONSTRAINT hiking_media_publication_guard CHECK (
    publication_status <> 'published'
    OR (
      published_at IS NOT NULL AND verified_at IS NOT NULL
      AND permission_status IN ('verified_open','permission_granted')
      AND source_reference_url IS NOT NULL
    )
  ),
  CONSTRAINT hiking_media_target_path CHECK (
    bucket_id = 'hiking-public-media'
    AND storage_path !~ '(^/|\.\.|\\)'
  ),
  CONSTRAINT hiking_media_source_url_https CHECK (source_reference_url IS NULL OR source_reference_url ~* '^https://')
);
CREATE INDEX IF NOT EXISTS hiking_media_mountain_public_idx
  ON public.hiking_media (mountain_id, sort_order) WHERE publication_status='published';
CREATE INDEX IF NOT EXISTS hiking_media_trail_public_idx
  ON public.hiking_media (trail_id, sort_order) WHERE publication_status='published';
ALTER TABLE public.hiking_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY hiking_media_public_read ON public.hiking_media
  FOR SELECT TO anon, authenticated
  USING (
    publication_status='published'
    AND permission_status IN ('verified_open','permission_granted')
    AND (
      (mountain_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.hiking_mountains m WHERE m.mountain_id=hiking_media.mountain_id AND m.publication_status='published'))
      OR
      (trail_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.hiking_trails t JOIN public.hiking_mountains m ON m.mountain_id=t.mountain_id WHERE t.trail_id=hiking_media.trail_id AND t.publication_status='published' AND m.publication_status='published'))
    )
  );
REVOKE ALL ON public.hiking_media FROM anon, authenticated;
GRANT SELECT ON public.hiking_media TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hiking_media TO service_role;

CREATE TABLE IF NOT EXISTS public.hiking_route_versions (
  route_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trail_id uuid NOT NULL REFERENCES public.hiking_trails(trail_id) ON DELETE RESTRICT,
  import_id uuid REFERENCES public.hiking_route_imports(import_id) ON DELETE SET NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  route_geojson jsonb NOT NULL,
  route_geometry extensions.geometry(MultiLineString,4326),
  distance_m integer CHECK (distance_m IS NULL OR distance_m >= 0),
  elevation_gain_m integer CHECK (elevation_gain_m IS NULL OR elevation_gain_m >= 0),
  checkpoint_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_id uuid REFERENCES public.hiking_data_sources(source_id) ON DELETE SET NULL,
  source_reference_url text,
  source_version text,
  license_review_status text NOT NULL
    CHECK (license_review_status IN ('approved','not_required')),
  validation_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  change_reason text NOT NULL,
  created_by_admin_id uuid REFERENCES public.akun_admin(akun_admin_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trail_id, version_number),
  CONSTRAINT hiking_route_version_geojson_type CHECK (
    jsonb_typeof(route_geojson)='object'
    AND route_geojson->>'type' IN ('LineString','MultiLineString')
  ),
  CONSTRAINT hiking_route_version_source_https CHECK (source_reference_url IS NULL OR source_reference_url ~* '^https://'),
  CONSTRAINT hiking_route_version_geometry_valid CHECK (
    route_geometry IS NULL OR (extensions.ST_IsValid(route_geometry) AND extensions.ST_NPoints(route_geometry) >= 2)
  )
);
ALTER TABLE public.hiking_route_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hiking_route_versions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hiking_route_versions TO service_role;
CREATE INDEX IF NOT EXISTS hiking_route_versions_trail_latest_idx
  ON public.hiking_route_versions (trail_id, version_number DESC);

CREATE OR REPLACE FUNCTION app_private.guard_hiking_booking_disabled()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_enabled boolean;
BEGIN
  SELECT f.is_enabled INTO v_enabled
  FROM public.hiking_feature_flags f
  WHERE f.flag_key='hiking_ticket_booking_enabled';

  IF COALESCE(v_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Hiking ticket booking is disabled during preparation.'
      USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION app_private.guard_hiking_booking_disabled() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_guard_hiking_bookings_disabled ON public.hiking_bookings;
CREATE TRIGGER trg_guard_hiking_bookings_disabled
  BEFORE INSERT OR UPDATE ON public.hiking_bookings
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_hiking_booking_disabled();
DROP TRIGGER IF EXISTS trg_guard_hiking_booking_participants_disabled ON public.hiking_booking_participants;
CREATE TRIGGER trg_guard_hiking_booking_participants_disabled
  BEFORE INSERT OR UPDATE ON public.hiking_booking_participants
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_hiking_booking_disabled();

CREATE OR REPLACE FUNCTION app_private.sync_hiking_route_version_geometry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_geom extensions.geometry;
BEGIN
  v_geom := extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(NEW.route_geojson::text),4326);
  NEW.route_geometry := extensions.ST_Multi(v_geom);
  IF NOT extensions.ST_IsValid(NEW.route_geometry) OR extensions.ST_NPoints(NEW.route_geometry) < 2 THEN
    RAISE EXCEPTION 'Route version geometry is invalid.' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION app_private.sync_hiking_route_version_geometry() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_sync_hiking_route_version_geometry ON public.hiking_route_versions;
CREATE TRIGGER trg_sync_hiking_route_version_geometry
  BEFORE INSERT OR UPDATE OF route_geojson ON public.hiking_route_versions
  FOR EACH ROW EXECUTE FUNCTION app_private.sync_hiking_route_version_geometry();

CREATE OR REPLACE VIEW public.v_public_hiking_media
WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  media.media_id,
  media.mountain_id,
  m.slug AS mountain_slug,
  media.trail_id,
  t.slug AS trail_slug,
  media.media_type,
  media.bucket_id,
  media.storage_path,
  media.alt_text,
  media.caption,
  media.sort_order,
  media.source_reference_url,
  media.permission_status,
  media.verified_at
FROM public.hiking_media media
LEFT JOIN public.hiking_mountains m ON m.mountain_id=media.mountain_id AND m.publication_status='published'
LEFT JOIN public.hiking_trails t ON t.trail_id=media.trail_id AND t.publication_status='published'
WHERE media.publication_status='published'
  AND media.permission_status IN ('verified_open','permission_granted')
  AND ((media.mountain_id IS NOT NULL AND m.mountain_id IS NOT NULL)
    OR (media.trail_id IS NOT NULL AND t.trail_id IS NOT NULL));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.v_public_hiking_media FROM anon, authenticated;
GRANT SELECT ON public.v_public_hiking_media TO anon, authenticated;

INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES (
  'hiking-public-media','hiking-public-media',true,10485760,
  ARRAY['image/jpeg','image/png','image/webp','image/avif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public=true,
  file_size_limit=10485760,
  allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp','image/avif']::text[];

COMMIT;