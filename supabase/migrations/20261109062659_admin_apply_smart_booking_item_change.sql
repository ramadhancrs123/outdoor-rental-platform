-- Dedicated item approval for AKASHA SMART BOOKING.
-- This command only replaces Smart Booking line snapshots and recalculates its
-- observational quote. It must never write to legacy reservation detail,
-- rental, inventory, checkout, catalog or sales transaction tables.
--
-- Schedule/cancellation decisions keep using admin_resolve_akasha_smart_booking_change.

CREATE OR REPLACE FUNCTION app_private.admin_apply_akasha_smart_booking_item_change(
  p_change_request_id uuid,
  p_expected_revision integer,
  p_idempotency_key text,
  p_resolution_note text DEFAULT NULL,
  p_public_resolution_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_change app_private.akasha_smart_booking_change_request%ROWTYPE;
  v_booking app_private.akasha_smart_booking%ROWTYPE;
  v_source_line app_private.akasha_smart_booking_line%ROWTYPE;
  v_admin_id uuid;
  v_actor uuid := auth.uid();
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_resolution_note text := nullif(btrim(coalesce(p_resolution_note, '')), '');
  v_public_note text := nullif(btrim(coalesce(p_public_resolution_note, '')), '');
  v_request_hash text;
  v_idem_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_response jsonb;
  v_items jsonb;
  v_line jsonb;
  v_kind text;
  v_barang_id uuid;
  v_variant_id uuid;
  v_package_id uuid;
  v_target_barang_id uuid;
  v_target_variant_id uuid;
  v_target_package_id uuid;
  v_tariff_id uuid;
  v_catalog_promo_id uuid;
  v_package_promo_id uuid;
  v_name text;
  v_variant_name text;
  v_category_id uuid;
  v_source_category_id uuid;
  v_normal_price numeric(14,2);
  v_effective_price numeric(14,2);
  v_discount_percent numeric(5,2);
  v_discount_amount numeric(14,2);
  v_quantity numeric(12,3);
  v_subtotal numeric(14,2);
  v_currency_code character(3);
  v_inventory_mode text;
  v_duration_unit text;
  v_duration_value integer;
  v_seen_targets text[] := ARRAY[]::text[];
  v_target_key text;
  v_position integer := 0;
  v_line_count_before integer;
  v_total_before numeric(14,2);
  v_total_after numeric(14,2);
  v_has_rental boolean := false;
  v_request_payload jsonb;
  v_source_line_id uuid;
  v_alt_line jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: sesi admin tidak ditemukan'
      USING ERRCODE = '42501';
  END IF;

  IF length(v_key) < 8 OR length(v_key) > 100 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency key tidak valid'
      USING ERRCODE = '22023';
  END IF;

  IF length(coalesce(v_resolution_note, '')) > 500
     OR length(coalesce(v_public_note, '')) > 500 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: catatan resolusi maksimal 500 karakter'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_change
  FROM app_private.akasha_smart_booking_change_request c
  WHERE c.smart_booking_change_request_id = p_change_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: permintaan perubahan tidak ditemukan'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_booking
  FROM app_private.akasha_smart_booking b
  WHERE b.smart_booking_id = v_change.smart_booking_id
    AND b.usaha_id = v_change.usaha_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: booking tidak ditemukan'
      USING ERRCODE = 'P0002';
  END IF;

  v_admin_id := app_private.require_usaha_permission(v_booking.usaha_id, 'reservation.amend');

  v_request_hash := encode(
    extensions.digest(
      convert_to(jsonb_build_object(
        'booking_id', v_booking.smart_booking_id,
        'change_request_id', p_change_request_id,
        'decision', 'apply_item_change',
        'expected_revision', p_expected_revision,
        'resolution_note', v_resolution_note,
        'public_resolution_note', v_public_note,
        'actor', v_actor
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.idempotency_key (
    usaha_id, actor_auth_user_id, key, command_name, request_hash
  )
  VALUES (
    v_booking.usaha_id, v_actor, v_key,
    'admin_apply_akasha_smart_booking_item_change', v_request_hash
  )
  ON CONFLICT (usaha_id, actor_auth_user_id, command_name, key)
  DO NOTHING
  RETURNING idempotency_key_id INTO v_idem_id;

  IF v_idem_id IS NULL THEN
    SELECT ik.request_hash, ik.response_body
      INTO v_existing_hash, v_existing_response
    FROM public.idempotency_key ik
    WHERE ik.usaha_id = v_booking.usaha_id
      AND ik.actor_auth_user_id = v_actor
      AND ik.command_name = 'admin_apply_akasha_smart_booking_item_change'
      AND ik.key = v_key;

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk resolusi berbeda'
        USING ERRCODE = '23505';
    END IF;

    IF v_existing_response IS NULL THEN
      RAISE EXCEPTION 'UNKNOWN_OUTCOME: penerapan perubahan sedang diproses'
        USING ERRCODE = '40001';
    END IF;

    RETURN v_existing_response;
  END IF;

  IF v_change.request_status <> 'pending'
     OR v_change.request_type NOT IN (
       'item_change', 'variant_change', 'quantity_change', 'alternative_interest'
     ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: permintaan bukan perubahan item yang masih pending'
      USING ERRCODE = '23514';
  END IF;

  IF p_expected_revision IS DISTINCT FROM v_booking.revision THEN
    RAISE EXCEPTION 'STALE_REVISION: booking telah berubah. Muat ulang sebelum menerapkan perubahan.'
      USING ERRCODE = '40001';
  END IF;

  IF v_booking.workflow_status IN ('cancelled', 'expired', 'fulfilled') THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: booking sudah ditutup dan tidak menerima perubahan item'
      USING ERRCODE = '23514';
  END IF;

  v_request_payload := v_change.payload;
  v_items := coalesce(v_request_payload->'items', '[]'::jsonb);

  IF jsonb_typeof(v_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_items) < 1
     OR jsonb_array_length(v_items) > 10 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: perubahan item harus berisi 1-10 jenis barang'
      USING ERRCODE = '22023';
  END IF;

  -- An alternative-interest request replaces only its source line. The source
  -- quantity and kind are taken from the existing booking, not from the client.
  IF v_change.request_type = 'alternative_interest' THEN
    IF coalesce(v_request_payload->>'source_line_id', '') !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR jsonb_array_length(v_items) <> 1 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: item sumber dan satu alternatif wajib dipilih'
        USING ERRCODE = '22023';
    END IF;

    v_source_line_id := (v_request_payload->>'source_line_id')::uuid;

    SELECT * INTO v_source_line
    FROM app_private.akasha_smart_booking_line l
    WHERE l.usaha_id = v_booking.usaha_id
      AND l.smart_booking_id = v_booking.smart_booking_id
      AND l.smart_booking_line_id = v_source_line_id;

    IF NOT FOUND
       OR v_source_line.line_kind NOT IN ('rental', 'sale')
       OR v_source_line.paket_sewa_id IS NOT NULL THEN
      RAISE EXCEPTION 'NOT_FOUND: item sumber alternatif tidak ditemukan atau tidak mendukung alternatif'
        USING ERRCODE = 'P0002';
    END IF;

    IF v_source_line.varian_barang_id IS NOT NULL THEN
      SELECT b.kategori_barang_id
        INTO v_source_category_id
      FROM public.varian_barang vb
      JOIN public.barang b
        ON b.usaha_id = vb.usaha_id
       AND b.barang_id = vb.barang_id
      WHERE vb.usaha_id = v_booking.usaha_id
        AND vb.varian_barang_id = v_source_line.varian_barang_id;
    ELSE
      SELECT b.kategori_barang_id
        INTO v_source_category_id
      FROM public.barang b
      WHERE b.usaha_id = v_booking.usaha_id
        AND b.barang_id = v_source_line.barang_id;
    END IF;

    IF v_source_category_id IS NULL THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: kategori item sumber tidak lagi tersedia'
        USING ERRCODE = '23514';
    END IF;

    v_alt_line := v_items->0;
    IF jsonb_typeof(v_alt_line) IS DISTINCT FROM 'object'
       OR lower(btrim(coalesce(v_alt_line->>'kind', ''))) <> v_source_line.line_kind THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: alternatif harus tetap berada pada domain sewa/beli yang sama'
        USING ERRCODE = '22023';
    END IF;

    v_barang_id := nullif(v_alt_line->>'barang_id', '')::uuid;
    v_variant_id := nullif(v_alt_line->>'varian_barang_id', '')::uuid;
    v_package_id := nullif(v_alt_line->>'paket_sewa_id', '')::uuid;

    IF num_nonnulls(v_barang_id, v_variant_id, v_package_id) <> 1
       OR v_package_id IS NOT NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: alternatif harus berupa satu barang atau varian'
        USING ERRCODE = '22023';
    END IF;

    IF v_variant_id IS NOT NULL THEN
      SELECT b.kategori_barang_id
        INTO v_category_id
      FROM public.varian_barang vb
      JOIN public.barang b
        ON b.usaha_id = vb.usaha_id
       AND b.barang_id = vb.barang_id
      WHERE vb.usaha_id = v_booking.usaha_id
        AND vb.varian_barang_id = v_variant_id
        AND vb.status = 'active'
        AND b.status = 'active';
    ELSE
      SELECT b.kategori_barang_id
        INTO v_category_id
      FROM public.barang b
      WHERE b.usaha_id = v_booking.usaha_id
        AND b.barang_id = v_barang_id
        AND b.status = 'active';
    END IF;

    IF v_category_id IS NULL OR v_category_id IS DISTINCT FROM v_source_category_id THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: alternatif harus berasal dari kategori yang sama'
        USING ERRCODE = '23514';
    END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'kind', l.line_kind,
      'barang_id', l.barang_id,
      'varian_barang_id', l.varian_barang_id,
      'paket_sewa_id', l.paket_sewa_id,
      'jumlah', l.quantity
    ) ORDER BY l.line_position, l.created_at), '[]'::jsonb)
    INTO v_items
    FROM app_private.akasha_smart_booking_line l
    WHERE l.usaha_id = v_booking.usaha_id
      AND l.smart_booking_id = v_booking.smart_booking_id
      AND l.smart_booking_line_id <> v_source_line_id;

    v_alt_line := jsonb_set(
      v_alt_line,
      '{jumlah}',
      to_jsonb(v_source_line.quantity),
      true
    );
    v_items := v_items || jsonb_build_array(v_alt_line);
  END IF;

  IF jsonb_array_length(v_items) < 1 OR jsonb_array_length(v_items) > 10 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: total item setelah perubahan harus 1-10 jenis'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::integer, coalesce(sum(l.subtotal_snapshot), 0)
    INTO v_line_count_before, v_total_before
  FROM app_private.akasha_smart_booking_line l
  WHERE l.usaha_id = v_booking.usaha_id
    AND l.smart_booking_id = v_booking.smart_booking_id;

  -- Resolve every proposed line from current public catalog projections.
  -- Prices, names, tariff IDs, promo IDs and inventory mode sent by browsers
  -- are intentionally ignored and recalculated below.
  DELETE FROM app_private.akasha_smart_booking_line l
  WHERE l.usaha_id = v_booking.usaha_id
    AND l.smart_booking_id = v_booking.smart_booking_id;

  FOR v_line IN
    SELECT value
    FROM jsonb_array_elements(v_items)
  LOOP
    IF jsonb_typeof(v_line) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: setiap item perubahan harus berupa objek'
        USING ERRCODE = '22023';
    END IF;

    v_kind := lower(btrim(coalesce(v_line->>'kind', '')));
    IF v_kind NOT IN ('rental', 'sale') THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: tipe item harus rental atau sale'
        USING ERRCODE = '22023';
    END IF;

    IF coalesce(v_line->>'barang_id', '') <> ''
       AND coalesce(v_line->>'barang_id', '') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: ID barang tidak valid'
        USING ERRCODE = '22023';
    END IF;
    IF coalesce(v_line->>'varian_barang_id', '') <> ''
       AND coalesce(v_line->>'varian_barang_id', '') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: ID varian tidak valid'
        USING ERRCODE = '22023';
    END IF;
    IF coalesce(v_line->>'paket_sewa_id', '') <> ''
       AND coalesce(v_line->>'paket_sewa_id', '') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: ID paket tidak valid'
        USING ERRCODE = '22023';
    END IF;

    v_barang_id := nullif(v_line->>'barang_id', '')::uuid;
    v_variant_id := nullif(v_line->>'varian_barang_id', '')::uuid;
    v_package_id := nullif(v_line->>'paket_sewa_id', '')::uuid;

    IF num_nonnulls(v_barang_id, v_variant_id, v_package_id) <> 1 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: setiap item harus memilih tepat satu barang, varian, atau paket'
        USING ERRCODE = '22023';
    END IF;
    IF v_kind = 'sale' AND v_package_id IS NOT NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: paket hanya dapat diproses sebagai item rental'
        USING ERRCODE = '22023';
    END IF;

    IF coalesce(v_line->>'jumlah', '') !~ '^[0-9]{1,2}(\.[0-9]{1,3})?$' THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: jumlah item tidak valid'
        USING ERRCODE = '22023';
    END IF;
    v_quantity := (v_line->>'jumlah')::numeric;
    IF v_quantity < 1 OR v_quantity > 20 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: jumlah item harus berada pada rentang 1-20'
        USING ERRCODE = '22023';
    END IF;

    v_target_key := v_kind || ':' || coalesce(
      v_barang_id::text,
      v_variant_id::text,
      v_package_id::text
    );
    IF v_target_key = ANY(v_seen_targets) THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: item yang sama tidak boleh diajukan lebih dari sekali'
        USING ERRCODE = '22023';
    END IF;
    v_seen_targets := array_append(v_seen_targets, v_target_key);

    v_target_barang_id := NULL;
    v_target_variant_id := NULL;
    v_target_package_id := NULL;
    v_tariff_id := NULL;
    v_catalog_promo_id := NULL;
    v_package_promo_id := NULL;
    v_name := NULL;
    v_variant_name := NULL;
    v_normal_price := NULL;
    v_discount_percent := 0;
    v_currency_code := 'IDR';
    v_inventory_mode := NULL;
    v_duration_unit := NULL;
    v_duration_value := NULL;

    IF v_kind = 'rental' AND v_package_id IS NOT NULL THEN
      SELECT
        p.paket_sewa_id,
        p.nama,
        t.tarif_sewa_id,
        t.nominal,
        t.currency_code,
        t.durasi_unit,
        t.durasi_nilai,
        pp.promosi_paket_id,
        pp.harga_promo
      INTO
        v_target_package_id,
        v_name,
        v_tariff_id,
        v_normal_price,
        v_currency_code,
        v_duration_unit,
        v_duration_value,
        v_package_promo_id,
        v_effective_price
      FROM public.v_public_paket_sewa p
      JOIN public.v_public_tarif_sewa t
        ON t.usaha_id = p.usaha_id
       AND t.paket_sewa_id = p.paket_sewa_id
      LEFT JOIN public.v_public_paket_promo pp
        ON pp.usaha_id = t.usaha_id
       AND pp.paket_sewa_id = t.paket_sewa_id
       AND pp.tarif_sewa_id = t.tarif_sewa_id
      WHERE p.usaha_id = v_booking.usaha_id
        AND p.paket_sewa_id = v_package_id
        AND p.status = 'active'
      ORDER BY t.durasi_nilai ASC, t.nominal ASC, t.tarif_sewa_id
      LIMIT 1;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: paket atau tarif rental aktif tidak ditemukan di katalog publik'
          USING ERRCODE = 'P0002';
      END IF;

      v_effective_price := coalesce(v_effective_price, v_normal_price);
      v_discount_percent := CASE
        WHEN v_normal_price > 0 AND v_effective_price < v_normal_price
          THEN round((v_normal_price - v_effective_price) * 100 / v_normal_price, 2)
        ELSE 0
      END;

    ELSIF v_kind = 'rental' THEN
      SELECT
        r.barang_id,
        r.varian_barang_id,
        r.tarif_sewa_id,
        r.barang_nama,
        r.varian_nama,
        r.harga_normal,
        r.currency_code,
        r.inventory_mode,
        r.durasi_unit,
        r.durasi_nilai
      INTO
        v_target_barang_id,
        v_target_variant_id,
        v_tariff_id,
        v_name,
        v_variant_name,
        v_normal_price,
        v_currency_code,
        v_inventory_mode,
        v_duration_unit,
        v_duration_value
      FROM public.v_public_katalog_rental r
      WHERE r.usaha_id = v_booking.usaha_id
        AND (
          (v_variant_id IS NULL AND r.varian_barang_id IS NULL AND r.barang_id = v_barang_id)
          OR
          (v_variant_id IS NOT NULL AND r.varian_barang_id = v_variant_id)
        )
      ORDER BY r.durasi_nilai ASC, r.harga_normal ASC, r.tarif_sewa_id
      LIMIT 1;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: barang atau varian rental tidak lagi aktif di katalog publik'
          USING ERRCODE = 'P0002';
      END IF;

      IF v_target_variant_id IS NOT NULL THEN
        v_target_barang_id := NULL;
      END IF;

      SELECT promo.promosi_katalog_id, coalesce(promo.diskon_persen, 0)
        INTO v_catalog_promo_id, v_discount_percent
      FROM app_private.resolve_catalog_promo_price(
        v_booking.usaha_id,
        CASE WHEN v_target_variant_id IS NULL THEN v_target_barang_id ELSE NULL END,
        v_target_variant_id,
        'rental',
        now()
      ) promo;

      v_discount_percent := coalesce(v_discount_percent, 0);
      v_effective_price := round(v_normal_price * (100 - v_discount_percent) / 100, 2);

    ELSE
      SELECT
        s.barang_id,
        s.varian_barang_id,
        s.barang_nama,
        s.varian_nama,
        s.harga_normal,
        s.currency_code,
        s.inventory_mode
      INTO
        v_target_barang_id,
        v_target_variant_id,
        v_name,
        v_variant_name,
        v_normal_price,
        v_currency_code,
        v_inventory_mode
      FROM public.v_public_katalog_jual s
      WHERE s.usaha_id = v_booking.usaha_id
        AND (
          (v_variant_id IS NULL AND s.varian_barang_id IS NULL AND s.barang_id = v_barang_id)
          OR
          (v_variant_id IS NOT NULL AND s.varian_barang_id = v_variant_id)
        )
      LIMIT 1;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: barang atau varian pembelian tidak lagi aktif di katalog publik'
          USING ERRCODE = 'P0002';
      END IF;

      IF v_target_variant_id IS NOT NULL THEN
        v_target_barang_id := NULL;
      END IF;

      SELECT promo.promosi_katalog_id, coalesce(promo.diskon_persen, 0)
        INTO v_catalog_promo_id, v_discount_percent
      FROM app_private.resolve_catalog_promo_price(
        v_booking.usaha_id,
        CASE WHEN v_target_variant_id IS NULL THEN v_target_barang_id ELSE NULL END,
        v_target_variant_id,
        'sale',
        now()
      ) promo;

      v_discount_percent := coalesce(v_discount_percent, 0);
      v_effective_price := round(v_normal_price * (100 - v_discount_percent) / 100, 2);
    END IF;

    IF v_name IS NULL OR v_normal_price IS NULL OR v_normal_price < 0
       OR v_effective_price IS NULL OR v_effective_price < 0
       OR v_currency_code <> 'IDR' THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: harga atau mata uang katalog tidak valid'
        USING ERRCODE = '22023';
    END IF;

    v_discount_amount := round((v_normal_price - v_effective_price) * v_quantity, 2);
    IF v_discount_amount < 0 THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: harga efektif katalog melebihi harga normal'
        USING ERRCODE = '23514';
    END IF;

    v_subtotal := round(v_effective_price * v_quantity, 2);
    v_position := v_position + 1;
    v_has_rental := v_has_rental OR v_kind = 'rental';

    INSERT INTO app_private.akasha_smart_booking_line (
      usaha_id,
      smart_booking_id,
      line_kind,
      barang_id,
      varian_barang_id,
      paket_sewa_id,
      quantity,
      item_name_snapshot,
      variant_label_snapshot,
      inventory_mode_snapshot,
      unit_price_snapshot,
      normal_price_snapshot,
      discount_percent_snapshot,
      discount_amount_snapshot,
      subtotal_snapshot,
      currency_code,
      tarif_sewa_id,
      promosi_katalog_id,
      promosi_paket_id,
      line_metadata,
      line_position
    )
    VALUES (
      v_booking.usaha_id,
      v_booking.smart_booking_id,
      v_kind,
      v_target_barang_id,
      v_target_variant_id,
      v_target_package_id,
      v_quantity,
      v_name,
      v_variant_name,
      v_inventory_mode,
      v_effective_price,
      v_normal_price,
      v_discount_percent,
      v_discount_amount,
      v_subtotal,
      v_currency_code,
      v_tariff_id,
      v_catalog_promo_id,
      v_package_promo_id,
      jsonb_build_object(
        'source', 'admin_item_change_approval',
        'change_request_id', p_change_request_id,
        'approved_at', now()
      ),
      v_position
    );
  END LOOP;

  IF v_has_rental AND (
    v_booking.requested_pickup_date IS NULL
    OR v_booking.requested_return_date IS NULL
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: booking harus memiliki jadwal sebelum perubahan menambahkan item rental'
      USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(sum(l.subtotal_snapshot), 0)
    INTO v_total_after
  FROM app_private.akasha_smart_booking_line l
  WHERE l.usaha_id = v_booking.usaha_id
    AND l.smart_booking_id = v_booking.smart_booking_id;

  UPDATE app_private.akasha_smart_booking b
  SET
    workflow_status = v_change.previous_workflow_status,
    quote_total = v_total_after,
    revision = b.revision + 1,
    updated_at = now()
  WHERE b.usaha_id = v_booking.usaha_id
    AND b.smart_booking_id = v_booking.smart_booking_id;

  UPDATE app_private.akasha_smart_booking_change_request c
  SET
    request_status = 'applied',
    resolved_by_admin_id = v_admin_id,
    resolved_at = now(),
    resolution_note = v_resolution_note,
    public_resolution_note = coalesce(
      v_public_note,
      'Perubahan barang pada booking Anda telah diterapkan oleh tim Akasha.'
    ),
    updated_at = now()
  WHERE c.usaha_id = v_booking.usaha_id
    AND c.smart_booking_change_request_id = p_change_request_id;

  INSERT INTO app_private.akasha_smart_booking_activity_event (
    usaha_id,
    smart_booking_id,
    event_type,
    actor_type,
    actor_admin_id,
    customer_visible,
    public_message,
    internal_metadata
  )
  VALUES (
    v_booking.usaha_id,
    v_booking.smart_booking_id,
    'booking.change.applied',
    'admin',
    v_admin_id,
    true,
    coalesce(
      v_public_note,
      CASE
        WHEN v_change.request_type = 'alternative_interest'
          THEN 'Alternatif barang yang Anda pilih telah diterapkan ke booking.'
        ELSE 'Perubahan barang booking Anda telah diterapkan oleh tim Akasha.'
      END
    ),
    jsonb_build_object(
      'change_request_id', p_change_request_id,
      'request_type', v_change.request_type,
      'revision_from', v_booking.revision,
      'revision_to', v_booking.revision + 1,
      'line_count_before', v_line_count_before,
      'line_count_after', v_position,
      'quote_total_before', v_total_before,
      'quote_total_after', v_total_after
    )
  );

  INSERT INTO public.audit_log (
    usaha_id,
    actor_auth_user_id,
    actor_akun_admin_id,
    action,
    entity_type,
    entity_id,
    source_application,
    change_summary,
    reason
  )
  VALUES (
    v_booking.usaha_id,
    v_actor,
    v_admin_id,
    'apply_item_change',
    'akasha_smart_booking',
    v_booking.smart_booking_id,
    'rental-admin',
    jsonb_build_object(
      'change_request_id', p_change_request_id,
      'request_type', v_change.request_type,
      'revision_from', v_booking.revision,
      'revision_to', v_booking.revision + 1,
      'line_count_before', v_line_count_before,
      'line_count_after', v_position,
      'quote_total_before', v_total_before,
      'quote_total_after', v_total_after,
      'inventory_effect', 'none'
    ),
    v_resolution_note
  );

  INSERT INTO public.outbox_event (
    usaha_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload
  )
  VALUES (
    v_booking.usaha_id,
    'akasha_smart_booking.item_change_applied',
    'akasha_smart_booking',
    v_booking.smart_booking_id,
    jsonb_build_object(
      'smart_booking_id', v_booking.smart_booking_id,
      'change_request_id', p_change_request_id,
      'revision', v_booking.revision + 1
    )
  );

  v_response := jsonb_build_object(
    'smart_booking_id', v_booking.smart_booking_id,
    'request_id', p_change_request_id,
    'request_status', 'applied',
    'workflow_status', v_change.previous_workflow_status,
    'revision', v_booking.revision + 1,
    'line_count', v_position,
    'quote_total', v_total_after,
    'currency_code', 'IDR',
    'inventory_effect', 'none'
  );

  UPDATE public.idempotency_key
  SET response_status = 200,
      response_body = v_response
  WHERE idempotency_key_id = v_idem_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_apply_akasha_smart_booking_item_change(
  p_change_request_id uuid,
  p_expected_revision integer,
  p_idempotency_key text,
  p_resolution_note text DEFAULT NULL,
  p_public_resolution_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.admin_apply_akasha_smart_booking_item_change(
    $1, $2, $3, $4, $5
  );
$function$;

REVOKE ALL ON FUNCTION app_private.admin_apply_akasha_smart_booking_item_change(uuid, integer, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_apply_akasha_smart_booking_item_change(uuid, integer, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.admin_apply_akasha_smart_booking_item_change(uuid, integer, text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION app_private.admin_apply_akasha_smart_booking_item_change(uuid, integer, text, text, text)
  IS 'Applies pending Smart Booking item/variant/quantity/alternative requests by rebuilding only Smart Booking line snapshots from public catalog truth. Never mutates rental, inventory, catalog, sales, payment or walk-in domains.';
