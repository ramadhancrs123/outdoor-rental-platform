-- Smart Booking checkout: actual rental dates are admin-controlled, independent of the customer request dates.
-- The original requested dates remain on the linked reservation as historical booking data.

CREATE OR REPLACE FUNCTION app_private.admin_checkout_akasha_smart_booking(
  p_smart_booking_id uuid,
  p_expected_revision integer,
  p_jadwal_mulai timestamptz DEFAULT NULL,
  p_jadwal_kembali timestamptz DEFAULT NULL,
  p_rental_lines jsonb DEFAULT '[]'::jsonb,
  p_sale_lines jsonb DEFAULT '[]'::jsonb,
  p_akun_keuangan_id uuid DEFAULT NULL,
  p_metode text DEFAULT 'cash',
  p_payment_rental_amount numeric DEFAULT 0,
  p_dibayar_at timestamptz DEFAULT NULL,
  p_catatan text DEFAULT NULL,
  p_discount_request jsonb DEFAULT '{"mode":"none"}'::jsonb,
  p_idempotency_key text DEFAULT NULL,
  p_request_id uuid DEFAULT NULL,
  p_activate_rental boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_booking app_private.akasha_smart_booking%ROWTYPE;
  v_admin_id uuid;
  v_actor uuid := auth.uid();
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_request_hash text;
  v_idem_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_rental_count integer;
  v_sale_count integer;
  v_nested jsonb;
  v_response jsonb;
  v_rental_id uuid;
  v_sale_id uuid;
  v_checkout_id uuid;
  v_has_reservation boolean;
  v_event_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: sesi admin tidak ditemukan'
      USING ERRCODE = '42501';
  END IF;
  IF p_smart_booking_id IS NULL
     OR length(v_key) < 8 OR length(v_key) > 100
     OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: booking, idempotency key, dan request ID wajib valid'
      USING ERRCODE = '22023';
  END IF;
  IF p_rental_lines IS NULL OR jsonb_typeof(p_rental_lines) <> 'array'
     OR p_sale_lines IS NULL OR jsonb_typeof(p_sale_lines) <> 'array' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: detail rental dan pembelian harus berupa array'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_booking
  FROM app_private.akasha_smart_booking b
  WHERE b.smart_booking_id = p_smart_booking_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: booking online tidak ditemukan'
      USING ERRCODE = 'P0002';
  END IF;

  v_admin_id := app_private.require_usaha_permission(v_booking.usaha_id, 'reservation.amend');

  v_request_hash := encode(
    extensions.digest(
      convert_to(jsonb_build_object(
        'smart_booking_id', p_smart_booking_id,
        'expected_revision', p_expected_revision,
        'pickup_at', p_jadwal_mulai,
        'return_at', p_jadwal_kembali,
        'rental_lines', p_rental_lines,
        'sale_lines', p_sale_lines,
        'account_id', p_akun_keuangan_id,
        'payment_method', p_metode,
        'payment_rental_amount', coalesce(p_payment_rental_amount, 0),
        'paid_at', p_dibayar_at,
        'note', p_catatan,
        'discount_request', coalesce(p_discount_request, '{"mode":"none"}'::jsonb),
        'activate_rental', coalesce(p_activate_rental, false),
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
    'admin_checkout_akasha_smart_booking', v_request_hash
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
      AND ik.command_name = 'admin_checkout_akasha_smart_booking'
      AND ik.key = v_key;

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key checkout booking telah digunakan dengan payload berbeda'
        USING ERRCODE = '23505';
    END IF;
    IF v_existing_response IS NULL THEN
      RAISE EXCEPTION 'UNKNOWN_OUTCOME: hasil checkout booking belum dapat dipastikan'
        USING ERRCODE = '40001';
    END IF;
    RETURN v_existing_response;
  END IF;

  IF p_expected_revision IS DISTINCT FROM v_booking.revision THEN
    RAISE EXCEPTION 'STALE_REVISION: booking berubah. Muat ulang sebelum membuat transaksi.'
      USING ERRCODE = '40001';
  END IF;
  IF v_booking.workflow_status <> 'ready_for_checkout' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: booking harus berstatus siap checkout sebelum diproses'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM app_private.akasha_smart_booking_change_request c
    WHERE c.usaha_id = v_booking.usaha_id
      AND c.smart_booking_id = v_booking.smart_booking_id
      AND c.request_status = 'pending'
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: masih ada permintaan customer yang belum diselesaikan'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM app_private.akasha_smart_booking_conversion c
    WHERE c.usaha_id = v_booking.usaha_id
      AND c.smart_booking_id = v_booking.smart_booking_id
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: booking telah dikonversi menjadi transaksi operasional'
      USING ERRCODE = '23505';
  END IF;

  SELECT count(*)::integer INTO v_rental_count
  FROM app_private.akasha_smart_booking_line l
  WHERE l.usaha_id = v_booking.usaha_id
    AND l.smart_booking_id = v_booking.smart_booking_id
    AND l.line_kind = 'rental';

  SELECT count(*)::integer INTO v_sale_count
  FROM app_private.akasha_smart_booking_line l
  WHERE l.usaha_id = v_booking.usaha_id
    AND l.smart_booking_id = v_booking.smart_booking_id
    AND l.line_kind = 'sale';

  IF v_rental_count + v_sale_count < 1
     OR v_rental_count <> jsonb_array_length(p_rental_lines)
     OR v_sale_count <> jsonb_array_length(p_sale_lines) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: daftar rental/pembelian harus sama dengan item booking yang telah disetujui'
      USING ERRCODE = '23514';
  END IF;

  -- Verify every operational line against the currently approved Smart Booking
  -- snapshot. Browser input may enrich a rental line with a tariff and period,
  -- but cannot change product identity, package, line kind, or quantity.
  IF EXISTS (
    SELECT 1
    FROM app_private.akasha_smart_booking_line l
    WHERE l.usaha_id = v_booking.usaha_id
      AND l.smart_booking_id = v_booking.smart_booking_id
      AND l.line_kind = 'rental'
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_rental_lines) proposed(value)
        WHERE coalesce(proposed.value->>'barang_id', '') =
              CASE WHEN l.varian_barang_id IS NULL AND l.paket_sewa_id IS NULL THEN coalesce(l.barang_id::text, '') ELSE '' END
          AND coalesce(proposed.value->>'varian_barang_id', '') = coalesce(l.varian_barang_id::text, '')
          AND coalesce(proposed.value->>'paket_sewa_id', '') = coalesce(l.paket_sewa_id::text, '')
          AND coalesce(proposed.value->>'tarif_sewa_id', '') = coalesce(l.tarif_sewa_id::text, '')
          AND coalesce(proposed.value->>'jumlah', '') ~ '^[0-9]+(\.[0-9]{1,3})?$'
          AND (proposed.value->>'jumlah')::numeric = l.quantity
      )
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: item rental tidak sama dengan snapshot booking. Ajukan perubahan melalui portal customer terlebih dahulu.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM app_private.akasha_smart_booking_line l
    WHERE l.usaha_id = v_booking.usaha_id
      AND l.smart_booking_id = v_booking.smart_booking_id
      AND l.line_kind = 'sale'
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_sale_lines) proposed(value)
        WHERE coalesce(proposed.value->>'barang_id', '') =
              CASE WHEN l.varian_barang_id IS NULL THEN coalesce(l.barang_id::text, '') ELSE '' END
          AND coalesce(proposed.value->>'varian_barang_id', '') = coalesce(l.varian_barang_id::text, '')
          AND coalesce(proposed.value->>'jumlah', '') ~ '^[0-9]+(\.[0-9]{1,3})?$'
          AND (proposed.value->>'jumlah')::numeric = l.quantity
          AND coalesce((proposed.value->>'is_bonus_rental')::boolean, false) = false
      )
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: item pembelian tidak sama dengan snapshot booking atau memuat bonus yang belum disetujui'
      USING ERRCODE = '23514';
  END IF;

  IF v_rental_count > 0 THEN
    IF v_booking.penyewa_id IS NULL
       OR p_jadwal_mulai IS NULL
       OR p_jadwal_kembali IS NULL
       OR p_jadwal_kembali <= p_jadwal_mulai
       OR v_booking.requested_pickup_date IS NULL
       OR v_booking.requested_return_date IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: penyewa dan periode aktual rental wajib ditentukan'
        USING ERRCODE = '22023';
    END IF;

    -- The customer schedule is preserved as a reservation record only.
    -- Actual pickup/return timestamps are selected by the admin and are
    -- validated by the rental command against operational availability.

    SELECT EXISTS (
      SELECT 1 FROM public.reservasi r
      WHERE r.usaha_id = v_booking.usaha_id
        AND r.reservasi_id = v_booking.reservasi_id
        AND r.penyewa_id = v_booking.penyewa_id
        AND r.status = 'draft'
        AND r.stock_lock_status = 'not_locked'
    ) INTO v_has_reservation;

    IF v_booking.reservasi_id IS NOT NULL AND NOT v_has_reservation THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: draft reservasi tidak lagi sesuai untuk konversi booking ini'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF coalesce(p_payment_rental_amount, 0) <> 0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: pembayaran rental tidak boleh diberikan untuk booking pembelian saja'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_sale_count > 0 AND p_akun_keuangan_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: pilih akun operasional penerima pembayaran untuk pembelian'
      USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_payment_rental_amount, 0) < 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: pembayaran rental tidak boleh negatif'
      USING ERRCODE = '22023';
  END IF;

  -- Each nested command re-resolves current catalog price, promo, rental
  -- duration and available physical/quantity stock. Sale stock is consumed
  -- before rental stock in the existing mixed checkout command.
  IF v_rental_count > 0 AND v_sale_count > 0 THEN
    IF coalesce(p_activate_rental, false) THEN
      v_nested := app_private.command_create_mixed_checkout_and_activate_with_discount(
        v_booking.usaha_id,
        v_booking.penyewa_id,
        p_jadwal_mulai,
        p_jadwal_kembali,
        p_rental_lines,
        p_sale_lines,
        p_akun_keuangan_id,
        p_metode,
        coalesce(p_payment_rental_amount, 0),
        p_dibayar_at,
        coalesce(p_catatan, 'Transaksi dari AKASHA SMART BOOKING ' || v_booking.reference_code),
        coalesce(p_discount_request, '{"mode":"none"}'::jsonb),
        left(v_key || ':mixed-activate', 240),
        p_request_id
      );
    ELSE
      v_nested := app_private.command_create_mixed_checkout_with_discount(
        v_booking.usaha_id,
        v_booking.penyewa_id,
        p_jadwal_mulai,
        p_jadwal_kembali,
        p_rental_lines,
        p_sale_lines,
        p_akun_keuangan_id,
        p_metode,
        coalesce(p_payment_rental_amount, 0),
        p_dibayar_at,
        coalesce(p_catatan, 'Transaksi dari AKASHA SMART BOOKING ' || v_booking.reference_code),
        coalesce(p_discount_request, '{"mode":"none"}'::jsonb),
        left(v_key || ':mixed', 240),
        p_request_id
      );
    END IF;
    v_rental_id := nullif(v_nested->>'penyewaan_id', '')::uuid;
    v_sale_id := nullif(v_nested->>'penjualan_id', '')::uuid;
    v_checkout_id := nullif(v_nested->>'checkout_id', '')::uuid;

  ELSIF v_rental_count > 0 THEN
    IF coalesce(p_activate_rental, false) THEN
      v_nested := app_private.command_create_direct_rental_and_activate_with_discount(
        v_booking.usaha_id,
        v_booking.penyewa_id,
        p_jadwal_mulai,
        p_jadwal_kembali,
        p_rental_lines,
        coalesce(p_catatan, 'Transaksi dari AKASHA SMART BOOKING ' || v_booking.reference_code),
        coalesce(p_discount_request, '{"mode":"none"}'::jsonb),
        left(v_key || ':rental-activate', 240),
        p_request_id
      );
    ELSE
      v_nested := app_private.command_create_direct_rental_with_discount(
        v_booking.usaha_id,
        v_booking.penyewa_id,
        p_jadwal_mulai,
        p_jadwal_kembali,
        p_rental_lines,
        coalesce(p_catatan, 'Transaksi dari AKASHA SMART BOOKING ' || v_booking.reference_code),
        coalesce(p_discount_request, '{"mode":"none"}'::jsonb),
        left(v_key || ':rental', 240),
        p_request_id
      );
    END IF;
    v_rental_id := nullif(v_nested->>'penyewaan_id', '')::uuid;
  ELSE
    v_nested := app_private.command_create_sale(
      v_booking.usaha_id,
      'pos',
      v_booking.customer_name,
      v_booking.customer_phone,
      coalesce(p_catatan, 'Pembelian dari AKASHA SMART BOOKING ' || v_booking.reference_code),
      p_sale_lines,
      p_akun_keuangan_id,
      p_metode,
      left(v_key || ':sale', 240),
      p_request_id
    );
    v_sale_id := nullif(v_nested->>'penjualan_id', '')::uuid;
    v_checkout_id := nullif(v_nested->>'checkout_id', '')::uuid;
  END IF;

  IF (v_rental_count > 0 AND v_rental_id IS NULL)
     OR (v_sale_count > 0 AND v_sale_id IS NULL) THEN
    RAISE EXCEPTION 'INTERNAL_ERROR: perintah transaksi tidak mengembalikan identitas transaksi lengkap'
      USING ERRCODE = 'P0001';
  END IF;

  -- Preserve the original website request/reservation relationship without
  -- ever marking capacity locked. A draft request becomes converted only
  -- after the operational rental exists.
  IF v_rental_id IS NOT NULL AND v_booking.reservasi_id IS NOT NULL THEN
    UPDATE public.penyewaan p
    SET reservasi_id = v_booking.reservasi_id,
        updated_at = now()
    WHERE p.usaha_id = v_booking.usaha_id
      AND p.penyewaan_id = v_rental_id
      AND p.reservasi_id IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'INTERNAL_ERROR: hubungan rental dengan booking tidak berhasil disimpan'
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.reservasi r
    SET status = 'converted',
        stock_lock_status = 'not_locked',
        mulai_reservasi = v_booking.requested_pickup_date,
        selesai_reservasi = v_booking.requested_return_date,
        updated_at = now()
    WHERE r.usaha_id = v_booking.usaha_id
      AND r.reservasi_id = v_booking.reservasi_id
      AND r.status = 'draft'
      AND r.stock_lock_status = 'not_locked';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: draft reservasi berubah selama konversi'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO app_private.akasha_smart_booking_conversion (
    usaha_id, smart_booking_id, checkout_id, penyewaan_id,
    penjualan_id, converted_by_admin_id, source_command
  )
  VALUES (
    v_booking.usaha_id, v_booking.smart_booking_id, v_checkout_id,
    v_rental_id, v_sale_id, v_admin_id,
    CASE
      WHEN v_rental_id IS NOT NULL AND v_sale_id IS NOT NULL AND coalesce(p_activate_rental, false) THEN 'mixed_checkout_and_activate'
      WHEN v_rental_id IS NOT NULL AND v_sale_id IS NOT NULL THEN 'mixed_checkout'
      WHEN v_rental_id IS NOT NULL AND coalesce(p_activate_rental, false) THEN 'direct_rental_and_activate'
      WHEN v_rental_id IS NOT NULL THEN 'direct_rental'
      ELSE 'sale'
    END
  );

  UPDATE app_private.akasha_smart_booking b
  SET workflow_status = 'fulfilled',
      closed_at = now(),
      revision = b.revision + 1,
      updated_at = now()
  WHERE b.usaha_id = v_booking.usaha_id
    AND b.smart_booking_id = v_booking.smart_booking_id;

  INSERT INTO app_private.akasha_smart_booking_activity_event (
    usaha_id, smart_booking_id, event_type, actor_type,
    actor_admin_id, customer_visible, public_message, internal_metadata
  )
  VALUES (
    v_booking.usaha_id, v_booking.smart_booking_id,
    'booking.converted', 'admin', v_admin_id, true,
    'Booking Anda telah diproses menjadi transaksi operasional oleh tim Akasha.',
    jsonb_build_object(
      'penyewaan_id', v_rental_id,
      'penjualan_id', v_sale_id,
      'checkout_id', v_checkout_id,
      'inventory_revalidated', true,
      'stock_lock_created', false,
      'rental_activated', coalesce(p_activate_rental, false)
    )
  );

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id,
    action, entity_type, entity_id, source_application,
    request_id, change_summary
  )
  VALUES (
    v_booking.usaha_id, v_actor, v_admin_id,
    'convert_smart_booking', 'akasha_smart_booking',
    v_booking.smart_booking_id, 'rental-admin',
    p_request_id,
    jsonb_build_object(
      'revision_from', v_booking.revision,
      'revision_to', v_booking.revision + 1,
      'penyewaan_id', v_rental_id,
      'penjualan_id', v_sale_id,
      'checkout_id', v_checkout_id,
      'inventory_revalidated', true,
      'stock_lock_created', false,
      'rental_activated', coalesce(p_activate_rental, false)
    )
  );

  INSERT INTO public.outbox_event (
    usaha_id, event_type, aggregate_type, aggregate_id, payload
  )
  VALUES (
    v_booking.usaha_id, 'akasha_smart_booking.converted',
    'akasha_smart_booking', v_booking.smart_booking_id,
    jsonb_build_object(
      'smart_booking_id', v_booking.smart_booking_id,
      'penyewaan_id', v_rental_id,
      'penjualan_id', v_sale_id,
      'checkout_id', v_checkout_id,
      'revision', v_booking.revision + 1
    )
  );

  v_response := jsonb_build_object(
    'smart_booking_id', v_booking.smart_booking_id,
    'reference_code', v_booking.reference_code,
    'workflow_status', 'fulfilled',
    'revision', v_booking.revision + 1,
    'penyewaan_id', v_rental_id,
    'penjualan_id', v_sale_id,
    'checkout_id', v_checkout_id,
    'transaction_result', v_nested,
    'inventory_revalidated', true,
    'stock_lock_created', false,
    'rental_activated', coalesce(p_activate_rental, false)
  );

  UPDATE public.idempotency_key
  SET response_status = 200,
      response_body = v_response
  WHERE idempotency_key_id = v_idem_id;

  RETURN v_response;
END;
$function$;
