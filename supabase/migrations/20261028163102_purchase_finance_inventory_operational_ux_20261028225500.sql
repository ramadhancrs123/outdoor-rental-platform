-- Purchase/finance operational UX hardening. Tenant-scoped RPCs and inventory guards.
-- Auto-number preview, atomic purchase cash-out, and an inventory source quantity guard.

CREATE OR REPLACE FUNCTION app_private.purchase_number_preview(p_usaha_id uuid, p_tanggal_pembelian date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_year text;
  v_existing bigint := 0;
  v_counter bigint := 0;
BEGIN
  PERFORM app_private.procurement_require_admin(p_usaha_id);
  IF p_tanggal_pembelian IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tanggal pembelian wajib diisi' USING ERRCODE='22023';
  END IF;
  v_year := to_char(p_tanggal_pembelian, 'YYYY');
  SELECT coalesce(max(substring(p.nomor_pembelian FROM '^PB-[0-9]{4}-([0-9]+)$')::bigint),0)
    INTO v_existing
  FROM public.pembelian p
  WHERE p.usaha_id=p_usaha_id
    AND p.nomor_pembelian ~ ('^PB-' || v_year || '-[0-9]+$');
  SELECT coalesce(max(bc.last_value),0) INTO v_counter
  FROM app_private.business_counter bc
  WHERE bc.usaha_id=p_usaha_id AND bc.series='PB' AND bc.period_key=v_year;
  RETURN 'PB-' || v_year || '-' || lpad((greatest(v_existing,v_counter)+1)::text,3,'0');
END;
$function$;

CREATE OR REPLACE FUNCTION public.purchase_number_preview(p_usaha_id uuid, p_tanggal_pembelian date)
RETURNS text
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.purchase_number_preview($1,$2);
$function$;

REVOKE ALL ON FUNCTION public.purchase_number_preview(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_number_preview(uuid,date) TO authenticated;
REVOKE ALL ON FUNCTION app_private.purchase_number_preview(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.purchase_number_preview(uuid,date) TO authenticated;


-- A payment sourced from a purchase uses the persisted purchase total as money
-- truth and marks that purchase completed only after the account cash-out commits.
CREATE OR REPLACE FUNCTION app_private.command_record_expense_with_finance_cashout(
  p_usaha_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_pemasok_id uuid,
  p_kategori_biaya text,
  p_deskripsi text,
  p_amount numeric,
  p_tanggal_pengeluaran date,
  p_bukti_storage_path text,
  p_catatan text,
  p_allocations jsonb,
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
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_timezone text;
  v_expense jsonb;
  v_settlement jsonb;
  v_expense_key text;
  v_settlement_key text;
  v_settlement_at timestamptz;
  v_response jsonb;
  v_source_type text := lower(btrim(coalesce(p_source_type,'')));
  v_amount numeric(19,2) := p_amount;
  v_supplier_id uuid := p_pemasok_id;
  v_category text := nullif(btrim(coalesce(p_kategori_biaya,'')),'');
  v_description text := nullif(btrim(coalesce(p_deskripsi,'')),'');
  v_expense_date date := coalesce(p_tanggal_pengeluaran,current_date);
  v_purchase public.pembelian%ROWTYPE;
  v_allocated numeric(19,2) := 0;
BEGIN
  v_admin_id := app_private.assert_finance_admin(p_usaha_id);
  IF v_source_type NOT IN ('purchase','operational','other','manual') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: cash out satu-langkah hanya mendukung Pembelian, Operasional, Lainnya, atau Manual' USING ERRCODE='22023';
  END IF;
  IF v_source_type='purchase' AND p_source_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: pembelian sumber wajib dipilih' USING ERRCODE='22023';
  END IF;
  IF v_source_type<>'purchase' AND p_source_id IS NOT NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: source_id hanya boleh diisi untuk Pembelian' USING ERRCODE='22023';
  END IF;
  IF p_request_id IS NULL OR p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: request_id dan idempotency_key wajib diisi' USING ERRCODE='22023';
  END IF;
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations)<>'array' OR jsonb_array_length(p_allocations)=0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: minimal satu akun uang harus dipilih' USING ERRCODE='22023';
  END IF;

  -- Keep retry payload stable even after a successful request changed purchase status.
  v_request_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'source_type',v_source_type,'source_id',p_source_id,
    'pemasok_id',p_pemasok_id,'kategori_biaya',p_kategori_biaya,
    'deskripsi',p_deskripsi,'amount',p_amount,'tanggal_pengeluaran',p_tanggal_pengeluaran,
    'bukti_storage_path',p_bukti_storage_path,'catatan',p_catatan,'allocations',p_allocations
  )::text);

  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'record_expense_with_finance_cashout',v_request_hash)
  ON CONFLICT(usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body,ik.request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key ik
    WHERE ik.usaha_id=p_usaha_id AND ik.actor_auth_user_id=v_auth_user_id
      AND ik.command_name='record_expense_with_finance_cashout' AND ik.key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text,0));

  IF v_source_type='purchase' THEN
    SELECT p.* INTO v_purchase FROM public.pembelian p
    WHERE p.usaha_id=p_usaha_id AND p.pembelian_id=p_source_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_FOUND: pembelian tidak ditemukan dalam usaha aktif' USING ERRCODE='P0002';
    END IF;
    IF v_purchase.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: pembelian ini sudah dibayar atau diselesaikan' USING ERRCODE='23514';
    END IF;
    IF v_purchase.total_amount IS NULL OR v_purchase.total_amount<=0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: total pembelian harus lebih dari 0' USING ERRCODE='22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.transaksi_keuangan t
      WHERE t.usaha_id=p_usaha_id AND t.sumber_type='purchase'
        AND t.sumber_id=p_source_id AND t.status='recorded'
    ) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: pembelian sudah memiliki transaksi pengeluaran tercatat' USING ERRCODE='23514';
    END IF;
    -- Server derives the amount, supplier, date and description from the saved purchase.
    v_amount := v_purchase.total_amount;
    v_supplier_id := v_purchase.pemasok_id;
    v_category := 'Pembelian';
    v_description := 'Pembelian ' || v_purchase.nomor_pembelian;
    v_expense_date := v_purchase.tanggal_pembelian;
  ELSE
    IF v_amount IS NULL OR v_amount<=0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: nominal pengeluaran harus lebih dari 0' USING ERRCODE='22023';
    END IF;
    IF v_category IS NULL OR v_description IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: kategori dan deskripsi pengeluaran wajib diisi' USING ERRCODE='22023';
    END IF;
  END IF;

  SELECT coalesce(sum((a.value->>'amount')::numeric),0) INTO v_allocated
  FROM jsonb_array_elements(p_allocations) AS a(value);
  IF abs(v_allocated-v_amount)>0.000001 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: total alokasi akun harus sama dengan nominal pengeluaran. Nominal Rp %, alokasi Rp %',
      to_char(v_amount,'FM999G999G999G990D00'),
      to_char(v_allocated,'FM999G999G999G990D00')
      USING ERRCODE='22023';
  END IF;

  SELECT u.timezone INTO v_timezone
  FROM public.usaha u WHERE u.usaha_id=p_usaha_id AND u.status='active';
  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  v_settlement_at := (v_expense_date::text || ' 00:00:00 ' || v_timezone)::timestamptz;
  v_expense_key := btrim(p_idempotency_key) || ':expense';
  v_settlement_key := btrim(p_idempotency_key) || ':settlement';

  v_expense := app_private.command_record_expense(
    p_usaha_id,v_source_type,CASE WHEN v_source_type='purchase' THEN p_source_id ELSE NULL END,
    v_supplier_id,v_category,v_description,v_amount,v_expense_date,
    p_bukti_storage_path,p_catatan,v_expense_key,p_request_id
  );

  v_settlement := app_private.command_settle_expense_multi_account(
    p_usaha_id,(v_expense->>'pengeluaran_id')::uuid,v_amount,p_allocations,
    v_settlement_at,p_catatan,v_settlement_key,p_request_id
  );

  IF v_source_type='purchase' THEN
    UPDATE public.pembelian SET status='completed',updated_at=now()
    WHERE usaha_id=p_usaha_id AND pembelian_id=p_source_id;
  END IF;

  v_response := v_expense || jsonb_build_object(
    'cash_out_recorded',true,'settlement',v_settlement,
    'purchase_status',CASE WHEN v_source_type='purchase' THEN 'completed' ELSE NULL END
  );

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  ) VALUES(
    p_usaha_id,v_auth_user_id,v_admin_id,'record_expense_with_finance_cashout',
    'pengeluaran',(v_expense->>'pengeluaran_id')::uuid,'admin-command',p_request_id,
    jsonb_build_object('source_type',v_source_type,'source_id',p_source_id,
      'amount',v_amount,'pengeluaran_id',v_expense->>'pengeluaran_id',
      'transaksi_keuangan_id',v_expense->>'transaksi_keuangan_id',
      'allocations',p_allocations,'settlement',v_settlement,
      'purchase_status',CASE WHEN v_source_type='purchase' THEN 'completed' ELSE NULL END)
  );

  UPDATE public.idempotency_key SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$;


CREATE OR REPLACE FUNCTION app_private.command_create_purchase_with_finance_cashout(
  p_usaha_id uuid,
  p_pemasok_id uuid,
  p_nomor_pembelian text,
  p_tanggal_pembelian date,
  p_lines jsonb,
  p_catatan text,
  p_allocations jsonb,
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
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_purchase_result jsonb;
  v_cashout_result jsonb;
  v_purchase public.pembelian%ROWTYPE;
  v_response jsonb;
  v_inner_purchase_key text;
  v_inner_cashout_key text;
BEGIN
  v_admin_id := app_private.procurement_require_admin(p_usaha_id);
  IF p_tanggal_pembelian IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tanggal pembelian wajib diisi' USING ERRCODE='22023';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)=0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: minimal satu item pembelian wajib diisi' USING ERRCODE='22023';
  END IF;
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations)<>'array' OR jsonb_array_length(p_allocations)=0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: pilih akun uang untuk menyelesaikan pembayaran pembelian' USING ERRCODE='22023';
  END IF;
  IF p_request_id IS NULL OR p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi' USING ERRCODE='22023';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'pemasok_id',p_pemasok_id,
    'nomor_pembelian',p_nomor_pembelian,'tanggal_pembelian',p_tanggal_pembelian,
    'lines',p_lines,'catatan',p_catatan,'allocations',p_allocations
  )::text);

  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'create_purchase_with_finance_cashout',v_request_hash)
  ON CONFLICT(usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body,ik.request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key ik
    WHERE ik.usaha_id=p_usaha_id AND ik.actor_auth_user_id=v_auth_user_id
      AND ik.command_name='create_purchase_with_finance_cashout' AND ik.key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE='40001';
  END IF;

  v_inner_purchase_key := left(btrim(p_idempotency_key) || ':purchase',200);
  v_inner_cashout_key := left(btrim(p_idempotency_key) || ':cashout',200);

  v_purchase_result := app_private.command_create_purchase(
    p_usaha_id,p_pemasok_id,p_nomor_pembelian,p_tanggal_pembelian,p_lines,p_catatan,
    v_inner_purchase_key,p_request_id
  );
  v_cashout_result := app_private.command_record_expense_with_finance_cashout(
    p_usaha_id,'purchase',(v_purchase_result->>'pembelian_id')::uuid,p_pemasok_id,
    'Pembelian','Pembelian ' || (v_purchase_result->>'nomor_pembelian'),
    (v_purchase_result->>'total_amount')::numeric,(v_purchase_result->>'tanggal_pembelian')::date,
    NULL,p_catatan,p_allocations,v_inner_cashout_key,p_request_id
  );

  SELECT p.* INTO v_purchase FROM public.pembelian p
  WHERE p.usaha_id=p_usaha_id AND p.pembelian_id=(v_purchase_result->>'pembelian_id')::uuid;

  v_response := jsonb_build_object(
    'pembelian_id',v_purchase.pembelian_id,'usaha_id',v_purchase.usaha_id,
    'pemasok_id',v_purchase.pemasok_id,'nomor_pembelian',v_purchase.nomor_pembelian,
    'tanggal_pembelian',v_purchase.tanggal_pembelian,'status',v_purchase.status,
    'total_amount',v_purchase.total_amount,'currency_code',v_purchase.currency_code,
    'catatan',v_purchase.catatan,'line_count',jsonb_array_length(p_lines),
    'created_at',v_purchase.created_at,'updated_at',v_purchase.updated_at,
    'finance_expense_recorded',true,
    'pengeluaran_id',v_cashout_result->>'pengeluaran_id',
    'nomor_pengeluaran',v_cashout_result->>'nomor_pengeluaran',
    'transaksi_keuangan_id',v_cashout_result->>'transaksi_keuangan_id',
    'nomor_transaksi',v_cashout_result->>'nomor_transaksi',
    'cash_out_recorded',true,'settlement',v_cashout_result->'settlement'
  );

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  ) VALUES(
    p_usaha_id,v_auth_user_id,v_admin_id,'create_purchase_with_finance_cashout',
    'pembelian',v_purchase.pembelian_id,'admin-command',p_request_id,
    jsonb_build_object('nomor_pembelian',v_purchase.nomor_pembelian,
      'total_amount',v_purchase.total_amount,'status',v_purchase.status,
      'pengeluaran_id',v_cashout_result->>'pengeluaran_id',
      'transaksi_keuangan_id',v_cashout_result->>'transaksi_keuangan_id',
      'settlement',v_cashout_result->'settlement')
  );

  UPDATE public.idempotency_key SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$;


CREATE OR REPLACE FUNCTION app_private.command_reconcile_procurement_mutation(
  p_usaha_id uuid,
  p_command_name text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_row public.idempotency_key%ROWTYPE;
BEGIN
  PERFORM app_private.procurement_require_admin(p_usaha_id);
  IF p_command_name NOT IN ('create_supplier','update_supplier','set_supplier_status',
    'create_purchase','update_purchase_draft','create_purchase_with_finance_cashout') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: command_name procurement tidak didukung' USING ERRCODE='22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_row FROM public.idempotency_key ik
  WHERE ik.usaha_id=p_usaha_id AND ik.actor_auth_user_id=v_auth_user_id
    AND ik.command_name=p_command_name AND ik.key=btrim(p_idempotency_key);
  IF NOT FOUND THEN RETURN jsonb_build_object('state','not_found','response',NULL); END IF;
  RETURN jsonb_build_object('state',CASE WHEN v_row.response_body IS NULL THEN 'unknown' ELSE 'committed' END,
    'response',v_row.response_body);
END;
$function$;


-- Enforce purchase quantity under a row lock to prevent concurrent over-registration.
CREATE OR REPLACE FUNCTION app_private.validate_unit_purchase_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_barang uuid;
  v_varian uuid;
  v_quantity numeric;
  v_registered bigint := 0;
BEGIN
  IF NEW.sumber_pembelian_detail_id IS NULL THEN RETURN NEW; END IF;

  SELECT d.barang_id,d.varian_barang_id,d.jumlah INTO v_barang,v_varian,v_quantity
  FROM public.detail_pembelian d
  WHERE d.usaha_id=NEW.usaha_id AND d.detail_pembelian_id=NEW.sumber_pembelian_detail_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: sumber item pembelian tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  IF v_barang IS NOT NULL AND NEW.barang_id IS DISTINCT FROM v_barang THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: barang unit tidak sesuai dengan item pembelian' USING ERRCODE='23514';
  END IF;
  IF v_varian IS NOT NULL AND NEW.varian_barang_id IS DISTINCT FROM v_varian THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: varian unit tidak sesuai dengan item pembelian' USING ERRCODE='23514';
  END IF;

  IF TG_OP='UPDATE' THEN
    SELECT count(*) INTO v_registered FROM public.unit_barang u
    WHERE u.usaha_id=NEW.usaha_id
      AND u.sumber_pembelian_detail_id=NEW.sumber_pembelian_detail_id
      AND u.unit_barang_id IS DISTINCT FROM NEW.unit_barang_id;
  ELSE
    SELECT count(*) INTO v_registered FROM public.unit_barang u
    WHERE u.usaha_id=NEW.usaha_id
      AND u.sumber_pembelian_detail_id=NEW.sumber_pembelian_detail_id;
  END IF;

  IF v_registered >= floor(v_quantity) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: seluruh jumlah pembelian untuk item ini sudah didaftarkan ke inventaris' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.command_create_purchase_with_finance_cashout(
  p_usaha_id uuid,p_pemasok_id uuid,p_nomor_pembelian text,p_tanggal_pembelian date,
  p_lines jsonb,p_catatan text,p_allocations jsonb,p_idempotency_key text,p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_create_purchase_with_finance_cashout($1,$2,$3,$4,$5,$6,$7,$8,$9);
$function$;

REVOKE ALL ON FUNCTION public.command_create_purchase_with_finance_cashout(uuid,uuid,text,date,jsonb,text,jsonb,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.command_create_purchase_with_finance_cashout(uuid,uuid,text,date,jsonb,text,jsonb,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION app_private.command_create_purchase_with_finance_cashout(uuid,uuid,text,date,jsonb,text,jsonb,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_create_purchase_with_finance_cashout(uuid,uuid,text,date,jsonb,text,jsonb,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_record_expense_with_finance_cashout(uuid,text,uuid,uuid,text,text,numeric,date,text,text,jsonb,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.command_record_expense_with_finance_cashout(uuid,text,uuid,uuid,text,text,numeric,date,text,text,jsonb,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_reconcile_procurement_mutation(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.command_reconcile_procurement_mutation(uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION app_private.validate_unit_purchase_source() FROM PUBLIC, anon, authenticated;


-- Keep the purchase details stable after an inventory unit points to a line.
-- The UI hides "Ubah Draf" in this state; this trigger also protects direct RPC calls.
CREATE OR REPLACE FUNCTION app_private.prevent_purchase_detail_delete_if_registered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.unit_barang u
    WHERE u.usaha_id=OLD.usaha_id
      AND u.sumber_pembelian_detail_id=OLD.detail_pembelian_id
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: detail pembelian tidak dapat diubah karena unit inventaris sudah didaftarkan. Tambahkan unit melalui inventaris, bukan dengan mengubah jumlah pembelian.'
      USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_detail_pembelian_prevent_delete_registered_source ON public.detail_pembelian;
CREATE TRIGGER trg_detail_pembelian_prevent_delete_registered_source
BEFORE DELETE ON public.detail_pembelian
FOR EACH ROW
EXECUTE FUNCTION app_private.prevent_purchase_detail_delete_if_registered();

REVOKE ALL ON FUNCTION app_private.prevent_purchase_detail_delete_if_registered() FROM PUBLIC, anon, authenticated;
