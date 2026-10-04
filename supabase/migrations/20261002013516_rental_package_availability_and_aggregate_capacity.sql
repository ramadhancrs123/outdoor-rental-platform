-- Package rental composition and multi-line capacity hardening.

CREATE OR REPLACE FUNCTION app_private.validate_direct_rental_capacity(
  p_usaha_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz,
  p_lines jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_timezone text;
  v_shortfall record;
BEGIN
  SELECT u.timezone INTO v_timezone
  FROM public.usaha u
  WHERE u.usaha_id = p_usaha_id
    AND u.status = 'active';

  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  WITH input_lines AS (
    SELECT
      nullif(value->>'barang_id', '')::uuid AS barang_id,
      nullif(value->>'varian_barang_id', '')::uuid AS varian_id,
      nullif(value->>'paket_sewa_id', '')::uuid AS paket_id,
      COALESCE((value->>'jumlah')::numeric, 0) AS jumlah
    FROM jsonb_array_elements(p_lines) AS value
  ),
  expanded AS (
    SELECT
      CASE WHEN il.varian_id IS NOT NULL THEN vb.barang_id ELSE il.barang_id END AS barang_id,
      il.varian_id,
      il.jumlah AS required_quantity
    FROM input_lines il
    LEFT JOIN public.varian_barang vb
      ON vb.usaha_id = p_usaha_id
     AND vb.varian_barang_id = il.varian_id
    WHERE il.paket_id IS NULL

    UNION ALL

    SELECT
      CASE WHEN cp.varian_barang_id IS NOT NULL THEN cpvb.barang_id ELSE cp.barang_id END AS barang_id,
      cp.varian_barang_id,
      il.jumlah * cp.jumlah AS required_quantity
    FROM input_lines il
    JOIN public.komponen_paket cp
      ON cp.usaha_id = p_usaha_id
     AND cp.paket_sewa_id = il.paket_id
    LEFT JOIN public.varian_barang cpvb
      ON cpvb.usaha_id = p_usaha_id
     AND cpvb.varian_barang_id = cp.varian_barang_id
    WHERE il.paket_id IS NOT NULL
  ),
  canonical AS (
    SELECT e.barang_id, e.varian_id, SUM(e.required_quantity) AS required_quantity
    FROM expanded e
    WHERE e.required_quantity > 0 AND e.barang_id IS NOT NULL
    GROUP BY e.barang_id, e.varian_id
  ),
  product_demand AS (
    SELECT barang_id, SUM(required_quantity) AS required_quantity
    FROM canonical
    GROUP BY barang_id
  ),
  product_capacity AS (
    SELECT
      d.barang_id,
      d.required_quantity,
      COUNT(ub.unit_barang_id) FILTER (
        WHERE ub.status = 'ready'
          AND NOT EXISTS (
            SELECT 1
            FROM public.penetapan_unit pu
            JOIN public.detail_penyewaan dp
              ON dp.usaha_id = pu.usaha_id
             AND dp.detail_penyewaan_id = pu.detail_penyewaan_id
            JOIN public.penyewaan r
              ON r.usaha_id = dp.usaha_id
             AND r.penyewaan_id = dp.penyewaan_id
            WHERE pu.usaha_id = ub.usaha_id
              AND pu.unit_barang_id = ub.unit_barang_id
              AND pu.status = 'assigned'
              AND r.status IN ('draft', 'ready_for_pickup', 'active', 'return_in_progress')
              AND tstzrange(r.jadwal_mulai, r.jadwal_kembali, '[)')
                  && tstzrange(p_jadwal_mulai, p_jadwal_kembali, '[)')
          )
      )::numeric AS available_ready,
      app_private.reservation_locked_component_requirement(
        p_usaha_id,
        (p_jadwal_mulai AT TIME ZONE v_timezone)::date,
        (p_jadwal_kembali AT TIME ZONE v_timezone)::date,
        d.barang_id,
        NULL,
        NULL
      ) AS reserved_quantity
    FROM product_demand d
    LEFT JOIN public.unit_barang ub
      ON ub.usaha_id = p_usaha_id
     AND ub.barang_id = d.barang_id
    GROUP BY d.barang_id, d.required_quantity
  ),
  variant_capacity AS (
    SELECT
      c.barang_id,
      c.varian_id,
      c.required_quantity,
      COUNT(ub.unit_barang_id) FILTER (
        WHERE ub.status = 'ready'
          AND NOT EXISTS (
            SELECT 1
            FROM public.penetapan_unit pu
            JOIN public.detail_penyewaan dp
              ON dp.usaha_id = pu.usaha_id
             AND dp.detail_penyewaan_id = pu.detail_penyewaan_id
            JOIN public.penyewaan r
              ON r.usaha_id = dp.usaha_id
             AND r.penyewaan_id = dp.penyewaan_id
            WHERE pu.usaha_id = ub.usaha_id
              AND pu.unit_barang_id = ub.unit_barang_id
              AND pu.status = 'assigned'
              AND r.status IN ('draft', 'ready_for_pickup', 'active', 'return_in_progress')
              AND tstzrange(r.jadwal_mulai, r.jadwal_kembali, '[)')
                  && tstzrange(p_jadwal_mulai, p_jadwal_kembali, '[)')
          )
      )::numeric AS available_ready_variant,
      app_private.reservation_locked_component_requirement(
        p_usaha_id,
        (p_jadwal_mulai AT TIME ZONE v_timezone)::date,
        (p_jadwal_kembali AT TIME ZONE v_timezone)::date,
        c.barang_id,
        c.varian_id,
        NULL
      ) AS reserved_variant_quantity
    FROM canonical c
    LEFT JOIN public.unit_barang ub
      ON ub.usaha_id = p_usaha_id
     AND ub.varian_barang_id = c.varian_id
    WHERE c.varian_id IS NOT NULL
    GROUP BY c.barang_id, c.varian_id, c.required_quantity
  )
  SELECT pc.barang_id, pc.required_quantity,
         GREATEST(pc.available_ready - pc.reserved_quantity, 0) AS available_quantity,
         'product_capacity'::text AS shortage_scope
  INTO v_shortfall
  FROM product_capacity pc
  WHERE pc.available_ready - pc.reserved_quantity < pc.required_quantity
  LIMIT 1;

  IF v_shortfall IS NULL THEN
    SELECT vc.barang_id, vc.varian_id, vc.required_quantity,
           GREATEST(vc.available_ready_variant - vc.reserved_variant_quantity, 0) AS available_quantity,
           'variant_capacity'::text AS shortage_scope
    INTO v_shortfall
    FROM variant_capacity vc
    WHERE vc.available_ready_variant - vc.reserved_variant_quantity < vc.required_quantity
    LIMIT 1;
  END IF;

  IF v_shortfall IS NOT NULL THEN
    RAISE EXCEPTION
      'BUSINESS_CONFLICT: kapasitas fisik gabungan tidak cukup; scope=%, requested=%, available=%',
      v_shortfall.shortage_scope, v_shortfall.required_quantity, v_shortfall.available_quantity
      USING ERRCODE = '23514';
  END IF;
END;
$function$;

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

  PERFORM app_private.validate_direct_rental_capacity(
    p_usaha_id,
    p_jadwal_mulai,
    p_jadwal_kembali,
    p_lines
  );

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
  v_required_qty numeric := 0;
  v_assigned_qty numeric := 0;
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


  IF v_is_package THEN
    SELECT kp.jumlah
    INTO v_required_qty
    FROM public.komponen_penyewaan kp
    WHERE kp.usaha_id = p_usaha_id
      AND kp.komponen_penyewaan_id = p_komponen_penyewaan_id
      AND kp.detail_penyewaan_id = p_detail_penyewaan_id;

    SELECT count(*)::numeric
    INTO v_assigned_qty
    FROM public.penetapan_unit pu
    WHERE pu.usaha_id = p_usaha_id
      AND pu.komponen_penyewaan_id = p_komponen_penyewaan_id
      AND pu.status = 'assigned';
  ELSE
    v_required_qty := v_detail.jumlah;

    SELECT count(*)::numeric
    INTO v_assigned_qty
    FROM public.penetapan_unit pu
    WHERE pu.usaha_id = p_usaha_id
      AND pu.detail_penyewaan_id = p_detail_penyewaan_id
      AND pu.komponen_penyewaan_id IS NULL
      AND pu.status = 'assigned';
  END IF;

  IF v_required_qty <= 0 THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: jumlah unit yang harus ditetapkan tidak valid' USING ERRCODE = '23514';
  END IF;

  IF v_assigned_qty >= v_required_qty THEN
    RAISE EXCEPTION
      'BUSINESS_CONFLICT: jumlah unit untuk target ini sudah terpenuhi; required=%, assigned=%',
      v_required_qty,
      v_assigned_qty
      USING ERRCODE = '23514';
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
            SELECT coalesce(sum(kp.jumlah),0)
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
      )
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

REVOKE ALL ON FUNCTION app_private.validate_direct_rental_capacity(uuid,timestamptz,timestamptz,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.validate_direct_rental_capacity(uuid,timestamptz,timestamptz,jsonb) FROM anon;
REVOKE ALL ON FUNCTION app_private.validate_direct_rental_capacity(uuid,timestamptz,timestamptz,jsonb) FROM service_role;

REVOKE ALL ON FUNCTION app_private.command_create_direct_rental(uuid,uuid,timestamptz,timestamptz,jsonb,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_create_direct_rental(uuid,uuid,timestamptz,timestamptz,jsonb,text,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_create_direct_rental(uuid,uuid,timestamptz,timestamptz,jsonb,text,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_create_direct_rental(uuid,uuid,timestamptz,timestamptz,jsonb,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_assign_rental_unit(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_assign_rental_unit(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_assign_rental_unit(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_complete_rental_handover(uuid,uuid,timestamptz,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_complete_rental_handover(uuid,uuid,timestamptz,text,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_complete_rental_handover(uuid,uuid,timestamptz,text,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_complete_rental_handover(uuid,uuid,timestamptz,text,text,uuid) TO authenticated;
