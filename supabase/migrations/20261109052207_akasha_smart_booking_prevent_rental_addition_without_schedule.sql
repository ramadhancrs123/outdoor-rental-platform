-- A purchase-only booking has no rental period. Do not accept a customer-proposed
-- rental item through item-change without an existing rental context; customer UI
-- directs them to create a new booking where pickup/return dates are explicit.
DO $migration$
DECLARE
  v_definition text;
  v_old_block text;
  v_new_block text;
  v_replacement_count integer;
BEGIN
  SELECT pg_get_functiondef(
    'app_private.submit_akasha_smart_booking_change(text,text,jsonb,text,integer,text)'::regprocedure
  ) INTO v_definition;

  v_old_block := $old$
    IF NOT (v_payload ? 'items')
       OR jsonb_typeof(v_payload->'items') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_payload->'items') < 1
       OR jsonb_array_length(v_payload->'items') > 10 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: daftar item perubahan harus berisi 1-10 item'
        USING ERRCODE = '22023';
    END IF;
$old$;

  v_new_block := $new$
    IF NOT (v_payload ? 'items')
       OR jsonb_typeof(v_payload->'items') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_payload->'items') < 1
       OR jsonb_array_length(v_payload->'items') > 10 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: daftar item perubahan harus berisi 1-10 item'
        USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM app_private.akasha_smart_booking_line l
      WHERE l.smart_booking_id = v_booking.smart_booking_id
        AND l.line_kind = 'rental'
    )
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_payload->'items') AS proposed(value)
      WHERE jsonb_typeof(proposed.value) = 'object'
        AND lower(btrim(coalesce(proposed.value->>'kind', ''))) = 'rental'
    ) THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: untuk menambahkan rental, buat booking baru dengan periode rental'
        USING ERRCODE = '22023';
    END IF;
$new$;

  v_replacement_count :=
    (length(v_definition) - length(replace(v_definition, v_old_block, '')))
    / length(v_old_block);
  IF v_replacement_count <> 1 THEN
    RAISE EXCEPTION 'Smart Booking item-change period guard anchor changed; expected one match, found %', v_replacement_count;
  END IF;

  EXECUTE replace(v_definition, v_old_block, v_new_block);
END;
$migration$;

COMMENT ON FUNCTION app_private.submit_akasha_smart_booking_change(text,text,jsonb,text,integer,text)
IS 'Creates customer change requests with safe catalog, category, schedule, and item-kind validation; adding rental to a purchase-only booking requires a new dated booking.';
