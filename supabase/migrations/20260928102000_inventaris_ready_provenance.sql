DO $migration$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'app_private'
    AND p.proname = 'command_mark_inventory_unit_ready'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_usaha_id uuid, p_unit_barang_id uuid, p_catatan text, p_idempotency_key text, p_request_id uuid, p_expected_updated_at timestamp with time zone';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'READY_PROVENANCE_GAP: trusted READY command not found';
  END IF;

  v_definition := replace(
    v_definition,
    E'''inventory'',\n    p_unit_barang_id,',
    E'''pemeriksaan'',\n    v_latest_inspection.pemeriksaan_id,'
  );

  IF v_definition = pg_get_functiondef(
    (
      SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'app_private'
        AND p.proname = 'command_mark_inventory_unit_ready'
        AND pg_get_function_identity_arguments(p.oid) =
          'p_usaha_id uuid, p_unit_barang_id uuid, p_catatan text, p_idempotency_key text, p_request_id uuid, p_expected_updated_at timestamp with time zone'
    )
  ) THEN
    RAISE EXCEPTION 'READY_PROVENANCE_GAP: expected history-source replacement not found';
  END IF;

  EXECUTE v_definition;
END;
$migration$;