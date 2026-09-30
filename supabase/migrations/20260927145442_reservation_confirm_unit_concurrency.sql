-- Reservation confirmation must lock candidate physical units while checking availability.
-- This prevents an inventory mutation from changing a candidate unit between
-- availability validation and the reservation commit.
CREATE OR REPLACE FUNCTION app_private.command_confirm_reservation(p_usaha_id uuid, p_reservasi_id uuid, p_idempotency_key text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_reservation public.reservasi%ROWTYPE;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_response jsonb;
  v_available numeric;
  v_reserved numeric;
  v_requested numeric;
  v_component record;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL OR p_reservasi_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id dan reservasi_id wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi' USING ERRCODE = '22023';
  END IF;

  SELECT aa.akun_admin_id
  INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id = aa.akun_admin_id
   AND ku.status = 'active'
   AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id = v_auth_user_id
    AND aa.status = 'active'
    AND ku.usaha_id = p_usaha_id;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE = '42501';
  END IF;

  v_request_hash := md5(jsonb_build_object('usaha_id', p_usaha_id, 'reservasi_id', p_reservasi_id)::text);

  INSERT INTO public.idempotency_key (
    usaha_id, actor_auth_user_id, key, command_name, request_hash
  )
  VALUES (
    p_usaha_id, v_auth_user_id, btrim(p_idempotency_key),
    'confirm_reservation', v_request_hash
  )
  ON CONFLICT (usaha_id, actor_auth_user_id, command_name, key)
  DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body, ik.request_hash
    INTO v_existing_response, v_existing_hash
    FROM public.idempotency_key ik
    WHERE ik.usaha_id = p_usaha_id
      AND ik.actor_auth_user_id = v_auth_user_id
      AND ik.command_name = 'confirm_reservation'
      AND ik.key = btrim(p_idempotency_key);

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE = '23505';
    END IF;

    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;

    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE = '40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text, 0));

  SELECT *
  INTO v_reservation
  FROM public.reservasi
  WHERE usaha_id = p_usaha_id
    AND reservasi_id = p_reservasi_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: reservasi tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  IF v_reservation.status = 'confirmed' AND v_reservation.stock_lock_status = 'locked' THEN
    v_response := jsonb_build_object(
      'reservasi_id', v_reservation.reservasi_id,
      'nomor_reservasi', v_reservation.nomor_reservasi,
      'status', v_reservation.status,
      'stock_lock_status', v_reservation.stock_lock_status,
      'confirmed_at', v_reservation.confirmed_at
    );
    UPDATE public.idempotency_key
    SET response_status = 200, response_body = v_response
    WHERE idempotency_key_id = v_idempotency_id;
    RETURN v_response;
  END IF;

  IF v_reservation.status <> 'draft' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: reservasi hanya dapat dikonfirmasi dari status draft; status sekarang %', v_reservation.status USING ERRCODE = '23514';
  END IF;

  IF v_reservation.mulai_reservasi > v_reservation.selesai_reservasi THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: periode reservasi tidak valid' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.detail_reservasi d
    WHERE d.usaha_id = p_usaha_id
      AND d.reservasi_id = p_reservasi_id
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: reservasi belum memiliki detail' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.detail_reservasi d
    WHERE d.usaha_id = p_usaha_id
      AND d.reservasi_id = p_reservasi_id
      AND (
        num_nonnulls(d.barang_id, d.varian_barang_id, d.paket_sewa_id) <> 1
        OR d.jumlah <= 0
        OR d.unit_price IS NULL
        OR d.subtotal IS NULL
        OR d.subtotal IS DISTINCT FROM round(d.jumlah * d.unit_price, 2)
      )
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: detail reservasi belum valid untuk konfirmasi' USING ERRCODE = '22023';
  END IF;

  FOR v_component IN
    WITH expanded AS (
      SELECT
        d.reservasi_id,
        d.usaha_id,
        d.jumlah AS required_qty,
        d.barang_id,
        d.varian_barang_id,
        d.paket_sewa_id
      FROM public.detail_reservasi d
      WHERE d.usaha_id = p_usaha_id
        AND d.reservasi_id = p_reservasi_id

      UNION ALL

      SELECT
        d.reservasi_id,
        d.usaha_id,
        d.jumlah * cp.jumlah AS required_qty,
        cp.barang_id,
        cp.varian_barang_id,
        NULL::uuid AS paket_sewa_id
      FROM public.detail_reservasi d
      JOIN public.komponen_paket cp
        ON cp.usaha_id = d.usaha_id
       AND cp.paket_sewa_id = d.paket_sewa_id
      WHERE d.usaha_id = p_usaha_id
        AND d.reservasi_id = p_reservasi_id
        AND d.paket_sewa_id IS NOT NULL
    )
    SELECT
      CASE WHEN varian_barang_id IS NULL THEN barang_id ELSE NULL::uuid END AS barang_id,
      varian_barang_id,
      sum(required_qty) AS required_qty
    FROM expanded
    WHERE paket_sewa_id IS NULL
      AND (barang_id IS NOT NULL OR varian_barang_id IS NOT NULL)
    GROUP BY CASE WHEN varian_barang_id IS NULL THEN barang_id ELSE NULL::uuid END,
             varian_barang_id
  LOOP
    SELECT count(*)
    INTO v_available
    FROM (
      SELECT u.unit_barang_id
      FROM public.unit_barang u
      WHERE u.usaha_id = p_usaha_id
        AND u.status = 'ready'
        AND (
          (v_component.varian_barang_id IS NULL AND u.barang_id = v_component.barang_id)
          OR
          (v_component.varian_barang_id IS NOT NULL AND u.varian_barang_id = v_component.varian_barang_id)
        )
      FOR UPDATE
    ) AS locked_ready_units;

    v_reserved := app_private.reservation_locked_component_requirement(
      p_usaha_id,
      v_reservation.mulai_reservasi,
      v_reservation.selesai_reservasi,
      v_component.barang_id,
      v_component.varian_barang_id,
      p_reservasi_id
    );

    v_requested := coalesce(v_component.required_qty, 0);

    IF v_available - v_reserved < v_requested THEN
      RAISE EXCEPTION
        'BUSINESS_CONFLICT: kapasitas tidak cukup; requested=%, available=% untuk target %',
        v_requested, greatest(v_available - v_reserved, 0),
        coalesce(v_component.varian_barang_id::text, v_component.barang_id::text)
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  UPDATE public.reservasi
  SET status = 'confirmed',
      stock_lock_status = 'locked',
      confirmed_at = now(),
      confirmed_by_admin_id = v_admin_id
  WHERE usaha_id = p_usaha_id
    AND reservasi_id = p_reservasi_id;

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, request_id, change_summary
  )
  VALUES (
    p_usaha_id, v_auth_user_id, v_admin_id, 'confirm',
    'reservasi', p_reservasi_id, 'admin-command', p_request_id,
    jsonb_build_object(
      'status_before', 'draft',
      'status_after', 'confirmed',
      'stock_lock_status', 'locked'
    )
  );

  INSERT INTO public.outbox_event (
    usaha_id, event_type, aggregate_type, aggregate_id, payload
  )
  VALUES (
    p_usaha_id, 'reservation.confirmed', 'reservasi', p_reservasi_id,
    jsonb_build_object(
      'reservation_id', p_reservasi_id,
      'nomor_reservasi', v_reservation.nomor_reservasi
    )
  );

  v_response := jsonb_build_object(
    'reservasi_id', p_reservasi_id,
    'nomor_reservasi', v_reservation.nomor_reservasi,
    'status', 'confirmed',
    'stock_lock_status', 'locked'
  );

  UPDATE public.idempotency_key
  SET response_status = 200, response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$
