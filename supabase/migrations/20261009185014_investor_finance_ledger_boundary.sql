
-- ===== Consolidated section: 20261009165000_investor_entitlement_cash_separation.sql =====
-- Investor/Finance: separate stakeholder entitlement from physical money location.
-- Local-first migration. Do not apply to production without the verified candidate-SHA gate.

-- A usaha has one active Investor identity in the MVP. Historical identity rows can be inactive.
CREATE UNIQUE INDEX IF NOT EXISTS investor_one_active_per_usaha_unik
  ON public.investor(usaha_id)
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION app_private.guard_one_active_investor_per_usaha()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.usaha_id::text, 0));
  IF NEW.status = 'active' AND EXISTS (
    SELECT 1
    FROM public.investor i
    WHERE i.usaha_id = NEW.usaha_id
      AND i.status = 'active'
      AND i.investor_id IS DISTINCT FROM NEW.investor_id
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: usaha hanya dapat memiliki satu Investor aktif'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS investor_one_active_per_usaha_guard ON public.investor;
CREATE TRIGGER investor_one_active_per_usaha_guard
  BEFORE INSERT OR UPDATE OF usaha_id, status ON public.investor
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_one_active_investor_per_usaha();

CREATE OR REPLACE FUNCTION app_private.guard_investor_participation_nonoverlap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.usaha_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.investor_participation p
    WHERE p.usaha_id = NEW.usaha_id AND p.status = 'active'
      AND p.participation_id IS DISTINCT FROM NEW.participation_id
      AND daterange(p.effective_from, p.effective_until, '[)')
          && daterange(NEW.effective_from, NEW.effective_until, '[)')
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: rentang Investor bertabrakan; satu usaha hanya boleh memiliki satu partisipasi efektif'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS investor_participation_nonoverlap_guard ON public.investor_participation;
CREATE TRIGGER investor_participation_nonoverlap_guard
  BEFORE INSERT OR UPDATE OF usaha_id, investor_id, effective_from, effective_until, status
  ON public.investor_participation
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_investor_participation_nonoverlap();

-- Old rows point to another internal Finance account. Preserve them as
-- physical cash segregation, not proof that the Investor/Pengelola was paid.
ALTER TABLE public.investor_period_distribution
  ADD COLUMN IF NOT EXISTS movement_kind text NOT NULL DEFAULT 'cash_segregation';
ALTER TABLE public.operator_period_withdrawal
  ADD COLUMN IF NOT EXISTS movement_kind text NOT NULL DEFAULT 'cash_segregation';

ALTER TABLE public.investor_period_distribution
  DROP CONSTRAINT IF EXISTS investor_period_distribution_movement_kind_chk;
ALTER TABLE public.investor_period_distribution
  ADD CONSTRAINT investor_period_distribution_movement_kind_chk CHECK (movement_kind = 'cash_segregation');
ALTER TABLE public.operator_period_withdrawal
  DROP CONSTRAINT IF EXISTS operator_period_withdrawal_movement_kind_chk;
ALTER TABLE public.operator_period_withdrawal
  ADD CONSTRAINT operator_period_withdrawal_movement_kind_chk CHECK (movement_kind = 'cash_segregation');

COMMENT ON TABLE public.investor_period_distribution IS
  'Legacy cash-segregation history into an internal Finance account tagged Investor; does not mean the external Investor was paid.';
COMMENT ON TABLE public.operator_period_withdrawal IS
  'Legacy cash-segregation history into an internal Finance account tagged Pengelola; does not mean the external Pengelola was paid.';

ALTER TABLE public.investor_period_allocation
  ADD COLUMN IF NOT EXISTS advance_excess_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transferred_out_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE public.operator_period_allocation
  ADD COLUMN IF NOT EXISTS advance_excess_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transferred_in_amount numeric NOT NULL DEFAULT 0;

ALTER TABLE public.investor_period_allocation
  DROP CONSTRAINT IF EXISTS investor_period_allocation_amount_chk;
ALTER TABLE public.investor_period_allocation
  ADD CONSTRAINT investor_period_allocation_amount_chk CHECK (
    result_basis_amount >= 0 AND percentage BETWEEN 0 AND 100
    AND allocation_amount >= 0 AND distributed_amount >= 0
    AND transferred_out_amount >= 0
    AND distributed_amount + transferred_out_amount <= allocation_amount
    AND advance_excess_amount >= 0
  );
ALTER TABLE public.investor_period_allocation
  DROP CONSTRAINT IF EXISTS investor_period_allocation_status_chk;
ALTER TABLE public.investor_period_allocation
  ADD CONSTRAINT investor_period_allocation_status_chk
  CHECK (status IN ('allocated', 'partially_distributed', 'settled', 'review_required'));

ALTER TABLE public.operator_period_allocation
  DROP CONSTRAINT IF EXISTS operator_period_allocation_amount_chk;
ALTER TABLE public.operator_period_allocation
  ADD CONSTRAINT operator_period_allocation_amount_chk CHECK (
    result_basis_amount >= 0 AND percentage BETWEEN 0 AND 100
    AND allocation_amount >= 0 AND distributed_amount >= 0
    AND transferred_in_amount >= 0
    AND distributed_amount <= allocation_amount + transferred_in_amount
    AND advance_excess_amount >= 0
  );
ALTER TABLE public.operator_period_allocation
  DROP CONSTRAINT IF EXISTS operator_period_allocation_status_chk;
ALTER TABLE public.operator_period_allocation
  ADD CONSTRAINT operator_period_allocation_status_chk
  CHECK (status IN ('allocated', 'partially_distributed', 'settled', 'review_required'));

CREATE TABLE IF NOT EXISTS public.investor_stakeholder_payout (
  payout_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  stakeholder_type text NOT NULL,
  investor_id uuid,
  pengelola_akun_admin_id uuid,
  period_start date NOT NULL,
  period_id uuid,
  investor_allocation_id uuid,
  operator_allocation_id uuid,
  source_account_id uuid NOT NULL,
  transaksi_keuangan_id uuid,
  amount numeric NOT NULL,
  currency_code char(3) NOT NULL,
  paid_at timestamptz NOT NULL,
  destination_name text NOT NULL,
  destination_reference text,
  dicatat_by_admin_id uuid NOT NULL,
  request_id uuid NOT NULL,
  catatan text,
  status text NOT NULL DEFAULT 'recorded',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT investor_stakeholder_payout_amount_chk CHECK (amount > 0),
  CONSTRAINT investor_stakeholder_payout_type_chk CHECK (
    (stakeholder_type = 'investor' AND investor_id IS NOT NULL
      AND pengelola_akun_admin_id IS NULL AND operator_allocation_id IS NULL)
    OR
    (stakeholder_type = 'pengelola' AND pengelola_akun_admin_id IS NOT NULL
      AND investor_id IS NULL AND investor_allocation_id IS NULL)
  ),
  CONSTRAINT investor_stakeholder_payout_status_chk
    CHECK (status IN ('recorded', 'review_required', 'reversed')),
  CONSTRAINT investor_stakeholder_payout_period_fk
    FOREIGN KEY (period_id) REFERENCES public.investor_finance_period(period_id) ON DELETE RESTRICT,
  CONSTRAINT investor_stakeholder_payout_investor_fk
    FOREIGN KEY (usaha_id, investor_id) REFERENCES public.investor(usaha_id, investor_id) ON DELETE RESTRICT,
  CONSTRAINT investor_stakeholder_payout_investor_allocation_fk
    FOREIGN KEY (investor_allocation_id) REFERENCES public.investor_period_allocation(allocation_id) ON DELETE RESTRICT,
  CONSTRAINT investor_stakeholder_payout_operator_allocation_fk
    FOREIGN KEY (operator_allocation_id) REFERENCES public.operator_period_allocation(allocation_id) ON DELETE RESTRICT,
  CONSTRAINT investor_stakeholder_payout_source_fk
    FOREIGN KEY (usaha_id, source_account_id) REFERENCES public.akun_keuangan(usaha_id, akun_keuangan_id) ON DELETE RESTRICT,
  CONSTRAINT investor_stakeholder_payout_transaction_fk
    FOREIGN KEY (usaha_id, transaksi_keuangan_id) REFERENCES public.transaksi_keuangan(usaha_id, transaksi_keuangan_id) ON DELETE RESTRICT,
  CONSTRAINT investor_stakeholder_payout_actor_fk
    FOREIGN KEY (usaha_id, dicatat_by_admin_id) REFERENCES public.keanggotaan_usaha(usaha_id, akun_admin_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS investor_stakeholder_payout_period_idx
  ON public.investor_stakeholder_payout(usaha_id, stakeholder_type, period_start, paid_at DESC);
CREATE INDEX IF NOT EXISTS investor_stakeholder_payout_investor_allocation_idx
  ON public.investor_stakeholder_payout(investor_allocation_id) WHERE investor_allocation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS investor_stakeholder_payout_operator_allocation_idx
  ON public.investor_stakeholder_payout(operator_allocation_id) WHERE operator_allocation_id IS NOT NULL;

ALTER TABLE public.investor_stakeholder_payout ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.investor_stakeholder_payout FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.investor_stakeholder_payout IS
  'Actual payment out of a business-owned cash/bank account to an external Investor/Pengelola recipient. Separate from internal cash segregation and excluded from operational result.';

CREATE TABLE IF NOT EXISTS public.investor_entitlement_transfer (
  transfer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  period_id uuid NOT NULL,
  source_investor_allocation_id uuid NOT NULL,
  target_type text NOT NULL,
  target_operator_allocation_id uuid,
  physical_source_account_id uuid,
  physical_target_account_id uuid,
  transaksi_keuangan_id uuid,
  transfer_akun_keuangan_id uuid,
  amount numeric NOT NULL,
  currency_code char(3) NOT NULL,
  transferred_at timestamptz NOT NULL,
  dicatat_by_admin_id uuid NOT NULL,
  request_id uuid NOT NULL,
  catatan text,
  status text NOT NULL DEFAULT 'recorded',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT investor_entitlement_transfer_amount_chk CHECK (amount > 0),
  CONSTRAINT investor_entitlement_transfer_target_chk CHECK (
    (target_type = 'usaha' AND target_operator_allocation_id IS NULL)
    OR
    (target_type = 'pengelola' AND target_operator_allocation_id IS NOT NULL)
  ),
  CONSTRAINT investor_entitlement_transfer_physical_pair_chk CHECK (
    (physical_source_account_id IS NULL AND physical_target_account_id IS NULL
      AND transaksi_keuangan_id IS NULL AND transfer_akun_keuangan_id IS NULL)
    OR
    (physical_source_account_id IS NOT NULL AND physical_target_account_id IS NOT NULL
      AND physical_source_account_id <> physical_target_account_id
      AND transaksi_keuangan_id IS NOT NULL AND transfer_akun_keuangan_id IS NOT NULL)
  ),
  CONSTRAINT investor_entitlement_transfer_status_chk CHECK (status IN ('recorded', 'review_required', 'reversed')),
  CONSTRAINT investor_entitlement_transfer_period_fk
    FOREIGN KEY (period_id) REFERENCES public.investor_finance_period(period_id) ON DELETE RESTRICT,
  CONSTRAINT investor_entitlement_transfer_source_allocation_fk
    FOREIGN KEY (source_investor_allocation_id) REFERENCES public.investor_period_allocation(allocation_id) ON DELETE RESTRICT,
  CONSTRAINT investor_entitlement_transfer_target_operator_fk
    FOREIGN KEY (target_operator_allocation_id) REFERENCES public.operator_period_allocation(allocation_id) ON DELETE RESTRICT,
  CONSTRAINT investor_entitlement_transfer_physical_source_fk
    FOREIGN KEY (usaha_id, physical_source_account_id) REFERENCES public.akun_keuangan(usaha_id, akun_keuangan_id) ON DELETE RESTRICT,
  CONSTRAINT investor_entitlement_transfer_physical_target_fk
    FOREIGN KEY (usaha_id, physical_target_account_id) REFERENCES public.akun_keuangan(usaha_id, akun_keuangan_id) ON DELETE RESTRICT,
  CONSTRAINT investor_entitlement_transfer_transaction_fk
    FOREIGN KEY (usaha_id, transaksi_keuangan_id) REFERENCES public.transaksi_keuangan(usaha_id, transaksi_keuangan_id) ON DELETE RESTRICT,
  CONSTRAINT investor_entitlement_transfer_finance_transfer_fk
    FOREIGN KEY (transfer_akun_keuangan_id) REFERENCES public.transfer_akun_keuangan(transfer_akun_keuangan_id) ON DELETE RESTRICT,
  CONSTRAINT investor_entitlement_transfer_actor_fk
    FOREIGN KEY (usaha_id, dicatat_by_admin_id) REFERENCES public.keanggotaan_usaha(usaha_id, akun_admin_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS investor_entitlement_transfer_source_idx
  ON public.investor_entitlement_transfer(source_investor_allocation_id, transferred_at DESC)
  WHERE status = 'recorded';
CREATE INDEX IF NOT EXISTS investor_entitlement_transfer_target_operator_idx
  ON public.investor_entitlement_transfer(target_operator_allocation_id, transferred_at DESC)
  WHERE status = 'recorded';
CREATE INDEX IF NOT EXISTS investor_entitlement_transfer_business_idx
  ON public.investor_entitlement_transfer(usaha_id, target_type, transferred_at DESC)
  WHERE status = 'recorded';

ALTER TABLE public.investor_entitlement_transfer ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.investor_entitlement_transfer FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.investor_entitlement_transfer IS
  'Transfer hak internal dari alokasi Investor ke modal usaha atau hak Pengelola. Perpindahan uang fisik opsional dan tidak dihitung sebagai payout.';


-- Correct only the derived entitlement paid counters; preserve every transfer and old ledger row.
UPDATE public.investor_period_allocation a
SET distributed_amount = 0, advance_excess_amount = 0, status = 'allocated'
WHERE EXISTS (
  SELECT 1 FROM public.investor_period_distribution d
  WHERE d.allocation_id = a.allocation_id AND d.movement_kind = 'cash_segregation'
);
UPDATE public.operator_period_allocation a
SET distributed_amount = 0, advance_excess_amount = 0, status = 'allocated'
WHERE EXISTS (
  SELECT 1 FROM public.operator_period_withdrawal w
  WHERE w.allocation_id = a.allocation_id AND w.movement_kind = 'cash_segregation'
);

CREATE OR REPLACE FUNCTION app_private.apply_investor_preclose_payouts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_period public.investor_finance_period%rowtype;
  v_paid numeric := 0;
  v_excess numeric := 0;
BEGIN
  SELECT * INTO v_period FROM public.investor_finance_period p
  WHERE p.usaha_id = NEW.usaha_id AND p.period_id = NEW.period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'INTEGRITY_ERROR: periode alokasi Investor tidak ditemukan' USING ERRCODE = '23514'; END IF;

  SELECT coalesce(sum(p.amount), 0) INTO v_paid FROM public.investor_stakeholder_payout p
  WHERE p.usaha_id = NEW.usaha_id AND p.stakeholder_type = 'investor'
    AND p.investor_id = NEW.investor_id AND p.period_start = v_period.period_start
    AND p.investor_allocation_id IS NULL AND p.status = 'recorded';
  v_excess := greatest(v_paid - NEW.allocation_amount, 0);

  UPDATE public.investor_stakeholder_payout SET period_id = NEW.period_id,
    investor_allocation_id = NEW.allocation_id
  WHERE usaha_id = NEW.usaha_id AND stakeholder_type = 'investor'
    AND investor_id = NEW.investor_id AND period_start = v_period.period_start
    AND investor_allocation_id IS NULL AND status = 'recorded';

  UPDATE public.investor_period_allocation SET
    distributed_amount = least(v_paid, NEW.allocation_amount),
    advance_excess_amount = v_excess,
    status = CASE WHEN v_excess > 0 THEN 'review_required'
      WHEN v_paid > 0 AND v_paid >= NEW.allocation_amount AND NEW.allocation_amount > 0 THEN 'settled'
      WHEN v_paid > 0 THEN 'partially_distributed' ELSE 'allocated' END
  WHERE allocation_id = NEW.allocation_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.apply_operator_preclose_payouts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_period public.investor_finance_period%rowtype;
  v_paid numeric := 0;
  v_excess numeric := 0;
BEGIN
  SELECT * INTO v_period FROM public.investor_finance_period p
  WHERE p.usaha_id = NEW.usaha_id AND p.period_id = NEW.period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'INTEGRITY_ERROR: periode alokasi Pengelola tidak ditemukan' USING ERRCODE = '23514'; END IF;

  SELECT coalesce(sum(p.amount), 0) INTO v_paid FROM public.investor_stakeholder_payout p
  WHERE p.usaha_id = NEW.usaha_id AND p.stakeholder_type = 'pengelola'
    AND p.pengelola_akun_admin_id = NEW.pengelola_akun_admin_id
    AND p.period_start = v_period.period_start
    AND p.operator_allocation_id IS NULL AND p.status = 'recorded';
  v_excess := greatest(v_paid - NEW.allocation_amount, 0);

  UPDATE public.investor_stakeholder_payout SET period_id = NEW.period_id,
    operator_allocation_id = NEW.allocation_id
  WHERE usaha_id = NEW.usaha_id AND stakeholder_type = 'pengelola'
    AND pengelola_akun_admin_id = NEW.pengelola_akun_admin_id
    AND period_start = v_period.period_start
    AND operator_allocation_id IS NULL AND status = 'recorded';

  UPDATE public.operator_period_allocation SET
    distributed_amount = least(v_paid, NEW.allocation_amount),
    advance_excess_amount = v_excess,
    status = CASE WHEN v_excess > 0 THEN 'review_required'
      WHEN v_paid > 0 AND v_paid >= NEW.allocation_amount AND NEW.allocation_amount > 0 THEN 'settled'
      WHEN v_paid > 0 THEN 'partially_distributed' ELSE 'allocated' END
  WHERE allocation_id = NEW.allocation_id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS investor_allocation_apply_preclose_payouts ON public.investor_period_allocation;
CREATE TRIGGER investor_allocation_apply_preclose_payouts
  AFTER INSERT ON public.investor_period_allocation
  FOR EACH ROW EXECUTE FUNCTION app_private.apply_investor_preclose_payouts();
DROP TRIGGER IF EXISTS operator_allocation_apply_preclose_payouts ON public.operator_period_allocation;
CREATE TRIGGER operator_allocation_apply_preclose_payouts
  AFTER INSERT ON public.operator_period_allocation
  FOR EACH ROW EXECUTE FUNCTION app_private.apply_operator_preclose_payouts();

COMMENT ON COLUMN public.investor_period_allocation.distributed_amount IS
  'Jumlah payout aktual kepada penerima eksternal yang sudah tercatat; transfer internal/pemisahan kas tidak termasuk.';
COMMENT ON COLUMN public.investor_period_allocation.transferred_out_amount IS
  'Hak Investor yang dialihkan secara internal ke modal usaha atau hak Pengelola; bukan payout eksternal.';
COMMENT ON COLUMN public.operator_period_allocation.distributed_amount IS
  'Jumlah payout aktual kepada penerima eksternal yang sudah tercatat; transfer internal/pemisahan kas tidak termasuk.';
COMMENT ON COLUMN public.operator_period_allocation.transferred_in_amount IS
  'Hak yang diterima Pengelola melalui pemindahan hak internal; tidak mengubah hasil operasional closing.';
COMMENT ON COLUMN public.investor_period_allocation.advance_excess_amount IS
  'Bagian payout sebelum closing yang melebihi hak final periode; memerlukan pemeriksaan, bukan carry-forward otomatis.';
COMMENT ON COLUMN public.operator_period_allocation.advance_excess_amount IS
  'Bagian payout sebelum closing yang melebihi hak final periode; memerlukan pemeriksaan, bukan carry-forward otomatis.';

-- ===== Consolidated section: 20261009165100_investor_cash_segregation_command.sql =====
-- Physical cash segregation is a Finance movement, not an Investor/Pengelola payout.
CREATE OR REPLACE FUNCTION app_private.guard_finance_account_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
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
      SELECT 1
      FROM public.investor_entitlement_transfer t
      WHERE t.usaha_id = NEW.usaha_id
        AND t.transfer_id = NEW.sumber_id
        AND (
          (NEW.arah = 'keluar' AND NEW.akun_keuangan_id = t.physical_source_account_id)
          OR
          (NEW.arah = 'masuk' AND NEW.akun_keuangan_id = t.physical_target_account_id)
        )
        AND t.physical_source_account_id IS NOT NULL
        AND t.physical_target_account_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: pergerakan fisik tidak cocok dengan transfer hak Investor yang tercatat' USING ERRCODE = '23514';
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
      (v_account.fungsi_akun = 'investor' AND NEW.sumber_type = 'investor_payout')
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

CREATE OR REPLACE FUNCTION app_private.command_segregate_stakeholder_cash(
  p_usaha_id uuid, p_stakeholder_type text, p_source_account_id uuid, p_target_account_id uuid,
  p_amount numeric, p_moved_at timestamptz, p_catatan text, p_idempotency_key text, p_request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.assert_investor_admin(p_usaha_id);
  v_source public.akun_keuangan%rowtype;
  v_target public.akun_keuangan%rowtype;
  v_part public.investor_participation%rowtype;
  v_when timestamptz := coalesce(p_moved_at, now());
  v_timezone text;
  v_business_date date;
  v_period_start date;
  v_locked_period_start date;
  v_balance numeric;
  v_operational_cash numeric;
  v_currency_count integer;
  v_currency char(3);
  v_transaction_id uuid := gen_random_uuid();
  v_transfer_id uuid := gen_random_uuid();
  v_idempotency_id uuid;
  v_hash text;
  v_existing_hash text;
  v_existing_response jsonb;
  v_response jsonb;
  v_note text := nullif(btrim(coalesce(p_catatan, '')), '');
BEGIN
  IF p_stakeholder_type IS NULL OR p_stakeholder_type NOT IN ('investor', 'pengelola')
     OR p_source_account_id IS NULL OR p_target_account_id IS NULL OR p_source_account_id = p_target_account_id
     OR p_amount IS NULL OR p_amount <= 0 OR p_request_id IS NULL
     OR nullif(btrim(coalesce(p_idempotency_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: pemisahan kas belum lengkap' USING ERRCODE = '22023';
  END IF;

  SELECT u.timezone INTO v_timezone FROM public.usaha u
  WHERE u.usaha_id = p_usaha_id AND u.status = 'active';
  IF v_timezone IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE = 'P0002'; END IF;
  IF v_when > now() THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: waktu pemisahan kas tidak boleh di masa depan' USING ERRCODE = '22023';
  END IF;
  v_business_date := (v_when AT TIME ZONE v_timezone)::date;
  SELECT p.* INTO v_part FROM public.investor_participation p
  WHERE p.usaha_id = p_usaha_id AND p.status = 'active'
    AND p.effective_from <= v_business_date
    AND (p.effective_until IS NULL OR p.effective_until > v_business_date)
  ORDER BY p.effective_from DESC LIMIT 1;
  IF v_part.participation_id IS NULL THEN
    RAISE EXCEPTION 'CONFIG_REQUIRED: konfigurasi Investor/Pengelola belum tersedia pada tanggal pemindahan kas' USING ERRCODE = '55000';
  END IF;

  SELECT period_start INTO v_period_start
  FROM app_private.investor_period_for_date(v_business_date, v_part.period_start_day, v_part.period_end_day);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text || ':' || v_period_start::text, 0));

  -- Re-read and lock the effective config after acquiring the period lock.
  SELECT p.* INTO v_part FROM public.investor_participation p
  WHERE p.usaha_id = p_usaha_id AND p.status = 'active'
    AND p.effective_from <= v_business_date
    AND (p.effective_until IS NULL OR p.effective_until > v_business_date)
  ORDER BY p.effective_from DESC LIMIT 1 FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: konfigurasi Investor berubah; muat ulang sebelum memisahkan kas' USING ERRCODE = '23514';
  END IF;
  SELECT period_start INTO v_locked_period_start
  FROM app_private.investor_period_for_date(v_business_date, v_part.period_start_day, v_part.period_end_day);
  IF v_locked_period_start IS DISTINCT FROM v_period_start THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: rentang periode berubah; muat ulang sebelum memisahkan kas' USING ERRCODE = '23514';
  END IF;

  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id, 'stakeholder_type', p_stakeholder_type,
    'source_account_id', p_source_account_id, 'target_account_id', p_target_account_id,
    'amount', p_amount, 'moved_at', p_moved_at, 'catatan', v_note
  )::text);
  INSERT INTO public.idempotency_key(usaha_id, actor_auth_user_id, key, command_name, request_hash)
  VALUES (p_usaha_id, auth.uid(), btrim(p_idempotency_key), 'segregate_stakeholder_cash', v_hash)
  ON CONFLICT (usaha_id, actor_auth_user_id, command_name, key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;
  IF v_idempotency_id IS NULL THEN
    SELECT response_body, request_hash INTO v_existing_response, v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id = p_usaha_id AND actor_auth_user_id = auth.uid()
      AND command_name = 'segregate_stakeholder_cash' AND key = btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk data berbeda' USING ERRCODE = '23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: hasil pemisahan kas belum dapat dipastikan' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_source FROM public.akun_keuangan a
  WHERE a.usaha_id = p_usaha_id AND a.akun_keuangan_id = p_source_account_id FOR UPDATE;
  IF NOT FOUND OR v_source.status <> 'active' THEN RAISE EXCEPTION 'NOT_FOUND: akun usaha sumber aktif tidak ditemukan' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_target FROM public.akun_keuangan a
  WHERE a.usaha_id = p_usaha_id AND a.akun_keuangan_id = p_target_account_id FOR UPDATE;
  IF NOT FOUND OR v_target.status <> 'active' THEN RAISE EXCEPTION 'NOT_FOUND: rekening tujuan aktif tidak ditemukan' USING ERRCODE = 'P0002'; END IF;

  IF v_source.fungsi_akun <> 'operasional' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: uang hanya dapat dipisahkan dari akun usaha operasional' USING ERRCODE = '23514';
  END IF;
  IF p_stakeholder_type = 'investor'
     AND (v_target.fungsi_akun <> 'investor' OR v_target.investor_id <> v_part.investor_id) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: rekening tujuan tidak cocok dengan Investor aktif pada usaha' USING ERRCODE = '23514';
  END IF;
  IF p_stakeholder_type = 'pengelola'
     AND (v_target.fungsi_akun <> 'pengelola' OR v_target.pengelola_akun_admin_id <> v_part.pengelola_akun_admin_id) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: rekening tujuan tidak cocok dengan Pengelola aktif pada usaha' USING ERRCODE = '23514';
  END IF;
  IF v_source.mata_uang <> v_target.mata_uang THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: pemisahan kas beda mata uang belum didukung' USING ERRCODE = '23514';
  END IF;

  SELECT count(DISTINCT a.mata_uang), min(a.mata_uang)::char(3)
  INTO v_currency_count, v_currency
  FROM public.akun_keuangan a
  WHERE a.usaha_id = p_usaha_id AND a.status = 'active' AND a.fungsi_akun = 'operasional';
  IF v_currency_count <> 1 OR v_source.mata_uang <> v_currency THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: mata uang akun usaha perlu diperiksa sebelum pemisahan kas' USING ERRCODE = '23514';
  END IF;

  v_balance := app_private.finance_account_balance(p_usaha_id, p_source_account_id);
  IF p_amount > v_balance THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: saldo akun usaha sumber tidak cukup' USING ERRCODE = '23514';
  END IF;
  SELECT (x.payload->>'saldo')::numeric
  INTO v_operational_cash
  FROM (SELECT app_private.finance_operational_cash_summary(p_usaha_id) payload) x;
  IF v_operational_cash IS NULL OR v_operational_cash - p_amount < v_part.operational_reserve_amount THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: pemisahan kas akan mengurangi total dana usaha di bawah cadangan operasional' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.transaksi_keuangan(
    transaksi_keuangan_id, usaha_id, nomor_transaksi, jenis, arah, tanggal_transaksi,
    amount, currency_code, sumber_type, sumber_id, status, catatan
  ) VALUES (
    v_transaction_id, p_usaha_id,
    app_private.next_business_number(p_usaha_id, 'TRX', to_char(v_when AT TIME ZONE v_timezone, 'YYYY'))::text,
    'transfer', 'transfer', v_when, p_amount, v_source.mata_uang,
    'stakeholder_cash_segregation', v_transfer_id, 'recorded', v_note
  );
  INSERT INTO public.transfer_akun_keuangan(
    transfer_akun_keuangan_id, usaha_id, transaksi_keuangan_id, dari_akun_keuangan_id,
    ke_akun_keuangan_id, amount, mata_uang, dipindahkan_at, dicatat_by_admin_id,
    request_id, catatan, status
  ) VALUES (
    v_transfer_id, p_usaha_id, v_transaction_id, p_source_account_id, p_target_account_id,
    p_amount, v_source.mata_uang, v_when, v_admin_id, p_request_id, v_note, 'recorded'
  );
  INSERT INTO public.pergerakan_akun_keuangan(
    usaha_id, akun_keuangan_id, transaksi_keuangan_id, arah, amount, mata_uang,
    terjadi_at, sumber_type, sumber_id, status, dicatat_by_admin_id, request_id, catatan
  ) VALUES
    (p_usaha_id, p_source_account_id, v_transaction_id, 'keluar', p_amount, v_source.mata_uang,
      v_when, 'stakeholder_cash_segregation', v_transfer_id, 'recorded', v_admin_id, p_request_id, v_note),
    (p_usaha_id, p_target_account_id, v_transaction_id, 'masuk', p_amount, v_target.mata_uang,
      v_when, 'stakeholder_cash_segregation', v_transfer_id, 'recorded', v_admin_id, p_request_id, v_note);

  v_response := jsonb_build_object(
    'transfer_id', v_transfer_id, 'transaction_id', v_transaction_id,
    'stakeholder_type', p_stakeholder_type, 'source_account_id', p_source_account_id,
    'target_account_id', p_target_account_id, 'amount', p_amount,
    'currency_code', v_source.mata_uang, 'movement_kind', 'cash_segregation',
    'affects_entitlement', false, 'status', 'recorded'
  );
  INSERT INTO public.audit_log(
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action, entity_type, entity_id,
    source_application, request_id, change_summary
  ) VALUES (p_usaha_id, auth.uid(), v_admin_id, 'segregate_stakeholder_cash',
    'transfer_akun_keuangan', v_transfer_id, 'admin-command', p_request_id, v_response);
  INSERT INTO public.outbox_event(usaha_id, event_type, aggregate_type, aggregate_id, payload)
  VALUES (p_usaha_id, 'finance.account.transfer_recorded', 'transfer_akun_keuangan', v_transfer_id, v_response);
  UPDATE public.idempotency_key SET response_status = 200, response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION public.command_segregate_stakeholder_cash(
  p_usaha_id uuid, p_stakeholder_type text, p_source_account_id uuid, p_target_account_id uuid,
  p_amount numeric, p_moved_at timestamptz, p_catatan text, p_idempotency_key text, p_request_id uuid
)
RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$
  SELECT app_private.command_segregate_stakeholder_cash($1,$2,$3,$4,$5,$6,$7,$8,$9);
$function$;

REVOKE ALL ON FUNCTION app_private.command_segregate_stakeholder_cash(uuid,text,uuid,uuid,numeric,timestamptz,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.command_segregate_stakeholder_cash(uuid,text,uuid,uuid,numeric,timestamptz,text,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.command_segregate_stakeholder_cash(uuid,text,uuid,uuid,numeric,timestamptz,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.command_segregate_stakeholder_cash(uuid,text,uuid,uuid,numeric,timestamptz,text,text,uuid) TO authenticated;

-- ===== Consolidated section: 20261009165200_investor_stakeholder_payout_commands.sql =====
-- Record actual payouts separately from allocation and internal cash segregation.
CREATE OR REPLACE FUNCTION app_private.command_record_stakeholder_payout(
  p_usaha_id uuid, p_stakeholder_type text, p_period_start date,
  p_investor_allocation_id uuid, p_operator_allocation_id uuid,
  p_source_account_id uuid, p_amount numeric, p_paid_at timestamptz,
  p_destination_name text, p_destination_reference text, p_catatan text,
  p_idempotency_key text, p_request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.assert_investor_admin(p_usaha_id);
  v_part public.investor_participation%rowtype;
  v_period public.investor_finance_period%rowtype;
  v_i_alloc public.investor_period_allocation%rowtype;
  v_o_alloc public.operator_period_allocation%rowtype;
  v_source public.akun_keuangan%rowtype;
  v_payout_id uuid := gen_random_uuid();
  v_tx_id uuid := gen_random_uuid();
  v_when timestamptz := coalesce(p_paid_at, now());
  v_timezone text;
  v_today date;
  v_paid_date date;
  v_ps date;
  v_pe date;
  v_locked_period_start date;
  v_locked_period_end_exclusive date;
  v_currency char(3);
  v_operational_currency char(3);
  v_operational_currency_count integer;
  v_reserve numeric := 0;
  v_live jsonb;
  v_entitlement numeric := 0;
  v_prior_paid numeric := 0;
  v_remaining numeric := 0;
  v_balance numeric := 0;
  v_operational_cash numeric;
  v_idempotency_id uuid;
  v_hash text;
  v_existing_hash text;
  v_existing_response jsonb;
  v_response jsonb;
  v_note text := nullif(btrim(coalesce(p_catatan, '')), '');
  v_investor_id uuid;
  v_operator_id uuid;
  v_is_closed boolean := false;
  v_allocation_id uuid;
  v_allocated numeric := 0;
  v_distributed numeric := 0;
  v_transferred_out numeric := 0;
  v_transferred_in numeric := 0;
  v_advance_excess numeric := 0;
  v_event_type text;
  v_movement_source text;
  v_command_name text;
  v_participant_count integer;
BEGIN
  IF p_stakeholder_type IS NULL OR p_stakeholder_type NOT IN ('investor', 'pengelola')
     OR p_period_start IS NULL OR p_source_account_id IS NULL
     OR p_amount IS NULL OR p_amount <= 0
     OR nullif(btrim(coalesce(p_destination_name, '')), '') IS NULL
     OR p_request_id IS NULL OR nullif(btrim(coalesce(p_idempotency_key, '')), '') IS NULL
     OR (p_investor_allocation_id IS NOT NULL AND p_operator_allocation_id IS NOT NULL)
     OR (p_stakeholder_type = 'investor' AND p_operator_allocation_id IS NOT NULL)
     OR (p_stakeholder_type = 'pengelola' AND p_investor_allocation_id IS NOT NULL) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: data pembayaran Investor/Pengelola belum lengkap' USING ERRCODE = '22023';
  END IF;
  v_command_name := CASE WHEN p_stakeholder_type = 'investor'
    THEN 'payout_investor_balance' ELSE 'withdraw_operator_balance' END;

  SELECT u.timezone INTO v_timezone FROM public.usaha u
  WHERE u.usaha_id = p_usaha_id AND u.status = 'active';
  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  v_today := (now() AT TIME ZONE v_timezone)::date;
  v_paid_date := (v_when AT TIME ZONE v_timezone)::date;
  IF v_when > now() THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: waktu pembayaran tidak boleh di masa depan' USING ERRCODE = '22023';
  END IF;

  -- Resolve the canonical period before taking the common period lock.
  IF p_stakeholder_type = 'investor' AND p_investor_allocation_id IS NOT NULL THEN
    SELECT a.* INTO v_i_alloc FROM public.investor_period_allocation a
    WHERE a.usaha_id = p_usaha_id AND a.allocation_id = p_investor_allocation_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: alokasi Investor tidak ditemukan' USING ERRCODE = 'P0002'; END IF;
    SELECT * INTO v_period FROM public.investor_finance_period p
    WHERE p.usaha_id = p_usaha_id AND p.period_id = v_i_alloc.period_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'INTEGRITY_ERROR: periode alokasi Investor tidak ditemukan' USING ERRCODE = '23514'; END IF;
    v_ps := v_period.period_start; v_pe := v_period.period_end_exclusive; v_is_closed := true;
  ELSIF p_stakeholder_type = 'pengelola' AND p_operator_allocation_id IS NOT NULL THEN
    SELECT a.* INTO v_o_alloc FROM public.operator_period_allocation a
    WHERE a.usaha_id = p_usaha_id AND a.allocation_id = p_operator_allocation_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: alokasi Pengelola tidak ditemukan' USING ERRCODE = 'P0002'; END IF;
    SELECT * INTO v_period FROM public.investor_finance_period p
    WHERE p.usaha_id = p_usaha_id AND p.period_id = v_o_alloc.period_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'INTEGRITY_ERROR: periode alokasi Pengelola tidak ditemukan' USING ERRCODE = '23514'; END IF;
    v_ps := v_period.period_start; v_pe := v_period.period_end_exclusive; v_is_closed := true;
  ELSE
    SELECT count(*) INTO v_participant_count
    FROM public.investor_participation p
    WHERE p.usaha_id = p_usaha_id AND p.status = 'active'
      AND p.effective_from <= p_period_start
      AND (p.effective_until IS NULL OR p.effective_until > p_period_start);
    IF v_participant_count <> 1 THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: periode ini tidak memiliki tepat satu konfigurasi Investor yang berlaku'
        USING ERRCODE = '23514';
    END IF;
    SELECT p.* INTO v_part FROM public.investor_participation p
    WHERE p.usaha_id = p_usaha_id AND p.status = 'active'
      AND p.effective_from <= p_period_start
      AND (p.effective_until IS NULL OR p.effective_until > p_period_start);
    SELECT period_start, period_end_exclusive INTO v_ps, v_pe
    FROM app_private.investor_period_for_date(p_period_start, v_part.period_start_day, v_part.period_end_day);
    IF v_ps IS DISTINCT FROM p_period_start THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: tanggal harus merupakan awal periode' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_period_start IS DISTINCT FROM v_ps THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tanggal periode tidak cocok dengan alokasi yang dipilih' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text || ':' || v_ps::text, 0));

  -- Hash supplied timestamp, not its now() default, so identical retries replay.
  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id, 'stakeholder_type', p_stakeholder_type, 'period_start', v_ps,
    'investor_allocation_id', p_investor_allocation_id, 'operator_allocation_id', p_operator_allocation_id,
    'source_account_id', p_source_account_id, 'amount', p_amount, 'paid_at', p_paid_at,
    'destination_name', btrim(p_destination_name),
    'destination_reference', nullif(btrim(coalesce(p_destination_reference, '')), ''), 'catatan', v_note
  )::text);
  INSERT INTO public.idempotency_key(usaha_id, actor_auth_user_id, key, command_name, request_hash)
  VALUES (p_usaha_id, auth.uid(), btrim(p_idempotency_key), v_command_name, v_hash)
  ON CONFLICT (usaha_id, actor_auth_user_id, command_name, key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;
  IF v_idempotency_id IS NULL THEN
    SELECT response_body, request_hash INTO v_existing_response, v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id = p_usaha_id AND actor_auth_user_id = auth.uid()
      AND command_name = v_command_name AND key = btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah dipakai untuk data pembayaran berbeda' USING ERRCODE = '23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: hasil pembayaran belum dapat dipastikan' USING ERRCODE = '40001';
  END IF;

  IF v_is_closed THEN
    IF p_stakeholder_type = 'investor' THEN
      SELECT * INTO v_i_alloc FROM public.investor_period_allocation a
      WHERE a.usaha_id = p_usaha_id AND a.allocation_id = p_investor_allocation_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: alokasi Investor tidak ditemukan' USING ERRCODE = 'P0002'; END IF;
      v_investor_id := v_i_alloc.investor_id; v_currency := v_i_alloc.currency_code;
      v_allocated := v_i_alloc.allocation_amount; v_distributed := v_i_alloc.distributed_amount;
      v_transferred_out := v_i_alloc.transferred_out_amount;
      v_advance_excess := v_i_alloc.advance_excess_amount; v_allocation_id := v_i_alloc.allocation_id;
    ELSE
      SELECT * INTO v_o_alloc FROM public.operator_period_allocation a
      WHERE a.usaha_id = p_usaha_id AND a.allocation_id = p_operator_allocation_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: alokasi Pengelola tidak ditemukan' USING ERRCODE = 'P0002'; END IF;
      v_operator_id := v_o_alloc.pengelola_akun_admin_id; v_currency := v_o_alloc.currency_code;
      v_allocated := v_o_alloc.allocation_amount; v_distributed := v_o_alloc.distributed_amount;
      v_transferred_in := v_o_alloc.transferred_in_amount;
      v_advance_excess := v_o_alloc.advance_excess_amount; v_allocation_id := v_o_alloc.allocation_id;
    END IF;
    IF v_advance_excess > 0 OR
       (p_stakeholder_type = 'investor' AND v_i_alloc.status = 'review_required') OR
       (p_stakeholder_type = 'pengelola' AND v_o_alloc.status = 'review_required') THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: alokasi perlu pemeriksaan sebelum pembayaran dilanjutkan' USING ERRCODE = '23514';
    END IF;
    v_remaining := CASE
      WHEN p_stakeholder_type = 'investor'
        THEN greatest(v_allocated - v_distributed - v_transferred_out, 0)
      ELSE greatest(v_allocated + v_transferred_in - v_distributed, 0)
    END;
    IF p_amount > v_remaining THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: pembayaran melebihi sisa hak yang belum dibayar' USING ERRCODE = '23514';
    END IF;
    v_reserve := v_period.operational_reserve_amount;
  ELSE
    IF v_today < v_ps OR v_today >= v_pe OR v_paid_date < v_ps OR v_paid_date >= v_pe THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: penarikan sebelum closing hanya dapat dicatat untuk periode yang sedang berjalan' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.investor_finance_period p
      WHERE p.usaha_id = p_usaha_id AND p.period_start = v_ps) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: periode baru saja ditutup; pilih alokasi periode tersebut' USING ERRCODE = '23514';
    END IF;
    SELECT count(*) INTO v_participant_count
    FROM public.investor_participation p
    WHERE p.usaha_id = p_usaha_id AND p.status = 'active'
      AND p.effective_from <= v_ps AND (p.effective_until IS NULL OR p.effective_until > v_ps);
    IF v_participant_count <> 1 THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: konfigurasi Investor pada tanggal periode tidak tunggal' USING ERRCODE = '23514';
    END IF;
    SELECT p.* INTO v_part FROM public.investor_participation p
    WHERE p.usaha_id = p_usaha_id AND p.status = 'active'
      AND p.effective_from <= v_ps AND (p.effective_until IS NULL OR p.effective_until > v_ps)
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: konfigurasi Investor berubah; muat ulang sebelum pembayaran' USING ERRCODE = '23514';
    END IF;
    SELECT period_start, period_end_exclusive
    INTO v_locked_period_start, v_locked_period_end_exclusive
    FROM app_private.investor_period_for_date(v_ps, v_part.period_start_day, v_part.period_end_day);
    IF v_locked_period_start IS DISTINCT FROM v_ps OR v_locked_period_end_exclusive IS DISTINCT FROM v_pe THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: rentang periode berubah; muat ulang sebelum pembayaran' USING ERRCODE = '23514';
    END IF;
    v_investor_id := v_part.investor_id; v_operator_id := v_part.pengelola_akun_admin_id;
    v_reserve := v_part.operational_reserve_amount;
    v_live := app_private.calculate_investor_period(p_usaha_id, v_investor_id, v_ps, v_pe);
    IF v_live->>'status' <> 'OK'
      OR v_live->>'allocation_status' = 'MULTI_CURRENCY_REVIEW_REQUIRED'
      OR v_live->>'investor_entitlement' IS NULL OR v_live->>'operator_remainder' IS NULL THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: hasil periode belum dapat digunakan untuk pembayaran; periksa konfigurasi/mata uang' USING ERRCODE = '23514';
    END IF;
    v_entitlement := CASE WHEN p_stakeholder_type = 'investor'
      THEN (v_live->>'investor_entitlement')::numeric ELSE (v_live->>'operator_remainder')::numeric END;
    SELECT coalesce(sum(p.amount), 0) INTO v_prior_paid
    FROM public.investor_stakeholder_payout p
    WHERE p.usaha_id = p_usaha_id AND p.stakeholder_type = p_stakeholder_type
      AND p.period_start = v_ps AND p.investor_allocation_id IS NULL
      AND p.operator_allocation_id IS NULL AND p.status = 'recorded';
    v_remaining := greatest(v_entitlement - v_prior_paid, 0);
    IF p_amount > v_remaining THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: pembayaran melebihi estimasi hak periode berjalan' USING ERRCODE = '23514';
    END IF;
    SELECT count(DISTINCT a.mata_uang), min(a.mata_uang)::char(3)
    INTO v_operational_currency_count, v_operational_currency
    FROM public.akun_keuangan a
    WHERE a.usaha_id = p_usaha_id AND a.status = 'active' AND a.fungsi_akun = 'operasional';
    IF v_operational_currency_count <> 1 THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: mata uang akun usaha perlu diperiksa sebelum pembayaran' USING ERRCODE = '23514';
    END IF;
    v_currency := v_operational_currency;
    IF jsonb_array_length(coalesce(v_live->'currencies', '[]'::jsonb)) > 1
      OR (jsonb_array_length(coalesce(v_live->'currencies', '[]'::jsonb)) = 1
        AND (v_live->'currencies'->>0) <> v_currency) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: mata uang hasil periode tidak cocok dengan rekening operasional' USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT * INTO v_source FROM public.akun_keuangan a
  WHERE a.usaha_id = p_usaha_id AND a.akun_keuangan_id = p_source_account_id FOR UPDATE;
  IF NOT FOUND OR v_source.status <> 'active' THEN
    RAISE EXCEPTION 'NOT_FOUND: rekening sumber aktif tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF p_stakeholder_type = 'investor' THEN
    IF v_source.fungsi_akun = 'investor' AND v_source.investor_id <> v_investor_id THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: rekening sumber bukan milik Investor yang dibayar' USING ERRCODE = '23514';
    ELSIF v_source.fungsi_akun NOT IN ('operasional', 'investor') THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: pembayaran Investor harus dari akun usaha atau rekening Investor terkait' USING ERRCODE = '23514';
    END IF;
    v_movement_source := 'investor_payout'; v_event_type := 'investor.payout.recorded';
  ELSE
    IF v_source.fungsi_akun = 'pengelola' AND v_source.pengelola_akun_admin_id <> v_operator_id THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: rekening sumber bukan milik Pengelola yang dibayar' USING ERRCODE = '23514';
    ELSIF v_source.fungsi_akun NOT IN ('operasional', 'pengelola') THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: pembayaran Pengelola harus dari akun usaha atau rekening Pengelola terkait' USING ERRCODE = '23514';
    END IF;
    v_movement_source := 'operator_withdrawal_payout'; v_event_type := 'investor.operator_withdrawal.recorded';
  END IF;
  IF v_source.mata_uang <> v_currency THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: mata uang rekening sumber tidak cocok dengan hasil/alokasi' USING ERRCODE = '23514';
  END IF;

  v_balance := app_private.finance_account_balance(p_usaha_id, p_source_account_id);
  IF p_amount > v_balance THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: saldo rekening sumber tidak cukup' USING ERRCODE = '23514';
  END IF;
  IF v_source.fungsi_akun = 'operasional' THEN
    -- Reserve belongs to the aggregate operational pool, not just the chosen source account.
    SELECT p.operational_reserve_amount INTO v_reserve
    FROM public.investor_participation p
    WHERE p.usaha_id = p_usaha_id AND p.status = 'active'
      AND p.effective_from <= v_today
      AND (p.effective_until IS NULL OR p.effective_until > v_today)
    ORDER BY p.effective_from DESC LIMIT 1 FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: cadangan operasional saat ini tidak dapat diverifikasi' USING ERRCODE = '23514';
    END IF;
    SELECT (x.payload->>'saldo')::numeric, (x.payload->>'currency_count')::integer
    INTO v_operational_cash, v_operational_currency_count
    FROM (SELECT app_private.finance_operational_cash_summary(p_usaha_id) payload) x;
    IF v_operational_currency_count <> 1 OR v_operational_cash IS NULL THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: saldo operasional perlu diperiksa sebelum pembayaran' USING ERRCODE = '23514';
    END IF;
    IF v_operational_cash - p_amount < v_reserve THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: pembayaran akan mengurangi total dana usaha di bawah cadangan operasional' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF p_stakeholder_type = 'investor' THEN
    INSERT INTO public.investor_stakeholder_payout(
      payout_id, usaha_id, stakeholder_type, investor_id, period_start, period_id,
      investor_allocation_id, source_account_id, amount, currency_code, paid_at,
      destination_name, destination_reference, dicatat_by_admin_id, request_id, catatan
    ) VALUES (
      v_payout_id, p_usaha_id, 'investor', v_investor_id, v_ps,
      CASE WHEN v_is_closed THEN v_period.period_id ELSE NULL END,
      CASE WHEN v_is_closed THEN v_allocation_id ELSE NULL END,
      p_source_account_id, p_amount, v_currency, v_when, btrim(p_destination_name),
      nullif(btrim(coalesce(p_destination_reference, '')), ''), v_admin_id, p_request_id, v_note
    );
  ELSE
    INSERT INTO public.investor_stakeholder_payout(
      payout_id, usaha_id, stakeholder_type, pengelola_akun_admin_id, period_start, period_id,
      operator_allocation_id, source_account_id, amount, currency_code, paid_at,
      destination_name, destination_reference, dicatat_by_admin_id, request_id, catatan
    ) VALUES (
      v_payout_id, p_usaha_id, 'pengelola', v_operator_id, v_ps,
      CASE WHEN v_is_closed THEN v_period.period_id ELSE NULL END,
      CASE WHEN v_is_closed THEN v_allocation_id ELSE NULL END,
      p_source_account_id, p_amount, v_currency, v_when, btrim(p_destination_name),
      nullif(btrim(coalesce(p_destination_reference, '')), ''), v_admin_id, p_request_id, v_note
    );
  END IF;

  INSERT INTO public.transaksi_keuangan(
    transaksi_keuangan_id, usaha_id, nomor_transaksi, jenis, arah, tanggal_transaksi,
    amount, currency_code, sumber_type, sumber_id, status, catatan
  ) VALUES (
    v_tx_id, p_usaha_id,
    app_private.next_business_number(p_usaha_id, 'TRX', to_char(v_when AT TIME ZONE v_timezone, 'YYYY'))::text,
    'transfer', 'transfer', v_when, p_amount, v_currency,
    'investor_stakeholder_payout', v_payout_id, 'recorded', v_note
  );
  INSERT INTO public.pergerakan_akun_keuangan(
    usaha_id, akun_keuangan_id, transaksi_keuangan_id, arah, amount, mata_uang,
    terjadi_at, sumber_type, sumber_id, status, dicatat_by_admin_id, request_id, catatan
  ) VALUES (
    p_usaha_id, p_source_account_id, v_tx_id, 'keluar', p_amount, v_currency,
    v_when, v_movement_source, v_payout_id, 'recorded', v_admin_id, p_request_id, v_note
  );
  UPDATE public.investor_stakeholder_payout SET transaksi_keuangan_id = v_tx_id
  WHERE payout_id = v_payout_id;

  IF v_is_closed THEN
    IF p_stakeholder_type = 'investor' THEN
      UPDATE public.investor_period_allocation a
      SET distributed_amount = a.distributed_amount + p_amount,
          status = CASE
            WHEN a.distributed_amount + p_amount + a.transferred_out_amount >= a.allocation_amount
              AND a.allocation_amount > 0 THEN 'settled'
            ELSE 'partially_distributed' END
      WHERE a.allocation_id = v_allocation_id;
    ELSE
      UPDATE public.operator_period_allocation a
      SET distributed_amount = a.distributed_amount + p_amount,
          status = CASE
            WHEN a.distributed_amount + p_amount >= a.allocation_amount + a.transferred_in_amount
              AND a.allocation_amount + a.transferred_in_amount > 0 THEN 'settled'
            ELSE 'partially_distributed' END
      WHERE a.allocation_id = v_allocation_id;
    END IF;
  END IF;
  v_remaining := greatest(v_remaining - p_amount, 0);

  v_response := jsonb_build_object(
    'payout_id', v_payout_id, 'stakeholder_type', p_stakeholder_type, 'period_start', v_ps,
    'allocation_id', v_allocation_id, 'transaction_id', v_tx_id, 'source_account_id', p_source_account_id,
    'amount', p_amount, 'currency_code', v_currency, 'destination_name', btrim(p_destination_name),
    'remaining_entitlement', v_remaining,
    'settlement_status', CASE WHEN v_is_closed THEN 'paid_against_allocation' ELSE 'advance_before_closing' END,
    'affects_operational_result', false, 'status', 'recorded'
  );
  INSERT INTO public.audit_log(
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action, entity_type, entity_id,
    source_application, request_id, change_summary
  ) VALUES (p_usaha_id, auth.uid(), v_admin_id, v_command_name, 'investor_stakeholder_payout',
    v_payout_id, 'admin-command', p_request_id, v_response);
  INSERT INTO public.outbox_event(usaha_id, event_type, aggregate_type, aggregate_id, payload)
  VALUES (p_usaha_id, v_event_type, 'investor_stakeholder_payout', v_payout_id, v_response);
  UPDATE public.idempotency_key SET response_status = 200, response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION public.command_payout_investor_balance(
  p_usaha_id uuid, p_period_start date, p_allocation_id uuid, p_source_account_id uuid,
  p_amount numeric, p_paid_at timestamptz, p_destination_name text, p_destination_reference text,
  p_catatan text, p_idempotency_key text, p_request_id uuid
)
RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$
  SELECT app_private.command_record_stakeholder_payout(
    $1, 'investor', $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $11
  );
$function$;

CREATE OR REPLACE FUNCTION public.command_withdraw_operator_balance(
  p_usaha_id uuid, p_period_start date, p_allocation_id uuid, p_source_account_id uuid,
  p_amount numeric, p_paid_at timestamptz, p_destination_name text, p_destination_reference text,
  p_catatan text, p_idempotency_key text, p_request_id uuid
)
RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$
  SELECT app_private.command_record_stakeholder_payout(
    $1, 'pengelola', $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11
  );
$function$;

REVOKE ALL ON FUNCTION app_private.command_record_stakeholder_payout(uuid,text,date,uuid,uuid,uuid,numeric,timestamptz,text,text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.command_record_stakeholder_payout(uuid,text,date,uuid,uuid,uuid,numeric,timestamptz,text,text,text,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.command_payout_investor_balance(uuid,date,uuid,uuid,numeric,timestamptz,text,text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.command_payout_investor_balance(uuid,date,uuid,uuid,numeric,timestamptz,text,text,text,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.command_withdraw_operator_balance(uuid,date,uuid,uuid,numeric,timestamptz,text,text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.command_withdraw_operator_balance(uuid,date,uuid,uuid,numeric,timestamptz,text,text,text,text,uuid) TO authenticated;

-- Retire the old RPCs: they conflate internal account-to-account cash segregation with payout.
REVOKE ALL ON FUNCTION public.command_distribute_investor_allocation(uuid,uuid,uuid,uuid,numeric,timestamptz,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.command_withdraw_operator_allocation(uuid,uuid,uuid,uuid,numeric,timestamptz,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.command_distribute_investor_allocation(uuid,uuid,uuid,uuid,numeric,timestamptz,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.command_withdraw_operator_allocation(uuid,uuid,uuid,uuid,numeric,timestamptz,text,text,uuid) FROM PUBLIC, anon, authenticated;

-- ===== Consolidated section: 20261009165300_investor_stakeholder_history_rpc.sql =====
-- Authorized read model separates entitlement history from physical cash location.
CREATE OR REPLACE FUNCTION app_private.get_investor_stakeholder_history(p_usaha_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_access text := app_private.assert_investor_read_access(p_usaha_id);
  v_investor_id uuid;
  v_physical_accounts jsonb;
  v_allocations jsonb;
  v_payouts jsonb;
  v_entitlement_transfers jsonb;
  v_cash_segregations jsonb;
BEGIN
  IF v_access = 'investor' THEN
    v_investor_id := app_private.get_investor_id_for_principal(p_usaha_id);
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'account_id', a.akun_keuangan_id,
    'account_name', a.nama_akun,
    'stakeholder_type', a.fungsi_akun,
    'account_status', a.status,
    'currency_code', a.mata_uang,
    'physical_balance', round(app_private.finance_account_balance(a.usaha_id, a.akun_keuangan_id), 2),
    'balance_kind', 'physical_money_location'
  ) ORDER BY a.fungsi_akun, a.nama_akun), '[]'::jsonb)
  INTO v_physical_accounts
  FROM public.akun_keuangan a
  WHERE a.usaha_id = p_usaha_id
    AND a.fungsi_akun IN ('investor', 'pengelola')
    AND (
      v_access = 'admin'
      OR (v_access = 'investor' AND a.fungsi_akun = 'investor' AND a.investor_id = v_investor_id)
    );

  WITH all_allocations AS (
    SELECT
      'investor'::text AS stakeholder_type,
      a.allocation_id,
      a.period_id,
      p.period_start,
      p.period_end_exclusive,
      a.investor_id,
      NULL::uuid AS pengelola_akun_admin_id,
      a.currency_code,
      a.result_basis_amount,
      a.percentage,
      a.allocation_amount,
      a.distributed_amount AS paid_amount,
      a.transferred_out_amount AS transferred_out_amount,
      0::numeric AS transferred_in_amount,
      greatest(a.allocation_amount - a.distributed_amount - a.transferred_out_amount, 0) AS remaining_amount,
      a.advance_excess_amount,
      a.status
    FROM public.investor_period_allocation a
    JOIN public.investor_finance_period p
      ON p.usaha_id = a.usaha_id AND p.period_id = a.period_id
    WHERE a.usaha_id = p_usaha_id
      AND (v_access = 'admin' OR (v_access = 'investor' AND a.investor_id = v_investor_id))
    UNION ALL
    SELECT
      'pengelola'::text,
      a.allocation_id,
      a.period_id,
      p.period_start,
      p.period_end_exclusive,
      NULL::uuid,
      a.pengelola_akun_admin_id,
      a.currency_code,
      a.result_basis_amount,
      a.percentage,
      a.allocation_amount,
      a.distributed_amount,
      0::numeric AS transferred_out_amount,
      a.transferred_in_amount AS transferred_in_amount,
      greatest(a.allocation_amount + a.transferred_in_amount - a.distributed_amount, 0),
      a.advance_excess_amount,
      a.status
    FROM public.operator_period_allocation a
    JOIN public.investor_finance_period p
      ON p.usaha_id = a.usaha_id AND p.period_id = a.period_id
    WHERE a.usaha_id = p_usaha_id AND v_access = 'admin'
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'stakeholder_type', x.stakeholder_type,
    'allocation_id', x.allocation_id,
    'period_id', x.period_id,
    'period_start', x.period_start,
    'period_end_exclusive', x.period_end_exclusive,
    'investor_id', x.investor_id,
    'pengelola_akun_admin_id', x.pengelola_akun_admin_id,
    'currency_code', x.currency_code,
    'result_basis_amount', x.result_basis_amount,
    'percentage', x.percentage,
    'allocation_amount', x.allocation_amount,
    'paid_amount', x.paid_amount,
    'transferred_out_amount', x.transferred_out_amount,
    'transferred_in_amount', x.transferred_in_amount,
    'remaining_amount', x.remaining_amount,
    'advance_excess_amount', x.advance_excess_amount,
    'status', x.status
  ) ORDER BY x.period_start DESC, x.stakeholder_type), '[]'::jsonb)
  INTO v_allocations
  FROM all_allocations x;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'payout_id', p.payout_id,
    'stakeholder_type', p.stakeholder_type,
    'period_start', p.period_start,
    'period_id', p.period_id,
    'investor_allocation_id', p.investor_allocation_id,
    'operator_allocation_id', p.operator_allocation_id,
    'source_account_id', p.source_account_id,
    'transaction_id', p.transaksi_keuangan_id,
    'amount', p.amount,
    'currency_code', p.currency_code,
    'paid_at', p.paid_at,
    'destination_name', p.destination_name,
    'destination_reference', p.destination_reference,
    'recorded_by_admin_id', CASE WHEN v_access = 'admin' THEN p.dicatat_by_admin_id ELSE NULL END,
    'request_id', CASE WHEN v_access = 'admin' THEN p.request_id ELSE NULL END,
    'created_at', p.created_at,
    'catatan', p.catatan,
    'status', p.status
  ) ORDER BY p.paid_at DESC), '[]'::jsonb)
  INTO v_payouts
  FROM public.investor_stakeholder_payout p
  WHERE p.usaha_id = p_usaha_id
    AND (
      v_access = 'admin'
      OR (v_access = 'investor' AND p.stakeholder_type = 'investor' AND p.investor_id = v_investor_id)
    );

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'transfer_id', t.transfer_id,
    'period_id', t.period_id,
    'source_investor_allocation_id', t.source_investor_allocation_id,
    'target_type', t.target_type,
    'target_operator_allocation_id', t.target_operator_allocation_id,
    'physical_source_account_id', t.physical_source_account_id,
    'physical_target_account_id', t.physical_target_account_id,
    'transaction_id', t.transaksi_keuangan_id,
    'finance_transfer_id', t.transfer_akun_keuangan_id,
    'amount', t.amount,
    'currency_code', t.currency_code,
    'transferred_at', t.transferred_at,
    'physical_money_moved', t.physical_source_account_id IS NOT NULL,
    'affects_operational_result', false,
    'recorded_by_admin_id', CASE WHEN v_access = 'admin' THEN t.dicatat_by_admin_id ELSE NULL END,
    'request_id', CASE WHEN v_access = 'admin' THEN t.request_id ELSE NULL END,
    'catatan', t.catatan,
    'status', t.status
  ) ORDER BY t.transferred_at DESC), '[]'::jsonb)
  INTO v_entitlement_transfers
  FROM public.investor_entitlement_transfer t
  WHERE t.usaha_id = p_usaha_id
    AND (
      v_access = 'admin'
      OR (v_access = 'investor' AND EXISTS (
        SELECT 1 FROM public.investor_period_allocation a
        WHERE a.allocation_id = t.source_investor_allocation_id
          AND a.investor_id = v_investor_id
      ))
    );

  WITH segregation_rows AS (
    SELECT
      d.distribution_id::text AS event_id,
      'investor'::text AS stakeholder_type,
      d.source_account_id,
      d.target_account_id,
      d.transfer_id,
      d.amount,
      d.currency_code,
      d.distributed_at AS occurred_at,
      d.dicatat_by_admin_id AS recorded_by_admin_id,
      d.request_id,
      d.catatan
    FROM public.investor_period_distribution d
    WHERE d.usaha_id = p_usaha_id AND d.movement_kind = 'cash_segregation'
      AND (
        v_access = 'admin'
        OR (v_access = 'investor' AND EXISTS (
          SELECT 1 FROM public.investor_period_allocation a
          WHERE a.allocation_id = d.allocation_id AND a.investor_id = v_investor_id
        ))
      )
    UNION ALL
    SELECT
      w.withdrawal_id::text,
      'pengelola'::text,
      w.source_account_id,
      w.target_account_id,
      w.transfer_id,
      w.amount,
      w.currency_code,
      w.withdrawn_at,
      w.dicatat_by_admin_id,
      w.request_id,
      w.catatan
    FROM public.operator_period_withdrawal w
    WHERE w.usaha_id = p_usaha_id AND w.movement_kind = 'cash_segregation' AND v_access = 'admin'
    UNION ALL
    SELECT
      t.transfer_akun_keuangan_id::text,
      target.fungsi_akun,
      t.dari_akun_keuangan_id,
      t.ke_akun_keuangan_id,
      t.transfer_akun_keuangan_id,
      t.amount,
      t.mata_uang,
      t.dipindahkan_at,
      t.dicatat_by_admin_id,
      t.request_id,
      t.catatan
    FROM public.transfer_akun_keuangan t
    JOIN public.transaksi_keuangan tx
      ON tx.usaha_id = t.usaha_id AND tx.transaksi_keuangan_id = t.transaksi_keuangan_id
    JOIN public.akun_keuangan target
      ON target.usaha_id = t.usaha_id AND target.akun_keuangan_id = t.ke_akun_keuangan_id
    WHERE t.usaha_id = p_usaha_id AND t.status = 'recorded'
      AND tx.sumber_type = 'stakeholder_cash_segregation'
      AND (
        v_access = 'admin'
        OR (v_access = 'investor' AND target.fungsi_akun = 'investor' AND target.investor_id = v_investor_id)
      )
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'event_id', s.event_id,
    'stakeholder_type', s.stakeholder_type,
    'source_account_id', s.source_account_id,
    'target_account_id', s.target_account_id,
    'transfer_id', s.transfer_id,
    'amount', s.amount,
    'currency_code', s.currency_code,
    'occurred_at', s.occurred_at,
    'recorded_by_admin_id', CASE WHEN v_access = 'admin' THEN s.recorded_by_admin_id ELSE NULL END,
    'request_id', CASE WHEN v_access = 'admin' THEN s.request_id ELSE NULL END,
    'catatan', s.catatan,
    'movement_kind', 'cash_segregation',
    'affects_entitlement', false
  ) ORDER BY s.occurred_at DESC), '[]'::jsonb)
  INTO v_cash_segregations
  FROM segregation_rows s;

  RETURN jsonb_build_object(
    'status', 'OK',
    'principal', v_access,
    'physical_accounts', v_physical_accounts,
    'allocations', v_allocations,
    'payouts', v_payouts,
    'entitlement_transfers', v_entitlement_transfers,
    'cash_segregations', v_cash_segregations
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_investor_stakeholder_history(p_usaha_id uuid)
RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$
  SELECT app_private.get_investor_stakeholder_history($1);
$function$;

REVOKE ALL ON FUNCTION app_private.get_investor_stakeholder_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.get_investor_stakeholder_history(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_investor_stakeholder_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_investor_stakeholder_history(uuid) TO authenticated;

DROP TRIGGER IF EXISTS investor_stakeholder_payout_realtime ON public.investor_stakeholder_payout;
CREATE TRIGGER investor_stakeholder_payout_realtime
  AFTER INSERT OR UPDATE ON public.investor_stakeholder_payout
  FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_investor_event();


-- Reconciliation now checks the independent payout ledger against its allocated rights.
CREATE OR REPLACE FUNCTION app_private.investor_reconciliation(p_usaha_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.assert_investor_admin(p_usaha_id);
  v_current_config_count integer;
  v_future_config_count integer;
  v_investor_count integer;
  v_op_account_count integer;
  v_inv_account_count integer;
  v_opr_account_count integer;
  v_unsettled integer;
  v_pending integer;
  v_currency_count integer;
  v_negative_accounts integer;
  v_review_allocation_count integer;
  v_payout_allocation_mismatch_count integer;
  v_status text;
BEGIN
  SELECT count(*) INTO v_current_config_count
  FROM public.investor_participation
  WHERE usaha_id = p_usaha_id
    AND status = 'active'
    AND effective_from <= CURRENT_DATE
    AND (effective_until IS NULL OR effective_until > CURRENT_DATE);

  SELECT count(*) INTO v_future_config_count
  FROM public.investor_participation
  WHERE usaha_id = p_usaha_id
    AND status = 'active'
    AND effective_from > CURRENT_DATE;

  SELECT count(*) INTO v_investor_count
  FROM public.investor
  WHERE usaha_id = p_usaha_id AND status = 'active';

  SELECT count(*) INTO v_op_account_count
  FROM public.akun_keuangan
  WHERE usaha_id = p_usaha_id AND status = 'active' AND fungsi_akun = 'operasional';

  SELECT count(*) INTO v_inv_account_count
  FROM public.akun_keuangan
  WHERE usaha_id = p_usaha_id AND status = 'active' AND fungsi_akun = 'investor';

  SELECT count(*) INTO v_opr_account_count
  FROM public.akun_keuangan
  WHERE usaha_id = p_usaha_id AND status = 'active' AND fungsi_akun = 'pengelola';

  SELECT count(*) INTO v_unsettled
  FROM (
    SELECT allocation_id FROM public.investor_period_allocation
    WHERE usaha_id = p_usaha_id AND status <> 'settled'
    UNION ALL
    SELECT allocation_id FROM public.operator_period_allocation
    WHERE usaha_id = p_usaha_id AND status <> 'settled'
  ) q;

  SELECT count(*) INTO v_pending
  FROM public.investor_realtime_event
  WHERE usaha_id = p_usaha_id AND delivered_at IS NULL;

  SELECT count(DISTINCT mata_uang) INTO v_currency_count
  FROM public.akun_keuangan
  WHERE usaha_id = p_usaha_id AND status = 'active' AND fungsi_akun = 'operasional';

  SELECT count(*) INTO v_negative_accounts
  FROM public.akun_keuangan a
  WHERE a.usaha_id = p_usaha_id AND a.status = 'active'
    AND app_private.finance_account_balance(a.usaha_id, a.akun_keuangan_id) < 0;

  SELECT count(*) INTO v_review_allocation_count
  FROM (
    SELECT allocation_id FROM public.investor_period_allocation
    WHERE usaha_id = p_usaha_id
      AND (status = 'review_required' OR advance_excess_amount > 0)
    UNION ALL
    SELECT allocation_id FROM public.operator_period_allocation
    WHERE usaha_id = p_usaha_id
      AND (status = 'review_required' OR advance_excess_amount > 0)
  ) q;

  WITH payout_totals AS (
    SELECT
      a.allocation_id, 'investor'::text AS stakeholder_type,
      a.allocation_amount, a.distributed_amount, a.advance_excess_amount,
      0::numeric AS transferred_in_amount,
      coalesce((
        SELECT sum(p.amount) FROM public.investor_stakeholder_payout p
        WHERE p.investor_allocation_id = a.allocation_id AND p.status = 'recorded'
      ), 0) AS paid_total
    FROM public.investor_period_allocation a
    WHERE a.usaha_id = p_usaha_id
    UNION ALL
    SELECT
      a.allocation_id, 'pengelola'::text,
      a.allocation_amount, a.distributed_amount, a.advance_excess_amount,
      a.transferred_in_amount,
      coalesce((
        SELECT sum(p.amount) FROM public.investor_stakeholder_payout p
        WHERE p.operator_allocation_id = a.allocation_id AND p.status = 'recorded'
      ), 0) AS paid_total
    FROM public.operator_period_allocation a
    WHERE a.usaha_id = p_usaha_id
  )
  SELECT count(*) INTO v_payout_allocation_mismatch_count
  FROM payout_totals x
  WHERE x.distributed_amount IS DISTINCT FROM least(
          x.paid_total,
          x.allocation_amount + CASE WHEN x.stakeholder_type = 'pengelola' THEN x.transferred_in_amount ELSE 0 END
        )
     OR x.advance_excess_amount IS DISTINCT FROM CASE
          WHEN x.transferred_in_amount > 0 THEN 0
          ELSE greatest(x.paid_total - x.allocation_amount, 0)
        END;

  IF v_current_config_count = 1
     AND v_investor_count = 1
     AND v_op_account_count >= 1
     AND v_inv_account_count = 1
     AND v_opr_account_count = 1
     AND v_currency_count = 1
     AND v_pending = 0
     AND v_negative_accounts = 0
     AND v_review_allocation_count = 0
     AND v_payout_allocation_mismatch_count = 0 THEN
    v_status := 'HEALTHY';
  ELSE
    v_status := 'ATTENTION';
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'checked_by_admin_id', v_admin_id,
    'current_config_count', v_current_config_count,
    'future_config_count', v_future_config_count,
    'active_investor_count', v_investor_count,
    'operational_account_count', v_op_account_count,
    'investor_account_count', v_inv_account_count,
    'operator_account_count', v_opr_account_count,
    'unsettled_allocations', v_unsettled,
    'review_required_allocations', v_review_allocation_count,
    'payout_allocation_mismatches', v_payout_allocation_mismatch_count,
    'pending_realtime_events', v_pending,
    'operational_currency_count', v_currency_count,
    'negative_operational_or_stakeholder_accounts', v_negative_accounts,
    'negative_result_policy', 'investor_allocation_zero',
    'open_period_formula', 'investor_percentage_x_operational_result'
  );
END;
$function$;


-- Transfer Investor rights internally. A physical bank/cash movement is optional;
-- if both physical account IDs are supplied, the same command records that movement.
CREATE OR REPLACE FUNCTION app_private.command_transfer_investor_entitlement(
  p_usaha_id uuid,
  p_source_investor_allocation_id uuid,
  p_target_type text,
  p_target_operator_allocation_id uuid,
  p_amount numeric,
  p_transferred_at timestamptz,
  p_physical_source_account_id uuid,
  p_physical_target_account_id uuid,
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
  v_admin_id uuid := app_private.assert_investor_admin(p_usaha_id);
  v_allocation public.investor_period_allocation%rowtype;
  v_operator_allocation public.operator_period_allocation%rowtype;
  v_period public.investor_finance_period%rowtype;
  v_source_account public.akun_keuangan%rowtype;
  v_target_account public.akun_keuangan%rowtype;
  v_timezone text;
  v_business_date date;
  v_time timestamptz := coalesce(p_transferred_at, now());
  v_available numeric := 0;
  v_source_remaining numeric := 0;
  v_balance numeric := 0;
  v_operational_cash numeric := 0;
  v_reserve numeric := 0;
  v_currency_count integer := 0;
  v_transfer_id uuid := gen_random_uuid();
  v_transaction_id uuid := gen_random_uuid();
  v_finance_transfer_id uuid := gen_random_uuid();
  v_has_physical boolean := false;
  v_idempotency_id uuid;
  v_hash text;
  v_existing_hash text;
  v_existing_response jsonb;
  v_response jsonb;
  v_note text := nullif(btrim(coalesce(p_catatan, '')), '');
BEGIN
  IF p_usaha_id IS NULL
     OR p_source_investor_allocation_id IS NULL
     OR p_target_type NOT IN ('usaha', 'pengelola')
     OR p_amount IS NULL OR p_amount <= 0
     OR p_request_id IS NULL
     OR nullif(btrim(coalesce(p_idempotency_key, '')), '') IS NULL
     OR ((p_physical_source_account_id IS NULL) <> (p_physical_target_account_id IS NULL))
     OR (p_target_type = 'usaha' AND p_target_operator_allocation_id IS NOT NULL)
     OR (p_target_type = 'pengelola' AND p_target_operator_allocation_id IS NULL)
     OR (p_physical_source_account_id IS NOT NULL
         AND p_physical_source_account_id = p_physical_target_account_id) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tujuan, nominal, atau akun transfer belum lengkap'
      USING ERRCODE = '22023';
  END IF;
  v_has_physical := p_physical_source_account_id IS NOT NULL;
  IF v_time > now() THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: waktu transfer tidak boleh di masa depan'
      USING ERRCODE = '22023';
  END IF;

  -- Resolve the period key before locking rows; all investor/closing commands
  -- take this same lock first.
  SELECT a.* INTO v_allocation
  FROM public.investor_period_allocation a
  WHERE a.usaha_id = p_usaha_id AND a.allocation_id = p_source_investor_allocation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: hak Investor untuk periode tersebut tidak ditemukan'
      USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_period
  FROM public.investor_finance_period p
  WHERE p.usaha_id = p_usaha_id AND p.period_id = v_allocation.period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTEGRITY_ERROR: periode hak Investor tidak ditemukan'
      USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_usaha_id::text || ':' || v_period.period_start::text, 0)
  );

  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'source_investor_allocation_id', p_source_investor_allocation_id,
    'target_type', p_target_type,
    'target_operator_allocation_id', p_target_operator_allocation_id,
    'amount', p_amount,
    'transferred_at', p_transferred_at,
    'physical_source_account_id', p_physical_source_account_id,
    'physical_target_account_id', p_physical_target_account_id,
    'catatan', v_note
  )::text);
  INSERT INTO public.idempotency_key(
    usaha_id, actor_auth_user_id, key, command_name, request_hash
  ) VALUES (
    p_usaha_id, auth.uid(), btrim(p_idempotency_key),
    'transfer_investor_entitlement', v_hash
  )
  ON CONFLICT (usaha_id, actor_auth_user_id, command_name, key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body, request_hash
    INTO v_existing_response, v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id = p_usaha_id
      AND actor_auth_user_id = auth.uid()
      AND command_name = 'transfer_investor_entitlement'
      AND key = btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah dipakai untuk data transfer berbeda'
        USING ERRCODE = '23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: hasil transfer hak belum dapat dipastikan'
      USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_allocation
  FROM public.investor_period_allocation a
  WHERE a.usaha_id = p_usaha_id
    AND a.allocation_id = p_source_investor_allocation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: hak Investor untuk periode tersebut tidak ditemukan'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_allocation.period_id <> v_period.period_id
     OR v_allocation.status = 'review_required'
     OR v_allocation.advance_excess_amount > 0 THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: hak Investor perlu pemeriksaan sebelum dialihkan'
      USING ERRCODE = '23514';
  END IF;
  v_source_remaining := greatest(
    v_allocation.allocation_amount
      - v_allocation.distributed_amount
      - v_allocation.transferred_out_amount,
    0
  );
  IF p_amount > v_source_remaining THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: nominal melebihi sisa hak Investor yang belum dibayar atau dialihkan'
      USING ERRCODE = '23514';
  END IF;

  IF p_target_type = 'pengelola' THEN
    SELECT * INTO v_operator_allocation
    FROM public.operator_period_allocation a
    WHERE a.usaha_id = p_usaha_id
      AND a.allocation_id = p_target_operator_allocation_id
    FOR UPDATE;
    IF NOT FOUND OR v_operator_allocation.period_id <> v_period.period_id THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: alokasi Pengelola harus berasal dari periode closing yang sama'
        USING ERRCODE = '23514';
    END IF;
    IF v_operator_allocation.pengelola_akun_admin_id <> v_period.pengelola_akun_admin_id
       OR v_operator_allocation.status = 'review_required'
       OR v_operator_allocation.advance_excess_amount > 0
       OR v_operator_allocation.currency_code <> v_allocation.currency_code THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: tujuan hak Pengelola tidak cocok atau perlu pemeriksaan'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_has_physical THEN
    SELECT u.timezone INTO v_timezone
    FROM public.usaha u
    WHERE u.usaha_id = p_usaha_id AND u.status = 'active';
    IF v_timezone IS NULL THEN
      RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE = 'P0002';
    END IF;
    v_business_date := (v_time AT TIME ZONE v_timezone)::date;

    -- Lock the operating cash pool consistently before checking the reserve.
    PERFORM 1
    FROM public.akun_keuangan a
    WHERE a.usaha_id = p_usaha_id
      AND a.status = 'active'
      AND a.fungsi_akun = 'operasional'
    ORDER BY a.akun_keuangan_id
    FOR UPDATE;

    SELECT * INTO v_source_account
    FROM public.akun_keuangan a
    WHERE a.usaha_id = p_usaha_id
      AND a.akun_keuangan_id = p_physical_source_account_id
    FOR UPDATE;
    IF NOT FOUND OR v_source_account.status <> 'active' THEN
      RAISE EXCEPTION 'NOT_FOUND: rekening sumber aktif tidak ditemukan' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_target_account
    FROM public.akun_keuangan a
    WHERE a.usaha_id = p_usaha_id
      AND a.akun_keuangan_id = p_physical_target_account_id
    FOR UPDATE;
    IF NOT FOUND OR v_target_account.status <> 'active' THEN
      RAISE EXCEPTION 'NOT_FOUND: rekening tujuan aktif tidak ditemukan' USING ERRCODE = 'P0002';
    END IF;

    IF v_source_account.mata_uang <> v_allocation.currency_code
       OR v_target_account.mata_uang <> v_allocation.currency_code THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: mata uang rekening harus sama dengan mata uang hak Investor'
        USING ERRCODE = '23514';
    END IF;
    IF v_source_account.fungsi_akun NOT IN ('operasional', 'investor') THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: uang fisik harus berasal dari akun usaha atau rekening Investor terkait'
        USING ERRCODE = '23514';
    END IF;
    IF v_source_account.fungsi_akun = 'investor'
       AND v_source_account.investor_id <> v_allocation.investor_id THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: rekening fisik sumber bukan milik Investor terkait'
        USING ERRCODE = '23514';
    END IF;

    IF p_target_type = 'usaha' THEN
      IF v_target_account.fungsi_akun <> 'operasional' THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: tujuan uang fisik untuk Usaha harus berupa akun operasional'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      IF v_target_account.fungsi_akun <> 'pengelola'
         OR v_target_account.pengelola_akun_admin_id <> v_operator_allocation.pengelola_akun_admin_id THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: rekening tujuan bukan rekening fisik Pengelola yang menerima hak'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    v_balance := app_private.finance_account_balance(p_usaha_id, p_physical_source_account_id);
    IF p_amount > v_balance THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: saldo rekening sumber tidak cukup untuk transfer fisik'
        USING ERRCODE = '23514';
    END IF;

    IF v_source_account.fungsi_akun = 'operasional'
       AND v_target_account.fungsi_akun = 'pengelola' THEN
      SELECT p.operational_reserve_amount INTO v_reserve
      FROM public.investor_participation p
      WHERE p.usaha_id = p_usaha_id AND p.status = 'active'
        AND p.effective_from <= v_business_date
        AND (p.effective_until IS NULL OR p.effective_until > v_business_date)
      ORDER BY p.effective_from DESC
      LIMIT 1
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: cadangan operasional saat ini tidak dapat diverifikasi'
          USING ERRCODE = '23514';
      END IF;
      SELECT (x.payload->>'saldo')::numeric, (x.payload->>'currency_count')::integer
      INTO v_operational_cash, v_currency_count
      FROM (SELECT app_private.finance_operational_cash_summary(p_usaha_id) payload) x;
      IF v_currency_count <> 1 OR v_operational_cash IS NULL THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: saldo operasional perlu diperiksa sebelum transfer'
          USING ERRCODE = '23514';
      END IF;
      IF v_operational_cash - p_amount < v_reserve THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: transfer akan mengurangi dana usaha di bawah cadangan operasional'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    INSERT INTO public.transaksi_keuangan(
      transaksi_keuangan_id, usaha_id, nomor_transaksi, jenis, arah, tanggal_transaksi,
      amount, currency_code, sumber_type, sumber_id, status, catatan
    ) VALUES (
      v_transaction_id, p_usaha_id,
      app_private.next_business_number(p_usaha_id, 'TRX', to_char(v_time AT TIME ZONE v_timezone, 'YYYY'))::text,
      'transfer', 'transfer', v_time, p_amount, v_allocation.currency_code,
      'investor_entitlement_transfer', v_transfer_id, 'recorded', v_note
    );

    INSERT INTO public.transfer_akun_keuangan(
      transfer_akun_keuangan_id, usaha_id, transaksi_keuangan_id,
      dari_akun_keuangan_id, ke_akun_keuangan_id, amount, mata_uang,
      dipindahkan_at, dicatat_by_admin_id, request_id, catatan, status
    ) VALUES (
      v_finance_transfer_id, p_usaha_id, v_transaction_id,
      p_physical_source_account_id, p_physical_target_account_id, p_amount,
      v_allocation.currency_code, v_time, v_admin_id, p_request_id, v_note, 'recorded'
    );
  END IF;

  INSERT INTO public.investor_entitlement_transfer(
    transfer_id, usaha_id, period_id, source_investor_allocation_id, target_type,
    target_operator_allocation_id, physical_source_account_id, physical_target_account_id,
    transaksi_keuangan_id, transfer_akun_keuangan_id, amount, currency_code, transferred_at,
    dicatat_by_admin_id, request_id, catatan, status
  ) VALUES (
    v_transfer_id, p_usaha_id, v_period.period_id, v_allocation.allocation_id, p_target_type,
    p_target_operator_allocation_id,
    CASE WHEN v_has_physical THEN p_physical_source_account_id END,
    CASE WHEN v_has_physical THEN p_physical_target_account_id END,
    CASE WHEN v_has_physical THEN v_transaction_id END,
    CASE WHEN v_has_physical THEN v_finance_transfer_id END,
    p_amount, v_allocation.currency_code, v_time, v_admin_id, p_request_id, v_note, 'recorded'
  );

  -- This is entitlement reclassification, not an external payment.
  UPDATE public.investor_period_allocation a
  SET transferred_out_amount = a.transferred_out_amount + p_amount,
      status = CASE
        WHEN a.distributed_amount + a.transferred_out_amount + p_amount >= a.allocation_amount
          AND a.allocation_amount > 0 THEN 'settled'
        WHEN a.distributed_amount + a.transferred_out_amount + p_amount > 0 THEN 'partially_distributed'
        ELSE 'allocated'
      END
  WHERE a.allocation_id = v_allocation.allocation_id;

  IF p_target_type = 'pengelola' THEN
    UPDATE public.operator_period_allocation a
    SET transferred_in_amount = a.transferred_in_amount + p_amount,
        status = CASE
          WHEN a.distributed_amount >= a.allocation_amount + a.transferred_in_amount + p_amount
            AND a.allocation_amount + a.transferred_in_amount + p_amount > 0 THEN 'settled'
          WHEN a.distributed_amount > 0 THEN 'partially_distributed'
          ELSE 'allocated'
        END
    WHERE a.allocation_id = v_operator_allocation.allocation_id;
  END IF;

  IF v_has_physical THEN
    INSERT INTO public.pergerakan_akun_keuangan(
      usaha_id, akun_keuangan_id, transaksi_keuangan_id, arah, amount, mata_uang,
      terjadi_at, sumber_type, sumber_id, status, dicatat_by_admin_id, request_id, catatan
    ) VALUES
      (p_usaha_id, p_physical_source_account_id, v_transaction_id, 'keluar', p_amount,
        v_allocation.currency_code, v_time, 'investor_entitlement_transfer', v_transfer_id,
        'recorded', v_admin_id, p_request_id, v_note),
      (p_usaha_id, p_physical_target_account_id, v_transaction_id, 'masuk', p_amount,
        v_allocation.currency_code, v_time, 'investor_entitlement_transfer', v_transfer_id,
        'recorded', v_admin_id, p_request_id, v_note);
  END IF;

  v_available := greatest(
    v_allocation.allocation_amount - v_allocation.distributed_amount
      - v_allocation.transferred_out_amount - p_amount,
    0
  );
  v_response := jsonb_build_object(
    'status', 'recorded',
    'transfer_id', v_transfer_id,
    'period_id', v_period.period_id,
    'period_start', v_period.period_start,
    'source_investor_allocation_id', v_allocation.allocation_id,
    'target_type', p_target_type,
    'target_operator_allocation_id', p_target_operator_allocation_id,
    'amount', p_amount,
    'currency_code', v_allocation.currency_code,
    'remaining_investor_right', v_available,
    'physical_money_moved', v_has_physical,
    'transaction_id', CASE WHEN v_has_physical THEN v_transaction_id END,
    'finance_transfer_id', CASE WHEN v_has_physical THEN v_finance_transfer_id END,
    'affects_operational_result', false
  );

  INSERT INTO public.audit_log(
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action, entity_type, entity_id,
    source_application, request_id, change_summary
  ) VALUES (
    p_usaha_id, auth.uid(), v_admin_id, 'transfer_investor_entitlement',
    'investor_entitlement_transfer', v_transfer_id, 'admin-command', p_request_id, v_response
  );
  INSERT INTO public.outbox_event(usaha_id, event_type, aggregate_type, aggregate_id, payload)
  VALUES (
    p_usaha_id, 'investor.entitlement.transferred', 'investor_entitlement_transfer',
    v_transfer_id, v_response
  );
  UPDATE public.idempotency_key
  SET response_status = 200, response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION public.command_transfer_investor_entitlement(
  p_usaha_id uuid,
  p_source_investor_allocation_id uuid,
  p_target_type text,
  p_target_operator_allocation_id uuid,
  p_amount numeric,
  p_transferred_at timestamptz,
  p_physical_source_account_id uuid,
  p_physical_target_account_id uuid,
  p_catatan text,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_transfer_investor_entitlement(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
  );
$function$;

REVOKE ALL ON FUNCTION app_private.command_transfer_investor_entitlement(uuid,uuid,text,uuid,numeric,timestamptz,uuid,uuid,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.command_transfer_investor_entitlement(uuid,uuid,text,uuid,numeric,timestamptz,uuid,uuid,text,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.command_transfer_investor_entitlement(uuid,uuid,text,uuid,numeric,timestamptz,uuid,uuid,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.command_transfer_investor_entitlement(uuid,uuid,text,uuid,numeric,timestamptz,uuid,uuid,text,text,uuid) TO authenticated;


-- Keep the existing account/allocation endpoint compatible while reflecting
-- the independent transfer-of-rights ledger in remaining balances.
CREATE OR REPLACE FUNCTION app_private.get_investor_stakeholder_accounts(p_usaha_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_access text := app_private.assert_investor_read_access(p_usaha_id);
  v_investor_id uuid;
  v_items jsonb;
  v_investor_allocations jsonb;
  v_operator_allocations jsonb;
BEGIN
  IF v_access = 'investor' THEN
    v_investor_id := app_private.get_investor_id_for_principal(p_usaha_id);
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'akun_keuangan_id', a.akun_keuangan_id,
    'nama_akun', a.nama_akun,
    'fungsi_akun', a.fungsi_akun,
    'investor_id', a.investor_id,
    'pengelola_akun_admin_id', a.pengelola_akun_admin_id,
    'mata_uang', a.mata_uang,
    'saldo', round(app_private.finance_account_balance(a.usaha_id, a.akun_keuangan_id), 2)
  ) ORDER BY a.fungsi_akun, a.nama_akun), '[]'::jsonb)
  INTO v_items
  FROM public.akun_keuangan a
  WHERE a.usaha_id = p_usaha_id
    AND a.status = 'active'
    AND a.fungsi_akun IN ('investor', 'pengelola')
    AND (
      v_access = 'admin'
      OR (v_access = 'investor' AND a.fungsi_akun = 'investor' AND a.investor_id = v_investor_id)
    );

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'allocation_id', a.allocation_id,
    'investor_id', a.investor_id,
    'period_start', p.period_start,
    'period_end_exclusive', p.period_end_exclusive,
    'currency_code', a.currency_code,
    'allocation_amount', a.allocation_amount,
    'distributed_amount', a.distributed_amount,
    'transferred_out_amount', a.transferred_out_amount,
    'transferred_in_amount', 0,
    'remaining_amount', round(greatest(a.allocation_amount - a.distributed_amount - a.transferred_out_amount, 0), 2),
    'status', a.status
  ) ORDER BY p.period_start DESC), '[]'::jsonb)
  INTO v_investor_allocations
  FROM public.investor_period_allocation a
  JOIN public.investor_finance_period p
    ON p.period_id = a.period_id AND p.usaha_id = a.usaha_id
  WHERE a.usaha_id = p_usaha_id
    AND a.allocation_amount > a.distributed_amount + a.transferred_out_amount
    AND (v_access = 'admin' OR (v_access = 'investor' AND a.investor_id = v_investor_id));

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'allocation_id', a.allocation_id,
    'pengelola_akun_admin_id', a.pengelola_akun_admin_id,
    'period_start', p.period_start,
    'period_end_exclusive', p.period_end_exclusive,
    'currency_code', a.currency_code,
    'allocation_amount', a.allocation_amount,
    'distributed_amount', a.distributed_amount,
    'transferred_out_amount', 0,
    'transferred_in_amount', a.transferred_in_amount,
    'remaining_amount', round(greatest(a.allocation_amount + a.transferred_in_amount - a.distributed_amount, 0), 2),
    'status', a.status
  ) ORDER BY p.period_start DESC), '[]'::jsonb)
  INTO v_operator_allocations
  FROM public.operator_period_allocation a
  JOIN public.investor_finance_period p
    ON p.period_id = a.period_id AND p.usaha_id = a.usaha_id
  WHERE a.usaha_id = p_usaha_id
    AND a.status <> 'review_required'
    AND a.advance_excess_amount = 0
    AND v_access = 'admin';

  RETURN jsonb_build_object(
    'status', 'OK',
    'accounts', v_items,
    'investor_allocations', v_investor_allocations,
    'operator_allocations', v_operator_allocations
  );
END;
$function$;
