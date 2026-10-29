BEGIN;

CREATE OR REPLACE FUNCTION public.hiking_admin_accept_route_import(
  p_import_id uuid,
  p_route_geojson jsonb,
  p_distance_m integer,
  p_elevation_gain_m integer,
  p_source_reference_url text,
  p_source_version text,
  p_checkpoint_snapshot jsonb,
  p_validation_report jsonb,
  p_review_note text,
  p_actor_admin_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_import public.hiking_route_imports%ROWTYPE;
  v_trail public.hiking_trails%ROWTYPE;
  v_source public.hiking_data_sources%ROWTYPE;
  v_next_version integer;
  v_route_version_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.akun_admin aa
    WHERE aa.akun_admin_id=p_actor_admin_id
      AND aa.status='active' AND aa.role='super_admin'
  ) THEN
    RAISE EXCEPTION 'Active super admin required.' USING ERRCODE='42501';
  END IF;
  IF p_source_reference_url IS NULL OR p_source_reference_url !~* '^https://'
     THEN RAISE EXCEPTION 'Verified HTTPS source reference is required.' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_route_geojson) <> 'object'
     OR p_route_geojson->>'type' NOT IN ('LineString','MultiLineString') THEN
    RAISE EXCEPTION 'Route GeoJSON must be a LineString or MultiLineString.' USING ERRCODE='22023';
  END IF;
  IF p_distance_m IS NOT NULL AND p_distance_m < 0 THEN
    RAISE EXCEPTION 'Invalid route distance.' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_checkpoint_snapshot,'[]'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(p_validation_report,'{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Invalid import validation payload.' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_import FROM public.hiking_route_imports
  WHERE import_id=p_import_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Route import not found.' USING ERRCODE='P0002'; END IF;
  IF v_import.trail_id IS NULL THEN RAISE EXCEPTION 'Route import is not linked to a trail.' USING ERRCODE='22023'; END IF;
  IF v_import.import_status IN ('accepted','rejected') THEN RAISE EXCEPTION 'Route import was already reviewed.' USING ERRCODE='55000'; END IF;
  IF v_import.file_format <> 'gpx' THEN RAISE EXCEPTION 'Only validated GPX imports can be accepted by this command.' USING ERRCODE='22023'; END IF;
  IF v_import.license_review_status NOT IN ('approved','not_required') THEN RAISE EXCEPTION 'License clearance is required before applying the route.' USING ERRCODE='42501'; END IF;
  IF v_import.source_reference_url IS DISTINCT FROM p_source_reference_url THEN
    RAISE EXCEPTION 'Source reference must match the reviewed import record.' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_trail FROM public.hiking_trails WHERE trail_id=v_import.trail_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target trail not found.' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_source FROM public.hiking_data_sources WHERE source_id=COALESCE(v_import.source_id,v_trail.route_source_id);
  IF NOT FOUND OR v_source.is_active IS NOT TRUE
     OR v_source.permission_status NOT IN ('verified_open','permission_granted') THEN
    RAISE EXCEPTION 'Source permission is not cleared for route publication.' USING ERRCODE='42501';
  END IF;

  v_next_version := COALESCE((
    SELECT max(rv.version_number)+1 FROM public.hiking_route_versions rv WHERE rv.trail_id=v_trail.trail_id
  ),1);

  -- Any route change invalidates prior route verification/publication. The admin must
  -- review the new geometry and provenance explicitly before republishing it.
  UPDATE public.hiking_trails
  SET route_geojson=p_route_geojson,
      distance_m=p_distance_m,
      elevation_gain_m=p_elevation_gain_m,
      route_source_id=v_source.source_id,
      route_source_reference_url=p_source_reference_url,
      source_version=p_source_version,
      verified_at=NULL,
      publication_status='draft',
      published_at=NULL,
      updated_at=pg_catalog.now()
  WHERE trail_id=v_trail.trail_id;

  INSERT INTO public.hiking_route_versions (
    trail_id, import_id, version_number, route_geojson, distance_m,
    elevation_gain_m, checkpoint_snapshot, metadata_snapshot,
    source_id, source_reference_url, source_version, license_review_status,
    validation_report, change_reason, created_by_admin_id
  ) VALUES (
    v_trail.trail_id, p_import_id, v_next_version, p_route_geojson, p_distance_m,
    p_elevation_gain_m, COALESCE(p_checkpoint_snapshot,'[]'::jsonb),
    pg_catalog.jsonb_build_object(
      'trail_slug',v_trail.slug,'trail_name',v_trail.name,
      'mountain_id',v_trail.mountain_id,'previous_operational_status',v_trail.operational_status,
      'previous_publication_status',v_trail.publication_status
    ),
    v_source.source_id, p_source_reference_url, p_source_version, v_import.license_review_status,
    COALESCE(p_validation_report,'{}'::jsonb), COALESCE(NULLIF(pg_catalog.btrim(p_review_note),''),'Reviewed GPX route import'),
    p_actor_admin_id
  ) RETURNING route_version_id INTO v_route_version_id;

  UPDATE public.hiking_route_imports
  SET import_status='accepted', reviewed_by_admin_id=p_actor_admin_id,
      reviewed_at=pg_catalog.now(),
      validation_report=COALESCE(p_validation_report,'{}'::jsonb) ||
        pg_catalog.jsonb_build_object('review_note',NULLIF(pg_catalog.btrim(COALESCE(p_review_note,'')),'')),
      updated_at=pg_catalog.now()
  WHERE import_id=p_import_id;
  RETURN v_route_version_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.hiking_admin_accept_route_import(uuid,jsonb,integer,integer,text,text,jsonb,jsonb,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hiking_admin_accept_route_import(uuid,jsonb,integer,integer,text,text,jsonb,jsonb,text,uuid) TO service_role;

COMMIT;