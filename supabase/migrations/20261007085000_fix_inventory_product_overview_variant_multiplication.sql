-- Fix inventory product overview aggregation.
--
-- Root cause:
-- inventory_product_overview joined unit_barang directly to varian_barang,
-- causing each physical unit to be multiplied by the number of product variants.
--
-- Invariant:
-- one physical unit must contribute exactly once to total/status counts,
-- regardless of how many variants exist for the product.
--
-- Variant count is derived independently so it cannot multiply unit rows.

CREATE OR REPLACE FUNCTION public.inventory_product_overview(p_usaha_id uuid)
RETURNS TABLE(
  barang_id uuid,
  nama text,
  slug text,
  status text,
  kategori_nama text,
  total_unit bigint,
  ready_unit bigint,
  rented_unit bigint,
  attention_unit bigint,
  inspection_pending_unit bigint,
  maintenance_unit bigint,
  damaged_unit bigint,
  lost_unit bigint,
  inactive_unit bigint,
  variant_count bigint,
  latest_unit_updated_at timestamptz,
  cover_bucket text,
  cover_path text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT
    b.barang_id,
    b.nama,
    b.slug,
    b.status,
    kb.nama,
    count(u.unit_barang_id)::bigint,
    count(u.unit_barang_id) FILTER (WHERE u.status = 'ready')::bigint,
    count(u.unit_barang_id) FILTER (WHERE u.status = 'rented')::bigint,
    count(u.unit_barang_id) FILTER (WHERE u.status IN ('inspection_pending','maintenance','damaged','lost'))::bigint,
    count(u.unit_barang_id) FILTER (WHERE u.status = 'inspection_pending')::bigint,
    count(u.unit_barang_id) FILTER (WHERE u.status = 'maintenance')::bigint,
    count(u.unit_barang_id) FILTER (WHERE u.status = 'damaged')::bigint,
    count(u.unit_barang_id) FILTER (WHERE u.status = 'lost')::bigint,
    count(u.unit_barang_id) FILTER (WHERE u.status = 'inactive')::bigint,
    (
      SELECT count(*)::bigint
      FROM public.varian_barang v
      WHERE v.usaha_id = b.usaha_id
        AND v.barang_id = b.barang_id
    ),
    max(u.updated_at),
    media.storage_bucket,
    media.storage_path
  FROM public.barang b
  LEFT JOIN public.kategori_barang kb
    ON kb.usaha_id = b.usaha_id
   AND kb.kategori_barang_id = b.kategori_barang_id
  LEFT JOIN public.unit_barang u
    ON u.usaha_id = b.usaha_id
   AND u.barang_id = b.barang_id
  LEFT JOIN LATERAL (
    SELECT bm.storage_bucket, bm.storage_path
    FROM public.barang_media bm
    WHERE bm.usaha_id = b.usaha_id
      AND bm.barang_id = b.barang_id
      AND bm.status IN ('valid','active')
    ORDER BY bm.is_cover DESC, bm.urutan ASC
    LIMIT 1
  ) media ON true
  WHERE b.usaha_id = p_usaha_id
    AND app_private.has_usaha_access(p_usaha_id)
  GROUP BY
    b.barang_id,
    b.nama,
    b.slug,
    b.status,
    kb.nama,
    media.storage_bucket,
    media.storage_path
  ORDER BY b.nama ASC;
$function$;

REVOKE ALL ON FUNCTION public.inventory_product_overview(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_product_overview(uuid) TO authenticated;
