-- Defer website-public promo work per product scope.
-- Restore pre-Phase-6 public tariff/package views and their original public predicate.
-- The internal finance read-model fix remains active; no reservation flow is changed.

DROP VIEW IF EXISTS public.v_public_promosi_katalog_rental;

CREATE OR REPLACE VIEW public.v_public_tarif_sewa
WITH (security_invoker = true)
AS
SELECT
  t.usaha_id,
  u.slug AS usaha_slug,
  t.tarif_sewa_id,
  t.barang_id,
  t.varian_barang_id,
  t.paket_sewa_id,
  t.nama,
  t.durasi_unit,
  t.durasi_nilai,
  t.nominal,
  t.currency_code
FROM public.tarif_sewa t
JOIN public.usaha u ON u.usaha_id = t.usaha_id
WHERE u.status = 'active'
  AND t.status = 'active'
  AND t.berlaku_mulai <= now()
  AND (t.berlaku_sampai IS NULL OR now() < t.berlaku_sampai)
  AND app_private.is_public_catalog_target(
    t.usaha_id, t.barang_id, t.varian_barang_id, t.paket_sewa_id
  );

ALTER VIEW public.v_public_tarif_sewa RESET (security_barrier);
ALTER VIEW public.v_public_tarif_sewa SET (security_invoker = true);

CREATE OR REPLACE VIEW public.v_public_paket_promo
WITH (security_invoker = true)
AS
SELECT
  p.usaha_id,
  p.paket_sewa_id,
  p.tarif_sewa_id,
  p.promosi_paket_id,
  t.nominal AS harga_normal,
  p.harga_promo,
  t.currency_code,
  p.started_at
FROM public.promosi_paket_sewa p
JOIN public.v_public_tarif_sewa t
  ON t.usaha_id = p.usaha_id
 AND t.tarif_sewa_id = p.tarif_sewa_id
 AND t.paket_sewa_id = p.paket_sewa_id
WHERE p.harga_promo < t.nominal;

ALTER VIEW public.v_public_paket_promo RESET (security_barrier);
ALTER VIEW public.v_public_paket_promo SET (security_invoker = true);

DROP POLICY IF EXISTS promosi_paket_sewa_public_read ON public.promosi_paket_sewa;
CREATE POLICY promosi_paket_sewa_public_read
  ON public.promosi_paket_sewa
  FOR SELECT TO anon
  USING (
    app_private.can_read_public_package_promo(
      usaha_id, paket_sewa_id, tarif_sewa_id, status, started_at, ended_at
    )
  );

REVOKE ALL ON public.v_public_tarif_sewa
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.v_public_paket_promo
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_public_tarif_sewa TO anon, authenticated;
GRANT SELECT ON public.v_public_paket_promo TO anon, authenticated;

COMMENT ON VIEW public.v_public_tarif_sewa IS
  'Public-safe projection of current active rental tariffs for active businesses and explicitly public catalog targets.';
COMMENT ON VIEW public.v_public_paket_promo IS
  'Public package promo projection. Public eligibility is enforced by promosi_paket_sewa RLS.';
