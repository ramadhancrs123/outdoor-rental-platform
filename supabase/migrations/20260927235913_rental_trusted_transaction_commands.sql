-- Penyewaan phase-1 trusted transaction slice:
-- Reservation -> Rental -> Unit Assignment -> Pickup/Active.
-- Direct/walk-in, extension, return handoff, and correction remain later slices.

CREATE OR REPLACE FUNCTION app_private.command_create_rental_from_reservation(
  p_usaha_id uuid,
  p_reservasi_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_timezone text;
  v_reservation public.reservasi%ROWTYPE;
  v_existing public.penyewaan%ROWTYPE;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_rental_id uuid := gen_random_uuid();
  v_number bigint;
  v_rental_number text;
  v_tolerance_deadline timestamptz;
  v_total_amount numeric(14,2);
  v_currency text;
  v_detail public.detail_reservasi%ROWTYPE;
  v_component public.komponen_paket%ROWTYPE;
  v_detail_penyewaan_id uuid;
  v_response jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL OR p_reservasi_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id dan reservasi_id wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF p_jadwal_mulai IS NULL OR p_jadwal_kembali IS NULL OR p_jadwal_kembali <= p_jadwal_mulai THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: jadwal rental tidak valid' USING ERRCODE = '22023';
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

  SELECT u.timezone
  INTO v_timezone
  FROM public.usaha u
  WHERE u.usaha_id = p_usaha_id
    AND u.status = 'active';

  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'reservasi_id', p_reservasi_id,
    'jadwal_mulai', p_jadwal_mulai,
    'jadwal_kembali', p_jadwal_kembali
  )::text);

  INSERT INTO public.idempotency_key (
    usaha_id,
    actor_auth_user_id,
    key,
    command_name,
    request_hash
  )
  VALUES (
    p_usaha_id,
    v_auth_user_id,
    btrim(p_idempotency_key),
    'create_rental_from_reservation',
    v_request_hash
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
      AND ik.command_name = 'create_rental_from_reservation'
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
  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text || ':reservation:' || p_reservasi_id::text, 0));

  SELECT *
  INTO v_reservation
  FROM public.reservasi
  WHERE usaha_id = p_usaha_id
    AND reservasi_id = p_reservasi_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: reservasi tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  IF v_reservation.status <> 'confirmed' OR v_reservation.stock_lock_status <> 'locked' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: rental hanya dapat dibuat dari reservasi confirmed dengan stock lock locked' USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.penyewaan
  WHERE usaha_id = p_usaha_id
    AND reservasi_id = p_reservasi_id
  FOR UPDATE;

  IF FOUND THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: reservasi ini sudah memiliki penyewaan %', v_existing.nomor_penyewaan USING ERRCODE = '23505';
  END IF;

  IF (p_jadwal_mulai AT TIME ZONE v_timezone)::date <> v_reservation.mulai_reservasi
     OR (p_jadwal_kembali AT TIME ZONE v_timezone)::date <> v_reservation.selesai_reservasi THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tanggal jadwal rental harus mengikuti tanggal reservasi dalam timezone Usaha %', v_timezone USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT d.currency_code), min(d.currency_code)
  INTO v_currency, v_currency
  FROM public.detail_reservasi d
  WHERE d.usaha_id = p_usaha_id
    AND d.reservasi_id = p_reservasi_id;

  IF v_currency IS NULL THEN
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
        OR d.subtotal < 0
        OR d.unit_price < 0
        OR d.subtotal IS DISTINCT FROM round(d.jumlah * d.unit_price, 2)
      )
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: detail reservasi tidak valid untuk pembuatan rental' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.detail_reservasi d
    WHERE d.usaha_id = p_usaha_id
      AND d.reservasi_id = p_reservasi_id
    GROUP BY d.reservasi_id
    HAVING count(DISTINCT d.currency_code) <> 1
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: semua detail rental harus menggunakan currency yang sama' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(sum(d.subtotal), 0)
  INTO v_total_amount
  FROM public.detail_reservasi d
  WHERE d.usaha_id = p_usaha_id
    AND d.reservasi_id = p_reservasi_id;

  v_number := app_private.next_business_number(
    p_usaha_id,
    'RNT',
    to_char(p_jadwal_mulai AT TIME ZONE v_timezone, 'YYYY')
  );
  v_rental_number := 'RNT-' || to_char(p_jadwal_mulai AT TIME ZONE v_timezone, 'YYYY') || '-' || lpad(v_number::text, 3, '0');
  v_tolerance_deadline := p_jadwal_kembali + interval '10 hours';

  INSERT INTO public.penyewaan (
    penyewaan_id,
    usaha_id,
    reservasi_id,
    penyewa_id,
    nomor_penyewaan,
    jadwal_mulai,
    jadwal_kembali,
    tolerance_deadline,
    status,
    total_amount,
    currency_code,
    catatan
  )
  VALUES (
    v_rental_id,
    p_usaha_id,
    p_reservasi_id,
    v_reservation.penyewa_id,
    v_rental_number,
    p_jadwal_mulai,
    p_jadwal_kembali,
    v_tolerance_deadline,
    'draft',
    v_total_amount,
    v_currency,
    v_reservation.catatan
  );

  FOR v_detail IN
    SELECT d.*
    FROM public.detail_reservasi d
    WHERE d.usaha_id = p_usaha_id
      AND d.reservasi_id = p_reservasi_id
    ORDER BY d.created_at, d.detail_reservasi_id
  LOOP
    v_detail_penyewaan_id := gen_random_uuid();

    INSERT INTO public.detail_penyewaan (
      detail_penyewaan_id,
      usaha_id,
      penyewaan_id,
      barang_id,
      varian_barang_id,
      paket_sewa_id,
      jumlah,
      unit_price,
      currency_code,
      subtotal,
      catatan
    )
    VALUES (
      v_detail_penyewaan_id,
      p_usaha_id,
      v_rental_id,
      v_detail.barang_id,
      v_detail.varian_barang_id,
      v_detail.paket_sewa_id,
      v_detail.jumlah,
      v_detail.unit_price,
      v_detail.currency_code,
      v_detail.subtotal,
      v_detail.catatan
    );

    IF v_detail.paket_sewa_id IS NOT NULL THEN
      FOR v_component IN
        SELECT cp.*
        FROM public.komponen_paket cp
        WHERE cp.usaha_id = p_usaha_id
          AND cp.paket_sewa_id = v_detail.paket_sewa_id
        ORDER BY cp.created_at, cp.komponen_paket_id
      LOOP
        INSERT INTO public.komponen_penyewaan (
          komponen_penyewaan_id,
          usaha_id,
          detail_penyewaan_id,
          barang_id,
          varian_barang_id,
          unit_barang_id,
          jumlah,
          catatan,
          paket_sewa_id,
          komponen_paket_id
        )
        VALUES (
          gen_random_uuid(),
          p_usaha_id,
          v_detail_penyewaan_id,
          v_component.barang_id,
          v_component.varian_barang_id,
          NULL,
          v_detail.jumlah * v_component.jumlah,
          v_component.catatan,
          v_detail.paket_sewa_id,
          v_component.komponen_paket_id
        );
      END LOOP;
    END IF;
  END LOOP;

  INSERT INTO public.audit_log (
    usaha_id,
    actor_auth_user_id,
    actor_akun_admin_id,
    action,
    entity_type,
    entity_id,
    source_application,
    request_id,
    change_summary
  )
  VALUES (
    p_usaha_id,
    v_auth_user_id,
    v_admin_id,
    'create',
    'penyewaan',
    v_rental_id,
    'admin-command',
    p_request_id,
    jsonb_build_object(
      'nomor_penyewaan', v_rental_number,
      'reservasi_id', p_reservasi_id,
      'status', 'draft',
      'jadwal_mulai', p_jadwal_mulai,
      'jadwal_kembali', p_jadwal_kembali,
      'tolerance_deadline', v_tolerance_deadline,
      'total_amount', v_total_amount,
      'currency_code', v_currency
    )
  );

  INSERT INTO public.outbox_event (
    usaha_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload
  )
  VALUES (
    p_usaha_id,
    'rental.created',
    'penyewaan',
    v_rental_id,
    jsonb_build_object(
      'rental_id', v_rental_id,
      'rental_number', v_rental_number,
      'reservation_id', p_reservasi_id
    )
  );

  v_response := jsonb_build_object(
    'penyewaan_id', v_rental_id,
    'reservasi_id', p_reservasi_id,
    'nomor_penyewaan', v_rental_number,
    'status', 'draft',
    'jadwal_mulai', p_jadwal_mulai,
    'jadwal_kembali', p_jadwal_kembali,
    'tolerance_deadline', v_tolerance_deadline,
    'total_amount', v_total_amount,
    'currency_code', v_currency
  );

  UPDATE public.idempotency_key
  SET response_status = 200,
      response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_assign_rental_unit(
  p_usaha_id uuid,
  p_penyewaan_id uuid,
  p_detail_penyewaan_id uuid,
  p_unit_barang_id uuid,
  p_komponen_penyewaan_id uuid,
  p_asal_pilihan_unit_id uuid,
  p_alasan_substitusi text,
  p_catatan text,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_rental public.penyewaan%ROWTYPE;
  v_detail public.detail_penyewaan%ROWTYPE;
  v_unit public.unit_barang%ROWTYPE;
  v_existing public.penetapan_unit%ROWTYPE;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_assignment_id uuid := gen_random_uuid();
  v_response jsonb;
  v_is_package boolean;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL OR p_penyewaan_id IS NULL OR p_detail_penyewaan_id IS NULL OR p_unit_barang_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id, penyewaan_id, detail_penyewaan_id, dan unit_barang_id wajib diisi' USING ERRCODE = '22023';
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

  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'penyewaan_id', p_penyewaan_id,
    'detail_penyewaan_id', p_detail_penyewaan_id,
    'unit_barang_id', p_unit_barang_id,
    'komponen_penyewaan_id', p_komponen_penyewaan_id,
    'asal_pilihan_unit_id', p_asal_pilihan_unit_id,
    'alasan_substitusi', nullif(btrim(coalesce(p_alasan_substitusi, '')), ''),
    'catatan', nullif(btrim(coalesce(p_catatan, '')), '')
  )::text);

  INSERT INTO public.idempotency_key (
    usaha_id,
    actor_auth_user_id,
    key,
    command_name,
    request_hash
  )
  VALUES (
    p_usaha_id,
    v_auth_user_id,
    btrim(p_idempotency_key),
    'assign_rental_unit',
    v_request_hash
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
      AND ik.command_name = 'assign_rental_unit'
      AND ik.key = btrim(p_idempotency_key);

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE = '23505';
    END IF;

    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;

    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE = '40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text || ':unit:' || p_unit_barang_id::text, 0));

  SELECT *
  INTO v_rental
  FROM public.penyewaan
  WHERE usaha_id = p_usaha_id
    AND penyewaan_id = p_penyewaan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: penyewaan tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  IF v_rental.status NOT IN ('draft', 'ready_for_pickup') THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: unit hanya dapat ditetapkan saat rental masih dalam tahap persiapan; status sekarang %', v_rental.status USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO v_detail
  FROM public.detail_penyewaan
  WHERE usaha_id = p_usaha_id
    AND detail_penyewaan_id = p_detail_penyewaan_id
    AND penyewaan_id = p_penyewaan_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: detail penyewaan tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  v_is_package := v_detail.paket_sewa_id IS NOT NULL;

  IF v_is_package AND p_komponen_penyewaan_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: package rental assignment wajib memilih komponen penyewaan' USING ERRCODE = '22023';
  END IF;

  IF NOT v_is_package AND p_komponen_penyewaan_id IS NOT NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: detail non-package tidak boleh memiliki komponen penyewaan' USING ERRCODE = '22023';
  END IF;

  IF p_komponen_penyewaan_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.komponen_penyewaan kp
    WHERE kp.usaha_id = p_usaha_id
      AND kp.komponen_penyewaan_id = p_komponen_penyewaan_id
      AND kp.detail_penyewaan_id = p_detail_penyewaan_id
      AND kp.paket_sewa_id = v_detail.paket_sewa_id
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: komponen penyewaan tidak ditemukan pada detail rental' USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_unit
  FROM public.unit_barang
  WHERE usaha_id = p_usaha_id
    AND unit_barang_id = p_unit_barang_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: unit tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.penetapan_unit
  WHERE usaha_id = p_usaha_id
    AND detail_penyewaan_id = p_detail_penyewaan_id
    AND unit_barang_id = p_unit_barang_id
    AND status = 'assigned'
  FOR UPDATE;

  IF FOUND THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: unit tersebut sudah ditetapkan ke detail rental ini' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.penetapan_unit (
    penetapan_unit_id,
    usaha_id,
    detail_penyewaan_id,
    unit_barang_id,
    asal_pilihan_unit_id,
    status,
    ditetapkan_at,
    alasan_substitusi,
    ditetapkan_by_admin_id,
    catatan,
    komponen_penyewaan_id
  )
  VALUES (
    v_assignment_id,
    p_usaha_id,
    p_detail_penyewaan_id,
    p_unit_barang_id,
    p_asal_pilihan_unit_id,
    'assigned',
    now(),
    nullif(btrim(coalesce(p_alasan_substitusi, '')), ''),
    v_admin_id,
    nullif(btrim(coalesce(p_catatan, '')), ''),
    p_komponen_penyewaan_id
  );

  UPDATE public.penyewaan
  SET status = CASE
    WHEN (
      SELECT count(*)
      FROM public.penetapan_unit pu
      JOIN public.detail_penyewaan dp
        ON dp.usaha_id = pu.usaha_id
       AND dp.detail_penyewaan_id = pu.detail_penyewaan_id
      WHERE pu.usaha_id = p_usaha_id
        AND dp.penyewaan_id = p_penyewaan_id
        AND pu.status = 'assigned'
    ) = (
      SELECT coalesce(sum(
        CASE
          WHEN dp.paket_sewa_id IS NOT NULL THEN (
            SELECT coalesce(sum(kp.jumlah),0) * dp.jumlah
            FROM public.komponen_penyewaan kp
            WHERE kp.usaha_id = dp.usaha_id
              AND kp.detail_penyewaan_id = dp.detail_penyewaan_id
          )
          ELSE dp.jumlah
        END
      ),0)
      FROM public.detail_penyewaan dp
      WHERE dp.usaha_id = p_usaha_id
        AND dp.penyewaan_id = p_penyewaan_id
    )
    AND v_rental.status = 'draft'
    THEN 'ready_for_pickup'
    ELSE v_rental.status
  END
  WHERE usaha_id = p_usaha_id
    AND penyewaan_id = p_penyewaan_id;

  INSERT INTO public.audit_log (
    usaha_id,
    actor_auth_user_id,
    actor_akun_admin_id,
    action,
    entity_type,
    entity_id,
    source_application,
    request_id,
    change_summary
  )
  VALUES (
    p_usaha_id,
    v_auth_user_id,
    v_admin_id,
    'assign_unit',
    'penetapan_unit',
    v_assignment_id,
    'admin-command',
    p_request_id,
    jsonb_build_object(
      'penyewaan_id', p_penyewaan_id,
      'detail_penyewaan_id', p_detail_penyewaan_id,
      'unit_barang_id', p_unit_barang_id,
      'komponen_penyewaan_id', p_komponen_penyewaan_id,
      'status', 'assigned'
    )
  );

  INSERT INTO public.outbox_event (
    usaha_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload
  )
  VALUES (
    p_usaha_id,
    'rental.unit_assigned',
    'penyewaan',
    p_penyewaan_id,
    jsonb_build_object(
      'rental_id', p_penyewaan_id,
      'assignment_id', v_assignment_id,
      'unit_barang_id', p_unit_barang_id,
      'detail_penyewaan_id', p_detail_penyewaan_id
    )
  );

  v_response := jsonb_build_object(
    'penetapan_unit_id', v_assignment_id,
    'penyewaan_id', p_penyewaan_id,
    'detail_penyewaan_id', p_detail_penyewaan_id,
    'unit_barang_id', p_unit_barang_id,
    'status', 'assigned'
  );

  UPDATE public.idempotency_key
  SET response_status = 200,
      response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_complete_rental_handover(
  p_usaha_id uuid,
  p_penyewaan_id uuid,
  p_serah_terima_at timestamptz,
  p_catatan text,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_rental public.penyewaan%ROWTYPE;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_handover_id uuid := gen_random_uuid();
  v_handover_at timestamptz := coalesce(p_serah_terima_at, now());
  v_required_qty numeric := 0;
  v_assigned_qty numeric := 0;
  v_unit record;
  v_response jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL OR p_penyewaan_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id dan penyewaan_id wajib diisi' USING ERRCODE = '22023';
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

  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'penyewaan_id', p_penyewaan_id,
    'serah_terima_at', v_handover_at,
    'catatan', nullif(btrim(coalesce(p_catatan, '')), '')
  )::text);

  INSERT INTO public.idempotency_key (
    usaha_id,
    actor_auth_user_id,
    key,
    command_name,
    request_hash
  )
  VALUES (
    p_usaha_id,
    v_auth_user_id,
    btrim(p_idempotency_key),
    'complete_rental_handover',
    v_request_hash
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
      AND ik.command_name = 'complete_rental_handover'
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
  INTO v_rental
  FROM public.penyewaan
  WHERE usaha_id = p_usaha_id
    AND penyewaan_id = p_penyewaan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: penyewaan tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  IF v_rental.status = 'active' AND v_rental.actual_pickup_at IS NOT NULL THEN
    SELECT jsonb_build_object(
      'serah_terima_id', st.serah_terima_id,
      'penyewaan_id', st.penyewaan_id,
      'status', st.status,
      'serah_terima_at', st.serah_terima_at
    )
    INTO v_response
    FROM public.serah_terima st
    WHERE st.usaha_id = p_usaha_id
      AND st.penyewaan_id = p_penyewaan_id
    ORDER BY st.serah_terima_at DESC
    LIMIT 1;

    IF v_response IS NULL THEN
      RAISE EXCEPTION 'UNKNOWN_OUTCOME: rental active tetapi handover record tidak ditemukan' USING ERRCODE = '40001';
    END IF;

    UPDATE public.idempotency_key
    SET response_status = 200,
        response_body = v_response
    WHERE idempotency_key_id = v_idempotency_id;
    RETURN v_response;
  END IF;

  IF v_rental.status NOT IN ('draft', 'ready_for_pickup') THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: rental belum berada pada state yang dapat dipickup; status sekarang %', v_rental.status USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(sum(
    CASE
      WHEN dp.paket_sewa_id IS NOT NULL THEN (
        SELECT coalesce(sum(kp.jumlah),0)
        FROM public.komponen_penyewaan kp
        WHERE kp.usaha_id = dp.usaha_id
          AND kp.detail_penyewaan_id = dp.detail_penyewaan_id
      ) * dp.jumlah
      ELSE dp.jumlah
    END
  ),0)
  INTO v_required_qty
  FROM public.detail_penyewaan dp
  WHERE dp.usaha_id = p_usaha_id
    AND dp.penyewaan_id = p_penyewaan_id;

  SELECT count(*)::numeric
  INTO v_assigned_qty
  FROM public.penetapan_unit pu
  JOIN public.detail_penyewaan dp
    ON dp.usaha_id = pu.usaha_id
   AND dp.detail_penyewaan_id = pu.detail_penyewaan_id
  WHERE pu.usaha_id = p_usaha_id
    AND dp.penyewaan_id = p_penyewaan_id
    AND pu.status = 'assigned';

  IF v_required_qty = 0 OR v_assigned_qty <> v_required_qty THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: semua unit wajib ditetapkan sebelum serah-terima; required=%, assigned=%', v_required_qty, v_assigned_qty USING ERRCODE = '23514';
  END IF;

  FOR v_unit IN
    SELECT DISTINCT pu.unit_barang_id
    FROM public.penetapan_unit pu
    JOIN public.detail_penyewaan dp
      ON dp.usaha_id = pu.usaha_id
     AND dp.detail_penyewaan_id = pu.detail_penyewaan_id
    WHERE pu.usaha_id = p_usaha_id
      AND dp.penyewaan_id = p_penyewaan_id
      AND pu.status = 'assigned'
    ORDER BY pu.unit_barang_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_usaha_id::text || ':unit:' || v_unit.unit_barang_id::text, 0)
    );

    UPDATE public.unit_barang ub
    SET status = 'rented'
    WHERE ub.usaha_id = p_usaha_id
      AND ub.unit_barang_id = v_unit.unit_barang_id
      AND ub.status = 'ready';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: unit % tidak lagi READY untuk pickup', v_unit.unit_barang_id USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.riwayat_unit (
      usaha_id,
      unit_barang_id,
      jenis_kejadian,
      terjadi_at,
      status_sebelum,
      status_sesudah,
      sumber_type,
      sumber_id,
      actor_akun_admin_id,
      catatan,
      metadata
    )
    VALUES (
      p_usaha_id,
      v_unit.unit_barang_id,
      'rental_pickup',
      v_handover_at,
      'ready',
      'rented',
      'penyewaan',
      p_penyewaan_id,
      v_admin_id,
      nullif(btrim(coalesce(p_catatan, '')), ''),
      jsonb_build_object('rental_id', p_penyewaan_id)
    );
  END LOOP;

  INSERT INTO public.serah_terima (
    serah_terima_id,
    usaha_id,
    penyewaan_id,
    serah_terima_at,
    actor_admin_id,
    status,
    catatan
  )
  VALUES (
    v_handover_id,
    p_usaha_id,
    p_penyewaan_id,
    v_handover_at,
    v_admin_id,
    'completed',
    nullif(btrim(coalesce(p_catatan, '')), '')
  );

  UPDATE public.penyewaan
  SET status = 'active',
      actual_pickup_at = v_handover_at
  WHERE usaha_id = p_usaha_id
    AND penyewaan_id = p_penyewaan_id;

  INSERT INTO public.audit_log (
    usaha_id,
    actor_auth_user_id,
    actor_akun_admin_id,
    action,
    entity_type,
    entity_id,
    source_application,
    request_id,
    change_summary
  )
  VALUES (
    p_usaha_id,
    v_auth_user_id,
    v_admin_id,
    'pickup',
    'penyewaan',
    p_penyewaan_id,
    'admin-command',
    p_request_id,
    jsonb_build_object(
      'status_before', v_rental.status,
      'status_after', 'active',
      'actual_pickup_at', v_handover_at,
      'handover_id', v_handover_id,
      'assigned_quantity', v_assigned_qty
    )
  );

  INSERT INTO public.outbox_event (
    usaha_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload
  )
  VALUES (
    p_usaha_id,
    'rental.picked_up',
    'penyewaan',
    p_penyewaan_id,
    jsonb_build_object(
      'rental_id', p_penyewaan_id,
      'handover_id', v_handover_id,
      'actual_pickup_at', v_handover_at
    )
  );

  v_response := jsonb_build_object(
    'serah_terima_id', v_handover_id,
    'penyewaan_id', p_penyewaan_id,
    'status', 'active',
    'actual_pickup_at', v_handover_at
  );

  UPDATE public.idempotency_key
  SET response_status = 200,
      response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_reconcile_rental_creation(
  p_usaha_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_row public.idempotency_key%ROWTYPE;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id dan idempotency_key wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id = aa.akun_admin_id
     AND ku.status = 'active'
     AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id = v_auth_user_id
      AND aa.status = 'active'
      AND aa.role = 'super_admin'
      AND ku.usaha_id = p_usaha_id
  ) THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_row
  FROM public.idempotency_key ik
  WHERE ik.usaha_id = p_usaha_id
    AND ik.actor_auth_user_id = v_auth_user_id
    AND ik.command_name = 'create_rental_from_reservation'
    AND ik.key = btrim(p_idempotency_key);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found', 'response', null);
  END IF;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_row.response_body IS NULL THEN 'unknown' ELSE 'committed' END,
    'response', v_row.response_body
  );
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_reconcile_rental_assignment(
  p_usaha_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_row public.idempotency_key%ROWTYPE;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id dan idempotency_key wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id = aa.akun_admin_id
     AND ku.status = 'active'
     AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id = v_auth_user_id
      AND aa.status = 'active'
      AND aa.role = 'super_admin'
      AND ku.usaha_id = p_usaha_id
  ) THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_row
  FROM public.idempotency_key ik
  WHERE ik.usaha_id = p_usaha_id
    AND ik.actor_auth_user_id = v_auth_user_id
    AND ik.command_name = 'assign_rental_unit'
    AND ik.key = btrim(p_idempotency_key);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found', 'response', null);
  END IF;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_row.response_body IS NULL THEN 'unknown' ELSE 'committed' END,
    'response', v_row.response_body
  );
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_reconcile_rental_handover(
  p_usaha_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_row public.idempotency_key%ROWTYPE;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id dan idempotency_key wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id = aa.akun_admin_id
     AND ku.status = 'active'
     AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id = v_auth_user_id
      AND aa.status = 'active'
      AND aa.role = 'super_admin'
      AND ku.usaha_id = p_usaha_id
  ) THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_row
  FROM public.idempotency_key ik
  WHERE ik.usaha_id = p_usaha_id
    AND ik.actor_auth_user_id = v_auth_user_id
    AND ik.command_name = 'complete_rental_handover'
    AND ik.key = btrim(p_idempotency_key);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found', 'response', null);
  END IF;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_row.response_body IS NULL THEN 'unknown' ELSE 'committed' END,
    'response', v_row.response_body
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_create_rental_from_reservation(uuid,uuid,timestamptz,timestamptz,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_create_rental_from_reservation(uuid,uuid,timestamptz,timestamptz,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_create_rental_from_reservation(uuid,uuid,timestamptz,timestamptz,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_create_rental_from_reservation(uuid,uuid,timestamptz,timestamptz,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_assign_rental_unit(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_assign_rental_unit(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_assign_rental_unit(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_assign_rental_unit(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_complete_rental_handover(uuid,uuid,timestamptz,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_complete_rental_handover(uuid,uuid,timestamptz,text,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_complete_rental_handover(uuid,uuid,timestamptz,text,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_complete_rental_handover(uuid,uuid,timestamptz,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_reconcile_rental_creation(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_reconcile_rental_creation(uuid,text) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_reconcile_rental_creation(uuid,text) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_reconcile_rental_creation(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_reconcile_rental_assignment(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_reconcile_rental_assignment(uuid,text) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_reconcile_rental_assignment(uuid,text) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_reconcile_rental_assignment(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_reconcile_rental_handover(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_reconcile_rental_handover(uuid,text) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_reconcile_rental_handover(uuid,text) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_reconcile_rental_handover(uuid,text) TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.penyewaan FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.detail_penyewaan FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.komponen_penyewaan FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.penetapan_unit FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.serah_terima FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.riwayat_unit FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.unit_barang FROM authenticated;
