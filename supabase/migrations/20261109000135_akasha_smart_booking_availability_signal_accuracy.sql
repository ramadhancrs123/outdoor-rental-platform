-- Make customer availability signals compare current stock with the requested
-- quantity, and avoid describing variant substitutions as expected returns.
DO $migration$
DECLARE
  v_signature regprocedure :=
    'app_private.get_akasha_smart_booking_availability(text)'::regprocedure;
  v_definition text;
  v_patched text;
  v_old text;
  v_new text;
BEGIN
  v_definition := pg_get_functiondef(v_signature);

  v_old := $old$
      v_overall_status := coalesce(v_components->0->>'status', 'unknown');
    ELSIF v_line.paket_sewa_id IS NOT NULL THEN
$old$;

  v_new := $new$
      v_overall_status := CASE
        WHEN coalesce((v_components->0->>'available_now_requested_variant')::numeric, 0) >= v_line.quantity
          THEN 'available_now'
        WHEN coalesce((v_components->0->>'available_now_requested_variant')::numeric, 0) > 0
          THEN 'insufficient_quantity'
        ELSE 'currently_unavailable'
      END;
    ELSIF v_line.paket_sewa_id IS NOT NULL THEN
$new$;

  v_patched := replace(v_definition, v_old, v_new);
  IF v_patched = v_definition
     AND position('THEN ''insufficient_quantity''' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'EXPECTED_PATCH_MISSING: sale quantity availability status';
  END IF;

  v_definition := v_patched;
  v_old := $old$
      v_overall_status := CASE
        WHEN v_component_count = 0 THEN 'package_components_unavailable'
        WHEN v_component_ready = v_component_count THEN 'all_components_ready_now'
        WHEN v_component_ready + v_component_potential = v_component_count THEN 'some_components_depend_on_potential_stock'
        ELSE 'one_or_more_components_short'
      END;
$old$;

  v_new := $new$
      v_overall_status := CASE
        WHEN v_component_count = 0 THEN 'package_components_unavailable'
        WHEN v_component_ready = v_component_count THEN 'all_components_ready_now'
        WHEN v_component_ready + v_component_potential = v_component_count THEN 'one_or_more_components_need_review'
        ELSE 'one_or_more_components_short'
      END;
$new$;

  v_patched := replace(v_definition, v_old, v_new);
  IF v_patched = v_definition
     AND position('one_or_more_components_need_review' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'EXPECTED_PATCH_MISSING: package component availability status';
  END IF;

  IF v_patched <> v_definition THEN
    EXECUTE v_patched;
  END IF;
END;
$migration$;
