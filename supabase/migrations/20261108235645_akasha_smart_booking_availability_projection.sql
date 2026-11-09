-- ============================================================================
-- AKASHA SMART BOOKING — customer-safe availability projection.
-- Read-only projection: no stock holds, reservations, unit assignments, or
-- inventory movements are created here. Future returns are always labelled
-- as potential; a unit becomes ready only after normal return/inspection flow.
-- ============================================================================

CREATE OR REPLACE FUNCTION app_private.akasha_smart_booking_component_availability(
  p_usaha_id uuid,
  p_barang_id uuid,
  p_varian_barang_id uuid,
  p_required_quantity numeric,
  p_pickup_target timestamptz,
  p_tolerance_hours numeric
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_product_id uuid;
  v_product_name text;
  v_variant_name text;
  v_total_units integer := 0;
  v_global_ready integer := 0;
  v_variant_ready integer := 0;
  v_global_returns integer := 0;
  v_variant_returns integer := 0;
  v_state text;
BEGIN
  IF p_usaha_id IS NULL
     OR num_nonnulls(p_barang_id, p_varian_barang_id) <> 1
     OR p_required_quantity IS NULL OR p_required_quantity <= 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: target ketersediaan tidak valid'
      USING ERRCODE = '22023';
  END IF;

  IF p_varian_barang_id IS NOT NULL THEN
    SELECT vb.barang_id, b.nama, vb.nama
      INTO v_product_id, v_product_name, v_variant_name
    FROM public.varian_barang vb
    JOIN public.barang b
      ON b.usaha_id = vb.usaha_id
     AND b.barang_id = vb.barang_id
    WHERE vb.usaha_id = p_usaha_id
      AND vb.varian_barang_id = p_varian_barang_id
      AND vb.status = 'active'
      AND b.status = 'active';
  ELSE
    SELECT b.barang_id, b.nama
      INTO v_product_id, v_product_name
    FROM public.barang b
    WHERE b.usaha_id = p_usaha_id
      AND b.barang_id = p_barang_id
      AND b.status = 'active';
  END IF;

  IF v_product_id IS NULL THEN
    RETURN jsonb_build_object(
      'product_name', 'Item tidak lagi tersedia',
      'requested_variant', v_variant_name,
      'requested_quantity', p_required_quantity,
      'status', 'catalog_unavailable'
    );
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE ub.status = 'ready'
        AND NOT EXISTS (
          SELECT 1
          FROM public.penetapan_unit pu
          JOIN public.detail_penyewaan dp
            ON dp.usaha_id = pu.usaha_id
           AND dp.detail_penyewaan_id = pu.detail_penyewaan_id
          JOIN public.penyewaan p
            ON p.usaha_id = dp.usaha_id
           AND p.penyewaan_id = dp.penyewaan_id
          WHERE pu.usaha_id = ub.usaha_id
            AND pu.unit_barang_id = ub.unit_barang_id
            AND pu.status = 'assigned'
            AND (
              p.status IN ('active', 'return_in_progress')
              OR (
                p.status IN ('draft', 'ready_for_pickup')
                AND tstzrange(p.jadwal_mulai, p.jadwal_kembali, '[)')
                    && tstzrange(now(), now() + interval '1 second', '[)')
              )
            )
        )
    )::integer,
    count(*) FILTER (
      WHERE ub.status = 'ready'
        AND (
          p_varian_barang_id IS NULL
          OR ub.varian_barang_id = p_varian_barang_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.penetapan_unit pu
          JOIN public.detail_penyewaan dp
            ON dp.usaha_id = pu.usaha_id
           AND dp.detail_penyewaan_id = pu.detail_penyewaan_id
          JOIN public.penyewaan p
            ON p.usaha_id = dp.usaha_id
           AND p.penyewaan_id = dp.penyewaan_id
          WHERE pu.usaha_id = ub.usaha_id
            AND pu.unit_barang_id = ub.unit_barang_id
            AND pu.status = 'assigned'
            AND (
              p.status IN ('active', 'return_in_progress')
              OR (
                p.status IN ('draft', 'ready_for_pickup')
                AND tstzrange(p.jadwal_mulai, p.jadwal_kembali, '[)')
                    && tstzrange(now(), now() + interval '1 second', '[)')
              )
            )
        )
    )::integer
  INTO v_total_units, v_global_ready, v_variant_ready
  FROM public.unit_barang ub
  WHERE ub.usaha_id = p_usaha_id
    AND ub.barang_id = v_product_id;

  SELECT count(DISTINCT ub.unit_barang_id)::integer
    INTO v_global_returns
  FROM public.unit_barang ub
  JOIN public.penetapan_unit pu
    ON pu.usaha_id = ub.usaha_id
   AND pu.unit_barang_id = ub.unit_barang_id
   AND pu.status = 'assigned'
  JOIN public.detail_penyewaan dp
    ON dp.usaha_id = pu.usaha_id
   AND dp.detail_penyewaan_id = pu.detail_penyewaan_id
  JOIN public.penyewaan p
    ON p.usaha_id = dp.usaha_id
   AND p.penyewaan_id = dp.penyewaan_id
  WHERE ub.usaha_id = p_usaha_id
    AND ub.barang_id = v_product_id
    AND ub.status = 'rented'
    AND p.status IN ('active', 'return_in_progress')
    AND p.actual_return_completed_at IS NULL
    AND coalesce(
      p.tolerance_deadline,
      p.jadwal_kembali + make_interval(hours => coalesce(p_tolerance_hours, 10)::double precision)
    ) <= p_pickup_target;

  SELECT count(DISTINCT ub.unit_barang_id)::integer
    INTO v_variant_returns
  FROM public.unit_barang ub
  JOIN public.penetapan_unit pu
    ON pu.usaha_id = ub.usaha_id
   AND pu.unit_barang_id = ub.unit_barang_id
   AND pu.status = 'assigned'
  JOIN public.detail_penyewaan dp
    ON dp.usaha_id = pu.usaha_id
   AND dp.detail_penyewaan_id = pu.detail_penyewaan_id
  JOIN public.penyewaan p
    ON p.usaha_id = dp.usaha_id
   AND p.penyewaan_id = dp.penyewaan_id
  WHERE ub.usaha_id = p_usaha_id
    AND ub.barang_id = v_product_id
    AND ub.status = 'rented'
    AND (p_varian_barang_id IS NULL OR ub.varian_barang_id = p_varian_barang_id)
    AND p.status IN ('active', 'return_in_progress')
    AND p.actual_return_completed_at IS NULL
    AND coalesce(
      p.tolerance_deadline,
      p.jadwal_kembali + make_interval(hours => coalesce(p_tolerance_hours, 10)::double precision)
    ) <= p_pickup_target;

  v_state := CASE
    WHEN v_variant_ready >= p_required_quantity THEN 'ready_now'
    WHEN v_variant_ready + v_variant_returns >= p_required_quantity THEN 'potential_return_may_help'
    WHEN v_global_ready >= p_required_quantity THEN 'other_variants_available'
    WHEN v_global_ready + v_global_returns >= p_required_quantity THEN 'potential_returns_may_help'
    ELSE 'shortage'
  END;

  RETURN jsonb_build_object(
    'product_name', v_product_name,
    'requested_variant', v_variant_name,
    'requested_quantity', p_required_quantity,
    'total_serialized_units', v_total_units,
    'ready_now_across_variants', v_global_ready,
    'ready_now_requested_variant', v_variant_ready,
    'potential_returns_before_pickup_across_variants', v_global_returns,
    'potential_returns_before_pickup_requested_variant', v_variant_returns,
    'status', v_state,
    'is_guaranteed', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.akasha_smart_booking_component_availability(
  uuid, uuid, uuid, numeric, timestamptz, numeric
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.akasha_smart_booking_sale_availability(
  p_usaha_id uuid,
  p_barang_id uuid,
  p_varian_barang_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_product_id uuid;
  v_product_name text;
  v_variant_name text;
  v_inventory_mode text;
  v_global_quantity numeric := 0;
  v_variant_quantity numeric := 0;
  v_state text;
BEGIN
  IF num_nonnulls(p_barang_id, p_varian_barang_id) <> 1 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: target stok penjualan tidak valid'
      USING ERRCODE = '22023';
  END IF;

  IF p_varian_barang_id IS NOT NULL THEN
    SELECT vb.barang_id, b.nama, vb.nama,
      coalesce(vb.inventory_mode, b.inventory_mode, 'serialized')
      INTO v_product_id, v_product_name, v_variant_name, v_inventory_mode
    FROM public.varian_barang vb
    JOIN public.barang b
      ON b.usaha_id = vb.usaha_id AND b.barang_id = vb.barang_id
    WHERE vb.usaha_id = p_usaha_id
      AND vb.varian_barang_id = p_varian_barang_id
      AND vb.status = 'active'
      AND b.status = 'active'
      AND coalesce(vb.is_sellable, b.is_sellable) = true;
  ELSE
    SELECT b.barang_id, b.nama, b.inventory_mode
      INTO v_product_id, v_product_name, v_inventory_mode
    FROM public.barang b
    WHERE b.usaha_id = p_usaha_id
      AND b.barang_id = p_barang_id
      AND b.status = 'active'
      AND b.is_sellable = true;
  END IF;

  IF v_product_id IS NULL THEN
    RETURN jsonb_build_object(
      'product_name', 'Item tidak lagi tersedia',
      'requested_variant', v_variant_name,
      'inventory_mode', null,
      'available_now_across_variants', 0,
      'available_now_requested_variant', 0,
      'status', 'catalog_unavailable'
    );
  END IF;

  IF v_inventory_mode = 'quantity' THEN
    SELECT coalesce(sum(sb.jumlah), 0)
      INTO v_global_quantity
    FROM public.stok_barang sb
    WHERE sb.usaha_id = p_usaha_id
      AND sb.barang_id = v_product_id;

    SELECT coalesce(sum(sb.jumlah), 0)
      INTO v_variant_quantity
    FROM public.stok_barang sb
    WHERE sb.usaha_id = p_usaha_id
      AND sb.barang_id = v_product_id
      AND (p_varian_barang_id IS NULL OR sb.varian_barang_id = p_varian_barang_id);
  ELSE
    SELECT
      count(*) FILTER (
        WHERE ub.status = 'ready'
          AND NOT EXISTS (
            SELECT 1
            FROM public.penetapan_unit pu
            JOIN public.detail_penyewaan dp
              ON dp.usaha_id = pu.usaha_id
             AND dp.detail_penyewaan_id = pu.detail_penyewaan_id
            JOIN public.penyewaan p
              ON p.usaha_id = dp.usaha_id
             AND p.penyewaan_id = dp.penyewaan_id
            WHERE pu.usaha_id = ub.usaha_id
              AND pu.unit_barang_id = ub.unit_barang_id
              AND pu.status = 'assigned'
              AND p.status IN ('active', 'return_in_progress')
          )
      )::numeric,
      count(*) FILTER (
        WHERE ub.status = 'ready'
          AND (p_varian_barang_id IS NULL OR ub.varian_barang_id = p_varian_barang_id)
          AND NOT EXISTS (
            SELECT 1
            FROM public.penetapan_unit pu
            JOIN public.detail_penyewaan dp
              ON dp.usaha_id = pu.usaha_id
             AND dp.detail_penyewaan_id = pu.detail_penyewaan_id
            JOIN public.penyewaan p
              ON p.usaha_id = dp.usaha_id
             AND p.penyewaan_id = dp.penyewaan_id
            WHERE pu.usaha_id = ub.usaha_id
              AND pu.unit_barang_id = ub.unit_barang_id
              AND pu.status = 'assigned'
              AND p.status IN ('active', 'return_in_progress')
          )
      )::numeric
    INTO v_global_quantity, v_variant_quantity
    FROM public.unit_barang ub
    WHERE ub.usaha_id = p_usaha_id
      AND ub.barang_id = v_product_id;
  END IF;

  v_state := CASE
    WHEN v_variant_quantity > 0 THEN 'available_now'
    ELSE 'currently_unavailable'
  END;

  RETURN jsonb_build_object(
    'product_name', v_product_name,
    'requested_variant', v_variant_name,
    'inventory_mode', v_inventory_mode,
    'available_now_across_variants', v_global_quantity,
    'available_now_requested_variant', v_variant_quantity,
    'status', v_state,
    'is_guaranteed', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.akasha_smart_booking_sale_availability(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.get_akasha_smart_booking_availability(
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_session app_private.akasha_smart_booking_customer_session%ROWTYPE;
  v_booking app_private.akasha_smart_booking%ROWTYPE;
  v_tolerance numeric := 10;
  v_pickup_target timestamptz;
  v_lines jsonb := '[]'::jsonb;
  v_line record;
  v_component record;
  v_components jsonb;
  v_component_count integer;
  v_component_ready integer;
  v_component_potential integer;
  v_overall_status text;
  v_result jsonb;
BEGIN
  IF length(coalesce(p_session_token, '')) <> 64 THEN
    RAISE EXCEPTION 'SESSION_INVALID: sesi portal tidak valid atau telah berakhir'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_session
  FROM app_private.akasha_smart_booking_customer_session s
  WHERE s.session_token_hash = app_private.akasha_smart_booking_hmac(
      'portal-session', p_session_token
    )
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_INVALID: sesi portal tidak valid atau telah berakhir'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_booking
  FROM app_private.akasha_smart_booking b
  WHERE b.smart_booking_id = v_session.smart_booking_id
    AND b.usaha_id = v_session.usaha_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_INVALID: sesi portal tidak valid atau telah berakhir'
      USING ERRCODE = '28000';
  END IF;

  SELECT coalesce(u.default_tolerance_hours, 10)
    INTO v_tolerance
  FROM public.usaha u
  WHERE u.usaha_id = v_booking.usaha_id;

  -- Date-only bookings use the beginning of their local pickup date as the
  -- forecast boundary. This is conservative: same-day returns are not implied
  -- to be ready when the customer has not selected an exact pickup time.
  v_pickup_target := coalesce(
    v_booking.requested_pickup_at,
    v_booking.requested_pickup_date::timestamp AT TIME ZONE v_booking.business_timezone
  );

  FOR v_line IN
    SELECT l.*
    FROM app_private.akasha_smart_booking_line l
    WHERE l.usaha_id = v_booking.usaha_id
      AND l.smart_booking_id = v_booking.smart_booking_id
    ORDER BY l.line_position, l.created_at
  LOOP
    IF v_line.line_kind = 'sale' THEN
      v_components := jsonb_build_array(
        app_private.akasha_smart_booking_sale_availability(
          v_booking.usaha_id, v_line.barang_id, v_line.varian_barang_id
        )
      );
      v_overall_status := coalesce(v_components->0->>'status', 'unknown');
    ELSIF v_line.paket_sewa_id IS NOT NULL THEN
      v_components := '[]'::jsonb;
      v_component_count := 0;
      v_component_ready := 0;
      v_component_potential := 0;

      FOR v_component IN
        SELECT
          cp.barang_id,
          cp.varian_barang_id,
          cp.jumlah,
          coalesce(vb.nama, b.nama, 'Komponen paket') AS component_name,
          vb.nama AS variant_name
        FROM public.komponen_paket cp
        LEFT JOIN public.barang b
          ON b.usaha_id = cp.usaha_id AND b.barang_id = cp.barang_id
        LEFT JOIN public.varian_barang vb
          ON vb.usaha_id = cp.usaha_id
         AND vb.varian_barang_id = cp.varian_barang_id
        WHERE cp.usaha_id = v_booking.usaha_id
          AND cp.paket_sewa_id = v_line.paket_sewa_id
        ORDER BY b.nama, vb.nama
      LOOP
        v_components := v_components || jsonb_build_array(
          jsonb_build_object(
            'component_name', v_component.component_name,
            'requested_variant', v_component.variant_name,
            'required_quantity', v_line.quantity * v_component.jumlah,
            'availability', app_private.akasha_smart_booking_component_availability(
              v_booking.usaha_id,
              v_component.barang_id,
              v_component.varian_barang_id,
              v_line.quantity * v_component.jumlah,
              v_pickup_target,
              v_tolerance
            )
          )
        );
        v_component_count := v_component_count + 1;
        IF v_components->(v_component_count - 1)->'availability'->>'status' = 'ready_now' THEN
          v_component_ready := v_component_ready + 1;
        ELSIF v_components->(v_component_count - 1)->'availability'->>'status'
          IN ('potential_return_may_help', 'other_variants_available', 'potential_returns_may_help') THEN
          v_component_potential := v_component_potential + 1;
        END IF;
      END LOOP;

      v_overall_status := CASE
        WHEN v_component_count = 0 THEN 'package_components_unavailable'
        WHEN v_component_ready = v_component_count THEN 'all_components_ready_now'
        WHEN v_component_ready + v_component_potential = v_component_count THEN 'some_components_depend_on_potential_stock'
        ELSE 'one_or_more_components_short'
      END;
    ELSE
      v_components := jsonb_build_array(
        app_private.akasha_smart_booking_component_availability(
          v_booking.usaha_id,
          v_line.barang_id,
          v_line.varian_barang_id,
          v_line.quantity,
          v_pickup_target,
          v_tolerance
        )
      );
      v_overall_status := coalesce(v_components->0->>'status', 'unknown');
    END IF;

    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'line_id', v_line.smart_booking_line_id,
        'kind', v_line.line_kind,
        'item_name', v_line.item_name_snapshot,
        'variant_name', v_line.variant_label_snapshot,
        'requested_quantity', v_line.quantity,
        'status', v_overall_status,
        'components', v_components
      )
    );
  END LOOP;

  v_result := jsonb_build_object(
    'smart_booking_id', v_booking.smart_booking_id,
    'reference_code', v_booking.reference_code,
    'checked_at', now(),
    'requested_pickup_date', v_booking.requested_pickup_date,
    'requested_pickup_at', v_booking.requested_pickup_at,
    'business_timezone', v_booking.business_timezone,
    'pickup_forecast_boundary', v_pickup_target,
    'return_tolerance_hours', v_tolerance,
    'inventory_is_reserved', false,
    'availability_is_guaranteed', false,
    'lines', v_lines,
    'customer_notice',
      'Ketersediaan adalah informasi stok saat diperiksa. Pengembalian yang diperkirakan hanya potensi; unit baru dihitung siap setelah diterima dan lolos pemeriksaan. Stok akan divalidasi kembali saat transaksi di lokasi.'
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.get_akasha_smart_booking_availability(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_akasha_smart_booking_availability(
  p_session_token text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.get_akasha_smart_booking_availability($1);
$function$;

REVOKE ALL ON FUNCTION public.get_akasha_smart_booking_availability(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_akasha_smart_booking_availability(text)
  TO service_role;

COMMENT ON FUNCTION public.get_akasha_smart_booking_availability(text) IS
  'Customer-safe aggregate stock projection for an authenticated Smart Booking portal session. Future returns are potential only and are never counted as ready stock.';
