-- Align retail command idempotency writes with the live idempotency_key schema (no completed_at column).

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
  SET response_status=200,response_body=v_response
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
  SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$;
