-- A date-only schedule change removes an earlier exact pickup timestamp.
-- Retaining that old timestamp would make the availability forecast evaluate
-- the wrong pickup moment after a customer/admin date change.
DO $migration$
DECLARE
  v_signature regprocedure :=
    'app_private.admin_resolve_akasha_smart_booking_change(uuid,text,integer,text,text,jsonb)'::regprocedure;
  v_definition text;
  v_patched text;
  v_old text;
  v_new text;
BEGIN
  v_definition := pg_get_functiondef(v_signature);

  v_old := $old$
      requested_pickup_at = CASE
        WHEN v_payload ? 'requested_pickup_at'
        THEN nullif(v_payload->>'requested_pickup_at', '')::timestamptz
        ELSE requested_pickup_at
      END,
      requested_return_at = CASE
        WHEN v_payload ? 'requested_return_at'
        THEN nullif(v_payload->>'requested_return_at', '')::timestamptz
        ELSE requested_return_at
      END,
$old$;

  v_new := $new$
      requested_pickup_at = CASE
        WHEN v_payload ? 'requested_pickup_at'
        THEN nullif(v_payload->>'requested_pickup_at', '')::timestamptz
        WHEN v_payload ? 'requested_pickup_date' THEN NULL
        ELSE requested_pickup_at
      END,
      requested_return_at = CASE
        WHEN v_payload ? 'requested_return_at'
        THEN nullif(v_payload->>'requested_return_at', '')::timestamptz
        WHEN v_payload ? 'requested_return_date' THEN NULL
        ELSE requested_return_at
      END,
$new$;

  v_patched := replace(v_definition, v_old, v_new);

  IF v_patched = v_definition
     AND position('WHEN v_payload ? ''requested_pickup_date'' THEN NULL' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'EXPECTED_PATCH_MISSING: reset exact pickup/return timestamp after date change';
  END IF;

  IF v_patched <> v_definition THEN
    EXECUTE v_patched;
  END IF;
END;
$migration$;
