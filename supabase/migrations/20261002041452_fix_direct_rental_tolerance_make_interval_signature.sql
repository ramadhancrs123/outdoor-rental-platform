-- Fix PostgreSQL 17 make_interval signature in direct rental creation.
-- Preserve numeric tolerance hours by expressing the interval in seconds.
DO $migration$
DECLARE
  v_definition text;
  v_updated_definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'app_private'
    AND p.proname = 'command_create_direct_rental'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_usaha_id uuid, p_penyewa_id uuid, p_jadwal_mulai timestamp with time zone, p_jadwal_kembali timestamp with time zone, p_lines jsonb, p_catatan text, p_idempotency_key text, p_request_id uuid'
  LIMIT 1;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'command_create_direct_rental definition not found';
  END IF;

  v_updated_definition := replace(
    v_definition,
    'make_interval(hours => v_default_tolerance_hours::double precision)',
    'pg_catalog.make_interval(secs => v_default_tolerance_hours::double precision * 3600)'
  );

  IF v_updated_definition = v_definition THEN
    RAISE EXCEPTION 'expected direct rental tolerance expression not found';
  END IF;

  EXECUTE v_updated_definition;
END
$migration$;
