-- Finance phase-1 trusted recording commands.
-- Scope: manual payment recording + manual expense recording.
-- Existing finance baseline schema lives in the remote database; this migration
-- adds the trusted mutation boundary on top of that live contract.

CREATE OR REPLACE FUNCTION app_private.command_record_payment(
  p_usaha_id uuid,
  p_reservasi_id uuid,
  p_penyewaan_id uuid,
  p_jenis text,
  p_metode text,
  p_amount numeric,
  p_dibayar_at timestamptz,
  p_reference_text text,
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
$function$;

CREATE OR REPLACE FUNCTION app_private.command_record_expense(
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
    coalesce(v_description || CASE WHEN v_note IS NOT NULL THEN E'\n' || v_note ELSE '' END, v_note)
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
$function$;

REVOKE ALL ON FUNCTION app_private.command_record_payment(uuid, uuid, uuid, text, text, numeric, timestamptz, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_record_payment(uuid, uuid, uuid, text, text, numeric, timestamptz, text, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_record_payment(uuid, uuid, uuid, text, text, numeric, timestamptz, text, text, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_record_payment(uuid, uuid, uuid, text, text, numeric, timestamptz, text, text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_record_expense(uuid, text, uuid, uuid, text, text, numeric, date, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_record_expense(uuid, text, uuid, uuid, text, text, numeric, date, text, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_record_expense(uuid, text, uuid, uuid, text, text, numeric, date, text, text, text, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_record_expense(uuid, text, uuid, uuid, text, text, numeric, date, text, text, text, uuid) TO authenticated;

DROP POLICY IF EXISTS payment_insert_member ON public.pembayaran;
DROP POLICY IF EXISTS payment_update_member ON public.pembayaran;
DROP POLICY IF EXISTS expense_insert_member ON public.pengeluaran;
DROP POLICY IF EXISTS expense_update_member ON public.pengeluaran;
DROP POLICY IF EXISTS finance_transaction_insert_member ON public.transaksi_keuangan;

REVOKE INSERT, UPDATE, DELETE ON public.pembayaran FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.pengeluaran FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.transaksi_keuangan FROM authenticated;
