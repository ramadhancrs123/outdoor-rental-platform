-- Allows an Investor to record an actual transfer out of their own recorded balance.
-- This is not an allocation payout and never changes the operational result or rights allocation.

ALTER TABLE public.investor_stakeholder_payout
  ALTER COLUMN period_start DROP NOT NULL,
  ALTER COLUMN dicatat_by_admin_id DROP NOT NULL,
  ADD COLUMN dicatat_by_investor_id uuid,
  ADD COLUMN payout_kind text NOT NULL DEFAULT 'allocation_payout';

ALTER TABLE public.investor_stakeholder_payout
  ADD CONSTRAINT investor_payout_actor_investor_fk
    FOREIGN KEY (usaha_id, dicatat_by_investor_id)
    REFERENCES public.investor(usaha_id, investor_id) ON DELETE RESTRICT,
  ADD CONSTRAINT investor_payout_kind_chk
    CHECK (payout_kind IN ('allocation_payout', 'investor_self_transfer')),
  ADD CONSTRAINT investor_payout_actor_kind_chk
    CHECK (
      (payout_kind = 'allocation_payout'
        AND dicatat_by_admin_id IS NOT NULL
        AND dicatat_by_investor_id IS NULL)
      OR
      (payout_kind = 'investor_self_transfer'
        AND stakeholder_type = 'investor'
        AND investor_id IS NOT NULL
        AND dicatat_by_admin_id IS NULL
        AND dicatat_by_investor_id IS NOT NULL
        AND investor_id = dicatat_by_investor_id
        AND period_start IS NULL
        AND period_id IS NULL
        AND investor_allocation_id IS NULL
        AND operator_allocation_id IS NULL)
    );

ALTER TABLE public.pergerakan_akun_keuangan
  ALTER COLUMN dicatat_by_admin_id DROP NOT NULL,
  ADD COLUMN dicatat_by_investor_id uuid;

ALTER TABLE public.pergerakan_akun_keuangan
  ADD CONSTRAINT pergerakan_actor_investor_fk
    FOREIGN KEY (usaha_id, dicatat_by_investor_id)
    REFERENCES public.investor(usaha_id, investor_id) ON DELETE RESTRICT,
  ADD CONSTRAINT pergerakan_actor_exactly_one_chk
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
        AND (
          (NEW.arah = 'keluar' AND NEW.akun_keuangan_id = t.physical_source_account_id)
          OR (NEW.arah = 'masuk' AND NEW.akun_keuangan_id = t.physical_target_account_id)
        )
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
         SELECT 1
         FROM public.investor_stakeholder_payout p
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
      (v_account.fungsi_akun = 'investor' AND NEW.sumber_type IN ('investor_payout', 'investor_self_transfer'))
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

CREATE OR REPLACE FUNCTION app_private.command_investor_self_transfer(
  p_usaha_id uuid,
  p_source_account_id uuid,
  p_amount numeric,
  p_transferred_at timestamptz,
  p_destination_name text,
  p_destination_reference text,
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
  v_timezone text;
  v_when timestamptz := coalesce(p_transferred_at, now());
  v_note text := nullif(btrim(coalesce(p_catatan, '')), '');
  v_destination text := nullif(btrim(coalesce(p_destination_name, '')), '');
  v_reference text := nullif(btrim(coalesce(p_destination_reference, '')), '');
  v_balance numeric;
  v_payout_id uuid := gen_random_uuid();
  v_tx_id uuid := gen_random_uuid();
  v_idempotency_id uuid;
  v_hash text;
  v_existing_hash text;
  v_existing_response jsonb;
  v_response jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;
  IF p_usaha_id IS NULL
     OR p_source_account_id IS NULL
     OR p_amount IS NULL OR p_amount <= 0
     OR v_destination IS NULL
     OR p_request_id IS NULL
     OR nullif(btrim(coalesce(p_idempotency_key, '')), '') IS NULL
     OR v_when > now() THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tujuan, sumber, nominal, atau waktu transfer tidak valid' USING ERRCODE = '22023';
  END IF;

  v_access := app_private.assert_investor_read_access(p_usaha_id);
  IF v_access <> 'investor' THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: transfer saldo mandiri hanya tersedia untuk identitas Investor' USING ERRCODE = '42501';
  END IF;
  v_investor_id := app_private.get_investor_id_for_principal(p_usaha_id);

  SELECT u.timezone INTO v_timezone
  FROM public.usaha u
  WHERE u.usaha_id = p_usaha_id AND u.status = 'active';
  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text || ':' || p_source_account_id::text, 0));

  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'source_account_id', p_source_account_id,
    'amount', p_amount,
    'transferred_at', p_transferred_at,
    'destination_name', v_destination,
    'destination_reference', v_reference,
    'catatan', v_note
  )::text);

  INSERT INTO public.idempotency_key(usaha_id, actor_auth_user_id, key, command_name, request_hash)
  VALUES (p_usaha_id, auth.uid(), btrim(p_idempotency_key), 'investor_self_transfer', v_hash)
  ON CONFLICT (usaha_id, actor_auth_user_id, command_name, key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body, request_hash
    INTO v_existing_response, v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id = p_usaha_id
      AND actor_auth_user_id = auth.uid()
      AND command_name = 'investor_self_transfer'
      AND key = btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah dipakai untuk transfer berbeda' USING ERRCODE = '23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: hasil transfer keluar belum dapat dipastikan' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_source
  FROM public.akun_keuangan a
  WHERE a.usaha_id = p_usaha_id
    AND a.akun_keuangan_id = p_source_account_id
  FOR UPDATE;
  IF NOT FOUND OR v_source.status <> 'active'
     OR v_source.fungsi_akun <> 'investor'
     OR v_source.investor_id IS DISTINCT FROM v_investor_id THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: akun sumber bukan akun Investor aktif milik Anda' USING ERRCODE = '42501';
  END IF;

  v_balance := app_private.finance_account_balance(p_usaha_id, p_source_account_id);
  IF p_amount > v_balance THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: saldo akun Investor tidak cukup' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.investor_stakeholder_payout(
    payout_id, usaha_id, stakeholder_type, investor_id, pengelola_akun_admin_id,
    period_start, period_id, investor_allocation_id, operator_allocation_id,
    source_account_id, amount, currency_code, paid_at, destination_name,
    destination_reference, dicatat_by_admin_id, dicatat_by_investor_id,
    request_id, catatan, payout_kind, status
  ) VALUES (
    v_payout_id, p_usaha_id, 'investor', v_investor_id, NULL,
    NULL, NULL, NULL, NULL,
    p_source_account_id, p_amount, v_source.mata_uang, v_when, v_destination,
    v_reference, NULL, v_investor_id,
    p_request_id, v_note, 'investor_self_transfer', 'recorded'
  );

  INSERT INTO public.transaksi_keuangan(
    transaksi_keuangan_id, usaha_id, nomor_transaksi, jenis, arah, tanggal_transaksi,
    amount, currency_code, sumber_type, sumber_id, status, catatan
  ) VALUES (
    v_tx_id, p_usaha_id,
    app_private.next_business_number(p_usaha_id, 'TRX', to_char(v_when AT TIME ZONE v_timezone, 'YYYY'))::text,
    'transfer', 'transfer', v_when, p_amount, v_source.mata_uang,
    'investor_self_transfer', v_payout_id, 'recorded', v_note
  );

  UPDATE public.investor_stakeholder_payout
  SET transaksi_keuangan_id = v_tx_id
  WHERE payout_id = v_payout_id AND usaha_id = p_usaha_id;

  INSERT INTO public.pergerakan_akun_keuangan(
    usaha_id, akun_keuangan_id, transaksi_keuangan_id, arah, amount, mata_uang,
    terjadi_at, sumber_type, sumber_id, status, dicatat_by_admin_id,
    dicatat_by_investor_id, request_id, catatan
  ) VALUES (
    p_usaha_id, p_source_account_id, v_tx_id, 'keluar', p_amount, v_source.mata_uang,
    v_when, 'investor_self_transfer', v_payout_id, 'recorded', NULL,
    v_investor_id, p_request_id, v_note
  );

  v_balance := app_private.finance_account_balance(p_usaha_id, p_source_account_id);
  v_response := jsonb_build_object(
    'status', 'recorded',
    'payout_id', v_payout_id,
    'payout_kind', 'investor_self_transfer',
    'stakeholder_type', 'investor',
    'investor_id', v_investor_id,
    'source_account_id', p_source_account_id,
    'transaction_id', v_tx_id,
    'amount', p_amount,
    'currency_code', v_source.mata_uang,
    'destination_name', v_destination,
    'destination_reference', v_reference,
    'balance_after', round(v_balance, 2),
    'affects_operational_result', false
  );

  INSERT INTO public.audit_log(
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action, entity_type, entity_id,
    source_application, request_id, change_summary
  ) VALUES (
    p_usaha_id, auth.uid(), NULL, 'investor_self_transfer',
    'investor_stakeholder_payout', v_payout_id, 'investor-portal', p_request_id, v_response
  );

  INSERT INTO public.outbox_event(usaha_id, event_type, aggregate_type, aggregate_id, payload)
  VALUES (p_usaha_id, 'investor.self_transfer.recorded', 'investor_stakeholder_payout', v_payout_id, v_response);

  UPDATE public.idempotency_key
  SET response_status = 200, response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION public.command_investor_self_transfer(
  p_usaha_id uuid,
  p_source_account_id uuid,
  p_amount numeric,
  p_transferred_at timestamptz,
  p_destination_name text,
  p_destination_reference text,
  p_catatan text,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_investor_self_transfer(
    $1, $2, $3, $4, $5, $6, $7, $8, $9
  );
$function$;

REVOKE ALL ON FUNCTION app_private.command_investor_self_transfer(uuid, uuid, numeric, timestamptz, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.command_investor_self_transfer(uuid, uuid, numeric, timestamptz, text, text, text, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.command_investor_self_transfer(uuid, uuid, numeric, timestamptz, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.command_investor_self_transfer(uuid, uuid, numeric, timestamptz, text, text, text, text, uuid) TO authenticated;
