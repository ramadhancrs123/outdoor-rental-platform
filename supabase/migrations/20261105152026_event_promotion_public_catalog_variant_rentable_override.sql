-- Keep the public promotion eligibility aligned with the server resolver:
-- a variant may explicitly override its parent's rentable flag.

CREATE OR REPLACE VIEW public.v_public_promosi_katalog_rental
WITH (security_invoker = false, security_barrier = true)
AS
SELECT
  t.usaha_id,
  u.slug AS usaha_slug,
  t.barang_id,
  t.varian_barang_id,
  b.slug AS barang_slug,
  b.nama AS nama_barang,
  b.ringkasan_publik,
  vb.nama AS nama_varian,
  t.tarif_sewa_id,
  t.nama AS nama_tarif,
  t.durasi_unit,
  t.durasi_nilai,
  t.nominal AS harga_normal,
  p.promosi_katalog_id,
  p.diskon_persen,
  round(t.nominal * (100 - p.diskon_persen) / 100, 2) AS harga_efektif,
  t.currency_code,
  p.started_at,
  p.valid_until
FROM public.tarif_sewa t
JOIN public.usaha u
  ON u.usaha_id = t.usaha_id
JOIN public.barang b
  ON b.usaha_id = t.usaha_id
 AND b.barang_id = t.barang_id
LEFT JOIN public.varian_barang vb
  ON vb.usaha_id = t.usaha_id
 AND vb.barang_id = t.barang_id
 AND vb.varian_barang_id = t.varian_barang_id
JOIN LATERAL (
  SELECT
    promo.promosi_katalog_id,
    promo.diskon_persen,
    promo.is_public,
    promo.started_at,
    promo.valid_until
  FROM public.promosi_katalog promo
  WHERE promo.usaha_id = t.usaha_id
    AND promo.channel = 'rental'
    AND promo.status = 'active'
    AND promo.ended_at IS NULL
    AND promo.started_at <= now()
    AND (promo.valid_until IS NULL OR now() < promo.valid_until)
    AND (
      (
        t.varian_barang_id IS NOT NULL
        AND promo.varian_barang_id = t.varian_barang_id
        AND promo.barang_id IS NULL
      )
      OR (
        promo.barang_id = t.barang_id
        AND promo.varian_barang_id IS NULL
      )
    )
  ORDER BY
    CASE WHEN promo.varian_barang_id IS NOT NULL THEN 0 ELSE 1 END,
    promo.started_at DESC,
    promo.created_at DESC
  LIMIT 1
) p ON true
WHERE u.status = 'active'
  AND t.paket_sewa_id IS NULL
  AND t.status = 'active'
  AND t.berlaku_mulai <= now()
  AND (t.berlaku_sampai IS NULL OR now() < t.berlaku_sampai)
  AND b.status = 'active'
  AND b.is_public = true
  AND (
    (t.varian_barang_id IS NULL AND b.is_rentable = true)
    OR (
      t.varian_barang_id IS NOT NULL
      AND vb.status = 'active'
      AND coalesce(vb.is_rentable, b.is_rentable) = true
    )
  )
  AND p.is_public = true
  AND p.diskon_persen > 0
  AND app_private.is_public_catalog_target(
    t.usaha_id, t.barang_id, t.varian_barang_id, NULL::uuid
  );

REVOKE ALL ON public.v_public_promosi_katalog_rental
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_public_promosi_katalog_rental TO anon, authenticated;
