-- Untracked consumables, purchase-cost snapshots, and cashier quick-create workflow.
ALTER TABLE public.barang
  ADD COLUMN IF NOT EXISTS harga_beli numeric(14,2),
  ADD COLUMN IF NOT EXISTS satuan_jual text NOT NULL DEFAULT 'pcs';
ALTER TABLE public.varian_barang ADD COLUMN IF NOT EXISTS harga_beli numeric(14,2);
ALTER TABLE public.detail_penjualan
  ADD COLUMN IF NOT EXISTS harga_beli_satuan numeric(14,2),
  ADD COLUMN IF NOT EXISTS hpp_total numeric(14,2);
ALTER TABLE public.penjualan
  ADD COLUMN IF NOT EXISTS total_hpp numeric(14,2),
  ADD COLUMN IF NOT EXISTS gross_profit numeric(14,2);

ALTER TABLE public.barang DROP CONSTRAINT IF EXISTS barang_inventory_mode_valid;
ALTER TABLE public.barang ADD CONSTRAINT barang_inventory_mode_valid
  CHECK (inventory_mode IN ('serialized','quantity','untracked'));
ALTER TABLE public.varian_barang DROP CONSTRAINT IF EXISTS varian_inventory_mode_valid;
ALTER TABLE public.varian_barang ADD CONSTRAINT varian_inventory_mode_valid
  CHECK (inventory_mode IS NULL OR inventory_mode IN ('serialized','quantity','untracked'));
ALTER TABLE public.barang ADD CONSTRAINT barang_harga_beli_nonnegative CHECK (harga_beli IS NULL OR harga_beli>=0);
ALTER TABLE public.varian_barang ADD CONSTRAINT varian_harga_beli_nonnegative CHECK (harga_beli IS NULL OR harga_beli>=0);
ALTER TABLE public.detail_penjualan ADD CONSTRAINT detail_penjualan_hpp_nonnegative CHECK (harga_beli_satuan IS NULL OR harga_beli_satuan>=0);
ALTER TABLE public.barang ADD CONSTRAINT barang_satuan_jual_nonempty CHECK (length(btrim(satuan_jual)) BETWEEN 1 AND 20);

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
  IF p_inventory_mode NOT IN ('serialized','quantity','untracked') THEN
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
  IF p_inventory_mode IS NOT NULL AND p_inventory_mode NOT IN ('serialized','quantity','untracked') THEN
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
  v_cost numeric(14,2);
  v_line_hpp numeric(14,2);
  v_total_hpp numeric(14,2) := 0;
  v_hpp_complete boolean := true;
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
        coalesce(v.harga_beli,b.harga_beli),
        coalesce(v.inventory_mode,b.inventory_mode)
      INTO v_parent_id,v_barang_name,v_variant_name,v_sellable,v_price,v_cost,v_mode
      FROM public.varian_barang v
      JOIN public.barang b ON b.usaha_id=v.usaha_id AND b.barang_id=v.barang_id
      WHERE v.usaha_id=p_usaha_id AND v.varian_barang_id=v_variant_id
        AND v.status='active' AND b.status='active';
    ELSE
      SELECT b.barang_id,b.nama,NULL::text,b.is_sellable,b.harga_jual,b.harga_beli,b.inventory_mode
      INTO v_parent_id,v_barang_name,v_variant_name,v_sellable,v_price,v_cost,v_mode
      FROM public.barang b
      WHERE b.usaha_id=p_usaha_id AND b.barang_id=v_barang_id AND b.status='active';
    END IF;

    IF v_parent_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: produk atau varian aktif tidak ditemukan' USING ERRCODE='P0002'; END IF;
    IF v_sellable IS DISTINCT FROM true THEN RAISE EXCEPTION 'BUSINESS_CONFLICT: produk/varian ini belum diizinkan untuk dijual' USING ERRCODE='23514'; END IF;
    IF v_price IS NULL OR v_price <= 0 THEN RAISE EXCEPTION 'PRICE_REQUIRED: harga jual produk/varian belum ditentukan' USING ERRCODE='23514'; END IF;
    IF v_mode NOT IN ('serialized','quantity','untracked') THEN RAISE EXCEPTION 'VALIDATION_ERROR: mode inventaris produk tidak valid' USING ERRCODE='22023'; END IF;
    IF v_cost IS NOT NULL AND v_cost < 0 THEN RAISE EXCEPTION 'VALIDATION_ERROR: harga beli tidak boleh negatif' USING ERRCODE='22023'; END IF;
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
        coalesce(v.harga_beli,b.harga_beli),
        coalesce(v.inventory_mode,b.inventory_mode)
      INTO v_parent_id,v_barang_name,v_variant_name,v_sellable,v_price,v_cost,v_mode
      FROM public.varian_barang v
      JOIN public.barang b ON b.usaha_id=v.usaha_id AND b.barang_id=v.barang_id
      WHERE v.usaha_id=p_usaha_id AND v.varian_barang_id=v_variant_id
        AND v.status='active' AND b.status='active';
    ELSE
      SELECT b.barang_id,b.nama,NULL::text,b.is_sellable,b.harga_jual,b.harga_beli,b.inventory_mode
      INTO v_parent_id,v_barang_name,v_variant_name,v_sellable,v_price,v_cost,v_mode
      FROM public.barang b
      WHERE b.usaha_id=p_usaha_id AND b.barang_id=v_barang_id AND b.status='active';
    END IF;

    v_subtotal := round(v_qty * v_price,2);
    v_detail_id := gen_random_uuid();

    INSERT INTO public.detail_penjualan(
      detail_penjualan_id,usaha_id,penjualan_id,barang_id,varian_barang_id,
      nama_barang_snapshot,nama_varian_snapshot,inventory_mode,jumlah,unit_price,subtotal,currency_code,
      harga_beli_satuan,hpp_total
    ) VALUES (
      v_detail_id,p_usaha_id,v_sale_id,v_parent_id,v_variant_id,
      v_barang_name,v_variant_name,v_mode,v_qty,v_price,v_subtotal,'IDR',
      v_cost,CASE WHEN v_cost IS NULL THEN NULL ELSE round(v_qty*v_cost,2) END
    );

    IF v_cost IS NULL THEN
      v_hpp_complete := false;
    ELSE
      v_total_hpp := v_total_hpp + round(v_qty*v_cost,2);
    END IF;

    IF v_mode='untracked' THEN
      NULL; -- Consumables without stock tracking: sale does not mutate stock.
    ELSIF v_mode='quantity' THEN
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

  UPDATE public.penjualan
  SET total_hpp=CASE WHEN v_hpp_complete THEN v_total_hpp ELSE NULL END,
      gross_profit=CASE WHEN v_hpp_complete THEN v_total-v_total_hpp ELSE NULL END
  WHERE usaha_id=p_usaha_id AND penjualan_id=v_sale_id;

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
      'total_amount',v_total,'total_hpp',CASE WHEN v_hpp_complete THEN v_total_hpp ELSE NULL END,
      'gross_profit',CASE WHEN v_hpp_complete THEN v_total-v_total_hpp ELSE NULL END,
      'line_count',jsonb_array_length(p_lines),'source',p_source)
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
    'total_amount',v_total,'total_hpp',CASE WHEN v_hpp_complete THEN v_total_hpp ELSE NULL END,
    'gross_profit',CASE WHEN v_hpp_complete THEN v_total-v_total_hpp ELSE NULL END,
    'amount_paid',v_total,'payment_status','paid',
    'penjualan_pembayaran_id',v_payment_id,'transaksi_keuangan_id',v_transaction_id,
    'status','completed'
  );
  UPDATE public.idempotency_key
  SET response_status=200,response_body=v_response,completed_at=now()
  WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_create_quick_sale_product(
  p_usaha_id uuid,p_kategori_barang_id uuid,p_nama text,p_satuan_jual text,
  p_harga_beli numeric,p_harga_jual numeric,p_idempotency_key text,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_admin_id uuid := app_private.catalog_require_admin(p_usaha_id);
  v_category public.kategori_barang%ROWTYPE;
  v_claim jsonb;
  v_idempotency_id uuid;
  v_hash text;
  v_barang_id uuid := gen_random_uuid();
  v_slug text;
  v_response jsonb;
BEGIN
  IF p_kategori_barang_id IS NULL OR btrim(coalesce(p_nama,''))='' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: kategori dan nama barang wajib diisi' USING ERRCODE='22023';
  END IF;
  IF p_harga_beli IS NULL OR p_harga_beli<0 OR p_harga_jual IS NULL OR p_harga_jual<=0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: harga beli wajib nol atau lebih dan harga jual harus lebih dari nol' USING ERRCODE='22023';
  END IF;
  IF length(btrim(coalesce(p_satuan_jual,'')))>20 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: satuan maksimal 20 karakter' USING ERRCODE='22023';
  END IF;
  v_hash := md5(jsonb_build_object('usaha_id',p_usaha_id,'kategori',p_kategori_barang_id,
    'nama',btrim(p_nama),'satuan',coalesce(nullif(btrim(p_satuan_jual),''),'pcs'),
    'harga_beli',p_harga_beli,'harga_jual',p_harga_jual)::text);
  v_claim := app_private.catalog_idempotency_claim(p_usaha_id,'create_quick_sale_product',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: pembuatan barang belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text,0));
  SELECT * INTO v_category FROM public.kategori_barang
  WHERE usaha_id=p_usaha_id AND kategori_barang_id=p_kategori_barang_id AND status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: kategori aktif tidak ditemukan' USING ERRCODE='P0002'; END IF;
  v_slug := trim(both '-' from regexp_replace(lower(btrim(p_nama)),'[^a-z0-9]+','-','g'));
  IF v_slug='' THEN v_slug := 'barang'; END IF;
  v_slug := left(v_slug,70)||'-'||substr(replace(v_barang_id::text,'-',''),1,8);
  INSERT INTO public.barang(
    barang_id,usaha_id,kategori_barang_id,nama,slug,status,is_public,metadata,
    is_rentable,is_sellable,harga_beli,harga_jual,inventory_mode,satuan_jual
  ) VALUES (
    v_barang_id,p_usaha_id,p_kategori_barang_id,btrim(p_nama),v_slug,'active',false,
    jsonb_build_object('created_from','pos_quick_create'),false,true,p_harga_beli,p_harga_jual,'untracked',
    coalesce(nullif(btrim(p_satuan_jual),''),'pcs')
  );
  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  ) VALUES (
    p_usaha_id,auth.uid(),v_admin_id,'create_quick_sale_product','barang',v_barang_id,
    'admin-command',p_request_id,
    jsonb_build_object('nama',btrim(p_nama),'inventory_mode','untracked',
      'harga_beli',p_harga_beli,'harga_jual',p_harga_jual,'kategori_barang_id',p_kategori_barang_id)
  );
  v_response := jsonb_build_object('barang_id',v_barang_id,'usaha_id',p_usaha_id,
    'nama',btrim(p_nama),'slug',v_slug,'is_rentable',false,'is_sellable',true,
    'inventory_mode','untracked','harga_beli',p_harga_beli,'harga_jual',p_harga_jual,
    'satuan_jual',coalesce(nullif(btrim(p_satuan_jual),''),'pcs'));
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,201,v_response);
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_set_barang_hpp(
  p_usaha_id uuid,p_barang_id uuid,p_harga_beli numeric,p_expected_updated_at timestamptz,
  p_idempotency_key text,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_admin_id uuid := app_private.catalog_require_admin(p_usaha_id);
  v_row public.barang%ROWTYPE;
  v_claim jsonb; v_idempotency_id uuid; v_hash text;
BEGIN
  IF p_barang_id IS NULL OR p_harga_beli IS NULL OR p_harga_beli<0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: harga beli tidak boleh kosong atau negatif' USING ERRCODE='22023';
  END IF;
  v_hash:=md5(jsonb_build_object('usaha_id',p_usaha_id,'barang_id',p_barang_id,'harga_beli',p_harga_beli,'expected_updated_at',p_expected_updated_at)::text);
  v_claim:=app_private.catalog_idempotency_claim(p_usaha_id,'set_barang_hpp',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: HPP barang belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id:=(v_claim->>'idempotency_key_id')::uuid;
  SELECT * INTO v_row FROM public.barang WHERE usaha_id=p_usaha_id AND barang_id=p_barang_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: barang tidak ditemukan' USING ERRCODE='P0002'; END IF;
  IF p_expected_updated_at IS NOT NULL AND v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_DATA: barang sudah berubah, muat ulang' USING ERRCODE='40001';
  END IF;
  UPDATE public.barang SET harga_beli=p_harga_beli,updated_at=now()
  WHERE usaha_id=p_usaha_id AND barang_id=p_barang_id RETURNING * INTO v_row;
  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary)
  VALUES(p_usaha_id,auth.uid(),v_admin_id,'set_barang_hpp','barang',p_barang_id,'admin-command',p_request_id,jsonb_build_object('harga_beli',p_harga_beli));
  v_claim:=jsonb_build_object('barang_id',v_row.barang_id,'harga_beli',v_row.harga_beli,'updated_at',v_row.updated_at);
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim);
  RETURN v_claim;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_set_varian_hpp(
  p_usaha_id uuid,p_varian_barang_id uuid,p_harga_beli numeric,p_expected_updated_at timestamptz,
  p_idempotency_key text,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_admin_id uuid := app_private.catalog_require_admin(p_usaha_id);
  v_row public.varian_barang%ROWTYPE;
  v_claim jsonb; v_idempotency_id uuid; v_hash text;
BEGIN
  IF p_varian_barang_id IS NULL OR p_harga_beli IS NULL OR p_harga_beli<0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: harga beli tidak boleh kosong atau negatif' USING ERRCODE='22023';
  END IF;
  v_hash:=md5(jsonb_build_object('usaha_id',p_usaha_id,'varian_barang_id',p_varian_barang_id,'harga_beli',p_harga_beli,'expected_updated_at',p_expected_updated_at)::text);
  v_claim:=app_private.catalog_idempotency_claim(p_usaha_id,'set_varian_hpp',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: HPP varian belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id:=(v_claim->>'idempotency_key_id')::uuid;
  SELECT * INTO v_row FROM public.varian_barang WHERE usaha_id=p_usaha_id AND varian_barang_id=p_varian_barang_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: varian tidak ditemukan' USING ERRCODE='P0002'; END IF;
  IF p_expected_updated_at IS NOT NULL AND v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_DATA: varian sudah berubah, muat ulang' USING ERRCODE='40001';
  END IF;
  UPDATE public.varian_barang SET harga_beli=p_harga_beli,updated_at=now()
  WHERE usaha_id=p_usaha_id AND varian_barang_id=p_varian_barang_id RETURNING * INTO v_row;
  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary)
  VALUES(p_usaha_id,auth.uid(),v_admin_id,'set_varian_hpp','varian_barang',p_varian_barang_id,'admin-command',p_request_id,jsonb_build_object('harga_beli',p_harga_beli));
  v_claim:=jsonb_build_object('varian_barang_id',v_row.varian_barang_id,'harga_beli',v_row.harga_beli,'updated_at',v_row.updated_at);
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim);
  RETURN v_claim;
END;
$function$;

CREATE OR REPLACE FUNCTION public.command_create_quick_sale_product(
  p_usaha_id uuid,p_kategori_barang_id uuid,p_nama text,p_satuan_jual text,
  p_harga_beli numeric,p_harga_jual numeric,p_idempotency_key text,p_request_id uuid
) RETURNS jsonb LANGUAGE sql SET search_path TO '' AS $function$
  SELECT app_private.command_create_quick_sale_product($1,$2,$3,$4,$5,$6,$7,$8);
$function$;
CREATE OR REPLACE FUNCTION public.command_set_barang_hpp(
  p_usaha_id uuid,p_barang_id uuid,p_harga_beli numeric,p_expected_updated_at timestamptz,
  p_idempotency_key text,p_request_id uuid
) RETURNS jsonb LANGUAGE sql SET search_path TO '' AS $function$
  SELECT app_private.command_set_barang_hpp($1,$2,$3,$4,$5,$6);
$function$;
CREATE OR REPLACE FUNCTION public.command_set_varian_hpp(
  p_usaha_id uuid,p_varian_barang_id uuid,p_harga_beli numeric,p_expected_updated_at timestamptz,
  p_idempotency_key text,p_request_id uuid
) RETURNS jsonb LANGUAGE sql SET search_path TO '' AS $function$
  SELECT app_private.command_set_varian_hpp($1,$2,$3,$4,$5,$6);
$function$;

REVOKE ALL ON FUNCTION app_private.command_create_quick_sale_product(uuid,uuid,text,text,numeric,numeric,text,uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION app_private.command_set_barang_hpp(uuid,uuid,numeric,timestamptz,text,uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION app_private.command_set_varian_hpp(uuid,uuid,numeric,timestamptz,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION app_private.command_create_quick_sale_product(uuid,uuid,text,text,numeric,numeric,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_set_barang_hpp(uuid,uuid,numeric,timestamptz,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_set_varian_hpp(uuid,uuid,numeric,timestamptz,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.command_create_quick_sale_product(uuid,uuid,text,text,numeric,numeric,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.command_set_barang_hpp(uuid,uuid,numeric,timestamptz,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.command_set_varian_hpp(uuid,uuid,numeric,timestamptz,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.command_create_quick_sale_product(uuid,uuid,text,text,numeric,numeric,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_set_barang_hpp(uuid,uuid,numeric,timestamptz,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_set_varian_hpp(uuid,uuid,numeric,timestamptz,text,uuid) TO authenticated;
