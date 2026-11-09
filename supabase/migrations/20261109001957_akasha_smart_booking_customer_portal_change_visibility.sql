-- Only customer-originated requests are returned as request payloads to
-- the customer portal. Admin-originated offers/notes must be published through
-- customer-visible timeline messages, never by exposing internal payload JSON.
DO $migration$
DECLARE
  v_signature regprocedure :=
    'app_private.get_akasha_smart_booking_portal(text)'::regprocedure;
  v_definition text;
  v_patched text;
  v_old text;
  v_new text;
BEGIN
  v_definition := pg_get_functiondef(v_signature);
  v_old := 'WHERE c.smart_booking_id = v_booking.smart_booking_id';
  v_new := v_old || ' AND c.requested_by_type = ''customer''';
  v_patched := replace(v_definition, v_old, v_new);

  IF v_patched = v_definition
     AND position('c.requested_by_type = ''customer''' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'EXPECTED_PATCH_MISSING: customer portal change request visibility filter';
  END IF;

  IF v_patched <> v_definition THEN
    EXECUTE v_patched;
  END IF;
END;
$migration$;
