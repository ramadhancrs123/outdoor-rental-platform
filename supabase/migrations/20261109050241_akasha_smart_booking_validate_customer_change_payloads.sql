-- Validate every customer-proposed schedule and item target against the public
-- catalog projection before storing a change request. This remains a request only:
-- the approved booking lines and all operational domains remain untouched.
DO $migration$
DECLARE
  v_definition text;
  v_old_declarations text;
  v_new_declarations text;
  v_old_validation text;
  v_new_validation text;
  v_replacement_count integer;
BEGIN
  SELECT pg_get_functiondef(
    'app_private.submit_akasha_smart_booking_change(text,text,jsonb,text,integer,text)'::regprocedure
  ) INTO v_definition;

  v_old_declarations := $old$
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_response jsonb;
$old$;
  v_new_declarations := $new$
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_response jsonb;
  v_line jsonb;
  v_line_kind text;
  v_item_id uuid;
  v_variant_id uuid;
  v_package_id uuid;
  v_target_key text;
  v_seen_targets text[] := ARRAY[]::text[];
  v_target_is_public boolean;
  v_requested_quantity integer;
  v_pickup_date date;
  v_return_date date;
  v_source_line_id uuid;
  v_source_line app_private.akasha_smart_booking_line%ROWTYPE;
$new$;

  v_replacement_count :=
    (length(v_definition) - length(replace(v_definition, v_old_declarations, '')))
    / length(v_old_declarations);
  IF v_replacement_count <> 1 THEN
    RAISE EXCEPTION 'Smart Booking change declaration anchor changed; expected one match, found %', v_replacement_count;
  END IF;
  v_definition := replace(v_definition, v_old_declarations, v_new_declarations);

  v_old_validation := $old$
  IF p_request_type = 'schedule_change' THEN
    IF v_payload ? 'requested_pickup_date'
       AND nullif(v_payload->>'requested_pickup_date', '') IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: tanggal pengambilan tidak valid'
        USING ERRCODE = '22023';
    END IF;
    IF v_payload ? 'requested_return_date'
       AND nullif(v_payload->>'requested_return_date', '') IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: tanggal pengembalian tidak valid'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_request_type IN ('item_change', 'variant_change', 'quantity_change') THEN
    IF NOT (v_payload ? 'items') OR jsonb_typeof(v_payload->'items') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_payload->'items') < 1
       OR jsonb_array_length(v_payload->'items') > 10 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: daftar item perubahan harus berisi 1-10 item'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_request_type = 'cancellation' THEN
    IF v_reason IS NULL THEN
      v_reason := 'Customer mengajukan pembatalan booking.';
    END IF;
  END IF;
$old$;

  v_new_validation := $new$
  IF p_request_type = 'schedule_change' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM app_private.akasha_smart_booking_line l
      WHERE l.smart_booking_id = v_booking.smart_booking_id
        AND l.line_kind = 'rental'
    ) THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: booking pembelian saja tidak memiliki periode rental'
        USING ERRCODE = '22023';
    END IF;

    IF coalesce(v_payload->>'requested_pickup_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
       OR coalesce(v_payload->>'requested_return_date', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: tanggal pengambilan dan pengembalian wajib diisi'
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_pickup_date := (v_payload->>'requested_pickup_date')::date;
      v_return_date := (v_payload->>'requested_return_date')::date;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: format tanggal tidak valid'
          USING ERRCODE = '22023';
    END;

    IF v_pickup_date < (now() AT TIME ZONE v_booking.business_timezone)::date
       OR v_return_date < v_pickup_date THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: periode rental harus valid dan tidak berada di masa lalu'
        USING ERRCODE = '22023';
    END IF;

  ELSIF p_request_type IN ('item_change', 'variant_change', 'quantity_change', 'alternative_interest') THEN
    IF NOT (v_payload ? 'items')
       OR jsonb_typeof(v_payload->'items') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_payload->'items') < 1
       OR jsonb_array_length(v_payload->'items') > 10 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: daftar item perubahan harus berisi 1-10 item'
        USING ERRCODE = '22023';
    END IF;

    IF p_request_type = 'alternative_interest' THEN
      IF coalesce(v_payload->>'source_line_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         OR jsonb_array_length(v_payload->'items') <> 1 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: sumber dan satu item alternatif wajib dipilih'
          USING ERRCODE = '22023';
      END IF;

      v_source_line_id := (v_payload->>'source_line_id')::uuid;
      SELECT l.* INTO v_source_line
      FROM app_private.akasha_smart_booking_line l
      WHERE l.smart_booking_id = v_booking.smart_booking_id
        AND l.smart_booking_line_id = v_source_line_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: item booking sumber alternatif tidak ditemukan'
          USING ERRCODE = 'P0002';
      END IF;
    END IF;

    FOR v_line IN
      SELECT value FROM jsonb_array_elements(v_payload->'items')
    LOOP
      IF jsonb_typeof(v_line) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: setiap item perubahan harus berupa objek'
          USING ERRCODE = '22023';
      END IF;

      v_line_kind := lower(btrim(coalesce(v_line->>'kind', '')));
      IF v_line_kind NOT IN ('rental', 'sale') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: tipe item harus rental atau sale'
          USING ERRCODE = '22023';
      END IF;

      IF coalesce(v_line->>'barang_id', '') <> ''
         AND coalesce(v_line->>'barang_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: ID barang tidak valid'
          USING ERRCODE = '22023';
      END IF;
      IF coalesce(v_line->>'varian_barang_id', '') <> ''
         AND coalesce(v_line->>'varian_barang_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: ID varian tidak valid'
          USING ERRCODE = '22023';
      END IF;
      IF coalesce(v_line->>'paket_sewa_id', '') <> ''
         AND coalesce(v_line->>'paket_sewa_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: ID paket tidak valid'
          USING ERRCODE = '22023';
      END IF;

      v_item_id := nullif(v_line->>'barang_id', '')::uuid;
      v_variant_id := nullif(v_line->>'varian_barang_id', '')::uuid;
      v_package_id := nullif(v_line->>'paket_sewa_id', '')::uuid;

      IF num_nonnulls(v_item_id, v_variant_id, v_package_id) <> 1 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: setiap item harus memilih tepat satu barang, varian, atau paket'
          USING ERRCODE = '22023';
      END IF;

      IF coalesce(v_line->>'jumlah', '') !~ '^[0-9]{1,2}$' THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: jumlah item harus berupa bilangan bulat'
          USING ERRCODE = '22023';
      END IF;
      v_requested_quantity := (v_line->>'jumlah')::integer;
      IF v_requested_quantity < 1 OR v_requested_quantity > 20 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: jumlah item harus berada pada rentang 1-20'
          USING ERRCODE = '22023';
      END IF;

      v_target_key := v_line_kind || ':' || coalesce(
        v_item_id::text,
        v_variant_id::text,
        v_package_id::text
      );
      IF v_target_key = ANY(v_seen_targets) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: item yang sama tidak boleh dikirim lebih dari sekali'
          USING ERRCODE = '22023';
      END IF;
      v_seen_targets := array_append(v_seen_targets, v_target_key);

      v_target_is_public := false;
      IF v_line_kind = 'rental' AND v_package_id IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1
          FROM public.v_public_paket_sewa p
          JOIN public.v_public_tarif_sewa t
            ON t.usaha_id = p.usaha_id
           AND t.paket_sewa_id = p.paket_sewa_id
          WHERE p.usaha_id = v_booking.usaha_id
            AND p.paket_sewa_id = v_package_id
            AND p.status = 'active'
        ) INTO v_target_is_public;

      ELSIF v_line_kind = 'rental' AND v_variant_id IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1
          FROM public.v_public_katalog_rental r
          WHERE r.usaha_id = v_booking.usaha_id
            AND r.varian_barang_id = v_variant_id
        ) INTO v_target_is_public;

      ELSIF v_line_kind = 'rental' AND v_item_id IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1
          FROM public.v_public_katalog_rental r
          WHERE r.usaha_id = v_booking.usaha_id
            AND r.barang_id = v_item_id
            AND r.varian_barang_id IS NULL
        ) INTO v_target_is_public;

      ELSIF v_line_kind = 'sale' AND v_package_id IS NULL AND v_variant_id IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1
          FROM public.v_public_katalog_jual s
          WHERE s.usaha_id = v_booking.usaha_id
            AND s.varian_barang_id = v_variant_id
        ) INTO v_target_is_public;

      ELSIF v_line_kind = 'sale' AND v_package_id IS NULL AND v_item_id IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1
          FROM public.v_public_katalog_jual s
          WHERE s.usaha_id = v_booking.usaha_id
            AND s.barang_id = v_item_id
            AND s.varian_barang_id IS NULL
        ) INTO v_target_is_public;
      END IF;

      IF NOT v_target_is_public THEN
        RAISE EXCEPTION 'NOT_FOUND: salah satu item perubahan tidak aktif pada katalog publik'
          USING ERRCODE = 'P0002';
      END IF;

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
    END LOOP;

  ELSIF p_request_type = 'cancellation' THEN
    IF v_reason IS NULL THEN
      v_reason := 'Customer mengajukan pembatalan booking.';
    END IF;
  END IF;
$new$;

  v_replacement_count :=
    (length(v_definition) - length(replace(v_definition, v_old_validation, '')))
    / length(v_old_validation);
  IF v_replacement_count <> 1 THEN
    RAISE EXCEPTION 'Smart Booking change validation block changed; expected one match, found %', v_replacement_count;
  END IF;

  EXECUTE replace(v_definition, v_old_validation, v_new_validation);
END;
$migration$;

COMMENT ON FUNCTION app_private.submit_akasha_smart_booking_change(text,text,jsonb,text,integer,text)
IS 'Creates customer change requests with server-side schema, tenant, and public-catalog validation; never mutates booking lines or operational inventory.';
