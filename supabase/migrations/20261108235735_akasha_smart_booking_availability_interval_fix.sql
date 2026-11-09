-- Fix the tolerance interval expression using make_interval's seconds
-- argument. Numeric tolerance supports fractional hours safely.
DO $migration$
DECLARE
  v_signature regprocedure :=
    'app_private.akasha_smart_booking_component_availability(uuid,uuid,uuid,numeric,timestamptz,numeric)'::regprocedure;
  v_definition text;
  v_patched text;
BEGIN
  v_definition := pg_get_functiondef(v_signature);
  v_patched := replace(
    v_definition,
    'make_interval(hours => coalesce(p_tolerance_hours, 10)::double precision)',
    'make_interval(secs => coalesce(p_tolerance_hours, 10)::double precision * 3600)'
  );

  IF v_patched = v_definition THEN
    IF position('make_interval(secs => coalesce(p_tolerance_hours, 10)::double precision * 3600)' IN v_definition) = 0 THEN
      RAISE EXCEPTION 'EXPECTED_PATCH_MISSING: tolerance interval expression';
    END IF;
  ELSE
    EXECUTE v_patched;
  END IF;
END;
$migration$;
