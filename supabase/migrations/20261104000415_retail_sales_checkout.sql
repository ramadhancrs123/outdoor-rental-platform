-- Retail sales, quantity stock and unified checkout foundation.
-- Rental rows remain untouched: sale lines live in their own domain and only share catalog/inventory masters.

ALTER TABLE public.barang
  ADD COLUMN IF NOT EXISTS is_rentable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_sellable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS harga_jual numeric(14,2),
  ADD COLUMN IF NOT EXISTS inventory_mode text NOT NULL DEFAULT 'serialized';

ALTER TABLE public.varian_barang
  ADD COLUMN IF NOT EXISTS is_rentable boolean,
  ADD COLUMN IF NOT EXISTS is_sellable boolean,
  ADD COLUMN IF NOT EXISTS harga_jual numeric(14,2),
  ADD COLUMN IF NOT EXISTS inventory_mode text;

ALTER TABLE public.barang
  ADD CONSTRAINT barang_harga_jual_positive CHECK (harga_jual IS NULL OR harga_jual > 0),
  ADD CONSTRAINT barang_inventory_mode_valid CHECK (inventory_mode IN ('serialized','quantity')),
  ADD CONSTRAINT barang_rentable_requires_serialized CHECK (NOT is_rentable OR inventory_mode = 'serialized');

ALTER TABLE public.varian_barang
  ADD CONSTRAINT varian_harga_jual_positive CHECK (harga_jual IS NULL OR harga_jual > 0),
  ADD CONSTRAINT varian_inventory_mode_valid CHECK (inventory_mode IS NULL OR inventory_mode IN ('serialized','quantity')),
  ADD CONSTRAINT varian_rentable_requires_serialized CHECK (coalesce(is_rentable, true) = false OR inventory_mode IS NULL OR inventory_mode = 'serialized');

COMMENT ON COLUMN public.barang.is_rentable IS 'Whether the catalog product may be added to a rental transaction.';
COMMENT ON COLUMN public.barang.is_sellable IS 'Whether the catalog product may be sold as a retail item.';
COMMENT ON COLUMN public.barang.harga_jual IS 'Retail sale price in IDR; intentionally separate from rental tariffs.';
COMMENT ON COLUMN public.barang.inventory_mode IS 'serialized uses unit_barang; quantity uses stok_barang.';
COMMENT ON COLUMN public.varian_barang.harga_jual IS 'Optional retail price override; NULL inherits barang.harga_jual.';
COMMENT ON COLUMN public.varian_barang.is_sellable IS 'Optional sale eligibility override; NULL inherits barang.is_sellable.';

CREATE TABLE public.stok_barang (
  stok_barang_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  barang_id uuid NOT NULL,
  varian_barang_id uuid,
  jumlah integer NOT NULL DEFAULT 0 CHECK (jumlah >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stok_barang_usaha_fk FOREIGN KEY (usaha_id) REFERENCES public.usaha(usaha_id) ON DELETE RESTRICT,
  CONSTRAINT stok_barang_barang_fk FOREIGN KEY (usaha_id, barang_id) REFERENCES public.barang(usaha_id, barang_id) ON DELETE RESTRICT,
  CONSTRAINT stok_barang_variant_fk FOREIGN KEY (usaha_id, varian_barang_id) REFERENCES public.varian_barang(usaha_id, varian_barang_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX stok_barang_product_unique
  ON public.stok_barang (usaha_id, barang_id)
  WHERE varian_barang_id IS NULL;
CREATE UNIQUE INDEX stok_barang_variant_unique
  ON public.stok_barang (usaha_id, varian_barang_id)
  WHERE varian_barang_id IS NOT NULL;
CREATE INDEX stok_barang_product_idx ON public.stok_barang (usaha_id, barang_id);
CREATE INDEX stok_barang_variant_idx ON public.stok_barang (usaha_id, varian_barang_id) WHERE varian_barang_id IS NOT NULL;

CREATE TABLE public.pergerakan_stok (
  pergerakan_stok_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  stok_barang_id uuid NOT NULL,
  barang_id uuid NOT NULL,
  varian_barang_id uuid,
  jenis_pergerakan text NOT NULL CHECK (jenis_pergerakan IN ('opening','adjustment','sale','sale_return')),
  quantity_delta integer NOT NULL CHECK (quantity_delta <> 0),
  source_type text NOT NULL,
  source_id uuid,
  actor_akun_admin_id uuid NOT NULL,
  request_id uuid NOT NULL,
  catatan text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pergerakan_stok_usaha_fk FOREIGN KEY (usaha_id) REFERENCES public.usaha(usaha_id) ON DELETE RESTRICT,
  CONSTRAINT pergerakan_stok_stock_fk FOREIGN KEY (stok_barang_id) REFERENCES public.stok_barang(stok_barang_id) ON DELETE RESTRICT,
  CONSTRAINT pergerakan_stok_barang_fk FOREIGN KEY (usaha_id, barang_id) REFERENCES public.barang(usaha_id, barang_id) ON DELETE RESTRICT,
  CONSTRAINT pergerakan_stok_variant_fk FOREIGN KEY (usaha_id, varian_barang_id) REFERENCES public.varian_barang(usaha_id, varian_barang_id) ON DELETE RESTRICT,
  CONSTRAINT pergerakan_stok_actor_fk FOREIGN KEY (actor_akun_admin_id) REFERENCES public.akun_admin(akun_admin_id) ON DELETE RESTRICT
);
CREATE INDEX pergerakan_stok_product_created_idx ON public.pergerakan_stok (usaha_id, barang_id, created_at DESC);
CREATE INDEX pergerakan_stok_variant_created_idx ON public.pergerakan_stok (usaha_id, varian_barang_id, created_at DESC) WHERE varian_barang_id IS NOT NULL;

CREATE TABLE public.penjualan (
  penjualan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  nomor_penjualan text NOT NULL,
  source text NOT NULL DEFAULT 'pos' CHECK (source IN ('pos','mixed')),
  nama_pelanggan text,
  nomor_telepon text,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','voided','refunded')),
  payment_status text NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('unpaid','partial','paid')),
  total_amount numeric(14,2) NOT NULL CHECK (total_amount > 0),
  currency_code char(3) NOT NULL DEFAULT 'IDR' CHECK (currency_code = 'IDR'),
  catatan text,
  created_by_admin_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT penjualan_usaha_fk FOREIGN KEY (usaha_id) REFERENCES public.usaha(usaha_id) ON DELETE RESTRICT,
  CONSTRAINT penjualan_actor_fk FOREIGN KEY (created_by_admin_id) REFERENCES public.akun_admin(akun_admin_id) ON DELETE RESTRICT,
  CONSTRAINT penjualan_usaha_number_unique UNIQUE (usaha_id, nomor_penjualan),
  CONSTRAINT penjualan_tenant_unique UNIQUE (usaha_id, penjualan_id)
);

CREATE TABLE public.detail_penjualan (
  detail_penjualan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  penjualan_id uuid NOT NULL,
  barang_id uuid NOT NULL,
  varian_barang_id uuid,
  nama_barang_snapshot text NOT NULL,
  nama_varian_snapshot text,
  inventory_mode text NOT NULL CHECK (inventory_mode IN ('serialized','quantity')),
  jumlah integer NOT NULL CHECK (jumlah > 0),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price > 0),
  subtotal numeric(14,2) NOT NULL CHECK (subtotal > 0),
  currency_code char(3) NOT NULL DEFAULT 'IDR' CHECK (currency_code = 'IDR'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT detail_penjualan_tenant_unique UNIQUE (usaha_id, detail_penjualan_id),
  CONSTRAINT detail_penjualan_sale_fk FOREIGN KEY (usaha_id, penjualan_id) REFERENCES public.penjualan(usaha_id, penjualan_id) ON DELETE RESTRICT,
  CONSTRAINT detail_penjualan_barang_fk FOREIGN KEY (usaha_id, barang_id) REFERENCES public.barang(usaha_id, barang_id) ON DELETE RESTRICT,
  CONSTRAINT detail_penjualan_variant_fk FOREIGN KEY (usaha_id, varian_barang_id) REFERENCES public.varian_barang(usaha_id, varian_barang_id) ON DELETE RESTRICT,
  CONSTRAINT detail_penjualan_math CHECK (subtotal = round(jumlah * unit_price, 2))
);
CREATE INDEX detail_penjualan_sale_idx ON public.detail_penjualan (usaha_id, penjualan_id);
CREATE INDEX detail_penjualan_product_idx ON public.detail_penjualan (usaha_id, barang_id);
CREATE INDEX detail_penjualan_variant_idx ON public.detail_penjualan (usaha_id, varian_barang_id) WHERE varian_barang_id IS NOT NULL;

CREATE TABLE public.detail_penjualan_unit (
  detail_penjualan_unit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  detail_penjualan_id uuid NOT NULL,
  penjualan_id uuid NOT NULL,
  unit_barang_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT detail_penjualan_unit_line_fk FOREIGN KEY (usaha_id, detail_penjualan_id) REFERENCES public.detail_penjualan(usaha_id, detail_penjualan_id) ON DELETE RESTRICT,
  CONSTRAINT detail_penjualan_unit_sale_fk FOREIGN KEY (usaha_id, penjualan_id) REFERENCES public.penjualan(usaha_id, penjualan_id) ON DELETE RESTRICT,
  CONSTRAINT detail_penjualan_unit_unit_fk FOREIGN KEY (usaha_id, unit_barang_id) REFERENCES public.unit_barang(usaha_id, unit_barang_id) ON DELETE RESTRICT,
  CONSTRAINT detail_penjualan_unit_unique UNIQUE (usaha_id, unit_barang_id)
);
CREATE INDEX detail_penjualan_unit_line_idx ON public.detail_penjualan_unit (usaha_id, detail_penjualan_id);

CREATE TABLE public.penjualan_pembayaran (
  penjualan_pembayaran_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  penjualan_id uuid NOT NULL,
  transaksi_keuangan_id uuid NOT NULL,
  akun_keuangan_id uuid NOT NULL,
  nomor_pembayaran text NOT NULL,
  jenis text NOT NULL DEFAULT 'pembayaran_penjualan' CHECK (jenis = 'pembayaran_penjualan'),
  metode text NOT NULL CHECK (metode IN ('cash','bank_transfer','qris_manual','other')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency_code char(3) NOT NULL DEFAULT 'IDR' CHECK (currency_code = 'IDR'),
  dibayar_at timestamptz NOT NULL DEFAULT now(),
  dicatat_by_admin_id uuid NOT NULL,
  reference_text text,
  catatan text,
  status text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded','voided','reversed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT penjualan_pembayaran_sale_fk FOREIGN KEY (usaha_id, penjualan_id) REFERENCES public.penjualan(usaha_id, penjualan_id) ON DELETE RESTRICT,
  CONSTRAINT penjualan_pembayaran_transaction_fk FOREIGN KEY (transaksi_keuangan_id) REFERENCES public.transaksi_keuangan(transaksi_keuangan_id) ON DELETE RESTRICT,
  CONSTRAINT penjualan_pembayaran_account_fk FOREIGN KEY (usaha_id, akun_keuangan_id) REFERENCES public.akun_keuangan(usaha_id, akun_keuangan_id) ON DELETE RESTRICT,
  CONSTRAINT penjualan_pembayaran_actor_fk FOREIGN KEY (dicatat_by_admin_id) REFERENCES public.akun_admin(akun_admin_id) ON DELETE RESTRICT,
  CONSTRAINT penjualan_pembayaran_number_unique UNIQUE (usaha_id, nomor_pembayaran),
  CONSTRAINT penjualan_pembayaran_transaction_unique UNIQUE (usaha_id, transaksi_keuangan_id)
);
CREATE INDEX penjualan_pembayaran_sale_idx ON public.penjualan_pembayaran (usaha_id, penjualan_id, dibayar_at DESC);

CREATE TABLE public.checkout (
  checkout_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  nomor_checkout text NOT NULL,
  source text NOT NULL CHECK (source IN ('pos','mixed')),
  penyewaan_id uuid,
  penjualan_id uuid NOT NULL,
  subtotal_rental numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal_rental >= 0),
  subtotal_penjualan numeric(14,2) NOT NULL CHECK (subtotal_penjualan > 0),
  total_amount numeric(14,2) NOT NULL CHECK (total_amount > 0),
  amount_paid numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  payment_status text NOT NULL CHECK (payment_status IN ('unpaid','partial','paid')),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','voided','refunded')),
  created_by_admin_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checkout_usaha_fk FOREIGN KEY (usaha_id) REFERENCES public.usaha(usaha_id) ON DELETE RESTRICT,
  CONSTRAINT checkout_rental_fk FOREIGN KEY (usaha_id, penyewaan_id) REFERENCES public.penyewaan(usaha_id, penyewaan_id) ON DELETE RESTRICT,
  CONSTRAINT checkout_sale_fk FOREIGN KEY (usaha_id, penjualan_id) REFERENCES public.penjualan(usaha_id, penjualan_id) ON DELETE RESTRICT,
  CONSTRAINT checkout_actor_fk FOREIGN KEY (created_by_admin_id) REFERENCES public.akun_admin(akun_admin_id) ON DELETE RESTRICT,
  CONSTRAINT checkout_usaha_number_unique UNIQUE (usaha_id, nomor_checkout),
  CONSTRAINT checkout_sale_unique UNIQUE (usaha_id, penjualan_id),
  CONSTRAINT checkout_total_math CHECK (total_amount = subtotal_rental + subtotal_penjualan),
  CONSTRAINT checkout_paid_limit CHECK (amount_paid <= total_amount),
  CONSTRAINT checkout_source_consistency CHECK (
    (source = 'pos' AND penyewaan_id IS NULL AND subtotal_rental = 0)
    OR (source = 'mixed' AND penyewaan_id IS NOT NULL AND subtotal_rental > 0)
  )
);
CREATE INDEX checkout_created_idx ON public.checkout (usaha_id, created_at DESC);

ALTER TABLE public.stok_barang ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pergerakan_stok ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.penjualan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detail_penjualan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detail_penjualan_unit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.penjualan_pembayaran ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout ENABLE ROW LEVEL SECURITY;

CREATE POLICY stok_barang_select_member ON public.stok_barang
  FOR SELECT TO authenticated USING (app_private.has_usaha_access(usaha_id));
CREATE POLICY pergerakan_stok_select_member ON public.pergerakan_stok
  FOR SELECT TO authenticated USING (app_private.has_usaha_access(usaha_id));
CREATE POLICY penjualan_select_member ON public.penjualan
  FOR SELECT TO authenticated USING (app_private.has_usaha_access(usaha_id));
CREATE POLICY detail_penjualan_select_member ON public.detail_penjualan
  FOR SELECT TO authenticated USING (app_private.has_usaha_access(usaha_id));
CREATE POLICY detail_penjualan_unit_select_member ON public.detail_penjualan_unit
  FOR SELECT TO authenticated USING (app_private.has_usaha_access(usaha_id));
CREATE POLICY penjualan_pembayaran_select_member ON public.penjualan_pembayaran
  FOR SELECT TO authenticated USING (app_private.has_usaha_access(usaha_id));
CREATE POLICY checkout_select_member ON public.checkout
  FOR SELECT TO authenticated USING (app_private.has_usaha_access(usaha_id));

REVOKE ALL ON public.stok_barang, public.pergerakan_stok, public.penjualan,
  public.detail_penjualan, public.detail_penjualan_unit, public.penjualan_pembayaran,
  public.checkout FROM anon, authenticated;
GRANT SELECT ON public.stok_barang, public.pergerakan_stok, public.penjualan,
  public.detail_penjualan, public.detail_penjualan_unit, public.penjualan_pembayaran,
  public.checkout TO authenticated;

CREATE OR REPLACE FUNCTION app_private.validate_rentable_catalog_target()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_rentable boolean;
  v_barang_id uuid;
BEGIN
  IF NEW.varian_barang_id IS NOT NULL THEN
    SELECT vb.barang_id, coalesce(vb.is_rentable, b.is_rentable)
      INTO v_barang_id, v_rentable
    FROM public.varian_barang vb
    JOIN public.barang b
      ON b.usaha_id = vb.usaha_id
     AND b.barang_id = vb.barang_id
    WHERE vb.usaha_id = NEW.usaha_id
      AND vb.varian_barang_id = NEW.varian_barang_id
      AND vb.status = 'active'
      AND b.status = 'active';
  ELSIF NEW.barang_id IS NOT NULL THEN
    SELECT b.barang_id, b.is_rentable
      INTO v_barang_id, v_rentable
    FROM public.barang b
    WHERE b.usaha_id = NEW.usaha_id
      AND b.barang_id = NEW.barang_id
      AND b.status = 'active';
  ELSE
    RETURN NEW;
  END IF;

  IF v_barang_id IS NULL OR v_rentable IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: produk atau varian ini tidak diizinkan untuk transaksi rental'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_rental_detail_require_rentable_catalog ON public.detail_penyewaan;
CREATE TRIGGER trg_rental_detail_require_rentable_catalog
  BEFORE INSERT OR UPDATE OF barang_id, varian_barang_id
  ON public.detail_penyewaan
  FOR EACH ROW EXECUTE FUNCTION app_private.validate_rentable_catalog_target();

DROP TRIGGER IF EXISTS trg_reservation_detail_require_rentable_catalog ON public.detail_reservasi;
CREATE TRIGGER trg_reservation_detail_require_rentable_catalog
  BEFORE INSERT OR UPDATE OF barang_id, varian_barang_id
  ON public.detail_reservasi
  FOR EACH ROW EXECUTE FUNCTION app_private.validate_rentable_catalog_target();

DROP TRIGGER IF EXISTS trg_package_component_require_rentable_catalog ON public.komponen_paket;
CREATE TRIGGER trg_package_component_require_rentable_catalog
  BEFORE INSERT OR UPDATE OF barang_id, varian_barang_id
  ON public.komponen_paket
  FOR EACH ROW EXECUTE FUNCTION app_private.validate_rentable_catalog_target();

CREATE OR REPLACE FUNCTION app_private.command_set_barang_sales_config(
  p_usaha_id uuid,
  p_barang_id uuid,
  p_is_rentable boolean,
  p_is_sellable boolean,
  p_harga_jual numeric,
  p_inventory_mode text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb;
  v_idempotency_id uuid;
  v_row public.barang%ROWTYPE;
  v_hash text;
BEGIN
  IF p_barang_id IS NULL OR p_is_rentable IS NULL OR p_is_sellable IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: produk dan channel transaksi wajib ditentukan' USING ERRCODE='22023';
  END IF;
  IF p_inventory_mode NOT IN ('serialized','quantity') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: mode inventaris tidak valid' USING ERRCODE='22023';
  END IF;
  IF p_harga_jual IS NOT NULL AND p_harga_jual <= 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: harga jual harus lebih dari nol' USING ERRCODE='22023';
  END IF;
  IF p_is_rentable AND p_inventory_mode <> 'serialized' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: produk rental harus memakai inventaris unit fisik' USING ERRCODE='23514';
  END IF;

  v_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'barang_id',p_barang_id,'is_rentable',p_is_rentable,
    'is_sellable',p_is_sellable,'harga_jual',p_harga_jual,'inventory_mode',p_inventory_mode,
    'expected_updated_at',p_expected_updated_at
  )::text);
  v_claim := app_private.catalog_idempotency_claim(p_usaha_id,'set_barang_sales_config',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: konfigurasi produk belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text,0));
  SELECT * INTO v_row
  FROM public.barang
  WHERE usaha_id=p_usaha_id AND barang_id=p_barang_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: produk tidak ditemukan' USING ERRCODE='P0002'; END IF;
  IF p_expected_updated_at IS NOT NULL AND v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_DATA: produk sudah berubah, muat ulang sebelum menyimpan' USING ERRCODE='40001';
  END IF;
  IF p_inventory_mode='quantity' AND EXISTS (
    SELECT 1 FROM public.unit_barang u WHERE u.usaha_id=p_usaha_id AND u.barang_id=p_barang_id
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: produk sudah memiliki unit fisik; mode inventaris tidak dapat diubah menjadi kuantitas' USING ERRCODE='23514';
  END IF;
  IF p_inventory_mode='serialized' AND EXISTS (
    SELECT 1 FROM public.stok_barang s
    WHERE s.usaha_id=p_usaha_id AND s.barang_id=p_barang_id AND s.varian_barang_id IS NULL AND s.jumlah>0
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: saldo kuantitas masih ada; kosongkan saldo sebelum beralih ke unit fisik' USING ERRCODE='23514';
  END IF;

  UPDATE public.barang
  SET is_rentable=p_is_rentable,
      is_sellable=p_is_sellable,
      harga_jual=p_harga_jual,
      inventory_mode=p_inventory_mode,
      updated_at=now()
  WHERE usaha_id=p_usaha_id AND barang_id=p_barang_id
  RETURNING * INTO v_row;

  IF p_inventory_mode='quantity' THEN
    INSERT INTO public.stok_barang(usaha_id,barang_id,varian_barang_id,jumlah)
    SELECT p_usaha_id,p_barang_id,NULL,0
    WHERE NOT EXISTS (
      SELECT 1 FROM public.stok_barang s
      WHERE s.usaha_id=p_usaha_id AND s.barang_id=p_barang_id AND s.varian_barang_id IS NULL
    );
  END IF;

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  ) VALUES (
    p_usaha_id,auth.uid(),v_admin_id,'set_sales_config','barang',p_barang_id,
    'admin-command',p_request_id,
    jsonb_build_object('is_rentable',v_row.is_rentable,'is_sellable',v_row.is_sellable,
      'harga_jual',v_row.harga_jual,'inventory_mode',v_row.inventory_mode)
  );

  v_claim := jsonb_build_object(
    'barang_id',v_row.barang_id,'usaha_id',v_row.usaha_id,
    'is_rentable',v_row.is_rentable,'is_sellable',v_row.is_sellable,
    'harga_jual',v_row.harga_jual,'inventory_mode',v_row.inventory_mode,
    'updated_at',v_row.updated_at
  );
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim);
  RETURN v_claim;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_set_varian_sales_config(
  p_usaha_id uuid,
  p_varian_barang_id uuid,
  p_is_rentable boolean,
  p_is_sellable boolean,
  p_harga_jual numeric,
  p_inventory_mode text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb;
  v_idempotency_id uuid;
  v_variant public.varian_barang%ROWTYPE;
  v_product public.barang%ROWTYPE;
  v_effective_rentable boolean;
  v_effective_mode text;
  v_hash text;
BEGIN
  IF p_varian_barang_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: varian wajib ditentukan' USING ERRCODE='22023';
  END IF;
  IF p_inventory_mode IS NOT NULL AND p_inventory_mode NOT IN ('serialized','quantity') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: mode inventaris varian tidak valid' USING ERRCODE='22023';
  END IF;
  IF p_harga_jual IS NOT NULL AND p_harga_jual <= 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: harga jual varian harus lebih dari nol' USING ERRCODE='22023';
  END IF;

  v_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'varian_barang_id',p_varian_barang_id,
    'is_rentable',p_is_rentable,'is_sellable',p_is_sellable,'harga_jual',p_harga_jual,
    'inventory_mode',p_inventory_mode,'expected_updated_at',p_expected_updated_at
  )::text);
  v_claim := app_private.catalog_idempotency_claim(p_usaha_id,'set_varian_sales_config',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: konfigurasi varian belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text,0));
  SELECT * INTO v_variant
  FROM public.varian_barang
  WHERE usaha_id=p_usaha_id AND varian_barang_id=p_varian_barang_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: varian tidak ditemukan' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_product
  FROM public.barang
  WHERE usaha_id=p_usaha_id AND barang_id=v_variant.barang_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: produk induk varian tidak ditemukan' USING ERRCODE='P0002'; END IF;

  v_effective_rentable := coalesce(p_is_rentable,v_product.is_rentable);
  v_effective_mode := coalesce(p_inventory_mode,v_product.inventory_mode);
  IF v_effective_rentable AND v_effective_mode <> 'serialized' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: varian rental harus memakai inventaris unit fisik' USING ERRCODE='23514';
  END IF;
  IF v_effective_mode='quantity' AND EXISTS (
    SELECT 1 FROM public.unit_barang u
    WHERE u.usaha_id=p_usaha_id AND u.varian_barang_id=p_varian_barang_id
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: varian sudah memiliki unit fisik; mode inventaris tidak dapat diubah ke kuantitas' USING ERRCODE='23514';
  END IF;
  IF v_effective_mode='serialized' AND EXISTS (
    SELECT 1 FROM public.stok_barang s
    WHERE s.usaha_id=p_usaha_id AND s.varian_barang_id=p_varian_barang_id AND s.jumlah>0
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: saldo kuantitas varian masih ada' USING ERRCODE='23514';
  END IF;

  UPDATE public.varian_barang
  SET is_rentable=p_is_rentable,
      is_sellable=p_is_sellable,
      harga_jual=p_harga_jual,
      inventory_mode=p_inventory_mode,
      updated_at=now()
  WHERE usaha_id=p_usaha_id AND varian_barang_id=p_varian_barang_id
  RETURNING * INTO v_variant;

  IF v_effective_mode='quantity' THEN
    INSERT INTO public.stok_barang(usaha_id,barang_id,varian_barang_id,jumlah)
    SELECT p_usaha_id,v_product.barang_id,p_varian_barang_id,0
    WHERE NOT EXISTS (
      SELECT 1 FROM public.stok_barang s
      WHERE s.usaha_id=p_usaha_id AND s.varian_barang_id=p_varian_barang_id
    );
  END IF;

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  ) VALUES (
    p_usaha_id,auth.uid(),v_admin_id,'set_sales_config','varian_barang',p_varian_barang_id,
    'admin-command',p_request_id,
    jsonb_build_object('is_rentable',v_variant.is_rentable,'is_sellable',v_variant.is_sellable,
      'harga_jual',v_variant.harga_jual,'inventory_mode',v_variant.inventory_mode)
  );

  v_claim := jsonb_build_object(
    'varian_barang_id',v_variant.varian_barang_id,'barang_id',v_variant.barang_id,
    'is_rentable',v_variant.is_rentable,'is_sellable',v_variant.is_sellable,
    'harga_jual',v_variant.harga_jual,'inventory_mode',v_variant.inventory_mode,
    'updated_at',v_variant.updated_at
  );
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim);
  RETURN v_claim;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_adjust_sale_stock(
  p_usaha_id uuid,
  p_barang_id uuid,
  p_varian_barang_id uuid,
  p_jumlah_baru integer,
  p_alasan text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb;
  v_idempotency_id uuid;
  v_stock public.stok_barang%ROWTYPE;
  v_product public.barang%ROWTYPE;
  v_variant public.varian_barang%ROWTYPE;
  v_mode text;
  v_old integer := 0;
  v_delta integer := 0;
  v_hash text;
  v_response jsonb;
BEGIN
  IF p_barang_id IS NULL OR p_jumlah_baru IS NULL OR p_jumlah_baru < 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: produk dan jumlah stok baru wajib valid' USING ERRCODE='22023';
  END IF;
  IF length(btrim(coalesce(p_alasan,''))) < 5 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: alasan perubahan stok minimal 5 karakter' USING ERRCODE='22023';
  END IF;

  v_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'barang_id',p_barang_id,'varian_barang_id',p_varian_barang_id,
    'jumlah_baru',p_jumlah_baru,'alasan',btrim(p_alasan),'expected_updated_at',p_expected_updated_at
  )::text);
  v_claim := app_private.catalog_idempotency_claim(p_usaha_id,'adjust_sale_stock',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: perubahan stok belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text,0));
  SELECT * INTO v_product
  FROM public.barang
  WHERE usaha_id=p_usaha_id AND barang_id=p_barang_id AND status='active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: produk aktif tidak ditemukan' USING ERRCODE='P0002'; END IF;

  v_mode := v_product.inventory_mode;
  IF p_varian_barang_id IS NOT NULL THEN
    SELECT * INTO v_variant
    FROM public.varian_barang
    WHERE usaha_id=p_usaha_id AND varian_barang_id=p_varian_barang_id
      AND barang_id=p_barang_id AND status='active'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: varian aktif tidak ditemukan pada produk ini' USING ERRCODE='P0002'; END IF;
    v_mode := coalesce(v_variant.inventory_mode,v_product.inventory_mode);
  END IF;
  IF v_mode <> 'quantity' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: penyesuaian kuantitas hanya berlaku untuk produk dengan mode quantity' USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_stock
  FROM public.stok_barang
  WHERE usaha_id=p_usaha_id AND barang_id=p_barang_id
    AND varian_barang_id IS NOT DISTINCT FROM p_varian_barang_id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF p_expected_updated_at IS NOT NULL THEN
      RAISE EXCEPTION 'STALE_DATA: saldo stok belum tersedia; muat ulang sebelum mencoba lagi' USING ERRCODE='40001';
    END IF;
    INSERT INTO public.stok_barang(usaha_id,barang_id,varian_barang_id,jumlah)
    VALUES(p_usaha_id,p_barang_id,p_varian_barang_id,0)
    RETURNING * INTO v_stock;
  ELSE
    IF p_expected_updated_at IS NOT NULL AND v_stock.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'STALE_DATA: saldo stok sudah berubah; muat ulang sebelum mencoba lagi' USING ERRCODE='40001';
    END IF;
  END IF;

  v_old := v_stock.jumlah;
  v_delta := p_jumlah_baru - v_old;
  IF v_delta <> 0 THEN
    UPDATE public.stok_barang
    SET jumlah=p_jumlah_baru,updated_at=now()
    WHERE stok_barang_id=v_stock.stok_barang_id
    RETURNING * INTO v_stock;

    INSERT INTO public.pergerakan_stok(
      usaha_id,stok_barang_id,barang_id,varian_barang_id,jenis_pergerakan,
      quantity_delta,source_type,source_id,actor_akun_admin_id,request_id,catatan,metadata
    ) VALUES (
      p_usaha_id,v_stock.stok_barang_id,p_barang_id,p_varian_barang_id,
      CASE WHEN v_old=0 AND p_jumlah_baru>0 THEN 'opening' ELSE 'adjustment' END,
      v_delta,'stock_adjustment',v_stock.stok_barang_id,v_admin_id,p_request_id,
      btrim(p_alasan),jsonb_build_object('before',v_old,'after',p_jumlah_baru)
    );
  END IF;

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  ) VALUES (
    p_usaha_id,auth.uid(),v_admin_id,'adjust_sale_stock','stok_barang',v_stock.stok_barang_id,
    'admin-command',p_request_id,
    jsonb_build_object('barang_id',p_barang_id,'varian_barang_id',p_varian_barang_id,
      'before',v_old,'after',p_jumlah_baru,'delta',v_delta,'alasan',btrim(p_alasan))
  );

  v_response := jsonb_build_object(
    'stok_barang_id',v_stock.stok_barang_id,'barang_id',p_barang_id,
    'varian_barang_id',p_varian_barang_id,'jumlah',v_stock.jumlah,
    'updated_at',v_stock.updated_at,'state',CASE WHEN v_delta=0 THEN 'unchanged' ELSE 'changed' END
  );
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_response);
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_create_sale(
  p_usaha_id uuid,
  p_source text,
  p_nama_pelanggan text,
  p_nomor_telepon text,
  p_catatan text,
  p_lines jsonb,
  p_akun_keuangan_id uuid,
  p_metode text,
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
  v_account public.akun_keuangan%ROWTYPE;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_sale_id uuid := gen_random_uuid();
  v_checkout_id uuid := gen_random_uuid();
  v_payment_id uuid := gen_random_uuid();
  v_transaction_id uuid := gen_random_uuid();
  v_sale_number text;
  v_checkout_number text;
  v_payment_number text;
  v_payment_number_seq bigint;
  v_transaction_number bigint;
  v_sale_number_seq bigint;
  v_checkout_number_seq bigint;
  v_now timestamptz := now();
  v_year text;
  v_line jsonb;
  v_barang_id uuid;
  v_variant_id uuid;
  v_parent_id uuid;
  v_barang_name text;
  v_variant_name text;
  v_sellable boolean;
  v_price numeric(14,2);
  v_mode text;
  v_qty integer;
  v_subtotal numeric(14,2);
  v_total numeric(14,2) := 0;
  v_available integer;
  v_reserved numeric := 0;
  v_reservation record;
  v_unit record;
  v_detail_id uuid;
  v_selected integer;
  v_stock public.stok_barang%ROWTYPE;
  v_response jsonb;
  v_method text := lower(btrim(coalesce(p_metode,'')));
BEGIN
  v_admin_id := app_private.assert_finance_admin(p_usaha_id);
  IF p_source NOT IN ('pos','mixed') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: sumber penjualan tidak valid' USING ERRCODE='22023';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines)=0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: minimal satu barang penjualan wajib dipilih' USING ERRCODE='22023';
  END IF;
  IF p_akun_keuangan_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: akun penerima pembayaran wajib dipilih' USING ERRCODE='22023';
  END IF;
  IF v_method NOT IN ('cash','bank_transfer','qris_manual','other') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: metode pembayaran tidak didukung' USING ERRCODE='22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi' USING ERRCODE='22023';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'source',p_source,'nama_pelanggan',nullif(btrim(p_nama_pelanggan),''),
    'nomor_telepon',nullif(btrim(p_nomor_telepon),''),'catatan',nullif(btrim(p_catatan),''),
    'lines',p_lines,'akun',p_akun_keuangan_id,'metode',v_method
  )::text);

  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'create_sale',v_request_hash)
  ON CONFLICT(usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body,request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id AND actor_auth_user_id=v_auth_user_id
      AND command_name='create_sale' AND key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: status penjualan belum dapat dipastikan' USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text,0));

  SELECT timezone INTO v_timezone
  FROM public.usaha WHERE usaha_id=p_usaha_id AND status='active';
  IF v_timezone IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002'; END IF;

  SELECT * INTO v_account
  FROM public.akun_keuangan
  WHERE usaha_id=p_usaha_id AND akun_keuangan_id=p_akun_keuangan_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: akun penerima tidak ditemukan' USING ERRCODE='P0002'; END IF;
  IF v_account.status <> 'active' OR v_account.mata_uang <> 'IDR' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: akun penerima tidak aktif atau bukan akun IDR' USING ERRCODE='23514';
  END IF;

  -- Resolve all prices and validate item eligibility from database truth, never from client-supplied prices.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_barang_id := nullif(v_line->>'barang_id','')::uuid;
    v_variant_id := nullif(v_line->>'varian_barang_id','')::uuid;
    v_qty := coalesce(nullif(v_line->>'jumlah','')::integer,0);
    IF num_nonnulls(v_barang_id,v_variant_id) <> 1 OR v_qty <= 0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: setiap baris harus berisi tepat satu produk/varian dan jumlah bulat positif' USING ERRCODE='22023';
    END IF;

    IF v_variant_id IS NOT NULL THEN
      SELECT b.barang_id,b.nama,v.nama,
        coalesce(v.is_sellable,b.is_sellable),
        coalesce(v.harga_jual,b.harga_jual),
        coalesce(v.inventory_mode,b.inventory_mode)
      INTO v_parent_id,v_barang_name,v_variant_name,v_sellable,v_price,v_mode
      FROM public.varian_barang v
      JOIN public.barang b ON b.usaha_id=v.usaha_id AND b.barang_id=v.barang_id
      WHERE v.usaha_id=p_usaha_id AND v.varian_barang_id=v_variant_id
        AND v.status='active' AND b.status='active';
    ELSE
      SELECT b.barang_id,b.nama,NULL::text,b.is_sellable,b.harga_jual,b.inventory_mode
      INTO v_parent_id,v_barang_name,v_variant_name,v_sellable,v_price,v_mode
      FROM public.barang b
      WHERE b.usaha_id=p_usaha_id AND b.barang_id=v_barang_id AND b.status='active';
    END IF;

    IF v_parent_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: produk atau varian aktif tidak ditemukan' USING ERRCODE='P0002'; END IF;
    IF v_sellable IS DISTINCT FROM true THEN RAISE EXCEPTION 'BUSINESS_CONFLICT: produk/varian ini belum diizinkan untuk dijual' USING ERRCODE='23514'; END IF;
    IF v_price IS NULL OR v_price <= 0 THEN RAISE EXCEPTION 'PRICE_REQUIRED: harga jual produk/varian belum ditentukan' USING ERRCODE='23514'; END IF;
    IF v_mode NOT IN ('serialized','quantity') THEN RAISE EXCEPTION 'VALIDATION_ERROR: mode inventaris produk tidak valid' USING ERRCODE='22023'; END IF;
    v_subtotal := round(v_qty * v_price,2);
    v_total := v_total + v_subtotal;
  END LOOP;

  IF v_total <= 0 THEN RAISE EXCEPTION 'VALIDATION_ERROR: total penjualan harus lebih dari nol' USING ERRCODE='22023'; END IF;

  v_year := to_char(v_now AT TIME ZONE v_timezone,'YYYY');
  v_sale_number_seq := app_private.next_business_number(p_usaha_id,'POS',v_year);
  v_checkout_number_seq := app_private.next_business_number(p_usaha_id,'CKO',v_year);
  v_payment_number_seq := app_private.next_business_number(p_usaha_id,'SP',v_year);
  v_transaction_number := app_private.next_business_number(p_usaha_id,'TRX',v_year);
  v_sale_number := 'POS-' || v_year || '-' || lpad(v_sale_number_seq::text,4,'0');
  v_checkout_number := 'CK-' || v_year || '-' || lpad(v_checkout_number_seq::text,4,'0');
  v_payment_number := 'SP-' || v_year || '-' || lpad(v_payment_number_seq::text,4,'0');

  INSERT INTO public.penjualan(
    penjualan_id,usaha_id,nomor_penjualan,source,nama_pelanggan,nomor_telepon,status,
    payment_status,total_amount,currency_code,catatan,created_by_admin_id
  ) VALUES (
    v_sale_id,p_usaha_id,v_sale_number,p_source,
    nullif(btrim(coalesce(p_nama_pelanggan,'')),''),
    nullif(btrim(coalesce(p_nomor_telepon,'')),''),
    'completed','paid',v_total,'IDR',
    nullif(btrim(coalesce(p_catatan,'')),''),v_admin_id
  );

  -- Re-read each line under the tenant stock lock, then consume exactly the stock class assigned to that product/variant.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_barang_id := nullif(v_line->>'barang_id','')::uuid;
    v_variant_id := nullif(v_line->>'varian_barang_id','')::uuid;
    v_qty := (v_line->>'jumlah')::integer;

    IF v_variant_id IS NOT NULL THEN
      SELECT b.barang_id,b.nama,v.nama,
        coalesce(v.is_sellable,b.is_sellable),
        coalesce(v.harga_jual,b.harga_jual),
        coalesce(v.inventory_mode,b.inventory_mode)
      INTO v_parent_id,v_barang_name,v_variant_name,v_sellable,v_price,v_mode
      FROM public.varian_barang v
      JOIN public.barang b ON b.usaha_id=v.usaha_id AND b.barang_id=v.barang_id
      WHERE v.usaha_id=p_usaha_id AND v.varian_barang_id=v_variant_id
        AND v.status='active' AND b.status='active';
    ELSE
      SELECT b.barang_id,b.nama,NULL::text,b.is_sellable,b.harga_jual,b.inventory_mode
      INTO v_parent_id,v_barang_name,v_variant_name,v_sellable,v_price,v_mode
      FROM public.barang b
      WHERE b.usaha_id=p_usaha_id AND b.barang_id=v_barang_id AND b.status='active';
    END IF;

    v_subtotal := round(v_qty * v_price,2);
    v_detail_id := gen_random_uuid();

    INSERT INTO public.detail_penjualan(
      detail_penjualan_id,usaha_id,penjualan_id,barang_id,varian_barang_id,
      nama_barang_snapshot,nama_varian_snapshot,inventory_mode,jumlah,unit_price,subtotal,currency_code
    ) VALUES (
      v_detail_id,p_usaha_id,v_sale_id,v_parent_id,v_variant_id,
      v_barang_name,v_variant_name,v_mode,v_qty,v_price,v_subtotal,'IDR'
    );

    IF v_mode='quantity' THEN
      SELECT * INTO v_stock
      FROM public.stok_barang
      WHERE usaha_id=p_usaha_id AND barang_id=v_parent_id
        AND varian_barang_id IS NOT DISTINCT FROM v_variant_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'STOCK_NOT_CONFIGURED: saldo stok kuantitas belum diatur untuk %',coalesce(v_variant_name,v_barang_name) USING ERRCODE='23514';
      END IF;
      IF v_stock.jumlah < v_qty THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: stok % tersedia %, diminta %',coalesce(v_variant_name,v_barang_name),v_stock.jumlah,v_qty USING ERRCODE='23514';
      END IF;

      UPDATE public.stok_barang
      SET jumlah=jumlah-v_qty,updated_at=now()
      WHERE stok_barang_id=v_stock.stok_barang_id;

      INSERT INTO public.pergerakan_stok(
        usaha_id,stok_barang_id,barang_id,varian_barang_id,jenis_pergerakan,
        quantity_delta,source_type,source_id,actor_akun_admin_id,request_id,catatan,metadata
      ) VALUES (
        p_usaha_id,v_stock.stok_barang_id,v_parent_id,v_variant_id,'sale',
        -v_qty,'sale',v_sale_id,v_admin_id,p_request_id,
        'Penjualan '||v_sale_number,
        jsonb_build_object('penjualan_id',v_sale_id,'detail_penjualan_id',v_detail_id)
      );
    ELSE
      SELECT count(*) INTO v_available
      FROM public.unit_barang u
      WHERE u.usaha_id=p_usaha_id AND u.status='ready'
        AND (
          (v_variant_id IS NOT NULL AND u.varian_barang_id=v_variant_id)
          OR (v_variant_id IS NULL AND u.barang_id=v_parent_id AND u.varian_barang_id IS NULL)
        );

      v_reserved := 0;
      FOR v_reservation IN
        SELECT r.mulai_reservasi,r.selesai_reservasi
        FROM public.reservasi r
        WHERE r.usaha_id=p_usaha_id AND r.status='confirmed' AND r.stock_lock_status='locked'
      LOOP
        v_reserved := greatest(v_reserved,app_private.reservation_locked_component_requirement(
          p_usaha_id,v_reservation.mulai_reservasi,v_reservation.selesai_reservasi,
          CASE WHEN v_variant_id IS NULL THEN v_parent_id ELSE NULL::uuid END,
          v_variant_id,NULL
        ));
      END LOOP;

      IF v_available - v_reserved < v_qty THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: unit % tidak dapat dijual karena stok dibutuhkan untuk rental/reservasi; tersedia %, sudah dikomitmen %',
          coalesce(v_variant_name,v_barang_name),v_available,v_reserved USING ERRCODE='23514';
      END IF;

      v_selected := 0;
      FOR v_unit IN
        SELECT u.unit_barang_id,u.kode_unit,u.lokasi_id
        FROM public.unit_barang u
        WHERE u.usaha_id=p_usaha_id AND u.status='ready'
          AND (
            (v_variant_id IS NOT NULL AND u.varian_barang_id=v_variant_id)
            OR (v_variant_id IS NULL AND u.barang_id=v_parent_id AND u.varian_barang_id IS NULL)
          )
        ORDER BY u.created_at,u.unit_barang_id
        LIMIT v_qty
        FOR UPDATE
      LOOP
        UPDATE public.unit_barang
        SET status='sold',updated_at=now()
        WHERE usaha_id=p_usaha_id AND unit_barang_id=v_unit.unit_barang_id AND status='ready';
        IF NOT FOUND THEN
          RAISE EXCEPTION 'BUSINESS_CONFLICT: unit berubah saat proses penjualan, ulangi setelah memuat stok terbaru' USING ERRCODE='40001';
        END IF;
        INSERT INTO public.detail_penjualan_unit(
          usaha_id,detail_penjualan_id,penjualan_id,unit_barang_id
        ) VALUES (p_usaha_id,v_detail_id,v_sale_id,v_unit.unit_barang_id);
        INSERT INTO public.riwayat_unit(
          usaha_id,unit_barang_id,jenis_kejadian,terjadi_at,status_sebelum,status_sesudah,
          lokasi_sebelum_id,lokasi_sesudah_id,sumber_type,sumber_id,actor_akun_admin_id,catatan,metadata
        ) VALUES (
          p_usaha_id,v_unit.unit_barang_id,'unit_sold',v_now,'ready','sold',
          v_unit.lokasi_id,v_unit.lokasi_id,'sale',v_sale_id,v_admin_id,
          'Dijual melalui transaksi '||v_sale_number,
          jsonb_build_object('penjualan_id',v_sale_id,'nomor_penjualan',v_sale_number,'kode_unit',v_unit.kode_unit)
        );
        v_selected := v_selected + 1;
      END LOOP;

      IF v_selected <> v_qty THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: jumlah unit siap berubah ketika penjualan diproses' USING ERRCODE='40001';
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.transaksi_keuangan(
    transaksi_keuangan_id,usaha_id,nomor_transaksi,jenis,arah,tanggal_transaksi,
    amount,currency_code,sumber_type,sumber_id,status,catatan
  ) VALUES (
    v_transaction_id,p_usaha_id,v_transaction_number::text,'sales_payment','income',v_now,
    v_total,'IDR','sale',v_sale_id,'recorded',
    'Pembayaran penjualan '||v_sale_number
  );

  INSERT INTO public.penjualan_pembayaran(
    penjualan_pembayaran_id,usaha_id,penjualan_id,transaksi_keuangan_id,akun_keuangan_id,
    nomor_pembayaran,jenis,metode,amount,currency_code,dibayar_at,dicatat_by_admin_id,
    reference_text,catatan,status
  ) VALUES (
    v_payment_id,p_usaha_id,v_sale_id,v_transaction_id,p_akun_keuangan_id,
    v_payment_number,'pembayaran_penjualan',v_method,v_total,'IDR',v_now,v_admin_id,
    null,nullif(btrim(coalesce(p_catatan,'')),''),'recorded'
  );

  INSERT INTO public.pergerakan_akun_keuangan(
    usaha_id,akun_keuangan_id,transaksi_keuangan_id,arah,amount,mata_uang,terjadi_at,
    sumber_type,sumber_id,status,dicatat_by_admin_id,request_id,catatan
  ) VALUES (
    p_usaha_id,p_akun_keuangan_id,v_transaction_id,'masuk',v_total,'IDR',v_now,
    'payment',v_payment_id,'recorded',v_admin_id,p_request_id,
    'Pembayaran penjualan '||v_sale_number
  );

  INSERT INTO public.checkout(
    checkout_id,usaha_id,nomor_checkout,source,penyewaan_id,penjualan_id,
    subtotal_rental,subtotal_penjualan,total_amount,amount_paid,payment_status,
    status,created_by_admin_id
  ) VALUES (
    v_checkout_id,p_usaha_id,v_checkout_number,p_source,NULL,v_sale_id,
    0,v_total,v_total,v_total,'paid','completed',v_admin_id
  );

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  ) VALUES (
    p_usaha_id,v_auth_user_id,v_admin_id,'create_sale','penjualan',v_sale_id,
    'admin-command',p_request_id,
    jsonb_build_object('nomor_penjualan',v_sale_number,'checkout_id',v_checkout_id,
      'total_amount',v_total,'line_count',jsonb_array_length(p_lines),'source',p_source)
  );

  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES (
    p_usaha_id,'sale.completed','penjualan',v_sale_id,
    jsonb_build_object('penjualan_id',v_sale_id,'nomor_penjualan',v_sale_number,
      'checkout_id',v_checkout_id,'total_amount',v_total)
  );

  v_response := jsonb_build_object(
    'checkout_id',v_checkout_id,'nomor_checkout',v_checkout_number,
    'penjualan_id',v_sale_id,'nomor_penjualan',v_sale_number,
    'total_amount',v_total,'amount_paid',v_total,'payment_status','paid',
    'penjualan_pembayaran_id',v_payment_id,'transaksi_keuangan_id',v_transaction_id,
    'status','completed'
  );
  UPDATE public.idempotency_key
  SET response_status=200,response_body=v_response,completed_at=now()
  WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_create_mixed_checkout(
  p_usaha_id uuid,
  p_penyewa_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz,
  p_rental_lines jsonb,
  p_sale_lines jsonb,
  p_akun_keuangan_id uuid,
  p_metode text,
  p_payment_rental_amount numeric,
  p_dibayar_at timestamptz,
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
  v_admin_id uuid := app_private.assert_finance_admin(p_usaha_id);
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_rental jsonb;
  v_sale jsonb;
  v_payment jsonb;
  v_rental_id uuid;
  v_sale_id uuid;
  v_checkout_id uuid;
  v_rental_total numeric(14,2);
  v_sale_total numeric(14,2);
  v_paid_rental numeric(14,2) := coalesce(p_payment_rental_amount,0);
  v_total_paid numeric(14,2);
  v_total numeric(14,2);
  v_response jsonb;
  v_timezone text;
BEGIN
  IF p_usaha_id IS NULL OR p_penyewa_id IS NULL OR p_rental_lines IS NULL
     OR jsonb_typeof(p_rental_lines)<>'array' OR jsonb_array_length(p_rental_lines)=0
     OR p_sale_lines IS NULL OR jsonb_typeof(p_sale_lines)<>'array' OR jsonb_array_length(p_sale_lines)=0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: checkout gabungan membutuhkan minimal satu baris rental dan satu baris pembelian' USING ERRCODE='22023';
  END IF;
  IF p_akun_keuangan_id IS NULL OR p_metode NOT IN ('cash','bank_transfer','qris_manual','other') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: akun dan metode pembayaran checkout wajib valid' USING ERRCODE='22023';
  END IF;
  IF v_paid_rental < 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: pembayaran rental tidak boleh negatif' USING ERRCODE='22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi' USING ERRCODE='22023';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'penyewa_id',p_penyewa_id,'jadwal_mulai',p_jadwal_mulai,
    'jadwal_kembali',p_jadwal_kembali,'rental_lines',p_rental_lines,'sale_lines',p_sale_lines,
    'account',p_akun_keuangan_id,'method',p_metode,'payment_rental',v_paid_rental,
    'dibayar_at',p_dibayar_at,'catatan',p_catatan
  )::text);

  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'create_mixed_checkout',v_request_hash)
  ON CONFLICT(usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body,request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id AND actor_auth_user_id=v_auth_user_id
      AND command_name='create_mixed_checkout' AND key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key checkout sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: status checkout gabungan belum dapat dipastikan' USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text,0));
  SELECT timezone INTO v_timezone FROM public.usaha WHERE usaha_id=p_usaha_id AND status='active';
  IF v_timezone IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002'; END IF;

  v_rental := app_private.command_create_direct_rental(
    p_usaha_id,p_penyewa_id,p_jadwal_mulai,p_jadwal_kembali,p_rental_lines,
    p_catatan,left(btrim(p_idempotency_key)||':rental',240),p_request_id
  );
  v_rental_id := (v_rental->>'penyewaan_id')::uuid;
  v_rental_total := round((v_rental->>'total_amount')::numeric,2);
  IF v_rental_id IS NULL OR v_rental_total <= 0 THEN
    RAISE EXCEPTION 'INTERNAL_ERROR: transaksi rental tidak mengembalikan ringkasan yang valid' USING ERRCODE='P0001';
  END IF;
  IF v_paid_rental > v_rental_total THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: pembayaran rental melebihi nilai rental' USING ERRCODE='22023';
  END IF;

  v_sale := app_private.command_create_sale(
    p_usaha_id,'pos',
    (SELECT p.nama_lengkap FROM public.penyewa p WHERE p.usaha_id=p_usaha_id AND p.penyewa_id=p_penyewa_id),
    (SELECT p.nomor_telepon FROM public.penyewa p WHERE p.usaha_id=p_usaha_id AND p.penyewa_id=p_penyewa_id),
    'Pembelian pada checkout gabungan '||btrim(p_idempotency_key),
    p_sale_lines,p_akun_keuangan_id,p_metode,
    left(btrim(p_idempotency_key)||':sale',240),p_request_id
  );
  v_sale_id := (v_sale->>'penjualan_id')::uuid;
  v_checkout_id := (v_sale->>'checkout_id')::uuid;
  v_sale_total := round((v_sale->>'total_amount')::numeric,2);
  IF v_sale_id IS NULL OR v_checkout_id IS NULL OR v_sale_total <= 0 THEN
    RAISE EXCEPTION 'INTERNAL_ERROR: transaksi penjualan tidak mengembalikan ringkasan yang valid' USING ERRCODE='P0001';
  END IF;

  IF v_paid_rental > 0 THEN
    v_payment := app_private.command_record_payment_with_account(
      p_usaha_id,NULL,v_rental_id,p_akun_keuangan_id,
      CASE WHEN v_paid_rental=v_rental_total THEN 'pelunasan' ELSE 'dp' END,
      p_metode,v_paid_rental,coalesce(p_dibayar_at,now()),
      'Checkout gabungan '||(SELECT nomor_checkout FROM public.checkout WHERE checkout_id=v_checkout_id),
      'Alokasi pembayaran rental pada checkout gabungan',
      left(btrim(p_idempotency_key)||':rental-payment',240),p_request_id
    );
  END IF;

  v_total := v_rental_total + v_sale_total;
  v_total_paid := v_sale_total + v_paid_rental;
  UPDATE public.penjualan
  SET source='mixed'
  WHERE usaha_id=p_usaha_id AND penjualan_id=v_sale_id;

  UPDATE public.checkout
  SET source='mixed',
      penyewaan_id=v_rental_id,
      subtotal_rental=v_rental_total,
      total_amount=v_total,
      amount_paid=v_total_paid,
      payment_status=CASE WHEN v_total_paid=v_total THEN 'paid' WHEN v_total_paid>0 THEN 'partial' ELSE 'unpaid' END
  WHERE usaha_id=p_usaha_id AND checkout_id=v_checkout_id;

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  ) VALUES (
    p_usaha_id,v_auth_user_id,v_admin_id,'create_mixed_checkout','checkout',v_checkout_id,
    'admin-command',p_request_id,
    jsonb_build_object('penyewaan_id',v_rental_id,'penjualan_id',v_sale_id,
      'subtotal_rental',v_rental_total,'subtotal_penjualan',v_sale_total,
      'total_amount',v_total,'amount_paid',v_total_paid)
  );

  v_response := jsonb_build_object(
    'checkout_id',v_checkout_id,
    'nomor_checkout',(SELECT nomor_checkout FROM public.checkout WHERE checkout_id=v_checkout_id),
    'penyewaan_id',v_rental_id,
    'nomor_penyewaan',v_rental->>'nomor_penyewaan',
    'penjualan_id',v_sale_id,
    'nomor_penjualan',v_sale->>'nomor_penjualan',
    'subtotal_rental',v_rental_total,
    'subtotal_penjualan',v_sale_total,
    'total_amount',v_total,
    'amount_paid',v_total_paid,
    'payment_status',CASE WHEN v_total_paid=v_total THEN 'paid' WHEN v_total_paid>0 THEN 'partial' ELSE 'unpaid' END,
    'status','completed'
  );
  UPDATE public.idempotency_key
  SET response_status=200,response_body=v_response,completed_at=now()
  WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$;

-- Public RPC wrappers: authenticated admins only; internal mutation functions remain in app_private.
CREATE OR REPLACE FUNCTION public.command_set_barang_sales_config(
  p_usaha_id uuid,p_barang_id uuid,p_is_rentable boolean,p_is_sellable boolean,
  p_harga_jual numeric,p_inventory_mode text,p_expected_updated_at timestamptz,
  p_idempotency_key text,p_request_id uuid
) RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$
  SELECT app_private.command_set_barang_sales_config($1,$2,$3,$4,$5,$6,$7,$8,$9);
$function$;

CREATE OR REPLACE FUNCTION public.command_set_varian_sales_config(
  p_usaha_id uuid,p_varian_barang_id uuid,p_is_rentable boolean,p_is_sellable boolean,
  p_harga_jual numeric,p_inventory_mode text,p_expected_updated_at timestamptz,
  p_idempotency_key text,p_request_id uuid
) RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$
  SELECT app_private.command_set_varian_sales_config($1,$2,$3,$4,$5,$6,$7,$8,$9);
$function$;

CREATE OR REPLACE FUNCTION public.command_adjust_sale_stock(
  p_usaha_id uuid,p_barang_id uuid,p_varian_barang_id uuid,p_jumlah_baru integer,
  p_alasan text,p_expected_updated_at timestamptz,p_idempotency_key text,p_request_id uuid
) RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$
  SELECT app_private.command_adjust_sale_stock($1,$2,$3,$4,$5,$6,$7,$8);
$function$;

CREATE OR REPLACE FUNCTION public.command_create_sale(
  p_usaha_id uuid,p_nama_pelanggan text,p_nomor_telepon text,p_catatan text,
  p_lines jsonb,p_akun_keuangan_id uuid,p_metode text,p_idempotency_key text,p_request_id uuid
) RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$
  SELECT app_private.command_create_sale(
    $1,'pos',$2,$3,$4,$5,$6,$7,$8,$9
  );
$function$;

CREATE OR REPLACE FUNCTION public.command_create_mixed_checkout(
  p_usaha_id uuid,p_penyewa_id uuid,p_jadwal_mulai timestamptz,p_jadwal_kembali timestamptz,
  p_rental_lines jsonb,p_sale_lines jsonb,p_akun_keuangan_id uuid,p_metode text,
  p_payment_rental_amount numeric,p_dibayar_at timestamptz,p_catatan text,
  p_idempotency_key text,p_request_id uuid
) RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$
  SELECT app_private.command_create_mixed_checkout(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
  );
$function$;

REVOKE ALL ON FUNCTION app_private.command_set_barang_sales_config(uuid,uuid,boolean,boolean,numeric,text,timestamptz,text,uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION app_private.command_set_varian_sales_config(uuid,uuid,boolean,boolean,numeric,text,timestamptz,text,uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION app_private.command_adjust_sale_stock(uuid,uuid,uuid,integer,text,timestamptz,text,uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION app_private.command_create_sale(uuid,text,text,text,text,jsonb,uuid,text,text,uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION app_private.command_create_mixed_checkout(uuid,uuid,timestamptz,timestamptz,jsonb,jsonb,uuid,text,numeric,timestamptz,text,text,uuid) FROM PUBLIC,anon,service_role;

GRANT EXECUTE ON FUNCTION app_private.command_set_barang_sales_config(uuid,uuid,boolean,boolean,numeric,text,timestamptz,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_set_varian_sales_config(uuid,uuid,boolean,boolean,numeric,text,timestamptz,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_adjust_sale_stock(uuid,uuid,uuid,integer,text,timestamptz,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_create_sale(uuid,text,text,text,text,jsonb,uuid,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_create_mixed_checkout(uuid,uuid,timestamptz,timestamptz,jsonb,jsonb,uuid,text,numeric,timestamptz,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.command_set_barang_sales_config(uuid,uuid,boolean,boolean,numeric,text,timestamptz,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.command_set_varian_sales_config(uuid,uuid,boolean,boolean,numeric,text,timestamptz,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.command_adjust_sale_stock(uuid,uuid,uuid,integer,text,timestamptz,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.command_create_sale(uuid,text,text,text,jsonb,uuid,text,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.command_create_mixed_checkout(uuid,uuid,timestamptz,timestamptz,jsonb,jsonb,uuid,text,numeric,timestamptz,text,text,uuid) FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.command_set_barang_sales_config(uuid,uuid,boolean,boolean,numeric,text,timestamptz,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_set_varian_sales_config(uuid,uuid,boolean,boolean,numeric,text,timestamptz,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_adjust_sale_stock(uuid,uuid,uuid,integer,text,timestamptz,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_create_sale(uuid,text,text,text,jsonb,uuid,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_create_mixed_checkout(uuid,uuid,timestamptz,timestamptz,jsonb,jsonb,uuid,text,numeric,timestamptz,text,text,uuid) TO authenticated;
