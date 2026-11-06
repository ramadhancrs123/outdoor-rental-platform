-- Protect physical/quantity stock when switching to untracked and propagate HPP to mixed checkout.

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
  IF p_inventory_mode='untracked' AND EXISTS (
    SELECT 1 FROM public.unit_barang u WHERE u.usaha_id=p_usaha_id AND u.barang_id=p_barang_id
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: barang memiliki riwayat unit fisik; tidak dapat beralih ke mode tanpa pelacakan' USING ERRCODE='23514';
  END IF;
  IF p_inventory_mode='untracked' AND EXISTS (
    SELECT 1 FROM public.stok_barang s WHERE s.usaha_id=p_usaha_id AND s.barang_id=p_barang_id AND s.jumlah>0
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: saldo stok kuantitas masih ada; kosongkan sebelum memakai mode tanpa pelacakan' USING ERRCODE='23514';
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
  IF v_effective_mode='untracked' AND EXISTS (
    SELECT 1 FROM public.unit_barang u WHERE u.usaha_id=p_usaha_id AND u.varian_barang_id=p_varian_barang_id
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: varian memiliki riwayat unit fisik; tidak dapat beralih ke mode tanpa pelacakan' USING ERRCODE='23514';
  END IF;
  IF v_effective_mode='untracked' AND EXISTS (
    SELECT 1 FROM public.stok_barang s WHERE s.usaha_id=p_usaha_id AND s.varian_barang_id=p_varian_barang_id AND s.jumlah>0
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: saldo stok varian masih ada; kosongkan sebelum memakai mode tanpa pelacakan' USING ERRCODE='23514';
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

  -- Consume retail stock first. Rental availability is validated against the reduced stock;
  -- any rental failure aborts this transaction and rolls the sale and finance ledger back.
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
    'total_hpp',v_sale->'total_hpp',
    'gross_profit',v_sale->'gross_profit',
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
