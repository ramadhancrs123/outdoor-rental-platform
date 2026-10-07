-- Repair for Quick Item location auto-selection.
-- Keep the already-applied command logic intact; only replace UUID aggregation.

DO $migration$
DECLARE
  v_definition text;
  v_original text;
  v_replacement text;
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

  v_replacement := E'
    SELECT count(*)
      INTO v_location_count
    FROM public.lokasi
    WHERE usaha_id = p_usaha_id
      AND status = ''active'';

    IF v_location_count > 1 THEN
      RAISE EXCEPTION
        ''VALIDATION_ERROR: lokasi wajib dipilih karena Usaha memiliki lebih dari satu lokasi aktif''
        USING ERRCODE=''22023'';
    ELSIF v_location_count = 1 THEN
      SELECT lokasi_id
        INTO v_location_id
      FROM public.lokasi
      WHERE usaha_id = p_usaha_id
        AND status = ''active''
      ORDER BY nama, lokasi_id
      LIMIT 1;
    ELSE
      v_location_id := NULL;
    END IF;';

  v_definition := replace(
    v_definition,
    E'    SELECT count(*), min(lokasi_id)\n      INTO v_location_count, v_location_id\n    FROM public.lokasi\n    WHERE usaha_id = p_usaha_id\n      AND status = ''active'';\n\n    IF v_location_count > 1 THEN\n      RAISE EXCEPTION\n        ''VALIDATION_ERROR: lokasi wajib dipilih karena Usaha memiliki lebih dari satu lokasi aktif''\n        USING ERRCODE=''22023'';\n    ELSIF v_location_count = 0 THEN\n      v_location_id := NULL;\n    END IF;',
    v_replacement
  );

  IF v_definition = v_original THEN
    RAISE EXCEPTION 'QUICK_ITEM_LOCATION_FIX_GAP: expected UUID aggregation block not found';
  END IF;

  EXECUTE v_definition;
END;
$migration$;