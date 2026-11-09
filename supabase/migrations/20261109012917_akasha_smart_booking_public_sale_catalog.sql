-- Public catalog read models and Smart Booking quote consistency.
-- Inventory is still observational: this migration never creates stock locks,
-- units, sales, payments, or cash movements.

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
LEFT JOIN LATERAL app_private.resolve_catalog_promo_price(
  t.usaha_id,
  CASE WHEN t.varian_barang_id IS NULL THEN t.barang_id ELSE NULL END,
  t.varian_barang_id,
  'rental',
  now()
) promo ON true
WHERE t.paket_sewa_id IS NULL
  AND num_nonnulls(t.barang_id, t.varian_barang_id) = 1
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
LEFT JOIN LATERAL app_private.resolve_catalog_promo_price(
  b.usaha_id,
  CASE WHEN v.varian_barang_id IS NULL THEN b.barang_id ELSE NULL END,
  v.varian_barang_id,
  'sale',
  now()
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

CREATE OR REPLACE VIEW public.v_public_barang_media
WITH (security_invoker = false, security_barrier = true)
AS
SELECT
  m.usaha_id,
  m.barang_id,
  m.storage_bucket,
  m.storage_path,
  m.media_type,
  m.urutan,
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
  'Public-safe rental options with the same active rental-channel promotion resolver used by Smart Booking. No inventory reservation is implied.';
COMMENT ON VIEW public.v_public_katalog_jual IS
  'Public-safe sellable catalog options with active sale-channel promotions resolved server-side. Inventory is not reserved.';
COMMENT ON VIEW public.v_public_barang_media IS
  'Public-safe images for explicitly public active products; private media and non-public storage paths are excluded.';

-- The legacy website-booking command is retained as a compatibility writer.
-- Its reservation detail rows must carry the same rental/package price snapshot
-- as Smart Booking, including active product/variant promotions.
CREATE OR REPLACE FUNCTION app_private.apply_website_reservation_price_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_source text;
  v_normal_price numeric(14,2);
  v_duration_unit text;
  v_duration_value numeric(12,3);
  v_promo_id uuid;
  v_discount_percent numeric(5,2) := 0;
BEGIN
  SELECT ps.sumber
    INTO v_source
  FROM public.reservasi r
  JOIN public.permintaan_sewa ps
    ON ps.usaha_id = r.usaha_id
   AND ps.permintaan_sewa_id = r.permintaan_sewa_id
  WHERE r.usaha_id = NEW.usaha_id
    AND r.reservasi_id = NEW.reservasi_id;

  IF v_source IS DISTINCT FROM 'website' OR NEW.tarif_sewa_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT t.nominal, t.durasi_unit, t.durasi_nilai
    INTO v_normal_price, v_duration_unit, v_duration_value
  FROM public.tarif_sewa t
  WHERE t.usaha_id = NEW.usaha_id
    AND t.tarif_sewa_id = NEW.tarif_sewa_id
    AND t.status = 'active'
    AND t.berlaku_mulai <= now()
    AND (t.berlaku_sampai IS NULL OR t.berlaku_sampai > now());

  IF NOT FOUND OR v_normal_price IS NULL OR v_normal_price <= 0 THEN
    RETURN NEW;
  END IF;

  NEW.harga_normal_snapshot := v_normal_price;
  NEW.durasi_unit_snapshot := v_duration_unit;
  NEW.durasi_nilai_snapshot := v_duration_value;

  IF NEW.paket_sewa_id IS NOT NULL THEN
    NEW.promosi_katalog_id := NULL;
    IF NEW.promosi_paket_id IS NOT NULL AND NEW.unit_price < v_normal_price THEN
      v_discount_percent := round(
        (v_normal_price - NEW.unit_price) * 100 / v_normal_price,
        2
      );
      NEW.diskon_persen_snapshot := v_discount_percent;
      NEW.nominal_diskon_snapshot := round(
        (v_normal_price - NEW.unit_price) * NEW.jumlah,
        2
      );
    ELSE
      NEW.diskon_persen_snapshot := 0;
      NEW.nominal_diskon_snapshot := 0;
    END IF;
    RETURN NEW;
  END IF;

  SELECT p.promosi_katalog_id, p.diskon_persen
    INTO v_promo_id, v_discount_percent
  FROM app_private.resolve_catalog_promo_price(
    NEW.usaha_id,
    CASE WHEN NEW.varian_barang_id IS NULL THEN NEW.barang_id ELSE NULL END,
    NEW.varian_barang_id,
    'rental',
    now()
  ) p;

  IF FOUND AND coalesce(v_discount_percent, 0) > 0 THEN
    NEW.promosi_katalog_id := v_promo_id;
    NEW.diskon_persen_snapshot := v_discount_percent;
    NEW.unit_price := round(
      v_normal_price * (100 - v_discount_percent) / 100,
      2
    );
    NEW.subtotal := round(NEW.jumlah * NEW.unit_price, 2);
    NEW.nominal_diskon_snapshot := round(
      (v_normal_price - NEW.unit_price) * NEW.jumlah,
      2
    );
  ELSE
    NEW.promosi_katalog_id := NULL;
    NEW.diskon_persen_snapshot := 0;
    NEW.nominal_diskon_snapshot := 0;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_aaa_website_reservation_price_snapshot
  ON public.detail_reservasi;
CREATE TRIGGER trg_aaa_website_reservation_price_snapshot
BEFORE INSERT ON public.detail_reservasi
FOR EACH ROW
EXECUTE FUNCTION app_private.apply_website_reservation_price_snapshot();

-- Defense in depth for Smart Booking snapshots: only genuinely rentable,
-- active/public catalog targets may become rental intent lines. Rental promos
-- are resolved again from the same server authority at the snapshot boundary.
CREATE OR REPLACE FUNCTION app_private.apply_akasha_smart_booking_line_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_inventory_mode text;
  v_rentable boolean;
  v_public boolean;
  v_active boolean;
  v_promo_id uuid;
  v_discount_percent numeric(5,2);
  v_normal_price numeric(14,2);
BEGIN
  IF NEW.line_kind <> 'rental' THEN
    RETURN NEW;
  END IF;

  IF NEW.varian_barang_id IS NOT NULL THEN
    SELECT
      coalesce(v.inventory_mode, b.inventory_mode, 'serialized'),
      coalesce(v.is_rentable, b.is_rentable),
      b.is_public,
      (v.status = 'active' AND b.status = 'active')
    INTO v_inventory_mode, v_rentable, v_public, v_active
    FROM public.varian_barang v
    JOIN public.barang b
      ON b.usaha_id = v.usaha_id
     AND b.barang_id = v.barang_id
    WHERE v.usaha_id = NEW.usaha_id
      AND v.varian_barang_id = NEW.varian_barang_id;
  ELSIF NEW.barang_id IS NOT NULL THEN
    SELECT
      coalesce(b.inventory_mode, 'serialized'),
      b.is_rentable,
      b.is_public,
      (b.status = 'active')
    INTO v_inventory_mode, v_rentable, v_public, v_active
    FROM public.barang b
    WHERE b.usaha_id = NEW.usaha_id
      AND b.barang_id = NEW.barang_id;
  ELSIF NEW.paket_sewa_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.paket_sewa p
      WHERE p.usaha_id = NEW.usaha_id
        AND p.paket_sewa_id = NEW.paket_sewa_id
        AND p.status = 'active'
        AND p.is_public = true
    ) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: paket rental tidak aktif atau tidak dipublikasikan'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  ELSE
    RAISE EXCEPTION 'VALIDATION_ERROR: rental line harus memilih barang, varian, atau paket'
      USING ERRCODE = '22023';
  END IF;

  IF v_rentable IS DISTINCT FROM true
     OR v_public IS DISTINCT FROM true
     OR v_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: produk atau varian ini tidak tersedia untuk booking rental'
      USING ERRCODE = '23514';
  END IF;

  NEW.inventory_mode_snapshot := v_inventory_mode;
  v_normal_price := coalesce(NEW.normal_price_snapshot, NEW.unit_price_snapshot);
  NEW.normal_price_snapshot := v_normal_price;

  SELECT p.promosi_katalog_id, p.diskon_persen
    INTO v_promo_id, v_discount_percent
  FROM app_private.resolve_catalog_promo_price(
    NEW.usaha_id,
    CASE WHEN NEW.varian_barang_id IS NULL THEN NEW.barang_id ELSE NULL END,
    NEW.varian_barang_id,
    'rental',
    now()
  ) p;

  IF FOUND AND coalesce(v_discount_percent, 0) > 0 THEN
    NEW.promosi_katalog_id := v_promo_id;
    NEW.discount_percent_snapshot := v_discount_percent;
    NEW.unit_price_snapshot := round(
      v_normal_price * (100 - v_discount_percent) / 100,
      2
    );
    NEW.discount_amount_snapshot := round(
      (v_normal_price - NEW.unit_price_snapshot) * NEW.quantity,
      2
    );
    NEW.subtotal_snapshot := round(
      NEW.unit_price_snapshot * NEW.quantity,
      2
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_aaa_smart_booking_line_policy
  ON app_private.akasha_smart_booking_line;
CREATE TRIGGER trg_aaa_smart_booking_line_policy
BEFORE INSERT OR UPDATE OF
  line_kind, barang_id, varian_barang_id, paket_sewa_id,
  quantity, unit_price_snapshot, normal_price_snapshot
ON app_private.akasha_smart_booking_line
FOR EACH ROW
EXECUTE FUNCTION app_private.apply_akasha_smart_booking_line_policy();

-- The Smart Booking command's compatibility response may contain the legacy
-- pre-promotion total. The authoritative customer quote is always the sum of
-- its normalized line snapshots, not a separately recomputed frontend value.
CREATE OR REPLACE FUNCTION app_private.recalculate_akasha_smart_booking_quote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_line_total numeric(14,2);
  v_line_count integer;
BEGIN
  SELECT coalesce(sum(l.subtotal_snapshot), 0), count(*)
    INTO v_line_total, v_line_count
  FROM app_private.akasha_smart_booking_line l
  WHERE l.usaha_id = NEW.usaha_id
    AND l.smart_booking_id = NEW.smart_booking_id
    AND l.currency_code = NEW.currency_code;

  IF v_line_count > 0 THEN
    NEW.quote_total := v_line_total;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_akasha_smart_booking_quote_total
  ON app_private.akasha_smart_booking;
CREATE TRIGGER trg_akasha_smart_booking_quote_total
BEFORE UPDATE OF quote_total ON app_private.akasha_smart_booking
FOR EACH ROW
EXECUTE FUNCTION app_private.recalculate_akasha_smart_booking_quote();

NOTIFY pgrst, 'reload schema';
