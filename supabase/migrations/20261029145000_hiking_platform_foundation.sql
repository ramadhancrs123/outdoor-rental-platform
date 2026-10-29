BEGIN;

-- Isolated foundation for the hiking planning module. No existing rental tables,
-- policies, RPCs, Edge Functions, or admin UI are modified by this migration.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.hiking_data_sources (
  source_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN (
    'official_agency','basemap','trail_network','gpx_archive','elevation_dem',
    'weather_forecast','weather_alert','ticket_provider','community','other'
  )),
  source_url text,
  attribution_text text,
  license_name text,
  license_url text,
  permission_status text NOT NULL DEFAULT 'unknown'
    CHECK (permission_status IN ('verified_open','permission_granted','permission_required','unknown','restricted')),
  is_public boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.hiking_data_sources IS 'Catalog of provenance and usage conditions for hiking data. A source entry is not proof that every linked asset is reusable.';

CREATE TABLE IF NOT EXISTS public.hiking_operators (
  operator_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE,
  name text NOT NULL,
  operator_type text NOT NULL DEFAULT 'other'
    CHECK (operator_type IN ('national_park','nature_park','forest_area','basecamp','community','ticket_vendor','other')),
  province text,
  regency text,
  address text,
  public_phone text,
  public_email text,
  website_url text,
  official_booking_url text,
  verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified','pending','verified','rejected')),
  is_public boolean NOT NULL DEFAULT false,
  source_id uuid REFERENCES public.hiking_data_sources(source_id) ON DELETE SET NULL,
  source_reference_url text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hiking_operator_urls_https CHECK (
    (website_url IS NULL OR website_url ~* '^https?://')
    AND (official_booking_url IS NULL OR official_booking_url ~* '^https?://')
  )
);
COMMENT ON TABLE public.hiking_operators IS 'Public operator/basecamp metadata only; partner secrets and API credentials must never be stored here.';

CREATE TABLE IF NOT EXISTS public.hiking_mountains (
  mountain_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  description text,
  elevation_m integer CHECK (elevation_m IS NULL OR elevation_m BETWEEN 0 AND 9000),
  province text,
  regency text,
  latitude numeric(9,6) CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  is_volcanic boolean NOT NULL DEFAULT false,
  volcanic_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (volcanic_status IN ('normal','waspada','siaga','awas','unknown','not_applicable')),
  volcanic_status_source_id uuid REFERENCES public.hiking_data_sources(source_id) ON DELETE SET NULL,
  volcanic_status_source_url text,
  volcanic_status_checked_at timestamptz,
  operator_id uuid REFERENCES public.hiking_operators(operator_id) ON DELETE SET NULL,
  primary_source_id uuid REFERENCES public.hiking_data_sources(source_id) ON DELETE SET NULL,
  source_reference_url text,
  publication_status text NOT NULL DEFAULT 'draft'
    CHECK (publication_status IN ('draft','pending_review','published','archived')),
  published_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hiking_mountain_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT hiking_mountain_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  CONSTRAINT hiking_mountain_published_verified CHECK (
    publication_status <> 'published' OR (published_at IS NOT NULL AND verified_at IS NOT NULL)
  ),
  CONSTRAINT hiking_volcanic_status_consistency CHECK (
    (is_volcanic AND volcanic_status <> 'not_applicable')
    OR (NOT is_volcanic AND volcanic_status = 'not_applicable')
  )
);
COMMENT ON TABLE public.hiking_mountains IS 'Master destination catalog. Volcanic activity and route operational status are deliberately separate.';
COMMENT ON COLUMN public.hiking_mountains.volcanic_status IS 'Official volcanic activity status when relevant: Normal, Waspada, Siaga, Awas, or unknown. It is not a trail open/closed flag.';

CREATE TABLE IF NOT EXISTS public.hiking_trails (
  trail_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mountain_id uuid NOT NULL REFERENCES public.hiking_mountains(mountain_id) ON DELETE RESTRICT,
  operator_id uuid REFERENCES public.hiking_operators(operator_id) ON DELETE SET NULL,
  code text,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  basecamp_name text,
  basecamp_address text,
  basecamp_latitude numeric(9,6) CHECK (basecamp_latitude IS NULL OR basecamp_latitude BETWEEN -90 AND 90),
  basecamp_longitude numeric(9,6) CHECK (basecamp_longitude IS NULL OR basecamp_longitude BETWEEN -180 AND 180),
  route_geojson jsonb,
  route_geometry extensions.geometry(MultiLineString,4326),
  distance_m integer CHECK (distance_m IS NULL OR distance_m >= 0),
  elevation_gain_m integer CHECK (elevation_gain_m IS NULL OR elevation_gain_m >= 0),
  estimated_duration_minutes integer CHECK (estimated_duration_minutes IS NULL OR estimated_duration_minutes > 0),
  difficulty_grade smallint CHECK (difficulty_grade IS NULL OR difficulty_grade BETWEEN 1 AND 5),
  difficulty_grade_status text NOT NULL DEFAULT 'not_assessed'
    CHECK (difficulty_grade_status IN ('official','operator_verified','community_reference','not_assessed')),
  difficulty_grade_source_id uuid REFERENCES public.hiking_data_sources(source_id) ON DELETE SET NULL,
  difficulty_grade_source_url text,
  operational_status text NOT NULL DEFAULT 'unknown'
    CHECK (operational_status IN ('open','closed','limited','temporarily_suspended','unknown')),
  operational_status_source_id uuid REFERENCES public.hiking_data_sources(source_id) ON DELETE SET NULL,
  operational_status_source_url text,
  operational_status_checked_at timestamptz,
  daily_quota integer CHECK (daily_quota IS NULL OR daily_quota >= 0),
  quota_source_url text,
  booking_provider_id uuid,
  official_booking_url text,
  booking_link_verified_at timestamptz,
  route_source_id uuid REFERENCES public.hiking_data_sources(source_id) ON DELETE SET NULL,
  route_source_reference_url text,
  osm_relation_id bigint,
  source_version text,
  publication_status text NOT NULL DEFAULT 'draft'
    CHECK (publication_status IN ('draft','pending_review','published','archived')),
  published_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hiking_trail_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT hiking_trail_booking_url_https CHECK (official_booking_url IS NULL OR official_booking_url ~* '^https?://'),
  CONSTRAINT hiking_trail_published_verified CHECK (
    publication_status <> 'published' OR (published_at IS NOT NULL AND verified_at IS NOT NULL)
  ),
  CONSTRAINT hiking_trail_geometry_valid CHECK (
    route_geometry IS NULL OR (extensions.ST_IsValid(route_geometry) AND extensions.ST_NPoints(route_geometry) >= 2)
  ),
  UNIQUE (mountain_id, slug),
  UNIQUE (mountain_id, code)
);
COMMENT ON TABLE public.hiking_trails IS 'Trail definitions and route geometry. route_geojson is a GeoJSON LineString/MultiLineString; backend maintains synchronized PostGIS geometry for spatial checks.';
COMMENT ON COLUMN public.hiking_trails.operational_status IS 'Operational status from the trail operator; independent from volcanic activity status.';
COMMENT ON COLUMN public.hiking_trails.difficulty_grade_status IS 'A grade value is not automatically official; distinguish official/operator-verified ratings from community references.';

CREATE TABLE IF NOT EXISTS public.hiking_checkpoints (
  checkpoint_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trail_id uuid NOT NULL REFERENCES public.hiking_trails(trail_id) ON DELETE CASCADE,
  sequence_number integer NOT NULL CHECK (sequence_number >= 0),
  code text,
  name text NOT NULL,
  checkpoint_type text NOT NULL DEFAULT 'waypoint'
    CHECK (checkpoint_type IN ('basecamp','pos','water_source','camping_area','summit','emergency_point','viewpoint','shelter','waypoint','other')),
  description text,
  latitude numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  elevation_m integer CHECK (elevation_m IS NULL OR elevation_m BETWEEN -500 AND 9000),
  elevation_source_id uuid REFERENCES public.hiking_data_sources(source_id) ON DELETE SET NULL,
  elevation_source_url text,
  source_id uuid REFERENCES public.hiking_data_sources(source_id) ON DELETE SET NULL,
  source_reference_url text,
  publication_status text NOT NULL DEFAULT 'draft'
    CHECK (publication_status IN ('draft','pending_review','published','archived')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trail_id, sequence_number),
  UNIQUE (trail_id, code),
  CONSTRAINT hiking_checkpoint_published_verified CHECK (
    publication_status <> 'published' OR verified_at IS NOT NULL
  )
);
COMMENT ON TABLE public.hiking_checkpoints IS 'Ordered route waypoints; waypoint chains do not substitute for a validated route line.';

CREATE TABLE IF NOT EXISTS public.hiking_weather_areas (
  weather_area_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adm4_code text NOT NULL UNIQUE,
  village_name text NOT NULL,
  district_name text,
  regency_name text,
  province_name text NOT NULL,
  latitude numeric(9,6) CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  source_url text NOT NULL DEFAULT 'https://data.bmkg.go.id/prakiraan-cuaca/',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hiking_weather_adm4_format CHECK (adm4_code ~ '^[0-9]{2}\.[0-9]{2}\.[0-9]{2}\.[0-9]{4}$')
);
COMMENT ON TABLE public.hiking_weather_areas IS 'BMKG forecast reference at administrative level IV (desa/kelurahan). It does not imply a forecast specifically measured at a mountain summit.';

CREATE TABLE IF NOT EXISTS public.hiking_mountain_weather_areas (
  mountain_id uuid NOT NULL REFERENCES public.hiking_mountains(mountain_id) ON DELETE CASCADE,
  weather_area_id uuid NOT NULL REFERENCES public.hiking_weather_areas(weather_area_id) ON DELETE RESTRICT,
  purpose text NOT NULL DEFAULT 'reference' CHECK (purpose IN ('basecamp','mountain_foot','nearby','reference')),
  is_primary boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  source_reference_url text,
  PRIMARY KEY (mountain_id, weather_area_id, purpose)
);
CREATE UNIQUE INDEX IF NOT EXISTS hiking_mountain_primary_weather_area_uq
  ON public.hiking_mountain_weather_areas (mountain_id) WHERE is_primary;

CREATE TABLE IF NOT EXISTS public.hiking_trail_weather_areas (
  trail_id uuid NOT NULL REFERENCES public.hiking_trails(trail_id) ON DELETE CASCADE,
  weather_area_id uuid NOT NULL REFERENCES public.hiking_weather_areas(weather_area_id) ON DELETE RESTRICT,
  purpose text NOT NULL DEFAULT 'basecamp' CHECK (purpose IN ('basecamp','trail_head','nearby','reference')),
  is_primary boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  source_reference_url text,
  PRIMARY KEY (trail_id, weather_area_id, purpose)
);
CREATE UNIQUE INDEX IF NOT EXISTS hiking_trail_primary_weather_area_uq
  ON public.hiking_trail_weather_areas (trail_id) WHERE is_primary;

CREATE TABLE IF NOT EXISTS public.hiking_route_imports (
  import_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trail_id uuid REFERENCES public.hiking_trails(trail_id) ON DELETE SET NULL,
  source_id uuid REFERENCES public.hiking_data_sources(source_id) ON DELETE SET NULL,
  bucket_id text NOT NULL DEFAULT 'hiking-route-sources',
  storage_path text NOT NULL,
  original_filename text NOT NULL,
  content_sha256 text,
  file_format text NOT NULL DEFAULT 'gpx' CHECK (file_format IN ('gpx','kml','geojson')),
  source_version text,
  license_review_status text NOT NULL DEFAULT 'pending'
    CHECK (license_review_status IN ('pending','approved','rejected','not_required')),
  import_status text NOT NULL DEFAULT 'uploaded'
    CHECK (import_status IN ('uploaded','validated','pending_review','accepted','rejected','failed')),
  point_count integer CHECK (point_count IS NULL OR point_count >= 0),
  segment_count integer CHECK (segment_count IS NULL OR segment_count >= 0),
  calculated_distance_m integer CHECK (calculated_distance_m IS NULL OR calculated_distance_m >= 0),
  validation_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_by_admin_id uuid REFERENCES public.akun_admin(akun_admin_id) ON DELETE SET NULL,
  reviewed_by_admin_id uuid REFERENCES public.akun_admin(akun_admin_id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket_id, storage_path),
  CONSTRAINT hiking_route_import_sha256 CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[a-fA-F0-9]{64}$')
);
COMMENT ON TABLE public.hiking_route_imports IS 'Internal import ledger for route files. Storage path, validation reports and reviewer identities are not public API fields.';

CREATE TABLE IF NOT EXISTS public.hiking_trail_status_history (
  history_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trail_id uuid NOT NULL REFERENCES public.hiking_trails(trail_id) ON DELETE CASCADE,
  previous_status text CHECK (previous_status IS NULL OR previous_status IN ('open','closed','limited','temporarily_suspended','unknown')),
  new_status text NOT NULL CHECK (new_status IN ('open','closed','limited','temporarily_suspended','unknown')),
  source_id uuid REFERENCES public.hiking_data_sources(source_id) ON DELETE SET NULL,
  source_url text,
  effective_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz NOT NULL DEFAULT now(),
  recorded_by_admin_id uuid REFERENCES public.akun_admin(akun_admin_id) ON DELETE SET NULL,
  verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('official','operator_verified','community_reference','unverified')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hiking_weather_cache (
  adm4_code text PRIMARY KEY REFERENCES public.hiking_weather_areas(adm4_code) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  analysis_date timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  fresh_until timestamptz NOT NULL,
  fetch_status text NOT NULL DEFAULT 'success' CHECK (fetch_status IN ('success','stale','error')),
  last_error_code text,
  last_error_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.hiking_weather_cache IS 'Server-only cache for official BMKG forecast responses, keyed by ADM4 to avoid repeating upstream requests per visitor.';

CREATE TABLE IF NOT EXISTS public.hiking_weather_alert_feed_state (
  feed_key text PRIMARY KEY,
  last_success_at timestamptz,
  next_refresh_after timestamptz,
  etag text,
  last_error_code text,
  last_error_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hiking_weather_alerts (
  alert_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL UNIQUE,
  sender text,
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'Actual' CHECK (status IN ('Actual','Exercise','System','Test','Draft')),
  message_type text NOT NULL DEFAULT 'Alert' CHECK (message_type IN ('Alert','Update','Cancel','Ack','Error')),
  scope text,
  category text,
  event text,
  urgency text CHECK (urgency IS NULL OR urgency IN ('Immediate','Expected','Future','Past','Unknown')),
  severity text CHECK (severity IS NULL OR severity IN ('Extreme','Severe','Moderate','Minor','Unknown')),
  certainty text CHECK (certainty IS NULL OR certainty IN ('Observed','Likely','Possible','Unlikely','Unknown')),
  headline text,
  description text,
  instruction text,
  language text,
  effective_at timestamptz,
  onset_at timestamptz,
  expires_at timestamptz,
  web_url text,
  source_url text NOT NULL,
  raw_cap_xml text,
  content_sha256 text,
  last_fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.hiking_weather_alerts IS 'Internal normalized CAP alert record from BMKG nowcast. Raw CAP XML is private and never part of the public view.';

CREATE TABLE IF NOT EXISTS public.hiking_weather_alert_areas (
  alert_area_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES public.hiking_weather_alerts(alert_id) ON DELETE CASCADE,
  area_description text NOT NULL,
  province_name text,
  regency_name text,
  district_name text,
  admin_codes text[] NOT NULL DEFAULT '{}',
  area_geometry_geojson jsonb,
  altitude_m integer,
  ceiling_m integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hiking_weather_alerts_active_idx
  ON public.hiking_weather_alerts (expires_at, effective_at)
  WHERE status = 'Actual' AND message_type IN ('Alert','Update');
CREATE INDEX IF NOT EXISTS hiking_weather_alert_areas_codes_gin
  ON public.hiking_weather_alert_areas USING gin (admin_codes);

CREATE TABLE IF NOT EXISTS public.hiking_safety_advisories (
  advisory_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mountain_id uuid REFERENCES public.hiking_mountains(mountain_id) ON DELETE CASCADE,
  trail_id uuid REFERENCES public.hiking_trails(trail_id) ON DELETE CASCADE,
  advisory_type text NOT NULL CHECK (advisory_type IN (
    'closure','weather','landslide','flood','wildfire','volcanic','earthquake',
    'wildlife','infrastructure','health','other'
  )),
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','watch','warning','critical')),
  title text NOT NULL,
  description text NOT NULL,
  instruction text,
  source_id uuid REFERENCES public.hiking_data_sources(source_id) ON DELETE SET NULL,
  source_url text,
  official_source boolean NOT NULL DEFAULT false,
  verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('official','operator_verified','community_reference','unverified')),
  publication_status text NOT NULL DEFAULT 'draft'
    CHECK (publication_status IN ('draft','pending_review','published','resolved','archived')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  published_at timestamptz,
  verified_at timestamptz,
  recorded_by_admin_id uuid REFERENCES public.akun_admin(akun_admin_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hiking_advisory_exactly_one_target CHECK (
    ((mountain_id IS NOT NULL)::integer + (trail_id IS NOT NULL)::integer) = 1
  ),
  CONSTRAINT hiking_advisory_expiry_after_start CHECK (expires_at IS NULL OR expires_at > starts_at),
  CONSTRAINT hiking_advisory_published_verified CHECK (
    publication_status <> 'published' OR (published_at IS NOT NULL AND verified_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS hiking_safety_advisories_public_idx
  ON public.hiking_safety_advisories (starts_at, expires_at, severity)
  WHERE publication_status = 'published';

CREATE TABLE IF NOT EXISTS public.hiking_daily_quotas (
  quota_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trail_id uuid NOT NULL REFERENCES public.hiking_trails(trail_id) ON DELETE CASCADE,
  hiking_date date NOT NULL,
  quota_total integer NOT NULL CHECK (quota_total >= 0),
  quota_reserved integer NOT NULL DEFAULT 0 CHECK (quota_reserved >= 0),
  source_id uuid REFERENCES public.hiking_data_sources(source_id) ON DELETE SET NULL,
  source_url text,
  is_official boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  valid_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trail_id, hiking_date),
  CONSTRAINT hiking_quota_reserved_not_over_total CHECK (quota_reserved <= quota_total),
  CONSTRAINT hiking_quota_validity CHECK (valid_until IS NULL OR verified_at IS NULL OR valid_until > verified_at)
);
COMMENT ON TABLE public.hiking_daily_quotas IS 'Date-specific quota snapshots; availability must not be described as live unless the source and freshness support that claim.';

CREATE TABLE IF NOT EXISTS public.hiking_booking_providers (
  provider_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  provider_type text NOT NULL DEFAULT 'operator'
    CHECK (provider_type IN ('government','national_park','operator','aggregator','other')),
  official_url text,
  booking_url text,
  integration_mode text NOT NULL DEFAULT 'disabled'
    CHECK (integration_mode IN ('disabled','link_only','manual','api')),
  integration_status text NOT NULL DEFAULT 'planned'
    CHECK (integration_status IN ('planned','reviewing','testing','active','suspended')),
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_id uuid REFERENCES public.hiking_data_sources(source_id) ON DELETE SET NULL,
  verified_at timestamptz,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hiking_provider_urls_https CHECK (
    (official_url IS NULL OR official_url ~* '^https?://')
    AND (booking_url IS NULL OR booking_url ~* '^https?://')
  ),
  CONSTRAINT hiking_provider_activation_guard CHECK (
    integration_status <> 'active' OR (is_active AND integration_mode IN ('link_only','manual','api') AND verified_at IS NOT NULL)
  )
);
COMMENT ON TABLE public.hiking_booking_providers IS 'Provider metadata only. API keys, signing secrets, payment credentials, and webhook secrets must be stored in Edge Function secrets, never in this table.';

CREATE TABLE IF NOT EXISTS public.hiking_feature_flags (
  flag_key text PRIMARY KEY,
  is_enabled boolean NOT NULL DEFAULT false,
  description text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.hiking_feature_flags (flag_key, is_enabled, description) VALUES
 ('public_hiking_catalog_enabled', false, 'Public hiking catalog is not released until frontend implementation and content QA are complete.'),
 ('bmkg_forecast_enabled', true, 'Backend forecast connector may be prepared; frontend exposure remains a separate release decision.'),
 ('bmkg_nowcast_alerts_enabled', true, 'Backend CAP alert ingestion may be prepared; frontend exposure remains a separate release decision.'),
 ('akasha_rental_booking_enabled', false, 'Akasha rental booking stays disabled; do not create live rental transactions from the hiking module.'),
 ('hiking_ticket_booking_enabled', false, 'Hiking ticket booking and payments must remain disabled until operator agreement and integration tests are approved.')
ON CONFLICT (flag_key) DO NOTHING;
COMMENT ON TABLE public.hiking_feature_flags IS 'Server-side rollout gates. Booking flags are seeded disabled and have no public write/read access.';

CREATE TABLE IF NOT EXISTS public.hiking_bookings (
  booking_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_reference text NOT NULL UNIQUE,
  trail_id uuid NOT NULL REFERENCES public.hiking_trails(trail_id) ON DELETE RESTRICT,
  provider_id uuid REFERENCES public.hiking_booking_providers(provider_id) ON DELETE RESTRICT,
  external_reference text,
  hiking_date date NOT NULL,
  return_date date,
  group_size integer NOT NULL CHECK (group_size BETWEEN 1 AND 100),
  booking_status text NOT NULL DEFAULT 'draft'
    CHECK (booking_status IN ('draft','pending_partner','confirmed','rejected','cancelled','expired','failed')),
  payment_status text NOT NULL DEFAULT 'not_started'
    CHECK (payment_status IN ('not_started','pending','paid','failed','refunded','unknown')),
  booking_source text NOT NULL DEFAULT 'partner_redirect'
    CHECK (booking_source IN ('partner_redirect','partner_api','operator_manual','internal')),
  idempotency_key text NOT NULL UNIQUE,
  consent_at timestamptz,
  privacy_retention_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hiking_booking_dates CHECK (return_date IS NULL OR return_date >= hiking_date)
);
COMMENT ON TABLE public.hiking_bookings IS 'Dormant future ticket-booking contract. No client role can read/write it and no transaction flow is activated by this migration.';

CREATE TABLE IF NOT EXISTS public.hiking_booking_participants (
  participant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.hiking_bookings(booking_id) ON DELETE CASCADE,
  participant_number smallint NOT NULL CHECK (participant_number BETWEEN 1 AND 100),
  full_name text NOT NULL,
  phone text,
  date_of_birth date,
  emergency_contact_name text,
  emergency_contact_phone text,
  consent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, participant_number),
  CONSTRAINT hiking_participant_name_len CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 160)
);
COMMENT ON TABLE public.hiking_booking_participants IS 'Contains personal and emergency-contact data. Keep access server-only, minimize collected data, and apply retention/deletion rules before activating ticket booking.';

CREATE TABLE IF NOT EXISTS public.hiking_booking_events (
  booking_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.hiking_bookings(booking_id) ON DELETE SET NULL,
  provider_id uuid REFERENCES public.hiking_booking_providers(provider_id) ON DELETE SET NULL,
  provider_event_id text,
  event_type text NOT NULL,
  payload_sha256 text,
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received','processed','ignored','failed')),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  result_code text,
  UNIQUE (provider_id, provider_event_id),
  CONSTRAINT hiking_booking_event_sha256 CHECK (payload_sha256 IS NULL OR payload_sha256 ~ '^[a-fA-F0-9]{64}$')
);
COMMENT ON TABLE public.hiking_booking_events IS 'Partner callback idempotency/audit metadata. Do not store card data or unrestricted raw webhook bodies.';

-- Keep route geometry and display GeoJSON synchronized for spatial checks and map output.
CREATE OR REPLACE FUNCTION app_private.sync_hiking_trail_geometry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_geom extensions.geometry;
BEGIN
  IF NEW.route_geojson IS NULL THEN
    NEW.route_geometry := NULL;
    RETURN NEW;
  END IF;

  IF pg_catalog.jsonb_typeof(NEW.route_geojson) <> 'object'
     OR COALESCE(NEW.route_geojson->>'type', '') NOT IN ('LineString','MultiLineString') THEN
    RAISE EXCEPTION 'route_geojson must be a GeoJSON LineString or MultiLineString geometry.'
      USING ERRCODE = '22023';
  END IF;

  v_geom := extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(NEW.route_geojson::text), 4326);
  NEW.route_geometry := extensions.ST_Multi(v_geom);

  IF NOT extensions.ST_IsValid(NEW.route_geometry)
     OR extensions.ST_NPoints(NEW.route_geometry) < 2 THEN
    RAISE EXCEPTION 'Route geometry is invalid or contains too few points.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION app_private.sync_hiking_trail_geometry() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_hiking_trail_geometry ON public.hiking_trails;
CREATE TRIGGER trg_sync_hiking_trail_geometry
  BEFORE INSERT OR UPDATE OF route_geojson ON public.hiking_trails
  FOR EACH ROW EXECUTE FUNCTION app_private.sync_hiking_trail_geometry();

CREATE INDEX IF NOT EXISTS hiking_mountains_name_search_idx
  ON public.hiking_mountains (lower(name));
CREATE INDEX IF NOT EXISTS hiking_mountains_aliases_gin_idx
  ON public.hiking_mountains USING gin (aliases);
CREATE INDEX IF NOT EXISTS hiking_mountains_region_idx
  ON public.hiking_mountains (province, regency, publication_status);
CREATE INDEX IF NOT EXISTS hiking_trails_mountain_status_idx
  ON public.hiking_trails (mountain_id, publication_status, operational_status);
CREATE INDEX IF NOT EXISTS hiking_trails_route_geometry_gist
  ON public.hiking_trails USING gist (route_geometry);
CREATE INDEX IF NOT EXISTS hiking_checkpoints_trail_sequence_idx
  ON public.hiking_checkpoints (trail_id, sequence_number);
CREATE INDEX IF NOT EXISTS hiking_mountain_weather_area_lookup_idx
  ON public.hiking_mountain_weather_areas (mountain_id, is_primary);
CREATE INDEX IF NOT EXISTS hiking_trail_weather_area_lookup_idx
  ON public.hiking_trail_weather_areas (trail_id, is_primary);
CREATE INDEX IF NOT EXISTS hiking_route_imports_status_idx
  ON public.hiking_route_imports (import_status, license_review_status, created_at DESC);
CREATE INDEX IF NOT EXISTS hiking_trail_status_history_latest_idx
  ON public.hiking_trail_status_history (trail_id, effective_at DESC);
CREATE INDEX IF NOT EXISTS hiking_daily_quotas_freshness_idx
  ON public.hiking_daily_quotas (trail_id, hiking_date, verified_at DESC);

-- All hiking tables start locked down. Only explicitly reviewed read models are exposed.
ALTER TABLE public.hiking_data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiking_operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiking_mountains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiking_trails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiking_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiking_weather_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiking_mountain_weather_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiking_trail_weather_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiking_route_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiking_trail_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiking_weather_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiking_weather_alert_feed_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiking_weather_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiking_weather_alert_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiking_safety_advisories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiking_daily_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiking_booking_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiking_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiking_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiking_booking_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiking_booking_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY hiking_sources_public_read ON public.hiking_data_sources
  FOR SELECT TO anon, authenticated USING (is_public AND is_active);
CREATE POLICY hiking_operators_public_read ON public.hiking_operators
  FOR SELECT TO anon, authenticated USING (is_public AND verification_status = 'verified');
CREATE POLICY hiking_mountains_public_read ON public.hiking_mountains
  FOR SELECT TO anon, authenticated USING (publication_status = 'published');
CREATE POLICY hiking_trails_public_read ON public.hiking_trails
  FOR SELECT TO anon, authenticated USING (
    publication_status = 'published'
    AND EXISTS (
      SELECT 1 FROM public.hiking_mountains m
      WHERE m.mountain_id = hiking_trails.mountain_id
        AND m.publication_status = 'published'
    )
  );
CREATE POLICY hiking_checkpoints_public_read ON public.hiking_checkpoints
  FOR SELECT TO anon, authenticated USING (
    publication_status = 'published'
    AND EXISTS (
      SELECT 1
      FROM public.hiking_trails t
      JOIN public.hiking_mountains m ON m.mountain_id = t.mountain_id
      WHERE t.trail_id = hiking_checkpoints.trail_id
        AND t.publication_status = 'published'
        AND m.publication_status = 'published'
    )
  );
CREATE POLICY hiking_weather_areas_public_read ON public.hiking_weather_areas
  FOR SELECT TO anon, authenticated USING (is_active);
CREATE POLICY hiking_mountain_weather_areas_public_read ON public.hiking_mountain_weather_areas
  FOR SELECT TO anon, authenticated USING (
    EXISTS (SELECT 1 FROM public.hiking_mountains m WHERE m.mountain_id = hiking_mountain_weather_areas.mountain_id AND m.publication_status='published')
    AND EXISTS (SELECT 1 FROM public.hiking_weather_areas wa WHERE wa.weather_area_id = hiking_mountain_weather_areas.weather_area_id AND wa.is_active)
  );
CREATE POLICY hiking_trail_weather_areas_public_read ON public.hiking_trail_weather_areas
  FOR SELECT TO anon, authenticated USING (
    EXISTS (SELECT 1 FROM public.hiking_trails t JOIN public.hiking_mountains m ON m.mountain_id=t.mountain_id WHERE t.trail_id=hiking_trail_weather_areas.trail_id AND t.publication_status='published' AND m.publication_status='published')
    AND EXISTS (SELECT 1 FROM public.hiking_weather_areas wa WHERE wa.weather_area_id = hiking_trail_weather_areas.weather_area_id AND wa.is_active)
  );
CREATE POLICY hiking_weather_alerts_public_read ON public.hiking_weather_alerts
  FOR SELECT TO anon, authenticated USING (
    status = 'Actual'
    AND message_type IN ('Alert','Update')
    AND COALESCE(effective_at, sent_at, now()) <= now()
    AND (expires_at IS NULL OR expires_at > now())
  );
CREATE POLICY hiking_weather_alert_areas_public_read ON public.hiking_weather_alert_areas
  FOR SELECT TO anon, authenticated USING (
    EXISTS (
      SELECT 1 FROM public.hiking_weather_alerts a
      WHERE a.alert_id = hiking_weather_alert_areas.alert_id
        AND a.status = 'Actual'
        AND a.message_type IN ('Alert','Update')
        AND COALESCE(a.effective_at, a.sent_at, now()) <= now()
        AND (a.expires_at IS NULL OR a.expires_at > now())
    )
  );
CREATE POLICY hiking_safety_advisories_public_read ON public.hiking_safety_advisories
  FOR SELECT TO anon, authenticated USING (
    publication_status = 'published'
    AND starts_at <= now()
    AND (expires_at IS NULL OR expires_at > now())
    AND (
      (mountain_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.hiking_mountains m WHERE m.mountain_id= hiking_safety_advisories.mountain_id AND m.publication_status='published'))
      OR
      (trail_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.hiking_trails t JOIN public.hiking_mountains m ON m.mountain_id=t.mountain_id WHERE t.trail_id=hiking_safety_advisories.trail_id AND t.publication_status='published' AND m.publication_status='published'))
    )
  );
CREATE POLICY hiking_daily_quotas_public_read ON public.hiking_daily_quotas
  FOR SELECT TO anon, authenticated USING (
    is_official
    AND verified_at IS NOT NULL
    AND verified_at >= now() - interval '24 hours'
    AND (valid_until IS NULL OR valid_until > now())
    AND EXISTS (SELECT 1 FROM public.hiking_trails t JOIN public.hiking_mountains m ON m.mountain_id=t.mountain_id WHERE t.trail_id=hiking_daily_quotas.trail_id AND t.publication_status='published' AND m.publication_status='published')
  );

-- Booking, raw ingestion, feature flags, cache and source payload tables intentionally
-- have no client policies and no anon/authenticated grants.
REVOKE ALL ON public.hiking_data_sources, public.hiking_operators, public.hiking_mountains,
  public.hiking_trails, public.hiking_checkpoints, public.hiking_weather_areas,
  public.hiking_mountain_weather_areas, public.hiking_trail_weather_areas,
  public.hiking_route_imports, public.hiking_trail_status_history, public.hiking_weather_cache,
  public.hiking_weather_alert_feed_state, public.hiking_weather_alerts, public.hiking_weather_alert_areas,
  public.hiking_safety_advisories, public.hiking_daily_quotas, public.hiking_booking_providers,
  public.hiking_feature_flags, public.hiking_bookings, public.hiking_booking_participants,
  public.hiking_booking_events
FROM anon, authenticated;

GRANT SELECT ON public.hiking_data_sources, public.hiking_operators, public.hiking_mountains,
  public.hiking_trails, public.hiking_checkpoints, public.hiking_weather_areas,
  public.hiking_mountain_weather_areas, public.hiking_trail_weather_areas,
  public.hiking_safety_advisories, public.hiking_daily_quotas
TO anon, authenticated;

-- Only safe public CAP fields are readable from these base tables.
GRANT SELECT (
  alert_id, identifier, sender, sent_at, status, message_type, scope, category,
  event, urgency, severity, certainty, headline, description, instruction,
  language, effective_at, onset_at, expires_at, web_url, source_url, last_fetched_at
) ON public.hiking_weather_alerts TO anon, authenticated;
GRANT SELECT (
  alert_area_id, alert_id, area_description, province_name, regency_name,
  district_name, admin_codes, area_geometry_geojson, altitude_m, ceiling_m
) ON public.hiking_weather_alert_areas TO anon, authenticated;

DROP POLICY IF EXISTS hiking_sources_service_only ON public.hiking_route_imports;
-- Internal-only tables deliberately have no client SELECT or DML policies.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hiking_route_imports,
  public.hiking_trail_status_history, public.hiking_weather_cache,
  public.hiking_weather_alert_feed_state, public.hiking_weather_alerts,
  public.hiking_weather_alert_areas, public.hiking_booking_providers,
  public.hiking_feature_flags, public.hiking_bookings, public.hiking_booking_participants,
  public.hiking_booking_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hiking_safety_advisories TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hiking_daily_quotas TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hiking_data_sources, public.hiking_operators,
  public.hiking_mountains, public.hiking_trails, public.hiking_checkpoints,
  public.hiking_weather_areas, public.hiking_mountain_weather_areas, public.hiking_trail_weather_areas
TO service_role;

CREATE OR REPLACE VIEW public.v_public_hiking_mountains
WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  m.mountain_id, m.code, m.slug, m.name, m.aliases, m.description,
  m.elevation_m, m.province, m.regency, m.latitude, m.longitude,
  m.is_volcanic,
  CASE WHEN m.is_volcanic THEN m.volcanic_status ELSE 'not_applicable' END AS volcanic_status,
  m.volcanic_status_source_url, m.volcanic_status_checked_at,
  o.name AS operator_name, o.website_url AS operator_website_url,
  m.verified_at,
  ARRAY(
    SELECT wa.adm4_code
    FROM public.hiking_mountain_weather_areas mwa
    JOIN public.hiking_weather_areas wa ON wa.weather_area_id = mwa.weather_area_id
    WHERE mwa.mountain_id = m.mountain_id AND wa.is_active
    ORDER BY mwa.is_primary DESC, wa.province_name, wa.regency_name, wa.village_name
  ) AS bmkg_adm4_codes
FROM public.hiking_mountains m
LEFT JOIN public.hiking_operators o ON o.operator_id = m.operator_id AND o.is_public AND o.verification_status='verified'
WHERE m.publication_status = 'published';

CREATE OR REPLACE VIEW public.v_public_hiking_trails
WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  t.trail_id, t.mountain_id, m.slug AS mountain_slug, m.name AS mountain_name,
  t.slug, t.code, t.name, t.description,
  t.basecamp_name, t.basecamp_address, t.basecamp_latitude, t.basecamp_longitude,
  t.route_geojson, t.distance_m, t.elevation_gain_m, t.estimated_duration_minutes,
  CASE WHEN t.difficulty_grade_status IN ('official','operator_verified') THEN t.difficulty_grade ELSE NULL END AS difficulty_grade,
  t.difficulty_grade_status,
  t.operational_status, t.operational_status_source_url, t.operational_status_checked_at,
  t.daily_quota, t.quota_source_url,
  CASE WHEN t.booking_link_verified_at IS NOT NULL THEN t.official_booking_url ELSE NULL END AS official_booking_url,
  o.name AS operator_name, o.website_url AS operator_website_url,
  t.route_source_reference_url, t.verified_at,
  ARRAY(
    SELECT wa.adm4_code
    FROM public.hiking_trail_weather_areas twa
    JOIN public.hiking_weather_areas wa ON wa.weather_area_id = twa.weather_area_id
    WHERE twa.trail_id = t.trail_id AND wa.is_active
    ORDER BY twa.is_primary DESC, wa.province_name, wa.regency_name, wa.village_name
  ) AS bmkg_adm4_codes
FROM public.hiking_trails t
JOIN public.hiking_mountains m ON m.mountain_id = t.mountain_id AND m.publication_status='published'
LEFT JOIN public.hiking_operators o ON o.operator_id = t.operator_id AND o.is_public AND o.verification_status='verified'
WHERE t.publication_status = 'published';

CREATE OR REPLACE VIEW public.v_public_hiking_checkpoints
WITH (security_invoker = true, security_barrier = true)
AS
SELECT c.checkpoint_id, c.trail_id, t.slug AS trail_slug, m.slug AS mountain_slug,
  c.sequence_number, c.code, c.name, c.checkpoint_type, c.description,
  c.latitude, c.longitude, c.elevation_m, c.elevation_source_url, c.verified_at
FROM public.hiking_checkpoints c
JOIN public.hiking_trails t ON t.trail_id = c.trail_id AND t.publication_status='published'
JOIN public.hiking_mountains m ON m.mountain_id = t.mountain_id AND m.publication_status='published'
WHERE c.publication_status='published';

CREATE OR REPLACE VIEW public.v_public_hiking_weather_alerts
WITH (security_invoker = true, security_barrier = true)
AS
SELECT a.alert_id, a.identifier, a.sender, a.sent_at, a.message_type, a.category,
  a.event, a.urgency, a.severity, a.certainty, a.headline, a.description, a.instruction,
  a.language, a.effective_at, a.onset_at, a.expires_at, a.web_url, a.source_url,
  a.last_fetched_at, 'BMKG'::text AS source_name, 'Sumber data: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)'::text AS source_attribution,
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
  AND (a.expires_at IS NULL OR a.expires_at > now());

CREATE OR REPLACE VIEW public.v_public_hiking_safety_advisories
WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  a.advisory_id, a.mountain_id, m.slug AS mountain_slug, a.trail_id, t.slug AS trail_slug,
  a.advisory_type, a.severity, a.title, a.description, a.instruction,
  a.source_url, a.official_source, a.verification_status,
  a.starts_at, a.expires_at, a.verified_at
FROM public.hiking_safety_advisories a
LEFT JOIN public.hiking_mountains m ON m.mountain_id=a.mountain_id
LEFT JOIN public.hiking_trails t ON t.trail_id=a.trail_id
WHERE a.publication_status='published'
  AND a.starts_at <= now() AND (a.expires_at IS NULL OR a.expires_at > now());

CREATE OR REPLACE VIEW public.v_public_hiking_availability
WITH (security_invoker = true, security_barrier = true)
AS
SELECT q.trail_id, t.slug AS trail_slug, q.hiking_date, q.quota_total,
  q.quota_reserved, GREATEST(q.quota_total - q.quota_reserved, 0) AS estimated_remaining,
  q.verified_at, q.valid_until, q.source_url
FROM public.hiking_daily_quotas q
JOIN public.hiking_trails t ON t.trail_id=q.trail_id AND t.publication_status='published'
WHERE q.is_official AND q.verified_at >= now() - interval '24 hours'
  AND (q.valid_until IS NULL OR q.valid_until > now());

GRANT SELECT ON public.v_public_hiking_mountains, public.v_public_hiking_trails,
  public.v_public_hiking_checkpoints, public.v_public_hiking_weather_alerts,
  public.v_public_hiking_safety_advisories, public.v_public_hiking_availability
TO anon, authenticated;

-- Public media references and raw route source files use deliberately separate access models.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'hiking-route-sources',
  'hiking-route-sources',
  false,
  20971520,
  ARRAY['application/gpx+xml','application/xml','text/xml','application/vnd.google-earth.kml+xml','application/geo+json','application/json']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 20971520,
  allowed_mime_types = ARRAY['application/gpx+xml','application/xml','text/xml','application/vnd.google-earth.kml+xml','application/geo+json','application/json']::text[];

-- This bucket intentionally has no anon/authenticated Storage policies.
-- Only trusted backend/service_role operations can upload/read original route files.

INSERT INTO public.hiking_data_sources
  (code, name, source_type, source_url, attribution_text, license_name, license_url, permission_status, is_public, is_active, notes)
VALUES
  ('openstreetmap', 'OpenStreetMap contributors', 'basemap',
   'https://www.openstreetmap.org/copyright', '© OpenStreetMap contributors',
   'Open Database License (ODbL) 1.0', 'https://opendatacommons.org/licenses/odbl/1-0/',
   'verified_open', true, true, 'Data license is separate from the usage policies of public tile servers.'),
  ('bmkg_forecast', 'BMKG Prakiraan Cuaca Terbuka', 'weather_forecast',
   'https://data.bmkg.go.id/prakiraan-cuaca/', 'Sumber data: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)',
   NULL, NULL, 'verified_open', true, true, 'API uses ADM4 administrative code; forecast does not guarantee conditions at a summit or on-trail.'),
  ('bmkg_nowcast_alert', 'BMKG Peringatan Dini Cuaca Terbuka', 'weather_alert',
   'https://data.bmkg.go.id/peringatan-dini-cuaca/', 'Sumber data: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)',
   NULL, NULL, 'verified_open', true, true, 'CAP XML/RSS feed; store CAP effective/expiry timestamps and only show currently valid alerts.'),
  ('astacala_bank_data', 'ASTACALA Bank Data', 'gpx_archive',
   'https://astacala.org/bank-data', 'Sumber: ASTACALA Bank Data',
   NULL, NULL, 'permission_required', false, true, 'Asset licensing and redistribution permission must be reviewed per file before public publication.'),
  ('gunungbagging_trail_maps', 'Gunung Bagging Trail Maps', 'gpx_archive',
   'https://www.gunungbagging.com/trail-maps/', 'Sumber: Gunung Bagging',
   NULL, NULL, 'permission_required', false, true, 'Visual map sharing terms must not be assumed to grant unrestricted reuse of all GPS tracks.'),
  ('srtm_dem', 'NASA/USGS SRTM elevation data', 'elevation_dem',
   'https://lpdaac.usgs.gov/documents/179/SRTM_User_Guide_V3.pdf', 'Sumber elevasi: NASA/USGS SRTM',
   NULL, NULL, 'verified_open', true, true, 'DEM-derived elevation is an estimate and may not match field survey elevation.')
ON CONFLICT (code) DO NOTHING;

GRANT USAGE ON SCHEMA extensions TO anon, authenticated;
COMMIT;
