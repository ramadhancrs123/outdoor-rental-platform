-- Public catalog views must not expose the unrestricted internal promo resolver.
-- This wrapper returns a discount only for an active, explicitly public,
-- rent-/sell-enabled product or variant in an active business. The underlying
-- resolver remains private to trusted transactional commands.

CREATE OR REPLACE FUNCTION app_private.resolve_public_catalog_promo_price(
  p_usaha_id uuid,
  p_barang_id uuid,
  p_varian_barang_id uuid,
  p_channel text
)
RETURNS TABLE(diskon_persen numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_target_active boolean;
  v_is_public boolean;
  v_channel_enabled boolean;
  v_price_available boolean;
BEGIN
  IF p_usaha_id IS NULL
     OR pg_catalog.num_nonnulls(p_barang_id, p_varian_barang_id) <> 1
     OR p_channel IS NULL
     OR p_channel NOT IN ('rental', 'sale') THEN
    RETURN;
  END IF;

  IF p_varian_barang_id IS NOT NULL THEN
    SELECT
      (u.status = 'active' AND b.status = 'active' AND v.status = 'active'),
      b.is_public,
      CASE p_channel
        WHEN 'rental' THEN coalesce(v.is_rentable, b.is_rentable)
        ELSE coalesce(v.is_sellable, b.is_sellable)
      END,
      CASE p_channel
        WHEN 'rental' THEN EXISTS (
          SELECT 1
          FROM public.v_public_tarif_sewa t
          WHERE t.usaha_id = p_usaha_id
            AND t.varian_barang_id = p_varian_barang_id
            AND t.paket_sewa_id IS NULL
        )
        ELSE coalesce(v.harga_jual, b.harga_jual) > 0
      END
    INTO v_target_active, v_is_public, v_channel_enabled, v_price_available
    FROM public.varian_barang v
    JOIN public.barang b
      ON b.usaha_id = v.usaha_id
     AND b.barang_id = v.barang_id
    JOIN public.usaha u
      ON u.usaha_id = b.usaha_id
    WHERE v.usaha_id = p_usaha_id
      AND v.varian_barang_id = p_varian_barang_id;
  ELSE
    SELECT
      (u.status = 'active' AND b.status = 'active'),
      b.is_public,
      CASE p_channel
        WHEN 'rental' THEN b.is_rentable
        ELSE b.is_sellable
      END,
      CASE p_channel
        WHEN 'rental' THEN EXISTS (
          SELECT 1
          FROM public.v_public_tarif_sewa t
          WHERE t.usaha_id = p_usaha_id
            AND t.barang_id = p_barang_id
            AND t.paket_sewa_id IS NULL
        )
        ELSE b.harga_jual > 0
      END
    INTO v_target_active, v_is_public, v_channel_enabled, v_price_available
    FROM public.barang b
    JOIN public.usaha u
      ON u.usaha_id = b.usaha_id
    WHERE b.usaha_id = p_usaha_id
      AND b.barang_id = p_barang_id;
  END IF;

  IF v_target_active IS DISTINCT FROM true
     OR v_is_public IS DISTINCT FROM true
     OR v_channel_enabled IS DISTINCT FROM true
     OR v_price_available IS DISTINCT FROM true THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT resolved.diskon_persen
  FROM app_private.resolve_catalog_promo_price(
    p_usaha_id,
    p_barang_id,
    p_varian_barang_id,
    p_channel,
    now()
  ) resolved;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.resolve_public_catalog_promo_price(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.resolve_public_catalog_promo_price(uuid, uuid, uuid, text)
  TO anon, authenticated;

CREATE OR REPLACE VIEW public.v_public_katalog_rental
WITH (security_invoker = false, security_barrier = true)
AS
SELECT
  t.usaha_id,
  u.slug AS usaha_slug,
  u.nama AS usaha_nama,
  b.kategori_barang_id,
  c.nama AS kategori_nama,
  b.barang_id,
  b.nama AS barang_nama,
  b.slug AS barang_slug,
  b.deskripsi AS barang_deskripsi,
  b.ringkasan_publik,
  t.varian_barang_id,
  v.nama AS varian_nama,
  v.deskripsi AS varian_deskripsi,
  t.tarif_sewa_id,
  t.nama AS tarif_nama,
  t.durasi_unit,
  t.durasi_nilai,
  t.nominal AS harga_normal,
  coalesce(promo.diskon_persen, 0)::numeric(5,2) AS diskon_persen,
  round(t.nominal * (100 - coalesce(promo.diskon_persen, 0)) / 100, 2) AS harga_efektif,
  t.currency_code,
  coalesce(v.inventory_mode, b.inventory_mode, 'serialized') AS inventory_mode
FROM public.v_public_tarif_sewa t
JOIN public.usaha u
  ON u.usaha_id = t.usaha_id
JOIN public.barang b
  ON b.usaha_id = t.usaha_id
 AND b.barang_id = coalesce(t.barang_id, (
   SELECT vb0.barang_id
   FROM public.varian_barang vb0
   WHERE vb0.usaha_id = t.usaha_id
     AND vb0.varian_barang_id = t.varian_barang_id
   LIMIT 1
 ))
JOIN public.kategori_barang c
  ON c.usaha_id = b.usaha_id
 AND c.kategori_barang_id = b.kategori_barang_id
LEFT JOIN public.varian_barang v
  ON v.usaha_id = t.usaha_id
 AND v.varian_barang_id = t.varian_barang_id
LEFT JOIN LATERAL app_private.resolve_public_catalog_promo_price(
  t.usaha_id,
  CASE WHEN t.varian_barang_id IS NULL THEN t.barang_id ELSE NULL::uuid END,
  t.varian_barang_id,
  'rental'
) promo ON true
WHERE t.paket_sewa_id IS NULL
  AND pg_catalog.num_nonnulls(t.barang_id, t.varian_barang_id) = 1
  AND u.status = 'active'
  AND b.status = 'active'
  AND b.is_public = true
  AND c.status = 'active'
  AND (
    (t.varian_barang_id IS NULL AND b.is_rentable = true)
    OR
    (
      t.varian_barang_id IS NOT NULL
      AND v.status = 'active'
      AND coalesce(v.is_rentable, b.is_rentable) = true
    )
  )
  AND t.nominal > 0;

CREATE OR REPLACE VIEW public.v_public_katalog_jual
WITH (security_invoker = false, security_barrier = true)
AS
SELECT
  b.usaha_id,
  u.slug AS usaha_slug,
  u.nama AS usaha_nama,
  b.kategori_barang_id,
  c.nama AS kategori_nama,
  b.barang_id,
  b.nama AS barang_nama,
  b.slug AS barang_slug,
  b.deskripsi AS barang_deskripsi,
  b.ringkasan_publik,
  v.varian_barang_id,
  v.nama AS varian_nama,
  v.deskripsi AS varian_deskripsi,
  coalesce(v.harga_jual, b.harga_jual) AS harga_normal,
  coalesce(promo.diskon_persen, 0)::numeric(5,2) AS diskon_persen,
  round(
    coalesce(v.harga_jual, b.harga_jual)
      * (100 - coalesce(promo.diskon_persen, 0)) / 100,
    2
  ) AS harga_efektif,
  'IDR'::character(3) AS currency_code,
  coalesce(v.inventory_mode, b.inventory_mode, 'serialized') AS inventory_mode
FROM public.barang b
JOIN public.usaha u
  ON u.usaha_id = b.usaha_id
JOIN public.kategori_barang c
  ON c.usaha_id = b.usaha_id
 AND c.kategori_barang_id = b.kategori_barang_id
LEFT JOIN public.varian_barang v
  ON v.usaha_id = b.usaha_id
 AND v.barang_id = b.barang_id
 AND v.status = 'active'
 AND coalesce(v.is_sellable, b.is_sellable) = true
 AND coalesce(v.harga_jual, b.harga_jual) > 0
LEFT JOIN LATERAL app_private.resolve_public_catalog_promo_price(
  b.usaha_id,
  CASE WHEN v.varian_barang_id IS NULL THEN b.barang_id ELSE NULL::uuid END,
  v.varian_barang_id,
  'sale'
) promo ON true
WHERE u.status = 'active'
  AND b.status = 'active'
  AND b.is_public = true
  AND c.status = 'active'
  AND (
    (
      v.varian_barang_id IS NOT NULL
      AND coalesce(v.is_sellable, b.is_sellable) = true
      AND coalesce(v.harga_jual, b.harga_jual) > 0
    )
    OR
    (
      v.varian_barang_id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.varian_barang active_variant
        WHERE active_variant.usaha_id = b.usaha_id
          AND active_variant.barang_id = b.barang_id
          AND active_variant.status = 'active'
      )
      AND b.is_sellable = true
      AND b.harga_jual > 0
    )
  );

COMMENT ON FUNCTION app_private.resolve_public_catalog_promo_price(uuid, uuid, uuid, text) IS
  'Returns only the active discount percentage for explicitly public, active, rental-/sell-enabled catalog targets. Safe for use by public catalog projections.';

NOTIFY pgrst, 'reload schema';
