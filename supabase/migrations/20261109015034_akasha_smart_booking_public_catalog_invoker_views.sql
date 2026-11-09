-- Public catalog endpoints use invoker-security views. The row-producing
-- SECURITY DEFINER functions stay in app_private (not a PostgREST-exposed
-- schema), project only explicitly public catalog fields, and re-validate
-- tenant/status/visibility/channel before returning rows.
--
-- This avoids SECURITY DEFINER views while keeping raw operational tables
-- unavailable to anon/authenticated clients.

CREATE OR REPLACE FUNCTION app_private.public_catalog_rental_projection()
RETURNS TABLE (
  usaha_id uuid,
  usaha_slug text,
  usaha_nama text,
  kategori_barang_id uuid,
  kategori_nama text,
  barang_id uuid,
  barang_nama text,
  barang_slug text,
  barang_deskripsi text,
  ringkasan_publik text,
  varian_barang_id uuid,
  varian_nama text,
  varian_deskripsi text,
  tarif_sewa_id uuid,
  tarif_nama text,
  durasi_unit text,
  durasi_nilai integer,
  harga_normal numeric(19,2),
  diskon_persen numeric(5,2),
  harga_efektif numeric,
  currency_code character(3),
  inventory_mode text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    t.usaha_id,
    u.slug::text,
    u.nama::text,
    b.kategori_barang_id,
    c.nama::text,
    b.barang_id,
    b.nama::text,
    b.slug::text,
    b.deskripsi::text,
    b.ringkasan_publik::text,
    t.varian_barang_id,
    v.nama::text,
    v.deskripsi::text,
    t.tarif_sewa_id,
    t.nama::text,
    t.durasi_unit::text,
    t.durasi_nilai::integer,
    t.nominal::numeric,
    coalesce(promo.diskon_persen, 0)::numeric,
    round(t.nominal * (100 - coalesce(promo.diskon_persen, 0)) / 100, 2)::numeric,
    t.currency_code::character(3),
    coalesce(v.inventory_mode, b.inventory_mode, 'serialized')::text
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
      OR (
        t.varian_barang_id IS NOT NULL
        AND v.status = 'active'
        AND coalesce(v.is_rentable, b.is_rentable) = true
      )
    )
    AND t.nominal > 0;
$function$;

CREATE OR REPLACE FUNCTION app_private.public_catalog_sale_projection()
RETURNS TABLE (
  usaha_id uuid,
  usaha_slug text,
  usaha_nama text,
  kategori_barang_id uuid,
  kategori_nama text,
  barang_id uuid,
  barang_nama text,
  barang_slug text,
  barang_deskripsi text,
  ringkasan_publik text,
  varian_barang_id uuid,
  varian_nama text,
  varian_deskripsi text,
  harga_normal numeric(14,2),
  diskon_persen numeric(5,2),
  harga_efektif numeric,
  currency_code character(3),
  inventory_mode text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    b.usaha_id,
    u.slug::text,
    u.nama::text,
    b.kategori_barang_id,
    c.nama::text,
    b.barang_id,
    b.nama::text,
    b.slug::text,
    b.deskripsi::text,
    b.ringkasan_publik::text,
    v.varian_barang_id,
    v.nama::text,
    v.deskripsi::text,
    coalesce(v.harga_jual, b.harga_jual)::numeric,
    coalesce(promo.diskon_persen, 0)::numeric,
    round(
      coalesce(v.harga_jual, b.harga_jual)
        * (100 - coalesce(promo.diskon_persen, 0)) / 100,
      2
    )::numeric,
    'IDR'::character(3),
    coalesce(v.inventory_mode, b.inventory_mode, 'serialized')::text
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
      OR (
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
$function$;

CREATE OR REPLACE FUNCTION app_private.public_catalog_product_media_projection()
RETURNS TABLE (
  usaha_id uuid,
  barang_id uuid,
  storage_bucket text,
  storage_path text,
  media_type text,
  urutan integer,
  is_cover boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    m.usaha_id,
    m.barang_id,
    m.storage_bucket::text,
    m.storage_path::text,
    m.media_type::text,
    m.urutan::integer,
    m.is_cover
  FROM public.barang_media m
  JOIN public.barang b
    ON b.usaha_id = m.usaha_id
   AND b.barang_id = m.barang_id
  JOIN public.usaha u
    ON u.usaha_id = b.usaha_id
  WHERE u.status = 'active'
    AND b.status = 'active'
    AND b.is_public = true
    AND m.storage_bucket = 'rental-public-media'
    AND m.status = 'valid'
    AND m.media_type LIKE 'image/%';
$function$;

REVOKE ALL ON FUNCTION app_private.public_catalog_rental_projection()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.public_catalog_sale_projection()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.public_catalog_product_media_projection()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.public_catalog_rental_projection()
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.public_catalog_sale_projection()
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.public_catalog_product_media_projection()
  TO anon, authenticated;

-- The resolver is now called only from the protected projection functions.
REVOKE ALL ON FUNCTION app_private.resolve_public_catalog_promo_price(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- These views have no dependent database objects; web code consumes them by
-- name. Drop/recreate is required because PostgreSQL functions intentionally
-- expose unconstrained numeric output typmods, while the previous direct views
-- inherited constrained numeric precision from base columns.
DROP VIEW IF EXISTS public.v_public_katalog_rental;
DROP VIEW IF EXISTS public.v_public_katalog_jual;
DROP VIEW IF EXISTS public.v_public_barang_media;

CREATE VIEW public.v_public_katalog_rental
WITH (security_invoker = true, security_barrier = true)
AS
SELECT *
FROM app_private.public_catalog_rental_projection();

CREATE VIEW public.v_public_katalog_jual
WITH (security_invoker = true, security_barrier = true)
AS
SELECT *
FROM app_private.public_catalog_sale_projection();

CREATE VIEW public.v_public_barang_media
WITH (security_invoker = true, security_barrier = true)
AS
SELECT *
FROM app_private.public_catalog_product_media_projection();

REVOKE ALL ON public.v_public_katalog_rental
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.v_public_katalog_jual
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.v_public_barang_media
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_public_katalog_rental TO anon, authenticated;
GRANT SELECT ON public.v_public_katalog_jual TO anon, authenticated;
GRANT SELECT ON public.v_public_barang_media TO anon, authenticated;

COMMENT ON VIEW public.v_public_katalog_rental IS
  'Invoker-security public rental projection backed by a constrained SECURITY DEFINER function; source operational tables remain private to clients.';
COMMENT ON VIEW public.v_public_katalog_jual IS
  'Invoker-security public sale projection backed by a constrained SECURITY DEFINER function; inventory is not reserved.';
COMMENT ON VIEW public.v_public_barang_media IS
  'Invoker-security projection of valid images on active public products only.';

NOTIFY pgrst, 'reload schema';
