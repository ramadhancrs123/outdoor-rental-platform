-- Finance F3 canonical schema objects reconstructed from verified live state.
CREATE TABLE IF NOT EXISTS public.keuangan_koreksi (
  koreksi_keuangan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL REFERENCES public.usaha(usaha_id) ON DELETE RESTRICT,
  nomor_koreksi text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('payment','expense')),
  target_id uuid NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('void','reversal')),
  reason text NOT NULL CHECK (btrim(reason) <> '' AND length(reason) <= 2000),
  replacement_transaksi_keuangan_id uuid NULL,
  actor_akun_admin_id uuid NOT NULL,
  request_id uuid NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT keuangan_koreksi_actor_membership_fk
    FOREIGN KEY (usaha_id, actor_akun_admin_id)
    REFERENCES public.keanggotaan_usaha(usaha_id, akun_admin_id)
    ON DELETE RESTRICT,
  CONSTRAINT keuangan_koreksi_replacement_tx_fk
    FOREIGN KEY (usaha_id, replacement_transaksi_keuangan_id)
    REFERENCES public.transaksi_keuangan(usaha_id, transaksi_keuangan_id)
    ON DELETE RESTRICT,
  CONSTRAINT keuangan_koreksi_reversal_replacement_chk CHECK (
    (action_type = 'void' AND replacement_transaksi_keuangan_id IS NULL)
    OR
    (action_type = 'reversal' AND replacement_transaksi_keuangan_id IS NOT NULL)
  ),
  CONSTRAINT keuangan_koreksi_nomor_unik UNIQUE (usaha_id, nomor_koreksi),
  CONSTRAINT keuangan_koreksi_target_unik UNIQUE (usaha_id, target_type, target_id)
);

-- Finance F3 canonical reconstruction from verified live Supabase state.
-- Generated 2026-09-29. Remote F3 migrations already exist; this closes repository drift.

CREATE OR REPLACE FUNCTION app_private.assert_finance_admin(p_usaha_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id wajib diisi' USING ERRCODE = '22023';
  END IF;

  SELECT aa.akun_admin_id
  INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id = aa.akun_admin_id
   AND ku.status = 'active'
   AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id = v_auth_user_id
    AND aa.status = 'active'
    AND aa.role = 'super_admin'
    AND ku.usaha_id = p_usaha_id;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses finance pada usaha' USING ERRCODE = '42501';
  END IF;

  RETURN v_admin_id;
END;
$function$

CREATE OR REPLACE FUNCTION app_private.command_correct_expense(p_usaha_id uuid, p_pengeluaran_id uuid, p_action_type text, p_reason text, p_idempotency_key text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid:=auth.uid();
  v_admin_id uuid;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_expense public.pengeluaran%ROWTYPE;
  v_transaction public.transaksi_keuangan%ROWTYPE;
  v_correction_id uuid:=gen_random_uuid();
  v_correction_number text;
  v_replacement_transaction_id uuid;
  v_replacement_transaction_number text;
  v_action text:=lower(btrim(coalesce(p_action_type,'')));
  v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
  v_response jsonb;
  v_effective_at timestamptz:=now();
  v_timezone text;
BEGIN
  v_admin_id:=app_private.assert_finance_admin(p_usaha_id);

  IF p_pengeluaran_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: pengeluaran_id wajib diisi' USING ERRCODE='22023';
  END IF;
  IF v_action NOT IN ('void','reversal') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: action correction tidak didukung' USING ERRCODE='22023';
  END IF;
  IF v_reason IS NULL OR length(v_reason)<5 OR length(v_reason)>2000 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: alasan koreksi wajib 5-2000 karakter' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_expense
  FROM public.pengeluaran e
  WHERE e.usaha_id=p_usaha_id AND e.pengeluaran_id=p_pengeluaran_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: pengeluaran tidak ditemukan dalam usaha aktif' USING ERRCODE='P0002';
  END IF;

  SELECT * INTO v_transaction
  FROM public.transaksi_keuangan t
  WHERE t.usaha_id=p_usaha_id AND t.transaksi_keuangan_id=v_expense.transaksi_keuangan_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTEGRITY_ERROR: transaksi keuangan pasangan pengeluaran tidak ditemukan' USING ERRCODE='23514';
  END IF;
  IF v_transaction.status<>'recorded' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: transaksi pengeluaran sudah tidak berada pada status recorded' USING ERRCODE='23514';
  END IF;

  SELECT u.timezone INTO v_timezone FROM public.usaha u
  WHERE u.usaha_id=p_usaha_id AND u.status='active';
  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  v_request_hash:=md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'pengeluaran_id',p_pengeluaran_id,'action_type',v_action,'reason',v_reason
  )::text);

  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'correct_expense',v_request_hash)
  ON CONFLICT(usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body,ik.request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key ik
    WHERE ik.usaha_id=p_usaha_id AND ik.actor_auth_user_id=v_auth_user_id
      AND ik.command_name='correct_expense' AND ik.key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text,0));

  IF EXISTS (
    SELECT 1 FROM public.keuangan_koreksi k
    WHERE k.usaha_id=p_usaha_id AND k.target_type='expense' AND k.target_id=p_pengeluaran_id
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: pengeluaran sudah memiliki koreksi' USING ERRCODE='23505';
  END IF;

  v_correction_number:=app_private.next_business_number(
    p_usaha_id,'KOR',to_char(v_effective_at AT TIME ZONE v_timezone,'YYYY')
  );

  IF v_action='void' THEN
    INSERT INTO public.keuangan_koreksi(
      koreksi_keuangan_id,usaha_id,nomor_koreksi,target_type,target_id,action_type,reason,
      actor_akun_admin_id,request_id,effective_at
    ) VALUES (
      v_correction_id,p_usaha_id,v_correction_number,'expense',p_pengeluaran_id,'void',v_reason,
      v_admin_id,p_request_id,v_effective_at
    );

    UPDATE public.transaksi_keuangan SET status='voided'
    WHERE usaha_id=p_usaha_id AND transaksi_keuangan_id=v_expense.transaksi_keuangan_id;
  ELSE
    v_replacement_transaction_id:=gen_random_uuid();
    v_replacement_transaction_number:=app_private.next_business_number(
      p_usaha_id,'TRX',to_char(v_effective_at AT TIME ZONE v_timezone,'YYYY')
    );

    INSERT INTO public.transaksi_keuangan(
      transaksi_keuangan_id,usaha_id,nomor_transaksi,jenis,arah,tanggal_transaksi,amount,currency_code,
      sumber_type,sumber_id,status,catatan
    ) VALUES (
      v_replacement_transaction_id,p_usaha_id,v_replacement_transaction_number,'finance_reversal',
      CASE WHEN v_transaction.arah='income' THEN 'expense' ELSE 'income' END,
      v_effective_at,v_transaction.amount,v_transaction.currency_code,
      'finance_correction',v_correction_id,'recorded',
      'Reversal '||v_transaction.nomor_transaksi||': '||v_reason
    );

    INSERT INTO public.keuangan_koreksi(
      koreksi_keuangan_id,usaha_id,nomor_koreksi,target_type,target_id,action_type,reason,
      replacement_transaksi_keuangan_id,actor_akun_admin_id,request_id,effective_at
    ) VALUES (
      v_correction_id,p_usaha_id,v_correction_number,'expense',p_pengeluaran_id,'reversal',v_reason,
      v_replacement_transaction_id,v_admin_id,p_request_id,v_effective_at
    );

    UPDATE public.transaksi_keuangan SET status='reversed'
    WHERE usaha_id=p_usaha_id AND transaksi_keuangan_id=v_expense.transaksi_keuangan_id;
  END IF;

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,
    change_summary,reason
  ) VALUES (
    p_usaha_id,v_auth_user_id,v_admin_id,
    CASE WHEN v_action='void' THEN 'void_expense' ELSE 'reverse_expense' END,
    'pengeluaran',p_pengeluaran_id,'admin-command',p_request_id,
    jsonb_build_object(
      'correction_id',v_correction_id,'correction_number',v_correction_number,'action_type',v_action,
      'transaction_id',v_expense.transaksi_keuangan_id,'replacement_transaction_id',v_replacement_transaction_id,
      'status_after',CASE WHEN v_action='void' THEN 'voided' ELSE 'reversed' END
    ),v_reason
  );

  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES(
    p_usaha_id,
    CASE WHEN v_action='void' THEN 'expense.voided' ELSE 'expense.reversed' END,
    'pengeluaran',p_pengeluaran_id,
    jsonb_build_object(
      'expense_id',p_pengeluaran_id,'transaction_id',v_expense.transaksi_keuangan_id,
      'correction_id',v_correction_id,'correction_number',v_correction_number,
      'replacement_transaction_id',v_replacement_transaction_id,'action_type',v_action,'reason',v_reason
    )
  );

  v_response:=jsonb_build_object(
    'pengeluaran_id',p_pengeluaran_id,
    'status',CASE WHEN v_action='void' THEN 'voided' ELSE 'reversed' END,
    'correction_id',v_correction_id,
    'nomor_koreksi',v_correction_number,
    'replacement_transaksi_keuangan_id',v_replacement_transaction_id
  );

  UPDATE public.idempotency_key SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;

  RETURN v_response;
END;
$function$

CREATE OR REPLACE FUNCTION app_private.command_correct_payment(p_usaha_id uuid, p_pembayaran_id uuid, p_action_type text, p_reason text, p_idempotency_key text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid:=auth.uid();
  v_admin_id uuid;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_payment public.pembayaran%ROWTYPE;
  v_transaction public.transaksi_keuangan%ROWTYPE;
  v_correction_id uuid:=gen_random_uuid();
  v_correction_number text;
  v_replacement_transaction_id uuid;
  v_replacement_transaction_number text;
  v_action text:=lower(btrim(coalesce(p_action_type,'')));
  v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
  v_response jsonb;
  v_effective_at timestamptz:=now();
  v_timezone text;
BEGIN
  v_admin_id:=app_private.assert_finance_admin(p_usaha_id);

  IF p_pembayaran_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: pembayaran_id wajib diisi' USING ERRCODE='22023';
  END IF;
  IF v_action NOT IN ('void','reversal') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: action correction tidak didukung' USING ERRCODE='22023';
  END IF;
  IF v_reason IS NULL OR length(v_reason)<5 OR length(v_reason)>2000 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: alasan koreksi wajib 5-2000 karakter' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_payment
  FROM public.pembayaran p
  WHERE p.usaha_id=p_usaha_id AND p.pembayaran_id=p_pembayaran_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: pembayaran tidak ditemukan dalam usaha aktif' USING ERRCODE='P0002';
  END IF;
  IF v_payment.status<>'recorded' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: pembayaran sudah tidak berada pada status recorded' USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_transaction
  FROM public.transaksi_keuangan t
  WHERE t.usaha_id=p_usaha_id AND t.transaksi_keuangan_id=v_payment.transaksi_keuangan_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTEGRITY_ERROR: transaksi keuangan pasangan pembayaran tidak ditemukan' USING ERRCODE='23514';
  END IF;

  SELECT u.timezone INTO v_timezone FROM public.usaha u
  WHERE u.usaha_id=p_usaha_id AND u.status='active';
  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  v_request_hash:=md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'pembayaran_id',p_pembayaran_id,'action_type',v_action,'reason',v_reason
  )::text);

  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'correct_payment',v_request_hash)
  ON CONFLICT(usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body,ik.request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key ik
    WHERE ik.usaha_id=p_usaha_id AND ik.actor_auth_user_id=v_auth_user_id
      AND ik.command_name='correct_payment' AND ik.key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text,0));

  IF EXISTS (
    SELECT 1 FROM public.keuangan_koreksi k
    WHERE k.usaha_id=p_usaha_id AND k.target_type='payment' AND k.target_id=p_pembayaran_id
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: pembayaran sudah memiliki koreksi' USING ERRCODE='23505';
  END IF;

  v_correction_number:=app_private.next_business_number(
    p_usaha_id,'KOR',to_char(v_effective_at AT TIME ZONE v_timezone,'YYYY')
  );

  IF v_action='void' THEN
    INSERT INTO public.keuangan_koreksi(
      koreksi_keuangan_id,usaha_id,nomor_koreksi,target_type,target_id,action_type,reason,
      actor_akun_admin_id,request_id,effective_at
    ) VALUES (
      v_correction_id,p_usaha_id,v_correction_number,'payment',p_pembayaran_id,'void',v_reason,
      v_admin_id,p_request_id,v_effective_at
    );
    UPDATE public.pembayaran SET status='voided'
    WHERE usaha_id=p_usaha_id AND pembayaran_id=p_pembayaran_id;
    UPDATE public.transaksi_keuangan SET status='voided'
    WHERE usaha_id=p_usaha_id AND transaksi_keuangan_id=v_payment.transaksi_keuangan_id;
  ELSE
    v_replacement_transaction_id:=gen_random_uuid();
    v_replacement_transaction_number:=app_private.next_business_number(
      p_usaha_id,'TRX',to_char(v_effective_at AT TIME ZONE v_timezone,'YYYY')
    );

    INSERT INTO public.transaksi_keuangan(
      transaksi_keuangan_id,usaha_id,nomor_transaksi,jenis,arah,tanggal_transaksi,amount,currency_code,
      sumber_type,sumber_id,status,catatan
    ) VALUES (
      v_replacement_transaction_id,p_usaha_id,v_replacement_transaction_number,'finance_reversal',
      CASE WHEN v_transaction.arah='income' THEN 'expense' ELSE 'income' END,
      v_effective_at,v_transaction.amount,v_transaction.currency_code,
      'finance_correction',v_correction_id,'recorded',
      'Reversal '||v_transaction.nomor_transaksi||': '||v_reason
    );

    INSERT INTO public.keuangan_koreksi(
      koreksi_keuangan_id,usaha_id,nomor_koreksi,target_type,target_id,action_type,reason,
      replacement_transaksi_keuangan_id,actor_akun_admin_id,request_id,effective_at
    ) VALUES (
      v_correction_id,p_usaha_id,v_correction_number,'payment',p_pembayaran_id,'reversal',v_reason,
      v_replacement_transaction_id,v_admin_id,p_request_id,v_effective_at
    );

    UPDATE public.pembayaran SET status='reversed'
    WHERE usaha_id=p_usaha_id AND pembayaran_id=p_pembayaran_id;
    UPDATE public.transaksi_keuangan SET status='reversed'
    WHERE usaha_id=p_usaha_id AND transaksi_keuangan_id=v_payment.transaksi_keuangan_id;
  END IF;

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,
    change_summary,reason
  ) VALUES (
    p_usaha_id,v_auth_user_id,v_admin_id,
    CASE WHEN v_action='void' THEN 'void_payment' ELSE 'reverse_payment' END,
    'pembayaran',p_pembayaran_id,'admin-command',p_request_id,
    jsonb_build_object(
      'correction_id',v_correction_id,'correction_number',v_correction_number,'action_type',v_action,
      'transaction_id',v_payment.transaksi_keuangan_id,'replacement_transaction_id',v_replacement_transaction_id,
      'status_after',CASE WHEN v_action='void' THEN 'voided' ELSE 'reversed' END
    ),v_reason
  );

  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES(
    p_usaha_id,
    CASE WHEN v_action='void' THEN 'payment.voided' ELSE 'payment.reversed' END,
    'pembayaran',p_pembayaran_id,
    jsonb_build_object(
      'payment_id',p_pembayaran_id,'transaction_id',v_payment.transaksi_keuangan_id,
      'correction_id',v_correction_id,'correction_number',v_correction_number,
      'replacement_transaction_id',v_replacement_transaction_id,'action_type',v_action,'reason',v_reason
    )
  );

  v_response:=jsonb_build_object(
    'pembayaran_id',p_pembayaran_id,
    'status',CASE WHEN v_action='void' THEN 'voided' ELSE 'reversed' END,
    'correction_id',v_correction_id,
    'nomor_koreksi',v_correction_number,
    'replacement_transaksi_keuangan_id',v_replacement_transaction_id
  );

  UPDATE public.idempotency_key SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;

  RETURN v_response;
END;
$function$

CREATE OR REPLACE FUNCTION app_private.command_reconcile_expense(p_usaha_id uuid, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_row public.idempotency_key%ROWTYPE;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id dan idempotency_key wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id = aa.akun_admin_id
     AND ku.status = 'active'
     AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id = v_auth_user_id
      AND aa.status = 'active'
      AND aa.role = 'super_admin'
      AND ku.usaha_id = p_usaha_id
  ) THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses finance pada usaha' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_row
  FROM public.idempotency_key ik
  WHERE ik.usaha_id = p_usaha_id
    AND ik.actor_auth_user_id = v_auth_user_id
    AND ik.command_name = 'record_expense'
    AND ik.key = btrim(p_idempotency_key);

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'state', 'not_found',
      'response', null
    );
  END IF;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_row.response_body IS NULL THEN 'unknown' ELSE 'committed' END,
    'response', v_row.response_body
  );
END;
$function$

CREATE OR REPLACE FUNCTION app_private.command_reconcile_payment(p_usaha_id uuid, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_row public.idempotency_key%ROWTYPE;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id dan idempotency_key wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id = aa.akun_admin_id
     AND ku.status = 'active'
     AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id = v_auth_user_id
      AND aa.status = 'active'
      AND aa.role = 'super_admin'
      AND ku.usaha_id = p_usaha_id
  ) THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses finance pada usaha' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_row
  FROM public.idempotency_key ik
  WHERE ik.usaha_id = p_usaha_id
    AND ik.actor_auth_user_id = v_auth_user_id
    AND ik.command_name = 'record_payment'
    AND ik.key = btrim(p_idempotency_key);

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'state', 'not_found',
      'response', null
    );
  END IF;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_row.response_body IS NULL THEN 'unknown' ELSE 'committed' END,
    'response', v_row.response_body
  );
END;
$function$

CREATE OR REPLACE FUNCTION app_private.command_record_expense(p_usaha_id uuid, p_source_type text, p_source_id uuid, p_pemasok_id uuid, p_kategori_biaya text, p_deskripsi text, p_amount numeric, p_tanggal_pengeluaran date, p_bukti_storage_path text, p_catatan text, p_idempotency_key text, p_request_id uuid)
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
  v_expense_id uuid := gen_random_uuid();
  v_transaction_id uuid := gen_random_uuid();
  v_expense_number text;
  v_transaction_number text;
  v_source_type text := lower(btrim(coalesce(p_source_type, '')));
  v_category text := nullif(btrim(coalesce(p_kategori_biaya, '')), '');
  v_description text := nullif(btrim(coalesce(p_deskripsi, '')), '');
  v_note text := nullif(btrim(coalesce(p_catatan, '')), '');
  v_evidence text := nullif(btrim(coalesce(p_bukti_storage_path, '')), '');
  v_expense_date date := coalesce(p_tanggal_pengeluaran, current_date);
  v_response jsonb;
  v_timezone text;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF v_source_type NOT IN ('purchase', 'maintenance', 'operational', 'other', 'manual') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: sumber pengeluaran tidak didukung' USING ERRCODE = '22023';
  END IF;

  IF p_source_id IS NULL AND v_source_type IN ('purchase', 'maintenance') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: source id wajib untuk pengeluaran berbasis source' USING ERRCODE = '22023';
  END IF;

  IF p_source_id IS NOT NULL AND v_source_type IN ('operational', 'other', 'manual') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: source id tidak boleh diisi untuk pengeluaran manual/operasional' USING ERRCODE = '22023';
  END IF;

  IF v_category IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: kategori biaya wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF v_description IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: deskripsi pengeluaran wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: nominal pengeluaran harus lebih dari 0' USING ERRCODE = '22023';
  END IF;

  SELECT aa.akun_admin_id
  INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id = aa.akun_admin_id
   AND ku.status = 'active'
   AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id = v_auth_user_id
    AND aa.status = 'active'
    AND aa.role = 'super_admin'
    AND ku.usaha_id = p_usaha_id;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses finance pada usaha' USING ERRCODE = '42501';
  END IF;

  IF v_source_type = 'purchase'
     AND NOT EXISTS (
       SELECT 1
       FROM public.pembelian p
       WHERE p.usaha_id = p_usaha_id
         AND p.pembelian_id = p_source_id
     )
  THEN
    RAISE EXCEPTION 'NOT_FOUND: pembelian source tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  IF v_source_type = 'maintenance'
     AND NOT EXISTS (
       SELECT 1
       FROM public.perawatan m
       WHERE m.usaha_id = p_usaha_id
         AND m.perawatan_id = p_source_id
     )
  THEN
    RAISE EXCEPTION 'NOT_FOUND: maintenance source tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  IF p_pemasok_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.pemasok s
       WHERE s.usaha_id = p_usaha_id
         AND s.pemasok_id = p_pemasok_id
     )
  THEN
    RAISE EXCEPTION 'NOT_FOUND: pemasok tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  IF v_evidence IS NOT NULL
     AND NOT app_private.storage_path_has_usaha_access(v_evidence)
  THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: path bukti pengeluaran tidak berada pada tenant aktif' USING ERRCODE = '42501';
  END IF;

  SELECT u.timezone
  INTO v_timezone
  FROM public.usaha u
  WHERE u.usaha_id = p_usaha_id
    AND u.status = 'active';

  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  v_request_hash := md5(
    jsonb_build_object(
      'usaha_id', p_usaha_id,
      'source_type', v_source_type,
      'source_id', p_source_id,
      'pemasok_id', p_pemasok_id,
      'kategori_biaya', v_category,
      'deskripsi', v_description,
      'amount', p_amount,
      'tanggal_pengeluaran', v_expense_date,
      'bukti_storage_path', v_evidence,
      'catatan', v_note
    )::text
  );

  INSERT INTO public.idempotency_key (
    usaha_id,
    actor_auth_user_id,
    key,
    command_name,
    request_hash
  )
  VALUES (
    p_usaha_id,
    v_auth_user_id,
    btrim(p_idempotency_key),
    'record_expense',
    v_request_hash
  )
  ON CONFLICT (usaha_id, actor_auth_user_id, command_name, key)
  DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body, ik.request_hash
    INTO v_existing_response, v_existing_hash
    FROM public.idempotency_key ik
    WHERE ik.usaha_id = p_usaha_id
      AND ik.actor_auth_user_id = v_auth_user_id
      AND ik.command_name = 'record_expense'
      AND ik.key = btrim(p_idempotency_key);

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE = '23505';
    END IF;

    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;

    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE = '40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text, 0));

  v_expense_number := app_private.next_business_number(
    p_usaha_id,
    'EXP',
    to_char(v_expense_date, 'YYYY')
  );

  v_transaction_number := app_private.next_business_number(
    p_usaha_id,
    'TRX',
    to_char(v_expense_date, 'YYYY')
  );

  INSERT INTO public.transaksi_keuangan (
    transaksi_keuangan_id,
    usaha_id,
    nomor_transaksi,
    jenis,
    arah,
    tanggal_transaksi,
    amount,
    currency_code,
    sumber_type,
    sumber_id,
    status,
    catatan
  )
  VALUES (
    v_transaction_id,
    p_usaha_id,
    v_transaction_number,
    'expense',
    'expense',
    (v_expense_date::text || ' 00:00:00 ' || v_timezone)::timestamptz,
    p_amount,
    'IDR',
    v_source_type,
    p_source_id,
    'recorded',
    coalesce(v_description || CASE WHEN v_note IS NOT NULL THEN E'
' || v_note ELSE '' END, v_note)
  );

  INSERT INTO public.pengeluaran (
    pengeluaran_id,
    usaha_id,
    transaksi_keuangan_id,
    pemasok_id,
    kategori_biaya,
    deskripsi,
    amount,
    currency_code,
    tanggal_pengeluaran,
    bukti_storage_path
  )
  VALUES (
    v_expense_id,
    p_usaha_id,
    v_transaction_id,
    p_pemasok_id,
    v_category,
    v_description,
    p_amount,
    'IDR',
    v_expense_date,
    v_evidence
  );

  INSERT INTO public.audit_log (
    usaha_id,
    actor_auth_user_id,
    actor_akun_admin_id,
    action,
    entity_type,
    entity_id,
    source_application,
    request_id,
    change_summary
  )
  VALUES (
    p_usaha_id,
    v_auth_user_id,
    v_admin_id,
    'record_expense',
    'pengeluaran',
    v_expense_id,
    'admin-command',
    p_request_id,
    jsonb_build_object(
      'expense_number', v_expense_number,
      'transaction_id', v_transaction_id,
      'transaction_number', v_transaction_number,
      'source_type', v_source_type,
      'source_id', p_source_id,
      'pemasok_id', p_pemasok_id,
      'category', v_category,
      'amount', p_amount,
      'currency_code', 'IDR',
      'date', v_expense_date,
      'status', 'recorded'
    )
  );

  INSERT INTO public.outbox_event (
    usaha_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload
  )
  VALUES (
    p_usaha_id,
    'expense.recorded',
    'pengeluaran',
    v_expense_id,
    jsonb_build_object(
      'expense_id', v_expense_id,
      'expense_number', v_expense_number,
      'transaction_id', v_transaction_id,
      'transaction_number', v_transaction_number,
      'source_type', v_source_type,
      'source_id', p_source_id
    )
  );

  v_response := jsonb_build_object(
    'pengeluaran_id', v_expense_id,
    'nomor_pengeluaran', v_expense_number,
    'transaksi_keuangan_id', v_transaction_id,
    'nomor_transaksi', v_transaction_number,
    'status', 'recorded',
    'source_type', v_source_type,
    'source_id', p_source_id,
    'amount', p_amount,
    'currency_code', 'IDR',
    'tanggal_pengeluaran', v_expense_date
  );

  UPDATE public.idempotency_key
  SET response_status = 200,
      response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$

CREATE OR REPLACE FUNCTION app_private.command_record_payment(p_usaha_id uuid, p_reservasi_id uuid, p_penyewaan_id uuid, p_jenis text, p_metode text, p_amount numeric, p_dibayar_at timestamp with time zone, p_reference_text text, p_catatan text, p_idempotency_key text, p_request_id uuid)
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
  v_payment_id uuid := gen_random_uuid();
  v_transaction_id uuid := gen_random_uuid();
  v_payment_number text;
  v_transaction_number text;
  v_payment_type text := lower(btrim(coalesce(p_jenis, '')));
  v_payment_method text := lower(btrim(coalesce(p_metode, '')));
  v_reference text := nullif(btrim(coalesce(p_reference_text, '')), '');
  v_note text := nullif(btrim(coalesce(p_catatan, '')), '');
  v_paid_at timestamptz := coalesce(p_dibayar_at, now());
  v_source_type text;
  v_source_id uuid;
  v_response jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF p_reservasi_id IS NULL AND p_penyewaan_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: pembayaran wajib terhubung ke reservasi atau penyewaan' USING ERRCODE = '22023';
  END IF;

  IF p_reservasi_id IS NOT NULL AND p_penyewaan_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.penyewaan r
       WHERE r.usaha_id = p_usaha_id
         AND r.penyewaan_id = p_penyewaan_id
         AND r.reservasi_id = p_reservasi_id
     )
  THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: reservasi dan penyewaan tidak memiliki hubungan yang konsisten' USING ERRCODE = '23514';
  END IF;

  IF v_payment_type NOT IN ('dp', 'pelunasan', 'pembayaran_tambahan') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: jenis pembayaran tidak didukung' USING ERRCODE = '22023';
  END IF;

  IF v_payment_method NOT IN ('cash', 'bank_transfer', 'qris_manual', 'other') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: metode pembayaran tidak didukung' USING ERRCODE = '22023';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: nominal pembayaran harus lebih dari 0' USING ERRCODE = '22023';
  END IF;

  SELECT aa.akun_admin_id
  INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id = aa.akun_admin_id
   AND ku.status = 'active'
   AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id = v_auth_user_id
    AND aa.status = 'active'
    AND aa.role = 'super_admin'
    AND ku.usaha_id = p_usaha_id;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses finance pada usaha' USING ERRCODE = '42501';
  END IF;

  IF p_reservasi_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.reservasi r
       WHERE r.usaha_id = p_usaha_id
         AND r.reservasi_id = p_reservasi_id
     )
  THEN
    RAISE EXCEPTION 'NOT_FOUND: reservasi tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  IF p_penyewaan_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.penyewaan r
       WHERE r.usaha_id = p_usaha_id
         AND r.penyewaan_id = p_penyewaan_id
     )
  THEN
    RAISE EXCEPTION 'NOT_FOUND: penyewaan tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  IF p_penyewaan_id IS NOT NULL THEN
    v_source_type := 'rental';
    v_source_id := p_penyewaan_id;
  ELSE
    v_source_type := 'reservation';
    v_source_id := p_reservasi_id;
  END IF;

  v_request_hash := md5(
    jsonb_build_object(
      'usaha_id', p_usaha_id,
      'reservasi_id', p_reservasi_id,
      'penyewaan_id', p_penyewaan_id,
      'jenis', v_payment_type,
      'metode', v_payment_method,
      'amount', p_amount,
      'dibayar_at', v_paid_at,
      'reference_text', v_reference,
      'catatan', v_note
    )::text
  );

  INSERT INTO public.idempotency_key (
    usaha_id,
    actor_auth_user_id,
    key,
    command_name,
    request_hash
  )
  VALUES (
    p_usaha_id,
    v_auth_user_id,
    btrim(p_idempotency_key),
    'record_payment',
    v_request_hash
  )
  ON CONFLICT (usaha_id, actor_auth_user_id, command_name, key)
  DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body, ik.request_hash
    INTO v_existing_response, v_existing_hash
    FROM public.idempotency_key ik
    WHERE ik.usaha_id = p_usaha_id
      AND ik.actor_auth_user_id = v_auth_user_id
      AND ik.command_name = 'record_payment'
      AND ik.key = btrim(p_idempotency_key);

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE = '23505';
    END IF;

    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;

    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE = '40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text, 0));

  v_payment_number := app_private.next_business_number(
    p_usaha_id,
    'PAY',
    to_char(v_paid_at AT TIME ZONE (SELECT u.timezone FROM public.usaha u WHERE u.usaha_id = p_usaha_id), 'YYYY')
  );

  v_transaction_number := app_private.next_business_number(
    p_usaha_id,
    'TRX',
    to_char(v_paid_at AT TIME ZONE (SELECT u.timezone FROM public.usaha u WHERE u.usaha_id = p_usaha_id), 'YYYY')
  );

  INSERT INTO public.transaksi_keuangan (
    transaksi_keuangan_id,
    usaha_id,
    nomor_transaksi,
    jenis,
    arah,
    tanggal_transaksi,
    amount,
    currency_code,
    sumber_type,
    sumber_id,
    status,
    catatan
  )
  VALUES (
    v_transaction_id,
    p_usaha_id,
    v_transaction_number,
    'rental_payment',
    'income',
    v_paid_at,
    p_amount,
    'IDR',
    v_source_type,
    v_source_id,
    'recorded',
    v_note
  );

  INSERT INTO public.pembayaran (
    pembayaran_id,
    usaha_id,
    reservasi_id,
    penyewaan_id,
    transaksi_keuangan_id,
    nomor_pembayaran,
    jenis,
    metode,
    amount,
    currency_code,
    dibayar_at,
    dicatat_by_admin_id,
    reference_text,
    catatan,
    status
  )
  VALUES (
    v_payment_id,
    p_usaha_id,
    p_reservasi_id,
    p_penyewaan_id,
    v_transaction_id,
    v_payment_number,
    v_payment_type,
    v_payment_method,
    p_amount,
    'IDR',
    v_paid_at,
    v_admin_id,
    v_reference,
    v_note,
    'recorded'
  );

  INSERT INTO public.audit_log (
    usaha_id,
    actor_auth_user_id,
    actor_akun_admin_id,
    action,
    entity_type,
    entity_id,
    source_application,
    request_id,
    change_summary
  )
  VALUES (
    p_usaha_id,
    v_auth_user_id,
    v_admin_id,
    'record_payment',
    'pembayaran',
    v_payment_id,
    'admin-command',
    p_request_id,
    jsonb_build_object(
      'payment_number', v_payment_number,
      'transaction_id', v_transaction_id,
      'transaction_number', v_transaction_number,
      'source_type', v_source_type,
      'source_id', v_source_id,
      'amount', p_amount,
      'currency_code', 'IDR',
      'jenis', v_payment_type,
      'metode', v_payment_method,
      'status', 'recorded'
    )
  );

  INSERT INTO public.outbox_event (
    usaha_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload
  )
  VALUES (
    p_usaha_id,
    'payment.recorded',
    'pembayaran',
    v_payment_id,
    jsonb_build_object(
      'payment_id', v_payment_id,
      'payment_number', v_payment_number,
      'transaction_id', v_transaction_id,
      'transaction_number', v_transaction_number,
      'source_type', v_source_type,
      'source_id', v_source_id
    )
  );

  v_response := jsonb_build_object(
    'pembayaran_id', v_payment_id,
    'nomor_pembayaran', v_payment_number,
    'transaksi_keuangan_id', v_transaction_id,
    'nomor_transaksi', v_transaction_number,
    'status', 'recorded',
    'source_type', v_source_type,
    'source_id', v_source_id,
    'amount', p_amount,
    'currency_code', 'IDR',
    'dibayar_at', v_paid_at
  );

  UPDATE public.idempotency_key
  SET response_status = 200,
      response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$

CREATE OR REPLACE FUNCTION app_private.finance_expense_analysis(p_usaha_id uuid, p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid;
  v_timezone text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_by_category jsonb;
  v_by_supplier jsonb;
  v_by_source jsonb;
BEGIN
  v_admin_id:=app_private.assert_finance_admin(p_usaha_id);
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date<=p_start_date THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: periode tidak valid' USING ERRCODE='22023';
  END IF;
  SELECT u.timezone INTO v_timezone FROM public.usaha u WHERE u.usaha_id=p_usaha_id AND u.status='active';
  IF v_timezone IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002'; END IF;
  v_start_at:=(p_start_date::text||' 00:00:00 '||v_timezone)::timestamptz;
  v_end_at:=(p_end_date::text||' 00:00:00 '||v_timezone)::timestamptz;

  SELECT coalesce(jsonb_agg(jsonb_build_object('kategori_biaya',x.kategori_biaya,'amount',x.amount,'count',x.record_count) ORDER BY x.amount DESC),'[]'::jsonb)
  INTO v_by_category
  FROM (
    SELECT e.kategori_biaya,sum(e.amount) amount,count(*) record_count
    FROM public.pengeluaran e
    JOIN public.transaksi_keuangan t ON t.usaha_id=e.usaha_id AND t.transaksi_keuangan_id=e.transaksi_keuangan_id
    WHERE e.usaha_id=p_usaha_id AND t.status='recorded' AND t.tanggal_transaksi>=v_start_at AND t.tanggal_transaksi<v_end_at
    GROUP BY e.kategori_biaya
  ) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('pemasok_id',x.pemasok_id,'amount',x.amount,'count',x.record_count) ORDER BY x.amount DESC),'[]'::jsonb)
  INTO v_by_supplier
  FROM (
    SELECT e.pemasok_id,sum(e.amount) amount,count(*) record_count
    FROM public.pengeluaran e
    JOIN public.transaksi_keuangan t ON t.usaha_id=e.usaha_id AND t.transaksi_keuangan_id=e.transaksi_keuangan_id
    WHERE e.usaha_id=p_usaha_id AND t.status='recorded' AND t.tanggal_transaksi>=v_start_at AND t.tanggal_transaksi<v_end_at
    GROUP BY e.pemasok_id
  ) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('source_type',x.source_type,'amount',x.amount,'count',x.record_count) ORDER BY x.amount DESC),'[]'::jsonb)
  INTO v_by_source
  FROM (
    SELECT t.sumber_type source_type,sum(t.amount) amount,count(*) record_count
    FROM public.pengeluaran e
    JOIN public.transaksi_keuangan t ON t.usaha_id=e.usaha_id AND t.transaksi_keuangan_id=e.transaksi_keuangan_id
    WHERE e.usaha_id=p_usaha_id AND t.status='recorded' AND t.tanggal_transaksi>=v_start_at AND t.tanggal_transaksi<v_end_at
    GROUP BY t.sumber_type
  ) x;

  RETURN jsonb_build_object(
    'period',jsonb_build_object('start_date',p_start_date,'end_date_exclusive',p_end_date,'timezone',v_timezone),
    'by_category',v_by_category,'by_supplier',v_by_supplier,'by_source',v_by_source,
    'note','Purchase dan maintenance hanya menjadi expense saat telah direpresentasikan oleh transaksi Finance.'
  );
END;
$function$

CREATE OR REPLACE FUNCTION app_private.finance_expense_page(p_usaha_id uuid, p_start_date date, p_end_date date, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid;
  v_timezone text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_limit integer:=least(greatest(coalesce(p_limit,50),1),200);
  v_offset integer:=greatest(coalesce(p_offset,0),0);
  v_total bigint;
  v_items jsonb;
BEGIN
  v_admin_id:=app_private.assert_finance_admin(p_usaha_id);
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date<=p_start_date THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: periode tidak valid' USING ERRCODE='22023';
  END IF;
  SELECT u.timezone INTO v_timezone FROM public.usaha u WHERE u.usaha_id=p_usaha_id AND u.status='active';
  IF v_timezone IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002'; END IF;
  v_start_at:=(p_start_date::text||' 00:00:00 '||v_timezone)::timestamptz;
  v_end_at:=(p_end_date::text||' 00:00:00 '||v_timezone)::timestamptz;
  SELECT count(*) INTO v_total
  FROM public.pengeluaran e
  JOIN public.transaksi_keuangan t ON t.usaha_id=e.usaha_id AND t.transaksi_keuangan_id=e.transaksi_keuangan_id
  WHERE e.usaha_id=p_usaha_id AND t.tanggal_transaksi>=v_start_at AND t.tanggal_transaksi<v_end_at;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'pengeluaran_id',x.pengeluaran_id,'transaksi_keuangan_id',x.transaksi_keuangan_id,
      'pemasok_id',x.pemasok_id,'kategori_biaya',x.kategori_biaya,'deskripsi',x.deskripsi,
      'amount',x.amount,'currency_code',x.currency_code,'tanggal_pengeluaran',x.tanggal_pengeluaran,
      'bukti_storage_path',x.bukti_storage_path,'transaction_status',x.transaction_status
    ) ORDER BY x.transaction_date DESC,x.pengeluaran_id DESC),'[]'::jsonb)
  INTO v_items
  FROM (
    SELECT e.*,t.status AS transaction_status,t.tanggal_transaksi AS transaction_date
    FROM public.pengeluaran e
    JOIN public.transaksi_keuangan t ON t.usaha_id=e.usaha_id AND t.transaksi_keuangan_id=e.transaksi_keuangan_id
    WHERE e.usaha_id=p_usaha_id AND t.tanggal_transaksi>=v_start_at AND t.tanggal_transaksi<v_end_at
    ORDER BY t.tanggal_transaksi DESC,e.pengeluaran_id DESC
    LIMIT v_limit OFFSET v_offset
  ) x;
  RETURN jsonb_build_object(
    'period',jsonb_build_object('start_date',p_start_date,'end_date_exclusive',p_end_date,'timezone',v_timezone),
    'items',v_items,'total',v_total,'limit',v_limit,'offset',v_offset,'has_more',(v_offset+v_limit)<v_total
  );
END;
$function$

CREATE OR REPLACE FUNCTION app_private.finance_payment_page(p_usaha_id uuid, p_start_date date, p_end_date date, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid;
  v_timezone text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_limit integer:=least(greatest(coalesce(p_limit,50),1),200);
  v_offset integer:=greatest(coalesce(p_offset,0),0);
  v_total bigint;
  v_items jsonb;
BEGIN
  v_admin_id:=app_private.assert_finance_admin(p_usaha_id);
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date<=p_start_date THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: periode tidak valid' USING ERRCODE='22023';
  END IF;
  SELECT u.timezone INTO v_timezone FROM public.usaha u WHERE u.usaha_id=p_usaha_id AND u.status='active';
  IF v_timezone IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002'; END IF;
  v_start_at:=(p_start_date::text||' 00:00:00 '||v_timezone)::timestamptz;
  v_end_at:=(p_end_date::text||' 00:00:00 '||v_timezone)::timestamptz;
  SELECT count(*) INTO v_total FROM public.pembayaran p
  WHERE p.usaha_id=p_usaha_id AND p.dibayar_at>=v_start_at AND p.dibayar_at<v_end_at;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'pembayaran_id',x.pembayaran_id,'nomor_pembayaran',x.nomor_pembayaran,
      'reservasi_id',x.reservasi_id,'penyewaan_id',x.penyewaan_id,'transaksi_keuangan_id',x.transaksi_keuangan_id,
      'jenis',x.jenis,'metode',x.metode,'amount',x.amount,'currency_code',x.currency_code,
      'dibayar_at',x.dibayar_at,'status',x.status,'reference_text',x.reference_text,'catatan',x.catatan
    ) ORDER BY x.dibayar_at DESC,x.pembayaran_id DESC),'[]'::jsonb)
  INTO v_items
  FROM (
    SELECT p.* FROM public.pembayaran p
    WHERE p.usaha_id=p_usaha_id AND p.dibayar_at>=v_start_at AND p.dibayar_at<v_end_at
    ORDER BY p.dibayar_at DESC,p.pembayaran_id DESC
    LIMIT v_limit OFFSET v_offset
  ) x;
  RETURN jsonb_build_object(
    'period',jsonb_build_object('start_date',p_start_date,'end_date_exclusive',p_end_date,'timezone',v_timezone),
    'items',v_items,'total',v_total,'limit',v_limit,'offset',v_offset,'has_more',(v_offset+v_limit)<v_total
  );
END;
$function$

CREATE OR REPLACE FUNCTION app_private.finance_reconciliation(p_usaha_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid;
  v_payment_orphan bigint:=0;
  v_expense_orphan bigint:=0;
  v_payment_status_mismatch bigint:=0;
  v_payment_amount_mismatch bigint:=0;
  v_expense_amount_mismatch bigint:=0;
  v_expense_direction_mismatch bigint:=0;
  v_transaction_missing_source bigint:=0;
  v_expense_source_missing bigint:=0;
  v_correction_target_status_mismatch bigint:=0;
  v_correction_replacement_invalid bigint:=0;
  v_finance_outbox_pending bigint:=0;
  v_finance_outbox_failed bigint:=0;
  v_finance_idempotency_unknown bigint:=0;
  v_duplicate_payment_reference_candidates bigint:=0;
  v_status text;
BEGIN
  v_admin_id:=app_private.assert_finance_admin(p_usaha_id);

  SELECT count(*) INTO v_payment_orphan
  FROM public.pembayaran p
  LEFT JOIN public.transaksi_keuangan t
    ON t.usaha_id=p.usaha_id AND t.transaksi_keuangan_id=p.transaksi_keuangan_id
  WHERE p.usaha_id=p_usaha_id AND t.transaksi_keuangan_id IS NULL;

  SELECT count(*) INTO v_expense_orphan
  FROM public.pengeluaran e
  LEFT JOIN public.transaksi_keuangan t
    ON t.usaha_id=e.usaha_id AND t.transaksi_keuangan_id=e.transaksi_keuangan_id
  WHERE e.usaha_id=p_usaha_id AND t.transaksi_keuangan_id IS NULL;

  SELECT count(*) INTO v_payment_status_mismatch
  FROM public.pembayaran p
  JOIN public.transaksi_keuangan t
    ON t.usaha_id=p.usaha_id AND t.transaksi_keuangan_id=p.transaksi_keuangan_id
  WHERE p.usaha_id=p_usaha_id AND p.status IS DISTINCT FROM t.status;

  SELECT count(*) INTO v_payment_amount_mismatch
  FROM public.pembayaran p
  JOIN public.transaksi_keuangan t
    ON t.usaha_id=p.usaha_id AND t.transaksi_keuangan_id=p.transaksi_keuangan_id
  WHERE p.usaha_id=p_usaha_id
    AND (p.amount IS DISTINCT FROM t.amount OR p.currency_code IS DISTINCT FROM t.currency_code);

  SELECT count(*) INTO v_expense_amount_mismatch
  FROM public.pengeluaran e
  JOIN public.transaksi_keuangan t
    ON t.usaha_id=e.usaha_id AND t.transaksi_keuangan_id=e.transaksi_keuangan_id
  WHERE e.usaha_id=p_usaha_id
    AND (e.amount IS DISTINCT FROM t.amount OR e.currency_code IS DISTINCT FROM t.currency_code);

  SELECT count(*) INTO v_expense_direction_mismatch
  FROM public.pengeluaran e
  JOIN public.transaksi_keuangan t
    ON t.usaha_id=e.usaha_id AND t.transaksi_keuangan_id=e.transaksi_keuangan_id
  WHERE e.usaha_id=p_usaha_id AND t.arah<>'expense';

  SELECT count(*) INTO v_transaction_missing_source
  FROM public.transaksi_keuangan t
  WHERE t.usaha_id=p_usaha_id
    AND t.status='recorded'
    AND (
      t.sumber_type IS NULL
      OR (
        t.sumber_type NOT IN ('manual','operational','other')
        AND t.sumber_id IS NULL
      )
    );

  SELECT count(*) INTO v_expense_source_missing
  FROM public.pengeluaran e
  JOIN public.transaksi_keuangan t
    ON t.usaha_id=e.usaha_id AND t.transaksi_keuangan_id=e.transaksi_keuangan_id
  WHERE e.usaha_id=p_usaha_id
    AND (
      (t.sumber_type='purchase' AND NOT EXISTS (
        SELECT 1 FROM public.pembelian p
        WHERE p.usaha_id=e.usaha_id AND p.pembelian_id=t.sumber_id
      ))
      OR
      (t.sumber_type='maintenance' AND NOT EXISTS (
        SELECT 1 FROM public.perawatan m
        WHERE m.usaha_id=e.usaha_id AND m.perawatan_id=t.sumber_id
      ))
      OR
      t.sumber_type IS NULL
      OR t.sumber_type NOT IN ('purchase','maintenance','operational','other','manual')
    );

  SELECT count(*) INTO v_correction_target_status_mismatch
  FROM public.keuangan_koreksi k
  LEFT JOIN public.pembayaran p
    ON k.target_type='payment' AND p.usaha_id=k.usaha_id AND p.pembayaran_id=k.target_id
  LEFT JOIN public.pengeluaran e
    ON k.target_type='expense' AND e.usaha_id=k.usaha_id AND e.pengeluaran_id=k.target_id
  LEFT JOIN public.transaksi_keuangan tp
    ON k.target_type='payment' AND tp.usaha_id=k.usaha_id AND p.transaksi_keuangan_id=tp.transaksi_keuangan_id
  LEFT JOIN public.transaksi_keuangan te
    ON k.target_type='expense' AND te.usaha_id=k.usaha_id AND e.transaksi_keuangan_id=te.transaksi_keuangan_id
  WHERE k.usaha_id=p_usaha_id
    AND (
      (k.target_type='payment' AND (p.pembayaran_id IS NULL OR tp.status IS DISTINCT FROM CASE WHEN k.action_type='void' THEN 'voided' ELSE 'reversed' END))
      OR
      (k.target_type='expense' AND (e.pengeluaran_id IS NULL OR te.status IS DISTINCT FROM CASE WHEN k.action_type='void' THEN 'voided' ELSE 'reversed' END))
    );

  SELECT count(*) INTO v_correction_replacement_invalid
  FROM public.keuangan_koreksi k
  LEFT JOIN public.transaksi_keuangan t
    ON t.usaha_id=k.usaha_id AND t.transaksi_keuangan_id=k.replacement_transaksi_keuangan_id
  WHERE k.usaha_id=p_usaha_id
    AND (
      (k.action_type='void' AND k.replacement_transaksi_keuangan_id IS NOT NULL)
      OR
      (k.action_type='reversal' AND (
        t.transaksi_keuangan_id IS NULL
        OR t.status<>'recorded'
        OR t.sumber_type<>'finance_correction'
        OR t.sumber_id IS DISTINCT FROM k.koreksi_keuangan_id
      ))
    );

  SELECT count(*) INTO v_finance_outbox_pending
  FROM public.outbox_event o
  WHERE o.usaha_id=p_usaha_id
    AND o.event_type IN ('payment.recorded','expense.recorded','payment.voided','payment.reversed','expense.voided','expense.reversed')
    AND o.status='pending';

  SELECT count(*) INTO v_finance_outbox_failed
  FROM public.outbox_event o
  WHERE o.usaha_id=p_usaha_id
    AND o.event_type IN ('payment.recorded','expense.recorded','payment.voided','payment.reversed','expense.voided','expense.reversed')
    AND o.status='failed';

  SELECT count(*) INTO v_finance_idempotency_unknown
  FROM public.idempotency_key i
  WHERE i.usaha_id=p_usaha_id
    AND i.command_name IN ('record_payment','record_expense','correct_payment','correct_expense')
    AND i.response_body IS NULL;

  SELECT count(*) INTO v_duplicate_payment_reference_candidates
  FROM (
    SELECT p.reference_text,p.amount,count(*) c
    FROM public.pembayaran p
    WHERE p.usaha_id=p_usaha_id
      AND p.status='recorded'
      AND nullif(btrim(p.reference_text),'') IS NOT NULL
    GROUP BY p.reference_text,p.amount HAVING count(*)>1
  ) d;

  v_status:=CASE
    WHEN v_payment_orphan+v_expense_orphan+v_payment_status_mismatch+v_payment_amount_mismatch+
         v_expense_amount_mismatch+v_expense_direction_mismatch+v_transaction_missing_source+
         v_expense_source_missing+v_correction_target_status_mismatch+v_correction_replacement_invalid+
         v_finance_outbox_failed+v_finance_idempotency_unknown>0
      THEN 'UNHEALTHY'
    WHEN v_finance_outbox_pending+v_duplicate_payment_reference_candidates>0 THEN 'ATTENTION'
    ELSE 'HEALTHY'
  END;

  RETURN jsonb_build_object(
    'status',v_status,
    'critical',jsonb_build_object(
      'payment_orphan',v_payment_orphan,
      'expense_orphan',v_expense_orphan,
      'payment_status_mismatch',v_payment_status_mismatch,
      'payment_amount_mismatch',v_payment_amount_mismatch,
      'expense_amount_mismatch',v_expense_amount_mismatch,
      'expense_direction_mismatch',v_expense_direction_mismatch,
      'transaction_missing_source',v_transaction_missing_source,
      'expense_source_missing',v_expense_source_missing,
      'correction_target_status_mismatch',v_correction_target_status_mismatch,
      'correction_replacement_invalid',v_correction_replacement_invalid,
      'finance_outbox_failed',v_finance_outbox_failed,
      'finance_idempotency_unknown',v_finance_idempotency_unknown
    ),
    'attention',jsonb_build_object(
      'finance_outbox_pending',v_finance_outbox_pending,
      'duplicate_payment_reference_candidates',v_duplicate_payment_reference_candidates
    ),
    'principle','Every payment has source+transaction; every expense has context+transaction; every transaction is tenant-scoped and auditable; every correction preserves history.'
  );
END;
$function$

CREATE OR REPLACE FUNCTION app_private.finance_reconciliation_findings(p_usaha_id uuid, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid;
  v_limit integer:=least(greatest(coalesce(p_limit,100),1),500);
  v_items jsonb;
BEGIN
  v_admin_id:=app_private.assert_finance_admin(p_usaha_id);

  WITH findings AS (
    SELECT jsonb_build_object(
      'code','PAYMENT_STATUS_MISMATCH','severity','critical',
      'payment_id',p.pembayaran_id,'transaction_id',t.transaksi_keuangan_id,
      'payment_status',p.status,'transaction_status',t.status
    ) item
    FROM public.pembayaran p
    JOIN public.transaksi_keuangan t ON t.usaha_id=p.usaha_id AND t.transaksi_keuangan_id=p.transaksi_keuangan_id
    WHERE p.usaha_id=p_usaha_id AND p.status IS DISTINCT FROM t.status

    UNION ALL

    SELECT jsonb_build_object(
      'code','PAYMENT_AMOUNT_MISMATCH','severity','critical',
      'payment_id',p.pembayaran_id,'transaction_id',t.transaksi_keuangan_id,
      'payment_amount',p.amount,'transaction_amount',t.amount
    )
    FROM public.pembayaran p
    JOIN public.transaksi_keuangan t ON t.usaha_id=p.usaha_id AND t.transaksi_keuangan_id=p.transaksi_keuangan_id
    WHERE p.usaha_id=p_usaha_id AND (p.amount IS DISTINCT FROM t.amount OR p.currency_code IS DISTINCT FROM t.currency_code)

    UNION ALL

    SELECT jsonb_build_object(
      'code','FINANCE_OUTBOX_FAILED','severity','critical',
      'outbox_event_id',o.outbox_event_id,'event_type',o.event_type,
      'last_error',o.last_error,'attempt_count',o.attempt_count
    )
    FROM public.outbox_event o
    WHERE o.usaha_id=p_usaha_id
      AND o.event_type IN ('payment.recorded','expense.recorded','payment.voided','payment.reversed','expense.voided','expense.reversed')
      AND o.status='failed'

    UNION ALL

    SELECT jsonb_build_object(
      'code','FINANCE_OUTBOX_PENDING','severity','attention',
      'outbox_event_id',o.outbox_event_id,'event_type',o.event_type,
      'attempt_count',o.attempt_count,'next_attempt_at',o.next_attempt_at
    )
    FROM public.outbox_event o
    WHERE o.usaha_id=p_usaha_id
      AND o.event_type IN ('payment.recorded','expense.recorded','payment.voided','payment.reversed','expense.voided','expense.reversed')
      AND o.status='pending'
  )
  SELECT coalesce(jsonb_agg(item),'[]'::jsonb)
  INTO v_items
  FROM (
    SELECT item FROM findings LIMIT v_limit
  ) s;

  RETURN jsonb_build_object('items',v_items,'limit',v_limit);
END;
$function$

CREATE OR REPLACE FUNCTION app_private.finance_recorded_income_by_product(p_usaha_id uuid, p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid;
  v_timezone text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_items jsonb;
  v_total_income numeric:=0;
  v_exact_attributed numeric:=0;
BEGIN
  v_admin_id:=app_private.assert_finance_admin(p_usaha_id);
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date<=p_start_date THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: periode tidak valid' USING ERRCODE='22023';
  END IF;

  SELECT u.timezone INTO v_timezone
  FROM public.usaha u
  WHERE u.usaha_id=p_usaha_id AND u.status='active';

  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  v_start_at:=(p_start_date::text||' 00:00:00 '||v_timezone)::timestamptz;
  v_end_at:=(p_end_date::text||' 00:00:00 '||v_timezone)::timestamptz;

  SELECT coalesce(sum(t.amount),0) INTO v_total_income
  FROM public.transaksi_keuangan t
  WHERE t.usaha_id=p_usaha_id
    AND t.status='recorded'
    AND t.arah='income'
    AND t.sumber_type IN ('rental','reservation')
    AND t.tanggal_transaksi>=v_start_at
    AND t.tanggal_transaksi<v_end_at;

  WITH source_lines AS (
    SELECT
      t.transaksi_keuangan_id,
      t.amount AS recorded_income,
      dp.barang_id,
      dp.varian_barang_id,
      dp.subtotal AS detail_subtotal
    FROM public.transaksi_keuangan t
    JOIN public.detail_penyewaan dp
      ON dp.usaha_id=t.usaha_id AND dp.penyewaan_id=t.sumber_id
    WHERE t.usaha_id=p_usaha_id
      AND t.status='recorded'
      AND t.arah='income'
      AND t.sumber_type='rental'
      AND t.tanggal_transaksi>=v_start_at
      AND t.tanggal_transaksi<v_end_at
      AND (SELECT count(*) FROM public.detail_penyewaan dpx WHERE dpx.usaha_id=t.usaha_id AND dpx.penyewaan_id=t.sumber_id)=1
      AND (dp.barang_id IS NOT NULL OR dp.varian_barang_id IS NOT NULL)

    UNION ALL

    SELECT
      t.transaksi_keuangan_id,
      t.amount AS recorded_income,
      dr.barang_id,
      dr.varian_barang_id,
      coalesce(dr.subtotal,0) AS detail_subtotal
    FROM public.transaksi_keuangan t
    JOIN public.detail_reservasi dr
      ON dr.usaha_id=t.usaha_id AND dr.reservasi_id=t.sumber_id
    WHERE t.usaha_id=p_usaha_id
      AND t.status='recorded'
      AND t.arah='income'
      AND t.sumber_type='reservation'
      AND t.tanggal_transaksi>=v_start_at
      AND t.tanggal_transaksi<v_end_at
      AND (SELECT count(*) FROM public.detail_reservasi drx WHERE drx.usaha_id=t.usaha_id AND drx.reservasi_id=t.sumber_id)=1
      AND (dr.barang_id IS NOT NULL OR dr.varian_barang_id IS NOT NULL)
  ), grouped AS (
    SELECT
      barang_id,
      varian_barang_id,
      sum(recorded_income) AS recorded_income,
      sum(detail_subtotal) AS detail_value,
      count(distinct transaksi_keuangan_id) AS transaction_count
    FROM source_lines
    GROUP BY barang_id,varian_barang_id
  )
  SELECT
    coalesce((SELECT sum(recorded_income) FROM source_lines),0),
    coalesce(jsonb_agg(jsonb_build_object(
      'barang_id',g.barang_id,
      'varian_barang_id',g.varian_barang_id,
      'recorded_income_exact',g.recorded_income,
      'rental_detail_value',g.detail_value,
      'transaction_count',g.transaction_count,
      'attribution_status','exact_single_detail'
    ) ORDER BY g.recorded_income DESC),'[]'::jsonb)
  INTO v_exact_attributed,v_items
  FROM grouped g;

  RETURN jsonb_build_object(
    'period',jsonb_build_object('start_date',p_start_date,'end_date_exclusive',p_end_date,'timezone',v_timezone),
    'items',coalesce(v_items,'[]'::jsonb),
    'total_rental_or_reservation_income',v_total_income,
    'exact_attributable_income',v_exact_attributed,
    'unallocated_income',v_total_income-v_exact_attributed,
    'coverage_ratio',CASE WHEN v_total_income=0 THEN NULL ELSE round(v_exact_attributed/v_total_income,6) END,
    'allocation_policy','Exact only when source rental/reservation has exactly one detail line with product/variant. No proportional split is invented.'
  );
END;
$function$

CREATE OR REPLACE FUNCTION app_private.finance_recorded_income_by_unit(p_usaha_id uuid, p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid;
  v_timezone text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_items jsonb;
  v_total_income numeric:=0;
  v_exact_unit_income numeric:=0;
BEGIN
  v_admin_id:=app_private.assert_finance_admin(p_usaha_id);
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date<=p_start_date THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: periode tidak valid' USING ERRCODE='22023';
  END IF;
  SELECT u.timezone INTO v_timezone FROM public.usaha u WHERE u.usaha_id=p_usaha_id AND u.status='active';
  IF v_timezone IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002'; END IF;
  v_start_at:=(p_start_date::text||' 00:00:00 '||v_timezone)::timestamptz;
  v_end_at:=(p_end_date::text||' 00:00:00 '||v_timezone)::timestamptz;

  SELECT coalesce(sum(t.amount),0) INTO v_total_income
  FROM public.transaksi_keuangan t
  WHERE t.usaha_id=p_usaha_id AND t.status='recorded' AND t.arah='income' AND t.sumber_type='rental'
    AND t.tanggal_transaksi>=v_start_at AND t.tanggal_transaksi<v_end_at;

  WITH exact AS (
    SELECT t.transaksi_keuangan_id,t.amount AS payment_amount
    FROM public.transaksi_keuangan t
    JOIN public.detail_penyewaan dp ON dp.usaha_id=t.usaha_id AND dp.penyewaan_id=t.sumber_id
    JOIN public.penetapan_unit pu ON pu.usaha_id=dp.usaha_id AND pu.detail_penyewaan_id=dp.detail_penyewaan_id
    WHERE t.usaha_id=p_usaha_id AND t.status='recorded' AND t.arah='income' AND t.sumber_type='rental'
      AND t.tanggal_transaksi>=v_start_at AND t.tanggal_transaksi<v_end_at
      AND (SELECT count(*) FROM public.detail_penyewaan dpx WHERE dpx.usaha_id=t.usaha_id AND dpx.penyewaan_id=t.sumber_id)=1
      AND (SELECT count(*) FROM public.penetapan_unit pux WHERE pux.usaha_id=dp.usaha_id AND pux.detail_penyewaan_id=dp.detail_penyewaan_id)=1
  )
  SELECT coalesce(sum(payment_amount),0) INTO v_exact_unit_income FROM exact;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'unit_barang_id',x.unit_barang_id,'kode_unit',x.kode_unit,'barang_id',x.barang_id,
      'varian_barang_id',x.varian_barang_id,'recorded_income_exact',x.recorded_income,
      'transaction_count',x.transaction_count,'attribution_status','exact_single_detail_single_unit'
    ) ORDER BY x.recorded_income DESC),'[]'::jsonb)
  INTO v_items
  FROM (
    SELECT ub.unit_barang_id,ub.kode_unit,ub.barang_id,ub.varian_barang_id,
           sum(t.amount) recorded_income,count(distinct t.transaksi_keuangan_id) transaction_count
    FROM public.transaksi_keuangan t
    JOIN public.detail_penyewaan dp ON dp.usaha_id=t.usaha_id AND dp.penyewaan_id=t.sumber_id
    JOIN public.penetapan_unit pu ON pu.usaha_id=dp.usaha_id AND pu.detail_penyewaan_id=dp.detail_penyewaan_id
    JOIN public.unit_barang ub ON ub.usaha_id=pu.usaha_id AND ub.unit_barang_id=pu.unit_barang_id
    WHERE t.usaha_id=p_usaha_id AND t.status='recorded' AND t.arah='income' AND t.sumber_type='rental'
      AND t.tanggal_transaksi>=v_start_at AND t.tanggal_transaksi<v_end_at
      AND (SELECT count(*) FROM public.detail_penyewaan dpx WHERE dpx.usaha_id=t.usaha_id AND dpx.penyewaan_id=t.sumber_id)=1
      AND (SELECT count(*) FROM public.penetapan_unit pux WHERE pux.usaha_id=dp.usaha_id AND pux.detail_penyewaan_id=dp.detail_penyewaan_id)=1
    GROUP BY ub.unit_barang_id,ub.kode_unit,ub.barang_id,ub.varian_barang_id
  ) x;

  RETURN jsonb_build_object(
    'period',jsonb_build_object('start_date',p_start_date,'end_date_exclusive',p_end_date,'timezone',v_timezone),
    'items',coalesce(v_items,'[]'::jsonb),
    'total_rental_income',v_total_income,
    'exact_unit_attributable_income',v_exact_unit_income,
    'unallocated_or_ambiguous_income',v_total_income-v_exact_unit_income,
    'coverage_ratio',CASE WHEN v_total_income=0 THEN NULL ELSE round(v_exact_unit_income/v_total_income,6) END,
    'allocation_policy','Unit attribution is exact only when one rental detail maps to exactly one physical unit assignment. No arbitrary split is invented.'
  );
END;
$function$

CREATE OR REPLACE FUNCTION app_private.finance_summary(p_usaha_id uuid, p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid;
  v_timezone text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_income numeric:=0;
  v_expense numeric:=0;
  v_payment_amount numeric:=0;
  v_payment_count bigint:=0;
  v_income_count bigint:=0;
  v_expense_count bigint:=0;
  v_reversal_income numeric:=0;
  v_reversal_expense numeric:=0;
BEGIN
  v_admin_id:=app_private.assert_finance_admin(p_usaha_id);
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date<=p_start_date THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: periode harus valid dan end-exclusive' USING ERRCODE='22023';
  END IF;
  SELECT u.timezone INTO v_timezone FROM public.usaha u
  WHERE u.usaha_id=p_usaha_id AND u.status='active';
  IF v_timezone IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002'; END IF;

  v_start_at:=(p_start_date::text||' 00:00:00 '||v_timezone)::timestamptz;
  v_end_at:=(p_end_date::text||' 00:00:00 '||v_timezone)::timestamptz;

  SELECT
    coalesce(sum(CASE WHEN t.arah='income' THEN t.amount ELSE 0 END),0),
    coalesce(sum(CASE WHEN t.arah='expense' THEN t.amount ELSE 0 END),0),
    count(*) FILTER (WHERE t.arah='income'),
    count(*) FILTER (WHERE t.arah='expense'),
    coalesce(sum(CASE WHEN t.jenis='finance_reversal' AND t.arah='income' THEN t.amount ELSE 0 END),0),
    coalesce(sum(CASE WHEN t.jenis='finance_reversal' AND t.arah='expense' THEN t.amount ELSE 0 END),0)
  INTO v_income,v_expense,v_income_count,v_expense_count,v_reversal_income,v_reversal_expense
  FROM public.transaksi_keuangan t
  WHERE t.usaha_id=p_usaha_id AND t.status='recorded'
    AND t.tanggal_transaksi>=v_start_at AND t.tanggal_transaksi<v_end_at;

  SELECT coalesce(sum(p.amount),0),count(*) INTO v_payment_amount,v_payment_count
  FROM public.pembayaran p
  WHERE p.usaha_id=p_usaha_id AND p.status='recorded'
    AND p.dibayar_at>=v_start_at AND p.dibayar_at<v_end_at;

  RETURN jsonb_build_object(
    'period',jsonb_build_object('start_date',p_start_date,'end_date_exclusive',p_end_date,'timezone',v_timezone),
    'recorded_income',v_income,'recorded_expense',v_expense,'net_operational_movement',v_income-v_expense,
    'recorded_income_transaction_count',v_income_count,'recorded_expense_transaction_count',v_expense_count,
    'recorded_payment_amount',v_payment_amount,'recorded_payment_count',v_payment_count,
    'reversal_income_in_period',v_reversal_income,'reversal_expense_in_period',v_reversal_expense,
    'freshness',jsonb_build_object('mode','live_database_query','generated_at',clock_timestamp()),
    'source_note','Recorded payment dan financial transaction adalah fakta terpisah; jangan dijumlahkan. Formal accounting revenue/profit belum didefinisikan. Prior-period results may change until a financial-period closing policy is approved.'
  );
END;
$function$

CREATE OR REPLACE FUNCTION app_private.finance_transaction_page(p_usaha_id uuid, p_start_date date, p_end_date date, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid;
  v_timezone text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_limit integer:=least(greatest(coalesce(p_limit,50),1),200);
  v_offset integer:=greatest(coalesce(p_offset,0),0);
  v_total bigint;
  v_items jsonb;
BEGIN
  v_admin_id:=app_private.assert_finance_admin(p_usaha_id);
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date<=p_start_date THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: periode tidak valid' USING ERRCODE='22023';
  END IF;
  SELECT u.timezone INTO v_timezone FROM public.usaha u WHERE u.usaha_id=p_usaha_id AND u.status='active';
  IF v_timezone IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002'; END IF;
  v_start_at:=(p_start_date::text||' 00:00:00 '||v_timezone)::timestamptz;
  v_end_at:=(p_end_date::text||' 00:00:00 '||v_timezone)::timestamptz;
  SELECT count(*) INTO v_total FROM public.transaksi_keuangan t
  WHERE t.usaha_id=p_usaha_id AND t.tanggal_transaksi>=v_start_at AND t.tanggal_transaksi<v_end_at;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'transaksi_keuangan_id',x.transaksi_keuangan_id,'nomor_transaksi',x.nomor_transaksi,
      'jenis',x.jenis,'arah',x.arah,'tanggal_transaksi',x.tanggal_transaksi,'amount',x.amount,
      'currency_code',x.currency_code,'sumber_type',x.sumber_type,'sumber_id',x.sumber_id,
      'status',x.status,'catatan',x.catatan
    ) ORDER BY x.tanggal_transaksi DESC,x.transaksi_keuangan_id DESC),'[]'::jsonb)
  INTO v_items
  FROM (
    SELECT t.* FROM public.transaksi_keuangan t
    WHERE t.usaha_id=p_usaha_id AND t.tanggal_transaksi>=v_start_at AND t.tanggal_transaksi<v_end_at
    ORDER BY t.tanggal_transaksi DESC,t.transaksi_keuangan_id DESC
    LIMIT v_limit OFFSET v_offset
  ) x;
  RETURN jsonb_build_object(
    'period',jsonb_build_object('start_date',p_start_date,'end_date_exclusive',p_end_date,'timezone',v_timezone),
    'items',v_items,'total',v_total,'limit',v_limit,'offset',v_offset,'has_more',(v_offset+v_limit)<v_total
  );
END;
$function$

CREATE OR REPLACE FUNCTION app_private.validate_expense_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NEW.usaha_id IS DISTINCT FROM OLD.usaha_id
     OR NEW.transaksi_keuangan_id IS DISTINCT FROM OLD.transaksi_keuangan_id
     OR NEW.pemasok_id IS DISTINCT FROM OLD.pemasok_id
     OR NEW.kategori_biaya IS DISTINCT FROM OLD.kategori_biaya
     OR NEW.deskripsi IS DISTINCT FROM OLD.deskripsi
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
     OR NEW.tanggal_pengeluaran IS DISTINCT FROM OLD.tanggal_pengeluaran
     OR NEW.bukti_storage_path IS DISTINCT FROM OLD.bukti_storage_path
  THEN
    RAISE EXCEPTION 'Expense core facts are immutable; use a compensating/correction workflow';
  END IF;

  RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION public.command_correct_expense(p_usaha_id uuid, p_pengeluaran_id uuid, p_action_type text, p_reason text, p_idempotency_key text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  SELECT app_private.command_correct_expense(
    p_usaha_id,
    p_pengeluaran_id,
    p_action_type,
    p_reason,
    p_idempotency_key,
    p_request_id
  );
$function$

CREATE OR REPLACE FUNCTION public.command_correct_payment(p_usaha_id uuid, p_pembayaran_id uuid, p_action_type text, p_reason text, p_idempotency_key text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  SELECT app_private.command_correct_payment(
    p_usaha_id,
    p_pembayaran_id,
    p_action_type,
    p_reason,
    p_idempotency_key,
    p_request_id
  );
$function$

CREATE OR REPLACE FUNCTION public.command_reconcile_expense(p_usaha_id uuid, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  SELECT app_private.command_reconcile_expense(p_usaha_id, p_idempotency_key);
$function$

CREATE OR REPLACE FUNCTION public.command_reconcile_payment(p_usaha_id uuid, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  SELECT app_private.command_reconcile_payment(p_usaha_id, p_idempotency_key);
$function$

CREATE OR REPLACE FUNCTION public.command_record_expense(p_usaha_id uuid, p_source_type text, p_source_id uuid, p_pemasok_id uuid, p_kategori_biaya text, p_deskripsi text, p_amount numeric, p_tanggal_pengeluaran date, p_bukti_storage_path text, p_catatan text, p_idempotency_key text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  SELECT app_private.command_record_expense(
    p_usaha_id,
    p_source_type,
    p_source_id,
    p_pemasok_id,
    p_kategori_biaya,
    p_deskripsi,
    p_amount,
    p_tanggal_pengeluaran,
    p_bukti_storage_path,
    p_catatan,
    p_idempotency_key,
    p_request_id
  );
$function$

CREATE OR REPLACE FUNCTION public.command_record_payment(p_usaha_id uuid, p_reservasi_id uuid, p_penyewaan_id uuid, p_jenis text, p_metode text, p_amount numeric, p_dibayar_at timestamp with time zone, p_reference_text text, p_catatan text, p_idempotency_key text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  SELECT app_private.command_record_payment(
    p_usaha_id,
    p_reservasi_id,
    p_penyewaan_id,
    p_jenis,
    p_metode,
    p_amount,
    p_dibayar_at,
    p_reference_text,
    p_catatan,
    p_idempotency_key,
    p_request_id
  );
$function$

CREATE OR REPLACE FUNCTION public.finance_expense_analysis(p_usaha_id uuid, p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT app_private.finance_expense_analysis(p_usaha_id,p_start_date,p_end_date); $function$

CREATE OR REPLACE FUNCTION public.finance_expense_page(p_usaha_id uuid, p_start_date date, p_end_date date, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT app_private.finance_expense_page(p_usaha_id,p_start_date,p_end_date,p_limit,p_offset); $function$

CREATE OR REPLACE FUNCTION public.finance_payment_page(p_usaha_id uuid, p_start_date date, p_end_date date, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT app_private.finance_payment_page(p_usaha_id,p_start_date,p_end_date,p_limit,p_offset); $function$

CREATE OR REPLACE FUNCTION public.finance_reconciliation(p_usaha_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT app_private.finance_reconciliation(p_usaha_id); $function$

CREATE OR REPLACE FUNCTION public.finance_reconciliation_findings(p_usaha_id uuid, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT app_private.finance_reconciliation_findings(p_usaha_id,p_limit); $function$

CREATE OR REPLACE FUNCTION public.finance_recorded_income_by_product(p_usaha_id uuid, p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT app_private.finance_recorded_income_by_product(p_usaha_id,p_start_date,p_end_date); $function$

CREATE OR REPLACE FUNCTION public.finance_recorded_income_by_unit(p_usaha_id uuid, p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT app_private.finance_recorded_income_by_unit(p_usaha_id,p_start_date,p_end_date); $function$

CREATE OR REPLACE FUNCTION public.finance_summary(p_usaha_id uuid, p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT app_private.finance_summary(p_usaha_id,p_start_date,p_end_date); $function$

CREATE OR REPLACE FUNCTION public.finance_transaction_page(p_usaha_id uuid, p_start_date date, p_end_date date, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT app_private.finance_transaction_page(p_usaha_id,p_start_date,p_end_date,p_limit,p_offset); $function$

REVOKE ALL ON FUNCTION public.command_correct_expense(uuid, uuid, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.command_correct_expense(uuid, uuid, text, text, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.command_correct_payment(uuid, uuid, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.command_correct_payment(uuid, uuid, text, text, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.command_reconcile_expense(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.command_reconcile_expense(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.command_reconcile_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.command_reconcile_payment(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.command_record_expense(uuid, text, uuid, uuid, text, text, numeric, date, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.command_record_expense(uuid, text, uuid, uuid, text, text, numeric, date, text, text, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.command_record_payment(uuid, uuid, uuid, text, text, numeric, timestamp with time zone, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.command_record_payment(uuid, uuid, uuid, text, text, numeric, timestamp with time zone, text, text, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.finance_expense_analysis(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_expense_analysis(uuid, date, date) TO authenticated;
REVOKE ALL ON FUNCTION public.finance_expense_page(uuid, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_expense_page(uuid, date, date, integer, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.finance_payment_page(uuid, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_payment_page(uuid, date, date, integer, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.finance_reconciliation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_reconciliation(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.finance_reconciliation_findings(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_reconciliation_findings(uuid, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.finance_recorded_income_by_product(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_recorded_income_by_product(uuid, date, date) TO authenticated;
REVOKE ALL ON FUNCTION public.finance_recorded_income_by_unit(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_recorded_income_by_unit(uuid, date, date) TO authenticated;
REVOKE ALL ON FUNCTION public.finance_summary(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_summary(uuid, date, date) TO authenticated;
REVOKE ALL ON FUNCTION public.finance_transaction_page(uuid, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_transaction_page(uuid, date, date, integer, integer) TO authenticated;