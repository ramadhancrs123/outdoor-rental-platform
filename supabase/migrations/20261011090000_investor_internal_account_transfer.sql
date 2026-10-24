-- Investor portal internal account transfer.
-- This records movement between accounts; it is not an external withdrawal,
-- income, expense, allocation, or entitlement change.

ALTER TABLE public.transfer_akun_keuangan
  ALTER COLUMN dicatat_by_admin_id DROP NOT NULL,
  ADD COLUMN dicatat_by_investor_id uuid;

ALTER TABLE public.transfer_akun_keuangan
  ADD CONSTRAINT transfer_actor_investor_fk
    FOREIGN KEY (usaha_id, dicatat_by_investor_id)
    REFERENCES public.investor(usaha_id, investor_id) ON DELETE RESTRICT,
  ADD CONSTRAINT transfer_actor_exactly_one_chk
    CHECK ((dicatat_by_admin_id IS NOT NULL) <> (dicatat_by_investor_id IS NOT NULL));

CREATE OR REPLACE FUNCTION app_private.guard_finance_account_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_account public.akun_keuangan%rowtype;
  v_balance numeric;
BEGIN
  SELECT * INTO v_account FROM public.akun_keuangan
  WHERE usaha_id = NEW.usaha_id AND akun_keuangan_id = NEW.akun_keuangan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: akun uang untuk pergerakan tidak ditemukan' USING ERRCODE = 'P0002'; END IF;
  IF v_account.status <> 'active' THEN RAISE EXCEPTION 'BUSINESS_CONFLICT: akun uang tidak aktif' USING ERRCODE = '23514'; END IF;
  IF v_account.mata_uang <> NEW.mata_uang THEN RAISE EXCEPTION 'BUSINESS_CONFLICT: currency pergerakan tidak sama dengan akun' USING ERRCODE = '23514'; END IF;

  IF NEW.sumber_type = 'investor_entitlement_transfer' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.investor_entitlement_transfer t
      WHERE t.usaha_id = NEW.usaha_id AND t.transfer_id = NEW.sumber_id
        AND ((NEW.arah = 'keluar' AND NEW.akun_keuangan_id = t.physical_source_account_id)
          OR (NEW.arah = 'masuk' AND NEW.akun_keuangan_id = t.physical_target_account_id))
        AND t.physical_source_account_id IS NOT NULL
        AND t.physical_target_account_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: pergerakan fisik tidak cocok dengan transfer hak Investor yang tercatat' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.sumber_type = 'investor_self_transfer' THEN
    IF NEW.arah <> 'keluar'
       OR v_account.fungsi_akun <> 'investor'
       OR NEW.dicatat_by_admin_id IS NOT NULL
       OR NEW.dicatat_by_investor_id IS NULL
       OR v_account.investor_id IS DISTINCT FROM NEW.dicatat_by_investor_id
       OR NOT EXISTS (
         SELECT 1 FROM public.investor_stakeholder_payout p
         WHERE p.usaha_id = NEW.usaha_id
           AND p.payout_id = NEW.sumber_id
           AND p.payout_kind = 'investor_self_transfer'
           AND p.stakeholder_type = 'investor'
           AND p.investor_id = v_account.investor_id
           AND p.dicatat_by_investor_id = NEW.dicatat_by_investor_id
           AND p.source_account_id = NEW.akun_keuangan_id
           AND p.amount = NEW.amount
           AND p.currency_code = NEW.mata_uang
           AND p.status = 'recorded'
       ) THEN
      RAISE EXCEPTION 'AUTHORIZATION_ERROR: transfer keluar hanya boleh dicatat oleh pemilik akun Investor untuk baris transfer miliknya' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.sumber_type = 'investor_account_transfer' THEN
    IF NEW.dicatat_by_admin_id IS NOT NULL
       OR NEW.dicatat_by_investor_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public.transfer_akun_keuangan t
         JOIN public.akun_keuangan source
           ON source.usaha_id = t.usaha_id AND source.akun_keuangan_id = t.dari_akun_keuangan_id
         JOIN public.akun_keuangan target
           ON target.usaha_id = t.usaha_id AND target.akun_keuangan_id = t.ke_akun_keuangan_id
         LEFT JOIN public.investor target_investor
           ON target_investor.usaha_id = target.usaha_id AND target_investor.investor_id = target.investor_id
         WHERE t.usaha_id = NEW.usaha_id
           AND t.transfer_akun_keuangan_id = NEW.sumber_id
           AND t.transaksi_keuangan_id = NEW.transaksi_keuangan_id
           AND t.dicatat_by_investor_id = NEW.dicatat_by_investor_id
           AND t.amount = NEW.amount AND t.mata_uang = NEW.mata_uang AND t.status = 'recorded'
           AND source.status = 'active' AND source.fungsi_akun = 'investor'
           AND source.investor_id = NEW.dicatat_by_investor_id AND source.mata_uang = NEW.mata_uang
           AND target.status = 'active' AND target.mata_uang = NEW.mata_uang
           AND target.fungsi_akun IN ('operasional', 'investor')
           AND (target.fungsi_akun <> 'investor' OR (target_investor.status = 'active' AND target.investor_id = NEW.dicatat_by_investor_id))
           AND ((NEW.arah = 'keluar' AND NEW.akun_keuangan_id = t.dari_akun_keuangan_id
                 AND v_account.fungsi_akun = 'investor' AND v_account.investor_id = NEW.dicatat_by_investor_id)
             OR (NEW.arah = 'masuk' AND NEW.akun_keuangan_id = t.ke_akun_keuangan_id))
       ) THEN
      RAISE EXCEPTION 'AUTHORIZATION_ERROR: pergerakan tidak cocok dengan transfer internal akun Investor yang sah' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.sumber_type = 'stakeholder_cash_segregation' THEN
    IF NOT ((NEW.arah = 'keluar' AND v_account.fungsi_akun = 'operasional')
      OR (NEW.arah = 'masuk' AND v_account.fungsi_akun IN ('investor', 'pengelola'))) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: pemisahan kas hanya boleh dari akun usaha ke rekening fisik Investor/Pengelola' USING ERRCODE = '23514';
    END IF;
  ELSIF v_account.fungsi_akun = 'investor' THEN
    IF NOT ((NEW.arah = 'masuk' AND NEW.sumber_type = 'investor_distribution')
      OR (NEW.arah = 'keluar' AND NEW.sumber_type IN ('investor_payout', 'investor_entitlement_transfer'))) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: rekening Investor hanya dapat menerima pemisahan kas lama atau menjadi sumber pembayaran/transfer internal hak' USING ERRCODE = '23514';
    END IF;
  ELSIF v_account.fungsi_akun = 'pengelola' THEN
    IF NOT ((NEW.arah = 'masuk' AND NEW.sumber_type IN ('operator_withdrawal', 'investor_entitlement_transfer'))
      OR (NEW.arah = 'keluar' AND NEW.sumber_type IN ('operator_withdrawal_payout', 'investor_entitlement_transfer'))) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: rekening Pengelola hanya dapat menerima pemisahan kas/transfer hak atau menjadi sumber pembayaran Pengelola' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.arah = 'keluar' THEN
    IF v_account.fungsi_akun = 'operasional' THEN
      v_balance := app_private.finance_account_balance(NEW.usaha_id, NEW.akun_keuangan_id);
      IF NEW.amount > v_balance THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: saldo akun tidak cukup. Tersedia Rp %, dibutuhkan Rp %',
          round(v_balance, 2), round(NEW.amount, 2) USING ERRCODE = '23514';
      END IF;
    ELSIF NOT (
      (v_account.fungsi_akun = 'investor' AND NEW.sumber_type IN ('investor_payout', 'investor_self_transfer', 'investor_account_transfer'))
      OR (v_account.fungsi_akun = 'pengelola' AND NEW.sumber_type = 'operator_withdrawal_payout')
      OR NEW.sumber_type = 'investor_entitlement_transfer'
    ) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: rekening stakeholder tidak boleh menjadi sumber pengeluaran operasional/transfer umum' USING ERRCODE = '23514';
    ELSE
      v_balance := app_private.finance_account_balance(NEW.usaha_id, NEW.akun_keuangan_id);
      IF NEW.amount > v_balance THEN RAISE EXCEPTION 'BUSINESS_CONFLICT: saldo rekening stakeholder tidak cukup' USING ERRCODE = '23514'; END IF;
    END IF;
  END IF;

  IF NEW.sumber_type = 'payment' AND v_account.fungsi_akun <> 'operasional' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: payment harus masuk ke akun usaha operasional' USING ERRCODE = '23514';
  END IF;
  IF NEW.sumber_type = 'transfer_akun' AND v_account.fungsi_akun <> 'operasional' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: transfer akun umum hanya untuk akun usaha operasional' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

-- CREATE OR REPLACE preserves the pre-existing routine ACL; explicitly remove
-- default/public EXECUTE because this SECURITY DEFINER trigger is trigger-only.
REVOKE ALL ON FUNCTION app_private.guard_finance_account_movement() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.command_investor_account_transfer(
  p_usaha_id uuid,
  p_source_account_id uuid,
  p_target_account_id uuid,
  p_amount numeric,
  p_transferred_at timestamptz,
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
  v_access text;
  v_investor_id uuid;
  v_source public.akun_keuangan%rowtype;
  v_target public.akun_keuangan%rowtype;
  v_timezone text;
  v_when timestamptz := coalesce(p_transferred_at, now());
  v_note text := nullif(btrim(coalesce(p_catatan, '')), '');
  v_balance numeric;
  v_target_balance numeric;
  v_transfer_id uuid := gen_random_uuid();
  v_tx_id uuid := gen_random_uuid();
  v_idempotency_id uuid;
  v_hash text;
  v_existing_hash text;
  v_existing_response jsonb;
  v_response jsonb;
  v_locked_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;
  IF p_usaha_id IS NULL OR p_source_account_id IS NULL OR p_target_account_id IS NULL
     OR p_source_account_id = p_target_account_id
     OR p_amount IS NULL OR p_amount <= 0
     OR nullif(btrim(coalesce(p_idempotency_key, '')), '') IS NULL
     OR p_request_id IS NULL OR v_when > now() THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: akun sumber/tujuan, nominal, atau waktu transfer tidak valid' USING ERRCODE = '22023';
  END IF;

  v_access := app_private.assert_investor_read_access(p_usaha_id);
  IF v_access <> 'investor' THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: transfer internal mandiri hanya tersedia untuk identitas Investor, bukan sesi admin' USING ERRCODE = '42501';
  END IF;
  v_investor_id := app_private.get_investor_id_for_principal(p_usaha_id);

  SELECT u.timezone INTO v_timezone
  FROM public.usaha u
  WHERE u.usaha_id = p_usaha_id AND u.status = 'active';
  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'source_account_id', p_source_account_id,
    'target_account_id', p_target_account_id,
    'amount', p_amount,
    'transferred_at', p_transferred_at,
    'catatan', v_note
  )::text);

  INSERT INTO public.idempotency_key(usaha_id, actor_auth_user_id, key, command_name, request_hash)
  VALUES (p_usaha_id, auth.uid(), btrim(p_idempotency_key), 'investor_account_transfer', v_hash)
  ON CONFLICT (usaha_id, actor_auth_user_id, command_name, key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body, request_hash INTO v_existing_response, v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id = p_usaha_id
      AND actor_auth_user_id = auth.uid()
      AND command_name = 'investor_account_transfer'
      AND key = btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah dipakai untuk transfer berbeda' USING ERRCODE = '23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: hasil transfer internal belum dapat dipastikan' USING ERRCODE = '40001';
  END IF;

  -- Lock both accounts in one stable order to prevent deadlocks and overdrafts.
  FOR v_locked_id IN
    SELECT a.akun_keuangan_id
    FROM public.akun_keuangan a
    WHERE a.usaha_id = p_usaha_id
      AND a.akun_keuangan_id IN (p_source_account_id, p_target_account_id)
    ORDER BY a.akun_keuangan_id
    FOR UPDATE
  LOOP
    NULL;
  END LOOP;

  SELECT * INTO v_source FROM public.akun_keuangan a
  WHERE a.usaha_id = p_usaha_id AND a.akun_keuangan_id = p_source_account_id;
  SELECT * INTO v_target FROM public.akun_keuangan a
  WHERE a.usaha_id = p_usaha_id AND a.akun_keuangan_id = p_target_account_id;

  IF v_source.akun_keuangan_id IS NULL OR v_source.status <> 'active'
     OR v_source.fungsi_akun <> 'investor'
     OR v_source.investor_id IS DISTINCT FROM v_investor_id THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: akun sumber bukan saldo Investor aktif milik Anda' USING ERRCODE = '42501';
  END IF;
  IF v_target.akun_keuangan_id IS NULL OR v_target.status <> 'active'
     OR v_target.fungsi_akun NOT IN ('operasional', 'investor') THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: tujuan harus akun Usaha aktif atau akun Investor aktif' USING ERRCODE = '23514';
  END IF;
  IF v_target.fungsi_akun = 'investor' AND NOT EXISTS (
    SELECT 1 FROM public.investor i
    WHERE i.usaha_id = p_usaha_id AND i.investor_id = v_target.investor_id AND i.status = 'active'
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: pemilik akun Investor tujuan tidak aktif' USING ERRCODE = '23514';
  END IF;
  IF v_source.mata_uang <> v_target.mata_uang THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: transfer antar akun dengan mata uang berbeda belum didukung' USING ERRCODE = '23514';
  END IF;

  v_balance := app_private.finance_account_balance(p_usaha_id, p_source_account_id);
  IF p_amount > v_balance THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: saldo akun Investor tidak cukup' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.transaksi_keuangan(
    transaksi_keuangan_id, usaha_id, nomor_transaksi, jenis, arah, tanggal_transaksi,
    amount, currency_code, sumber_type, sumber_id, status, catatan
  ) VALUES (
    v_tx_id, p_usaha_id,
    app_private.next_business_number(p_usaha_id, 'TRX', to_char(v_when AT TIME ZONE v_timezone, 'YYYY'))::text,
    'transfer', 'transfer', v_when, p_amount, v_source.mata_uang,
    'investor_account_transfer', v_transfer_id, 'recorded', v_note
  );

  INSERT INTO public.transfer_akun_keuangan(
    transfer_akun_keuangan_id, usaha_id, transaksi_keuangan_id,
    dari_akun_keuangan_id, ke_akun_keuangan_id, amount, mata_uang,
    dipindahkan_at, dicatat_by_admin_id, dicatat_by_investor_id,
    request_id, catatan, status
  ) VALUES (
    v_transfer_id, p_usaha_id, v_tx_id,
    p_source_account_id, p_target_account_id, p_amount, v_source.mata_uang,
    v_when, NULL, v_investor_id, p_request_id, v_note, 'recorded'
  );

  INSERT INTO public.pergerakan_akun_keuangan(
    usaha_id, akun_keuangan_id, transaksi_keuangan_id, arah, amount, mata_uang,
    terjadi_at, sumber_type, sumber_id, status, dicatat_by_admin_id,
    dicatat_by_investor_id, request_id, catatan
  ) VALUES
    (p_usaha_id, p_source_account_id, v_tx_id, 'keluar', p_amount, v_source.mata_uang,
     v_when, 'investor_account_transfer', v_transfer_id, 'recorded', NULL,
     v_investor_id, p_request_id, v_note),
    (p_usaha_id, p_target_account_id, v_tx_id, 'masuk', p_amount, v_target.mata_uang,
     v_when, 'investor_account_transfer', v_transfer_id, 'recorded', NULL,
     v_investor_id, p_request_id, v_note);

  v_balance := app_private.finance_account_balance(p_usaha_id, p_source_account_id);
  v_target_balance := app_private.finance_account_balance(p_usaha_id, p_target_account_id);
  v_response := jsonb_build_object(
    'status', 'recorded',
    'transfer_id', v_transfer_id,
    'transaction_id', v_tx_id,
    'source_account_id', p_source_account_id,
    'target_account_id', p_target_account_id,
    'amount', p_amount,
    'currency_code', v_source.mata_uang,
    'source_balance_after', round(v_balance, 2),
    'target_balance_after', round(v_target_balance, 2),
    'affects_operational_result', false,
    'affects_entitlement', false
  );

  INSERT INTO public.audit_log(
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action, entity_type, entity_id,
    source_application, request_id, change_summary
  ) VALUES (
    p_usaha_id, auth.uid(), NULL, 'investor_account_transfer', 'transfer_akun_keuangan',
    v_transfer_id, 'investor-portal', p_request_id, v_response
  );

  INSERT INTO public.outbox_event(usaha_id, event_type, aggregate_type, aggregate_id, payload)
  VALUES (p_usaha_id, 'investor.account_transfer.recorded', 'transfer_akun_keuangan', v_transfer_id, v_response);

  UPDATE public.idempotency_key
  SET response_status = 200, response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION public.command_investor_account_transfer(
  p_usaha_id uuid,
  p_source_account_id uuid,
  p_target_account_id uuid,
  p_amount numeric,
  p_transferred_at timestamptz,
  p_catatan text,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_investor_account_transfer($1, $2, $3, $4, $5, $6, $7, $8);
$function$;

REVOKE ALL ON FUNCTION app_private.command_investor_account_transfer(uuid, uuid, uuid, numeric, timestamptz, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.command_investor_account_transfer(uuid, uuid, uuid, numeric, timestamptz, text, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.command_investor_account_transfer(uuid, uuid, uuid, numeric, timestamptz, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.command_investor_account_transfer(uuid, uuid, uuid, numeric, timestamptz, text, text, uuid) TO authenticated;

-- Retire the old external/free-text destination command. Historical entries stay intact.
REVOKE ALL ON FUNCTION app_private.command_investor_self_transfer(uuid, uuid, numeric, timestamptz, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.command_investor_self_transfer(uuid, uuid, numeric, timestamptz, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.get_investor_stakeholder_accounts_with_transfer_targets(p_usaha_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_access text := app_private.assert_investor_read_access(p_usaha_id);
  v_investor_id uuid;
  v_base jsonb;
  v_targets jsonb;
BEGIN
  IF v_access = 'investor' THEN
    v_investor_id := app_private.get_investor_id_for_principal(p_usaha_id);
  END IF;

  v_base := app_private.get_investor_stakeholder_accounts(p_usaha_id);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'akun_keuangan_id', a.akun_keuangan_id,
    'nama_akun', a.nama_akun,
    'fungsi_akun', a.fungsi_akun,
    'investor_id', a.investor_id,
    'nama_pemilik', CASE WHEN a.fungsi_akun = 'operasional' THEN 'Akun Usaha' ELSE i.nama_tampilan END,
    'mata_uang', a.mata_uang
  ) ORDER BY a.fungsi_akun, a.nama_akun), '[]'::jsonb)
  INTO v_targets
  FROM public.akun_keuangan a
  LEFT JOIN public.investor i
    ON i.usaha_id = a.usaha_id AND i.investor_id = a.investor_id
  WHERE a.usaha_id = p_usaha_id
    AND a.status = 'active'
    AND (
      a.fungsi_akun = 'operasional'
      OR (a.fungsi_akun = 'investor' AND i.status = 'active')
    )
    AND (
      v_access = 'admin'
      OR a.fungsi_akun = 'operasional'
      OR (a.fungsi_akun = 'investor' AND a.investor_id = v_investor_id)
    );

  RETURN v_base || jsonb_build_object('transfer_targets', v_targets);
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.get_investor_stakeholder_history_with_account_transfers(p_usaha_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_access text := app_private.assert_investor_read_access(p_usaha_id);
  v_investor_id uuid;
  v_base jsonb;
  v_transfers jsonb;
BEGIN
  IF v_access = 'investor' THEN
    v_investor_id := app_private.get_investor_id_for_principal(p_usaha_id);
  END IF;

  v_base := app_private.get_investor_stakeholder_history(p_usaha_id);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'event_id', t.transfer_akun_keuangan_id::text,
    'stakeholder_type', 'investor',
    'source_account_id', t.dari_akun_keuangan_id,
    'target_account_id', t.ke_akun_keuangan_id,
    'transfer_id', t.transfer_akun_keuangan_id,
    'amount', t.amount,
    'currency_code', t.mata_uang,
    'occurred_at', t.dipindahkan_at,
    'recorded_by_admin_id', CASE WHEN v_access = 'admin' THEN t.dicatat_by_admin_id ELSE NULL END,
    'request_id', CASE WHEN v_access = 'admin' THEN t.request_id ELSE NULL END,
    'catatan', t.catatan,
    'movement_kind', 'investor_account_transfer',
    'affects_entitlement', false,
    'source_account_name', source.nama_akun,
    'target_account_name', target.nama_akun
  ) ORDER BY t.dipindahkan_at DESC), '[]'::jsonb)
  INTO v_transfers
  FROM public.transfer_akun_keuangan t
  JOIN public.transaksi_keuangan tx
    ON tx.usaha_id = t.usaha_id AND tx.transaksi_keuangan_id = t.transaksi_keuangan_id
  JOIN public.akun_keuangan source
    ON source.usaha_id = t.usaha_id AND source.akun_keuangan_id = t.dari_akun_keuangan_id
  JOIN public.akun_keuangan target
    ON target.usaha_id = t.usaha_id AND target.akun_keuangan_id = t.ke_akun_keuangan_id
  WHERE t.usaha_id = p_usaha_id
    AND t.status = 'recorded'
    AND tx.status = 'recorded'
    AND tx.sumber_type = 'investor_account_transfer'
    AND (
      v_access = 'admin'
      OR t.dicatat_by_investor_id = v_investor_id
      OR (target.fungsi_akun = 'investor' AND target.investor_id = v_investor_id)
    );

  RETURN jsonb_set(
    v_base,
    '{cash_segregations}',
    coalesce(v_base -> 'cash_segregations', '[]'::jsonb) || coalesce(v_transfers, '[]'::jsonb),
    true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_investor_stakeholder_accounts(p_usaha_id uuid)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.get_investor_stakeholder_accounts_with_transfer_targets($1);
$function$;

CREATE OR REPLACE FUNCTION public.get_investor_stakeholder_history(p_usaha_id uuid)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.get_investor_stakeholder_history_with_account_transfers($1);
$function$;

REVOKE ALL ON FUNCTION app_private.get_investor_stakeholder_accounts_with_transfer_targets(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.get_investor_stakeholder_accounts_with_transfer_targets(uuid) TO authenticated;
REVOKE ALL ON FUNCTION app_private.get_investor_stakeholder_history_with_account_transfers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.get_investor_stakeholder_history_with_account_transfers(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_investor_stakeholder_accounts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_investor_stakeholder_accounts(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_investor_stakeholder_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_investor_stakeholder_history(uuid) TO authenticated;
