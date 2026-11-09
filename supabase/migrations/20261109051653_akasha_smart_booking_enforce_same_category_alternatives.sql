-- Alternative suggestions are a bounded same-category workflow. Validate category
-- membership on the server; a manipulated browser payload cannot offer arbitrary
-- public items as a substitute for the customer's original request.
DO $migration$
DECLARE
  v_definition text;
  v_old_declarations text;
  v_new_declarations text;
  v_old_alternative_block text;
  v_new_alternative_block text;
  v_replacement_count integer;
BEGIN
  SELECT pg_get_functiondef(
    'app_private.submit_akasha_smart_booking_change(text,text,jsonb,text,integer,text)'::regprocedure
  ) INTO v_definition;

  v_old_declarations := $old$
  v_source_line app_private.akasha_smart_booking_line%ROWTYPE;
$old$;
  v_new_declarations := $new$
  v_source_line app_private.akasha_smart_booking_line%ROWTYPE;
  v_source_barang_id uuid;
  v_candidate_barang_id uuid;
  v_source_category_id uuid;
  v_candidate_category_id uuid;
$new$;

  v_replacement_count :=
    (length(v_definition) - length(replace(v_definition, v_old_declarations, '')))
    / length(v_old_declarations);
  IF v_replacement_count <> 1 THEN
    RAISE EXCEPTION 'Smart Booking alternative declaration anchor changed; expected one match, found %', v_replacement_count;
  END IF;
  v_definition := replace(v_definition, v_old_declarations, v_new_declarations);

  v_old_alternative_block := $old$
      IF p_request_type = 'alternative_interest' THEN
        IF v_line_kind <> v_source_line.line_kind THEN
          RAISE EXCEPTION 'VALIDATION_ERROR: alternatif harus memiliki tipe sewa/beli yang sama'
            USING ERRCODE = '22023';
        END IF;
        IF v_item_id IS NOT DISTINCT FROM v_source_line.barang_id
           AND v_variant_id IS NOT DISTINCT FROM v_source_line.varian_barang_id
           AND v_package_id IS NOT DISTINCT FROM v_source_line.paket_sewa_id THEN
          RAISE EXCEPTION 'VALIDATION_ERROR: alternatif harus berbeda dari item yang diminta'
            USING ERRCODE = '22023';
        END IF;
      END IF;
$old$;

  v_new_alternative_block := $new$
      IF p_request_type = 'alternative_interest' THEN
        IF v_line_kind <> v_source_line.line_kind THEN
          RAISE EXCEPTION 'VALIDATION_ERROR: alternatif harus memiliki tipe sewa/beli yang sama'
            USING ERRCODE = '22023';
        END IF;

        IF v_source_line.paket_sewa_id IS NOT NULL OR v_package_id IS NOT NULL THEN
          RAISE EXCEPTION 'VALIDATION_ERROR: alternatif paket belum didukung'
            USING ERRCODE = '22023';
        END IF;

        v_source_barang_id := v_source_line.barang_id;
        IF v_source_barang_id IS NULL AND v_source_line.varian_barang_id IS NOT NULL THEN
          SELECT vb.barang_id INTO v_source_barang_id
          FROM public.v_public_varian_barang vb
          WHERE vb.usaha_id = v_booking.usaha_id
            AND vb.varian_barang_id = v_source_line.varian_barang_id;
        END IF;

        v_candidate_barang_id := v_item_id;
        IF v_candidate_barang_id IS NULL AND v_variant_id IS NOT NULL THEN
          SELECT vb.barang_id INTO v_candidate_barang_id
          FROM public.v_public_varian_barang vb
          WHERE vb.usaha_id = v_booking.usaha_id
            AND vb.varian_barang_id = v_variant_id;
        END IF;

        IF v_source_barang_id IS NULL
           OR v_candidate_barang_id IS NULL
           OR v_source_barang_id = v_candidate_barang_id THEN
          RAISE EXCEPTION 'VALIDATION_ERROR: alternatif harus berupa barang lain'
            USING ERRCODE = '22023';
        END IF;

        SELECT b.kategori_barang_id INTO v_source_category_id
        FROM public.v_public_barang b
        WHERE b.usaha_id = v_booking.usaha_id
          AND b.barang_id = v_source_barang_id;

        SELECT b.kategori_barang_id INTO v_candidate_category_id
        FROM public.v_public_barang b
        WHERE b.usaha_id = v_booking.usaha_id
          AND b.barang_id = v_candidate_barang_id;

        IF v_source_category_id IS NULL
           OR v_candidate_category_id IS NULL
           OR v_source_category_id IS DISTINCT FROM v_candidate_category_id THEN
          RAISE EXCEPTION 'VALIDATION_ERROR: alternatif harus berasal dari kategori yang sama'
            USING ERRCODE = '22023';
        END IF;
      END IF;
$new$;

  v_replacement_count :=
    (length(v_definition) - length(replace(v_definition, v_old_alternative_block, '')))
    / length(v_old_alternative_block);
  IF v_replacement_count <> 1 THEN
    RAISE EXCEPTION 'Smart Booking alternative validation anchor changed; expected one match, found %', v_replacement_count;
  END IF;

  EXECUTE replace(v_definition, v_old_alternative_block, v_new_alternative_block);
END;
$migration$;

COMMENT ON FUNCTION app_private.submit_akasha_smart_booking_change(text,text,jsonb,text,integer,text)
IS 'Creates customer change requests with server-side schema, tenant, public-catalog, and same-category alternative validation; never mutates booking lines or operational inventory.';
