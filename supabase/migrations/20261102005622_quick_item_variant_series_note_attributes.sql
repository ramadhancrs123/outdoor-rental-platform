-- Extend Quick Item's existing variant JSONB payload without changing
-- inventory quantity, tariff, audit, stock, or onboarding transaction behavior.
-- "catatan" is optional variant metadata, not an identity dimension.
-- The three identity dimensions are warna, kapasitas (combined ukuran/kapasitas),
-- and seri. Keep the existing trusted command and public RPC wrapper intact.

DO $migration$
DECLARE
  v_definition text;
  v_original text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'app_private'
    AND p.proname = 'command_quick_item_onboarding'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_usaha_id uuid, p_payload jsonb, p_idempotency_key text, p_request_id uuid';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'QUICK_ITEM_FUNCTION_MISSING: command_quick_item_onboarding not found';
  END IF;

  v_original := v_definition;
  v_definition := replace(
    v_definition,
    E'    IF cardinality(v_dimensions) < 1 OR cardinality(v_dimensions) > 2 THEN\n      RAISE EXCEPTION ''VALIDATION_ERROR: Quick Item mendukung maksimal dua dimensi pilihan'' USING ERRCODE=''22023'';',
    E'    IF cardinality(v_dimensions) < 1 OR cardinality(v_dimensions) > 3 THEN\n      RAISE EXCEPTION ''VALIDATION_ERROR: Quick Item mendukung maksimal tiga dimensi pembeda'' USING ERRCODE=''22023'';'
  );

  IF v_definition = v_original THEN
    RAISE EXCEPTION 'QUICK_ITEM_VARIANT_DIMENSION_PATCH_GAP: expected two-dimension validation block not found';
  END IF;

  v_original := v_definition;
  v_definition := replace(
    v_definition,
    E'      v_keys := ARRAY(\n        SELECT key FROM jsonb_object_keys(v_attrs) AS j(key) ORDER BY key\n      );',
    E'      v_keys := ARRAY(\n        SELECT key FROM jsonb_object_keys(v_attrs) AS j(key)\n        WHERE key <> ''catatan''\n        ORDER BY key\n      );'
  );

  IF v_definition = v_original THEN
    RAISE EXCEPTION 'QUICK_ITEM_VARIANT_NOTE_PATCH_GAP: expected variant JSONB key validation block not found';
  END IF;

  EXECUTE v_definition;
END;
$migration$;
