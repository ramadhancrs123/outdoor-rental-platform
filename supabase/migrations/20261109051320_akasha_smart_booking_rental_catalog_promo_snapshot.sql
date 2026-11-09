-- Keep the Smart Booking customer quote aligned with the public rental catalog's
-- active product/variant catalog promotion. The legacy draft reservation snapshot
-- remains untouched as required by the frozen operational-domain boundary.
DO $migration$
DECLARE
  v_definition text;
  v_old_declarations text;
  v_new_declarations text;
  v_old_snapshot_block text;
  v_new_snapshot_block text;
  v_replacement_count integer;
BEGIN
  SELECT pg_get_functiondef(
    'app_private.command_create_akasha_smart_booking(text,jsonb,text)'::regprocedure
  ) INTO v_definition;

  v_old_declarations := $old$
  v_promo_id uuid;
$old$;
  v_new_declarations := $new$
  v_promo_id uuid;
  v_rental_line app_private.akasha_smart_booking_line%ROWTYPE;
$new$;

  v_replacement_count :=
    (length(v_definition) - length(replace(v_definition, v_old_declarations, '')))
    / length(v_old_declarations);
  IF v_replacement_count <> 1 THEN
    RAISE EXCEPTION 'Smart Booking rental promo declaration anchor changed; expected one match, found %', v_replacement_count;
  END IF;
  v_definition := replace(v_definition, v_old_declarations, v_new_declarations);

  v_old_snapshot_block := $old$
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: snapshot rental booking tidak ditemukan'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Purchase intent is stored only as a booking quote. No stock, sales, checkout,
$old$;

  v_new_snapshot_block := $new$
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: snapshot rental booking tidak ditemukan'
        USING ERRCODE = '23514';
    END IF;

    -- The legacy website writer intentionally stays unchanged. Its draft detail
    -- remains the operational-domain snapshot; Smart Booking keeps its own public
    -- quote snapshot and resolves active product/variant catalog promos here.
    FOR v_rental_line IN
      SELECT l.*
      FROM app_private.akasha_smart_booking_line l
      WHERE l.usaha_id = v_usaha.usaha_id
        AND l.smart_booking_id = v_booking_id
        AND l.line_kind = 'rental'
        AND l.paket_sewa_id IS NULL
    LOOP
      v_promo_id := NULL;
      v_discount_percent := 0;

      SELECT promo.promosi_katalog_id, coalesce(promo.diskon_persen, 0)
        INTO v_promo_id, v_discount_percent
      FROM app_private.resolve_catalog_promo_price(
        v_usaha.usaha_id,
        CASE
          WHEN v_rental_line.varian_barang_id IS NULL THEN v_rental_line.barang_id
          ELSE NULL
        END,
        v_rental_line.varian_barang_id,
        'rental',
        now()
      ) promo;

      v_discount_percent := coalesce(v_discount_percent, 0);
      IF v_discount_percent > 0 THEN
        v_effective_price := round(
          v_rental_line.normal_price_snapshot * (100 - v_discount_percent) / 100,
          2
        );
        v_discount_amount := round(
          (v_rental_line.normal_price_snapshot - v_effective_price) * v_rental_line.quantity,
          2
        );

        UPDATE app_private.akasha_smart_booking_line l
        SET
          unit_price_snapshot = v_effective_price,
          discount_percent_snapshot = v_discount_percent,
          discount_amount_snapshot = v_discount_amount,
          subtotal_snapshot = round(v_effective_price * v_rental_line.quantity, 2),
          promosi_katalog_id = v_promo_id
        WHERE l.usaha_id = v_usaha.usaha_id
          AND l.smart_booking_id = v_booking_id
          AND l.smart_booking_line_id = v_rental_line.smart_booking_line_id;
      END IF;
    END LOOP;

    SELECT coalesce(sum(l.subtotal_snapshot), 0)
      INTO v_total_rental
    FROM app_private.akasha_smart_booking_line l
    WHERE l.usaha_id = v_usaha.usaha_id
      AND l.smart_booking_id = v_booking_id
      AND l.line_kind = 'rental';

  END IF;

  -- Purchase intent is stored only as a booking quote. No stock, sales, checkout,
$new$;

  v_replacement_count :=
    (length(v_definition) - length(replace(v_definition, v_old_snapshot_block, '')))
    / length(v_old_snapshot_block);
  IF v_replacement_count <> 1 THEN
    RAISE EXCEPTION 'Smart Booking rental snapshot anchor changed; expected one match, found %', v_replacement_count;
  END IF;

  EXECUTE replace(v_definition, v_old_snapshot_block, v_new_snapshot_block);
END;
$migration$;

COMMENT ON FUNCTION app_private.command_create_akasha_smart_booking(text,jsonb,text)
IS 'Creates Smart Booking intent without stock mutation and resolves public active catalog promo prices into the booking quote snapshot.';
