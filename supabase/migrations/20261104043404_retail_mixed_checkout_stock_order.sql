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
