
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
      )::numeric AS available_quantity,
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
      )::numeric AS available_quantity,
      app_private.reservation_locked_component_requirement(
        p_usaha_id,
        (p_jadwal_mulai AT TIME ZONE v_timezone)::date,
        (p_jadwal_kembali AT TIME ZONE v_timezone)::date,
        c.barang_id,
        c.varian_id,
        NULL
      ) AS reserved_quantity
    FROM canonical c
    LEFT JOIN public.unit_barang ub
      ON ub.usaha_id = p_usaha_id
     AND ub.varian_barang_id = c.varian_id
    WHERE c.varian_id IS NOT NULL
    GROUP BY c.barang_id, c.varian_id, c.required_quantity
  ),
  shortfalls AS (
    SELECT
      pc.barang_id,
      NULL::uuid AS varian_id,
      pc.required_quantity,
      GREATEST(pc.available_quantity - pc.reserved_quantity, 0) AS effective_available,
      'product_capacity'::text AS shortage_scope
    FROM product_capacity pc
    WHERE pc.available_quantity - pc.reserved_quantity < pc.required_quantity

    UNION ALL

    SELECT
      vc.barang_id,
      vc.varian_id,
      vc.required_quantity,
      GREATEST(vc.available_quantity - vc.reserved_quantity, 0) AS effective_available,
      'variant_capacity'::text AS shortage_scope
    FROM variant_capacity vc
    WHERE vc.available_quantity - vc.reserved_quantity < vc.required_quantity
  )
  SELECT *
  INTO v_shortfall
  FROM shortfalls
  ORDER BY shortage_scope, barang_id, varian_id NULLS FIRST
  LIMIT 1;

  IF v_shortfall IS NOT NULL THEN
    RAISE EXCEPTION
      'BUSINESS_CONFLICT: kapasitas fisik gabungan tidak cukup; scope=%, requested=%, available=%',
      v_shortfall.shortage_scope, v_shortfall.required_quantity, v_shortfall.effective_available
      USING ERRCODE = '23514';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.validate_direct_rental_capacity(uuid,timestamptz,timestamptz,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.validate_direct_rental_capacity(uuid,timestamptz,timestamptz,jsonb) FROM anon;
REVOKE ALL ON FUNCTION app_private.validate_direct_rental_capacity(uuid,timestamptz,timestamptz,jsonb) FROM service_role;
