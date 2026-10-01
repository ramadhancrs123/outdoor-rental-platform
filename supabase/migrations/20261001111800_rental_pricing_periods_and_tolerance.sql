-- Rental pricing contract:
-- unit_price is the tariff nominal per tariff period.
-- subtotal is quantity * tariff nominal * computed periods.
-- The server recomputes tariff periods from rental schedule and tariff definition.
CREATE OR REPLACE FUNCTION app_private.command_create_direct_rental(
  p_usaha_id uuid,
  p_penyewa_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz,
  p_lines jsonb,
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
  v_timezone text;
  v_default_tolerance_hours numeric;
  v_renter public.penyewa%ROWTYPE;
  v_rental_id uuid := gen_random_uuid();
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_tolerance_deadline timestamptz;
  v_currency text;
  v_total numeric(14,2) := 0;
  v_number bigint;
  v_rental_number text;
  v_line jsonb;
  v_detail_id uuid;
  v_response jsonb;
  v_target_count integer := 0;
  v_available numeric;
  v_reserved numeric;
  v_required numeric;
  v_barang_id uuid;
  v_varian_id uuid;
  v_paket_id uuid;
  v_qty numeric;
  v_unit_price numeric(14,2);
  v_subtotal numeric(14,2);
  v_line_currency text;
  v_tariff_id uuid;
  v_tariff_duration_unit text;
  v_tariff_duration_value numeric;
  v_tariff_period_seconds numeric;
  v_duration_periods integer;
  v_client_duration_periods integer;
  v_tariff_nominal numeric(14,2);
  v_expected_subtotal numeric(14,2);
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL OR p_penyewa_id IS NULL OR p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: renter dan minimal satu detail rental wajib diisi' USING ERRCODE = '22023';
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

  SELECT u.timezone, coalesce(u.default_tolerance_hours, 10)
  INTO v_timezone, v_default_tolerance_hours
  FROM public.usaha u
  WHERE u.usaha_id = p_usaha_id
    AND u.status = 'active';

  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_renter
  FROM public.penyewa
  WHERE usaha_id = p_usaha_id
    AND penyewa_id = p_penyewa_id
    AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: penyewa aktif tidak ditemukan dalam usaha ini' USING ERRCODE = 'P0002';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'penyewa_id', p_penyewa_id,
    'jadwal_mulai', p_jadwal_mulai,
    'jadwal_kembali', p_jadwal_kembali,
    'lines', p_lines,
    'catatan', nullif(btrim(coalesce(p_catatan, '')), '')
  )::text);

  INSERT INTO public.idempotency_key (
    usaha_id, actor_auth_user_id, key, command_name, request_hash
  )
  VALUES (
    p_usaha_id, v_auth_user_id, btrim(p_idempotency_key), 'create_direct_rental', v_request_hash
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
      AND ik.command_name = 'create_direct_rental'
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

  v_currency := null;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_target_count := v_target_count + 1;
    v_barang_id := nullif(v_line->>'barang_id', '')::uuid;
    v_varian_id := nullif(v_line->>'varian_barang_id', '')::uuid;
    v_paket_id := nullif(v_line->>'paket_sewa_id', '')::uuid;
    v_qty := coalesce((v_line->>'jumlah')::numeric, 0);
    v_unit_price := coalesce((v_line->>'unit_price')::numeric, -1);
    v_subtotal := coalesce((v_line->>'subtotal')::numeric, -1);
    v_line_currency := coalesce(v_line->>'currency_code', 'IDR');
    v_tariff_id := nullif(v_line->>'tarif_sewa_id', '')::uuid;
    v_client_duration_periods := nullif(v_line->>'duration_periods', '')::integer;

    IF num_nonnulls(v_barang_id, v_varian_id, v_paket_id) <> 1 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: setiap detail rental harus memiliki tepat satu target katalog' USING ERRCODE = '22023';
    END IF;

    IF v_qty <= 0 OR v_unit_price < 0 OR v_subtotal < 0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: quantity, unit_price, dan subtotal tidak valid' USING ERRCODE = '22023';
    END IF;

    IF v_tariff_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: tarif sewa wajib dipilih' USING ERRCODE = '22023';
    END IF;

    SELECT
      t.durasi_unit,
      t.durasi_nilai,
      t.nominal
    INTO
      v_tariff_duration_unit,
      v_tariff_duration_value,
      v_tariff_nominal
    FROM public.tarif_sewa t
    WHERE t.tarif_sewa_id = v_tariff_id
      AND t.usaha_id = p_usaha_id
      AND t.status = 'active'
      AND t.berlaku_mulai <= p_jadwal_mulai
      AND (t.berlaku_sampai IS NULL OR t.berlaku_sampai > p_jadwal_mulai)
      AND (
        (v_paket_id IS NOT NULL AND t.paket_sewa_id = v_paket_id)
        OR (
          v_paket_id IS NULL
          AND v_barang_id IS NOT NULL
          AND (
            (v_varian_id IS NOT NULL AND (
              t.varian_barang_id = v_varian_id
              OR (t.varian_barang_id IS NULL AND t.barang_id = v_barang_id)
            ))
            OR (v_varian_id IS NULL AND t.barang_id = v_barang_id AND t.varian_barang_id IS NULL)
          )
        )
      )
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_FOUND: tarif sewa aktif tidak ditemukan untuk target katalog dan periode rental' USING ERRCODE = 'P0002';
    END IF;

    v_tariff_period_seconds := CASE lower(btrim(v_tariff_duration_unit))
      WHEN 'jam' THEN v_tariff_duration_value * 3600
      WHEN 'hari' THEN v_tariff_duration_value * 86400
      WHEN 'minggu' THEN v_tariff_duration_value * 604800
      ELSE NULL
    END;

    IF v_tariff_period_seconds IS NULL
       OR v_tariff_duration_value IS NULL
       OR v_tariff_duration_value <= 0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: satuan durasi tarif tidak didukung' USING ERRCODE = '22023';
    END IF;

    v_duration_periods := GREATEST(
      1,
      CEIL(
        EXTRACT(EPOCH FROM (p_jadwal_kembali - p_jadwal_mulai))
        / v_tariff_period_seconds
      )::integer
    );

    IF v_client_duration_periods IS NOT NULL AND v_client_duration_periods <> v_duration_periods THEN
      RAISE EXCEPTION
        'BUSINESS_CONFLICT: periode tarif berubah; expected=%, received=%',
        v_duration_periods, v_client_duration_periods
        USING ERRCODE = '23514';
    END IF;

    IF v_unit_price IS DISTINCT FROM round(v_tariff_nominal, 2) THEN
      RAISE EXCEPTION
        'BUSINESS_CONFLICT: harga tarif berubah; expected=%, received=%',
        round(v_tariff_nominal, 2), v_unit_price
        USING ERRCODE = '23514';
    END IF;

    v_expected_subtotal := round(v_qty * v_tariff_nominal * v_duration_periods, 2);

    IF v_subtotal IS DISTINCT FROM v_expected_subtotal THEN
      RAISE EXCEPTION
        'VALIDATION_ERROR: subtotal tidak sesuai durasi tarif; expected=%, received=%',
        v_expected_subtotal, v_subtotal
        USING ERRCODE = '22023';
    END IF;

    v_unit_price := round(v_tariff_nominal, 2);
    v_subtotal := v_expected_subtotal;

    IF v_line_currency <> 'IDR' THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: currency fase awal adalah IDR' USING ERRCODE = '22023';
    END IF;

    IF v_currency IS NULL THEN
      v_currency := v_line_currency;
    ELSIF v_currency <> v_line_currency THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: semua detail rental harus menggunakan currency yang sama' USING ERRCODE = '22023';
    END IF;

    IF v_barang_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.barang b
      WHERE b.usaha_id = p_usaha_id AND b.barang_id = v_barang_id AND b.status = 'active'
    ) THEN
      RAISE EXCEPTION 'NOT_FOUND: barang tidak ditemukan atau tidak aktif dalam usaha ini' USING ERRCODE = 'P0002';
    END IF;

    IF v_varian_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.varian_barang vb
      WHERE vb.usaha_id = p_usaha_id AND vb.varian_barang_id = v_varian_id AND vb.status = 'active'
    ) THEN
      RAISE EXCEPTION 'NOT_FOUND: varian tidak ditemukan atau tidak aktif dalam usaha ini' USING ERRCODE = 'P0002';
    END IF;

    IF v_paket_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.paket_sewa ps
      WHERE ps.usaha_id = p_usaha_id AND ps.paket_sewa_id = v_paket_id AND ps.status = 'active'
    ) THEN
      RAISE EXCEPTION 'NOT_FOUND: paket tidak ditemukan atau tidak aktif dalam usaha ini' USING ERRCODE = 'P0002';
    END IF;

    IF v_varian_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.varian_barang vb
      WHERE vb.usaha_id = p_usaha_id AND vb.varian_barang_id = v_varian_id
        AND vb.status = 'active'
        AND (v_barang_id IS NULL OR vb.barang_id = v_barang_id)
    ) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: varian tidak termasuk barang yang dipilih' USING ERRCODE = '23514';
    END IF;

    IF v_currency IS NULL THEN
      v_currency := 'IDR';
    END IF;

    IF v_barang_id IS NOT NULL OR v_varian_id IS NOT NULL THEN
      SELECT count(*)
      INTO v_available
      FROM public.unit_barang ub
      WHERE ub.usaha_id = p_usaha_id
        AND ub.status = 'ready'
        AND (
          (v_varian_id IS NOT NULL AND ub.varian_barang_id = v_varian_id)
          OR (v_varian_id IS NULL AND ub.barang_id = v_barang_id)
        );

      v_reserved := app_private.reservation_locked_component_requirement(
        p_usaha_id,
        (p_jadwal_mulai AT TIME ZONE v_timezone)::date,
        (p_jadwal_kembali AT TIME ZONE v_timezone)::date,
        v_barang_id,
        v_varian_id,
        null
      );

      v_required := v_qty;
      IF v_available - v_reserved < v_required THEN
        RAISE EXCEPTION
          'BUSINESS_CONFLICT: kapasitas fisik tidak cukup untuk target rental; requested=%, available=%',
          v_required, greatest(v_available - v_reserved, 0)
          USING ERRCODE = '23514';
      END IF;
    ELSE
      IF NOT EXISTS (
        SELECT 1
        FROM public.komponen_paket cp
        WHERE cp.usaha_id = p_usaha_id
          AND cp.paket_sewa_id = v_paket_id
      ) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: paket belum memiliki komponen' USING ERRCODE = '22023';
      END IF;

      FOR v_barang_id, v_varian_id, v_required IN
        SELECT cp.barang_id, cp.varian_barang_id, v_qty * cp.jumlah
        FROM public.komponen_paket cp
        WHERE cp.usaha_id = p_usaha_id
          AND cp.paket_sewa_id = v_paket_id
      LOOP
        SELECT count(*)
        INTO v_available
        FROM public.unit_barang ub
        WHERE ub.usaha_id = p_usaha_id
          AND ub.status = 'ready'
          AND (
            (v_varian_id IS NOT NULL AND ub.varian_barang_id = v_varian_id)
            OR (v_varian_id IS NULL AND ub.barang_id = v_barang_id)
          );

        v_reserved := app_private.reservation_locked_component_requirement(
          p_usaha_id,
          (p_jadwal_mulai AT TIME ZONE v_timezone)::date,
          (p_jadwal_kembali AT TIME ZONE v_timezone)::date,
          v_barang_id,
          v_varian_id,
          null
        );

        IF v_available - v_reserved < v_required THEN
          RAISE EXCEPTION
            'BUSINESS_CONFLICT: kapasitas fisik paket tidak cukup; requested=%, available=%',
            v_required, greatest(v_available - v_reserved, 0)
            USING ERRCODE = '23514';
        END IF;
      END LOOP;
    END IF;

    v_total := v_total + v_subtotal;
  END LOOP;

  v_number := app_private.next_business_number(
    p_usaha_id,
    'RNT',
    to_char(p_jadwal_mulai AT TIME ZONE v_timezone, 'YYYY')
  );
  v_rental_number := 'RNT-' || to_char(p_jadwal_mulai AT TIME ZONE v_timezone, 'YYYY') || '-' || lpad(v_number::text, 3, '0');
  v_tolerance_deadline := p_jadwal_kembali + make_interval(hours => v_default_tolerance_hours::double precision);

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
    NULL,
    p_penyewa_id,
    v_rental_number,
    p_jadwal_mulai,
    p_jadwal_kembali,
    v_tolerance_deadline,
    'draft',
    v_total,
    v_currency,
    nullif(btrim(coalesce(p_catatan, '')), '')
  );

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_detail_id := gen_random_uuid();
    v_barang_id := nullif(v_line->>'barang_id', '')::uuid;
    v_varian_id := nullif(v_line->>'varian_barang_id', '')::uuid;
    v_paket_id := nullif(v_line->>'paket_sewa_id', '')::uuid;
    v_qty := (v_line->>'jumlah')::numeric;
    v_unit_price := (v_line->>'unit_price')::numeric;
    v_subtotal := (v_line->>'subtotal')::numeric;
    v_line_currency := coalesce(v_line->>'currency_code', 'IDR');

    INSERT INTO public.detail_penyewaan (
      detail_penyewaan_id, usaha_id, penyewaan_id,
      barang_id, varian_barang_id, paket_sewa_id,
      jumlah, unit_price, currency_code, subtotal, catatan
    )
    VALUES (
      v_detail_id, p_usaha_id, v_rental_id,
      v_barang_id, v_varian_id, v_paket_id,
      v_qty, v_unit_price, v_line_currency, v_subtotal,
      nullif(btrim(coalesce(v_line->>'catatan', '')), '')
    );

    IF v_paket_id IS NOT NULL THEN
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
      SELECT
        gen_random_uuid(),
        p_usaha_id,
        v_detail_id,
        cp.barang_id,
        cp.varian_barang_id,
        NULL,
        v_qty * cp.jumlah,
        cp.catatan,
        v_paket_id,
        cp.komponen_paket_id
      FROM public.komponen_paket cp
      WHERE cp.usaha_id = p_usaha_id
        AND cp.paket_sewa_id = v_paket_id;
    END IF;
  END LOOP;

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, request_id, change_summary
  )
  VALUES (
    p_usaha_id, v_auth_user_id, v_admin_id, 'create_direct',
    'penyewaan', v_rental_id, 'admin-command', p_request_id,
    jsonb_build_object(
      'nomor_penyewaan', v_rental_number,
      'reservasi_id', null,
      'penyewa_id', p_penyewa_id,
      'status', 'draft',
      'detail_count', v_target_count,
      'total_amount', v_total,
      'currency_code', v_currency
    )
  );

  INSERT INTO public.outbox_event (
    usaha_id, event_type, aggregate_type, aggregate_id, payload
  )
  VALUES (
    p_usaha_id, 'rental.direct_created', 'penyewaan', v_rental_id,
    jsonb_build_object(
      'rental_id', v_rental_id,
      'rental_number', v_rental_number,
      'renter_id', p_penyewa_id
    )
  );

  v_response := jsonb_build_object(
    'penyewaan_id', v_rental_id,
    'reservasi_id', null,
    'penyewa_id', p_penyewa_id,
    'nomor_penyewaan', v_rental_number,
    'status', 'draft',
    'jadwal_mulai', p_jadwal_mulai,
    'jadwal_kembali', p_jadwal_kembali,
    'tolerance_deadline', v_tolerance_deadline,
    'total_amount', v_total,
    'currency_code', v_currency
  );

  UPDATE public.idempotency_key
  SET response_status = 200,
      response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_create_direct_rental(uuid,uuid,timestamptz,timestamptz,jsonb,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_create_direct_rental(uuid,uuid,timestamptz,timestamptz,jsonb,text,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_create_direct_rental(uuid,uuid,timestamptz,timestamptz,jsonb,text,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_create_direct_rental(uuid,uuid,timestamptz,timestamptz,jsonb,text,text,uuid) TO authenticated;
