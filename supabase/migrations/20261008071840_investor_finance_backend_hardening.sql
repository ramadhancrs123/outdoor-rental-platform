
-- Investor / Finance backend hardening
-- Business decisions locked 2026-10-08:
-- * operational account is the only operational cash pool;
-- * investor/operator balances are non-operational;
-- * open-period estimate = max(Net Operational Result, 0) * investor %;
-- * negative period result => investor allocation 0;
-- * reserve is retained in operational cash at closing/distribution;
-- * allocation and actual distribution are separate facts;
-- * period closing snapshots the result immutably.

ALTER TABLE public.akun_keuangan
  ADD COLUMN IF NOT EXISTS fungsi_akun text NOT NULL DEFAULT 'operasional',
  ADD COLUMN IF NOT EXISTS investor_id uuid,
  ADD COLUMN IF NOT EXISTS pengelola_akun_admin_id uuid;

ALTER TABLE public.akun_keuangan DROP CONSTRAINT IF EXISTS akun_keuangan_fungsi_akun_chk;
ALTER TABLE public.akun_keuangan
  ADD CONSTRAINT akun_keuangan_fungsi_akun_chk
  CHECK (
    (fungsi_akun='operasional' AND investor_id IS NULL AND pengelola_akun_admin_id IS NULL)
    OR (fungsi_akun='investor' AND investor_id IS NOT NULL AND pengelola_akun_admin_id IS NULL)
    OR (fungsi_akun='pengelola' AND investor_id IS NULL AND pengelola_akun_admin_id IS NOT NULL)
  );

ALTER TABLE public.akun_keuangan DROP CONSTRAINT IF EXISTS akun_keuangan_investor_fk;
ALTER TABLE public.akun_keuangan
  ADD CONSTRAINT akun_keuangan_investor_fk
  FOREIGN KEY (usaha_id,investor_id)
  REFERENCES public.investor(usaha_id,investor_id)
  ON DELETE RESTRICT;

ALTER TABLE public.akun_keuangan DROP CONSTRAINT IF EXISTS akun_keuangan_pengelola_fk;
ALTER TABLE public.akun_keuangan
  ADD CONSTRAINT akun_keuangan_pengelola_fk
  FOREIGN KEY (pengelola_akun_admin_id)
  REFERENCES public.akun_admin(akun_admin_id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS akun_keuangan_fungsi_usaha_idx
  ON public.akun_keuangan(usaha_id,fungsi_akun,status);

CREATE UNIQUE INDEX IF NOT EXISTS akun_keuangan_investor_active_unik
  ON public.akun_keuangan(usaha_id,investor_id)
  WHERE status='active' AND fungsi_akun='investor';

CREATE UNIQUE INDEX IF NOT EXISTS akun_keuangan_pengelola_active_unik
  ON public.akun_keuangan(usaha_id,pengelola_akun_admin_id)
  WHERE status='active' AND fungsi_akun='pengelola';

ALTER TABLE public.investor_participation
  ADD COLUMN IF NOT EXISTS operational_reserve_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pengelola_akun_admin_id uuid;

ALTER TABLE public.investor_participation DROP CONSTRAINT IF EXISTS investor_participation_reserve_chk;
ALTER TABLE public.investor_participation
  ADD CONSTRAINT investor_participation_reserve_chk
  CHECK (operational_reserve_amount >= 0);

ALTER TABLE public.investor_participation DROP CONSTRAINT IF EXISTS investor_participation_operator_fk;
ALTER TABLE public.investor_participation
  ADD CONSTRAINT investor_participation_operator_fk
  FOREIGN KEY (pengelola_akun_admin_id)
  REFERENCES public.akun_admin(akun_admin_id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS investor_participation_operator_idx
  ON public.investor_participation(usaha_id,pengelola_akun_admin_id,effective_from DESC);

CREATE UNIQUE INDEX IF NOT EXISTS investor_participation_usaha_effective_unik
  ON public.investor_participation(usaha_id,effective_from);

CREATE TABLE IF NOT EXISTS public.investor_finance_period (
  period_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  participation_id uuid NOT NULL,
  investor_id uuid NOT NULL,
  pengelola_akun_admin_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end_exclusive date NOT NULL,
  timezone text NOT NULL,
  currency_code char(3) NOT NULL,
  investor_percentage numeric(7,4) NOT NULL,
  operational_reserve_amount numeric NOT NULL,
  income_recorded numeric NOT NULL DEFAULT 0,
  expense_recorded numeric NOT NULL DEFAULT 0,
  net_operational_result numeric NOT NULL DEFAULT 0,
  investor_allocation numeric NOT NULL DEFAULT 0,
  operator_allocation numeric NOT NULL DEFAULT 0,
  operational_cash_at_close numeric NOT NULL DEFAULT 0,
  distributable_cash_at_close numeric NOT NULL DEFAULT 0,
  reserve_shortfall_at_close numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'closed',
  closed_by_admin_id uuid NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT investor_finance_period_window_chk CHECK (period_end_exclusive>period_start),
  CONSTRAINT investor_finance_period_status_chk CHECK (status='closed'),
  CONSTRAINT investor_finance_period_amount_chk CHECK (
    income_recorded>=0 AND expense_recorded>=0 AND operational_reserve_amount>=0
    AND investor_allocation>=0 AND operator_allocation>=0
    AND operational_cash_at_close>=0 AND distributable_cash_at_close>=0
    AND reserve_shortfall_at_close>=0
  ),
  CONSTRAINT investor_finance_period_participation_fk
    FOREIGN KEY (participation_id) REFERENCES public.investor_participation(participation_id) ON DELETE RESTRICT,
  CONSTRAINT investor_finance_period_investor_fk
    FOREIGN KEY (usaha_id,investor_id) REFERENCES public.investor(usaha_id,investor_id) ON DELETE RESTRICT,
  CONSTRAINT investor_finance_period_operator_fk
    FOREIGN KEY (pengelola_akun_admin_id) REFERENCES public.akun_admin(akun_admin_id) ON DELETE RESTRICT,
  CONSTRAINT investor_finance_period_closed_by_fk
    FOREIGN KEY (closed_by_admin_id) REFERENCES public.akun_admin(akun_admin_id) ON DELETE RESTRICT,
  CONSTRAINT investor_finance_period_unik UNIQUE (usaha_id,period_start)
);

CREATE INDEX IF NOT EXISTS investor_finance_period_lookup_idx
  ON public.investor_finance_period(usaha_id,period_start DESC);

ALTER TABLE public.investor_finance_period ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.investor_finance_period FROM anon,authenticated;

CREATE TABLE IF NOT EXISTS public.investor_period_allocation (
  allocation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  period_id uuid NOT NULL,
  investor_id uuid NOT NULL,
  currency_code char(3) NOT NULL,
  result_basis_amount numeric NOT NULL,
  percentage numeric(7,4) NOT NULL,
  allocation_amount numeric NOT NULL,
  distributed_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'allocated',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT investor_period_allocation_amount_chk CHECK (
    result_basis_amount>=0 AND percentage BETWEEN 0 AND 100
    AND allocation_amount>=0 AND distributed_amount>=0
    AND distributed_amount<=allocation_amount
  ),
  CONSTRAINT investor_period_allocation_status_chk CHECK (
    status IN ('allocated','partially_distributed','settled')
  ),
  CONSTRAINT investor_period_allocation_period_fk
    FOREIGN KEY (period_id) REFERENCES public.investor_finance_period(period_id) ON DELETE RESTRICT,
  CONSTRAINT investor_period_allocation_investor_fk
    FOREIGN KEY (usaha_id,investor_id) REFERENCES public.investor(usaha_id,investor_id) ON DELETE RESTRICT,
  CONSTRAINT investor_period_allocation_unik UNIQUE (period_id,investor_id)
);

ALTER TABLE public.investor_period_allocation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.investor_period_allocation FROM anon,authenticated;

CREATE TABLE IF NOT EXISTS public.operator_period_allocation (
  allocation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  period_id uuid NOT NULL,
  pengelola_akun_admin_id uuid NOT NULL,
  currency_code char(3) NOT NULL,
  result_basis_amount numeric NOT NULL,
  percentage numeric(7,4) NOT NULL,
  allocation_amount numeric NOT NULL,
  distributed_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'allocated',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operator_period_allocation_amount_chk CHECK (
    result_basis_amount>=0 AND percentage BETWEEN 0 AND 100
    AND allocation_amount>=0 AND distributed_amount>=0
    AND distributed_amount<=allocation_amount
  ),
  CONSTRAINT operator_period_allocation_status_chk CHECK (
    status IN ('allocated','partially_distributed','settled')
  ),
  CONSTRAINT operator_period_allocation_period_fk
    FOREIGN KEY (period_id) REFERENCES public.investor_finance_period(period_id) ON DELETE RESTRICT,
  CONSTRAINT operator_period_allocation_operator_fk
    FOREIGN KEY (pengelola_akun_admin_id) REFERENCES public.akun_admin(akun_admin_id) ON DELETE RESTRICT,
  CONSTRAINT operator_period_allocation_unik UNIQUE (period_id,pengelola_akun_admin_id)
);

ALTER TABLE public.operator_period_allocation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operator_period_allocation FROM anon,authenticated;

CREATE TABLE IF NOT EXISTS public.investor_period_distribution (
  distribution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  allocation_id uuid NOT NULL,
  source_account_id uuid NOT NULL,
  target_account_id uuid NOT NULL,
  transfer_id uuid NOT NULL,
  amount numeric NOT NULL,
  currency_code char(3) NOT NULL,
  distributed_at timestamptz NOT NULL,
  dicatat_by_admin_id uuid NOT NULL,
  request_id uuid NOT NULL,
  catatan text,
  status text NOT NULL DEFAULT 'recorded',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT investor_period_distribution_amount_chk CHECK (amount>0),
  CONSTRAINT investor_period_distribution_status_chk CHECK (status='recorded'),
  CONSTRAINT investor_period_distribution_allocation_fk
    FOREIGN KEY (allocation_id) REFERENCES public.investor_period_allocation(allocation_id) ON DELETE RESTRICT,
  CONSTRAINT investor_period_distribution_source_fk
    FOREIGN KEY (source_account_id) REFERENCES public.akun_keuangan(akun_keuangan_id) ON DELETE RESTRICT,
  CONSTRAINT investor_period_distribution_target_fk
    FOREIGN KEY (target_account_id) REFERENCES public.akun_keuangan(akun_keuangan_id) ON DELETE RESTRICT,
  CONSTRAINT investor_period_distribution_transfer_fk
    FOREIGN KEY (transfer_id) REFERENCES public.transfer_akun_keuangan(transfer_akun_keuangan_id) ON DELETE RESTRICT
);

ALTER TABLE public.investor_period_distribution ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.investor_period_distribution FROM anon,authenticated;

CREATE TABLE IF NOT EXISTS public.operator_period_withdrawal (
  withdrawal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  allocation_id uuid NOT NULL,
  source_account_id uuid NOT NULL,
  target_account_id uuid NOT NULL,
  transfer_id uuid NOT NULL,
  amount numeric NOT NULL,
  currency_code char(3) NOT NULL,
  withdrawn_at timestamptz NOT NULL,
  dicatat_by_admin_id uuid NOT NULL,
  request_id uuid NOT NULL,
  catatan text,
  status text NOT NULL DEFAULT 'recorded',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operator_period_withdrawal_amount_chk CHECK (amount>0),
  CONSTRAINT operator_period_withdrawal_status_chk CHECK (status='recorded'),
  CONSTRAINT operator_period_withdrawal_allocation_fk
    FOREIGN KEY (allocation_id) REFERENCES public.operator_period_allocation(allocation_id) ON DELETE RESTRICT,
  CONSTRAINT operator_period_withdrawal_source_fk
    FOREIGN KEY (source_account_id) REFERENCES public.akun_keuangan(akun_keuangan_id) ON DELETE RESTRICT,
  CONSTRAINT operator_period_withdrawal_target_fk
    FOREIGN KEY (target_account_id) REFERENCES public.akun_keuangan(akun_keuangan_id) ON DELETE RESTRICT,
  CONSTRAINT operator_period_withdrawal_transfer_fk
    FOREIGN KEY (transfer_id) REFERENCES public.transfer_akun_keuangan(transfer_akun_keuangan_id) ON DELETE RESTRICT
);

ALTER TABLE public.operator_period_withdrawal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operator_period_withdrawal FROM anon,authenticated;

CREATE TABLE IF NOT EXISTS public.investor_realtime_event (
  event_seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivered_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text
);

CREATE INDEX IF NOT EXISTS investor_realtime_event_usaha_seq_idx
  ON public.investor_realtime_event(usaha_id,event_seq DESC);

ALTER TABLE public.investor_realtime_event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.investor_realtime_event FROM anon,authenticated;

DROP TRIGGER IF EXISTS investor_finance_period_updated_at ON public.investor_finance_period;
CREATE TRIGGER investor_finance_period_updated_at
BEFORE UPDATE ON public.investor_finance_period
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

DROP TRIGGER IF EXISTS investor_period_allocation_updated_at ON public.investor_period_allocation;
CREATE TRIGGER investor_period_allocation_updated_at
BEFORE UPDATE ON public.investor_period_allocation
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

DROP TRIGGER IF EXISTS operator_period_allocation_updated_at ON public.operator_period_allocation;
CREATE TRIGGER operator_period_allocation_updated_at
BEFORE UPDATE ON public.operator_period_allocation
FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE OR REPLACE FUNCTION app_private.finance_account_balance(p_usaha_id uuid,p_akun_keuangan_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT
    coalesce((SELECT max(o.nominal) FROM public.saldo_awal_akun_keuangan o
      WHERE o.usaha_id=p_usaha_id AND o.akun_keuangan_id=p_akun_keuangan_id),0)
    + coalesce((SELECT sum(m.amount) FROM public.pergerakan_akun_keuangan m
      WHERE m.usaha_id=p_usaha_id AND m.akun_keuangan_id=p_akun_keuangan_id
        AND m.status='recorded' AND m.arah='masuk'),0)
    - coalesce((SELECT sum(m.amount) FROM public.pergerakan_akun_keuangan m
      WHERE m.usaha_id=p_usaha_id AND m.akun_keuangan_id=p_akun_keuangan_id
        AND m.status='recorded' AND m.arah='keluar'),0);
$function$;

CREATE OR REPLACE FUNCTION app_private.finance_operational_cash_summary(p_usaha_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_access text:=app_private.assert_investor_read_access(p_usaha_id);
  v_result jsonb;
BEGIN
  WITH b AS (
    SELECT a.akun_keuangan_id,a.nama_akun,a.mata_uang,
           app_private.finance_account_balance(p_usaha_id,a.akun_keuangan_id) saldo
    FROM public.akun_keuangan a
    WHERE a.usaha_id=p_usaha_id AND a.status='active' AND a.fungsi_akun='operasional'
  )
  SELECT jsonb_build_object(
    'principal',v_access,
    'accounts',coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
        'akun_keuangan_id',akun_keuangan_id,'nama_akun',nama_akun,
        'mata_uang',mata_uang,'saldo',round(saldo,2)
      ) ORDER BY nama_akun) FROM b),'[]'::jsonb),
    'saldo',round(coalesce(sum(saldo),0),2),
    'currency_count',count(DISTINCT mata_uang)
  ) INTO v_result
  FROM b;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.guard_finance_account_movement()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_account public.akun_keuangan%rowtype;
  v_balance numeric;
BEGIN
  SELECT * INTO v_account
  FROM public.akun_keuangan
  WHERE usaha_id=NEW.usaha_id AND akun_keuangan_id=NEW.akun_keuangan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: akun uang untuk pergerakan tidak ditemukan' USING ERRCODE='P0002';
  END IF;
  IF v_account.status<>'active' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: akun uang tidak aktif' USING ERRCODE='23514';
  END IF;
  IF v_account.mata_uang<>NEW.mata_uang THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: currency pergerakan tidak sama dengan akun' USING ERRCODE='23514';
  END IF;

  IF NEW.arah='keluar' THEN
    IF v_account.fungsi_akun<>'operasional' THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: akun investor/pengelola tidak boleh menjadi sumber pengeluaran atau transfer umum'
        USING ERRCODE='23514';
    END IF;
    v_balance:=app_private.finance_account_balance(NEW.usaha_id,NEW.akun_keuangan_id);
    IF NEW.amount>v_balance THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: saldo akun tidak cukup. Tersedia Rp %, dibutuhkan Rp %',
        round(v_balance,2),round(NEW.amount,2) USING ERRCODE='23514';
    END IF;
  END IF;

  IF NEW.sumber_type='payment' AND v_account.fungsi_akun<>'operasional' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: payment harus masuk ke akun usaha operasional' USING ERRCODE='23514';
  END IF;

  IF NEW.sumber_type='transfer_akun' AND v_account.fungsi_akun<>'operasional' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: transfer akun umum hanya untuk akun usaha operasional' USING ERRCODE='23514';
  END IF;

  IF NEW.sumber_type='investor_distribution' AND NEW.arah='masuk'
     AND (v_account.fungsi_akun<>'investor') THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: target distribution harus akun investor' USING ERRCODE='23514';
  END IF;

  IF NEW.sumber_type='operator_withdrawal' AND NEW.arah='masuk'
     AND (v_account.fungsi_akun<>'pengelola') THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: target withdrawal harus akun pengelola' USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS finance_account_movement_guard ON public.pergerakan_akun_keuangan;
CREATE TRIGGER finance_account_movement_guard
BEFORE INSERT ON public.pergerakan_akun_keuangan
FOR EACH ROW EXECUTE FUNCTION app_private.guard_finance_account_movement();

CREATE OR REPLACE FUNCTION app_private.resolve_investor_participation(
  p_usaha_id uuid,p_investor_id uuid,p_period_start date
)
RETURNS public.investor_participation
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE r public.investor_participation;
BEGIN
  SELECT p.* INTO r FROM public.investor_participation p
  WHERE p.usaha_id=p_usaha_id AND p.investor_id=p_investor_id AND p.status='active'
    AND p.effective_from<=p_period_start
    AND (p.effective_until IS NULL OR p.effective_until>p_period_start)
  ORDER BY p.effective_from DESC LIMIT 1;
  RETURN r;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.calculate_investor_period(
  p_usaha_id uuid,p_investor_id uuid,p_period_start date,p_period_end_exclusive date
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_p public.investor_participation;
  v_closed public.investor_finance_period%rowtype;
  v_timezone text;
  v_income numeric:=0;
  v_expense numeric:=0;
  v_net numeric:=0;
  v_investor numeric:=0;
  v_operator numeric:=0;
  v_cash numeric:=0;
  v_estimated_distributable numeric:=0;
  v_currencies jsonb:='[]'::jsonb;
  v_currency_count integer:=0;
  v_operational_currency_count integer:=0;
  v_count integer:=0;
BEGIN
  SELECT u.timezone INTO v_timezone FROM public.usaha u
  WHERE u.usaha_id=p_usaha_id AND u.status='active';
  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  SELECT * INTO v_p FROM app_private.resolve_investor_participation(
    p_usaha_id,p_investor_id,p_period_start
  );
  IF v_p.participation_id IS NULL THEN
    RAISE EXCEPTION 'CONFIG_REQUIRED: konfigurasi investor belum tersedia' USING ERRCODE='55000';
  END IF;

  SELECT * INTO v_closed FROM public.investor_finance_period x
  WHERE x.usaha_id=p_usaha_id AND x.period_start=p_period_start
  LIMIT 1;

  IF v_closed.period_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'usaha_id',p_usaha_id,'investor_id',p_investor_id,
      'participation_id',v_closed.participation_id,'period_id',v_closed.period_id,
      'period_state','CLOSED','status','OK',
      'period',jsonb_build_object('start',v_closed.period_start,'end_exclusive',v_closed.period_end_exclusive,'timezone',v_closed.timezone),
      'basis_type','net_operational_result','percentage',v_closed.investor_percentage,
      'reserve_amount',v_closed.operational_reserve_amount,
      'income_recorded',round(v_closed.income_recorded,2),
      'expense_recorded',round(v_closed.expense_recorded,2),
      'net_operational_result',round(v_closed.net_operational_result,2),
      'investor_entitlement',round(v_closed.investor_allocation,2),
      'operator_remainder',round(v_closed.operator_allocation,2),
      'operational_cash',round(v_closed.operational_cash_at_close,2),
      'estimated_distributable_cash',round(v_closed.distributable_cash_at_close,2),
      'currency_count',1,'currencies',jsonb_build_array(v_closed.currency_code),
      'allocation_status','CLOSED_FINAL','calculation_policy','INVESTOR_PERCENT_X_OPERATIONAL_RESULT',
      'calculated_at',clock_timestamp(),'freshness','DIRECT_FRESH'
    );
  END IF;

  SELECT count(DISTINCT t.currency_code),
         coalesce(jsonb_agg(DISTINCT t.currency_code),'[]'::jsonb),
         coalesce(sum(CASE WHEN t.arah='income' THEN t.amount ELSE 0 END),0),
         coalesce(sum(CASE WHEN t.arah='expense' THEN t.amount ELSE 0 END),0),
         count(*)
  INTO v_currency_count,v_currencies,v_income,v_expense,v_count
  FROM public.transaksi_keuangan t
  WHERE t.usaha_id=p_usaha_id AND t.status='recorded' AND t.arah IN ('income','expense')
    AND t.tanggal_transaksi >= (p_period_start::text||' 00:00:00 '||v_timezone)::timestamptz
    AND t.tanggal_transaksi < (p_period_end_exclusive::text||' 00:00:00 '||v_timezone)::timestamptz;

  SELECT (x.payload->>'saldo')::numeric,(x.payload->>'currency_count')::integer
  INTO v_cash,v_operational_currency_count
  FROM (SELECT app_private.finance_operational_cash_summary(p_usaha_id) payload) x;

  v_net:=v_income-v_expense;

  IF v_currency_count<=1 THEN
    v_investor:=round(greatest(v_net,0)*(v_p.percentage/100),2);
    v_operator:=round(greatest(v_net,0)-v_investor,2);
    v_estimated_distributable:=round(greatest(v_cash-v_p.operational_reserve_amount,0),2);
  END IF;

  RETURN jsonb_build_object(
    'usaha_id',p_usaha_id,'investor_id',p_investor_id,
    'participation_id',v_p.participation_id,'period_id',NULL,
    'period_state','OPEN','status','OK',
    'period',jsonb_build_object('start',p_period_start,'end_exclusive',p_period_end_exclusive,'timezone',v_timezone),
    'basis_type',v_p.basis_type,'percentage',v_p.percentage,
    'reserve_amount',v_p.operational_reserve_amount,
    'income_recorded',round(v_income,2),'expense_recorded',round(v_expense,2),
    'net_operational_result',round(v_net,2),
    'investor_entitlement',v_investor,'operator_remainder',v_operator,
    'operational_cash',round(coalesce(v_cash,0),2),
    'estimated_distributable_cash',v_estimated_distributable,
    'transaction_count',v_count,'currency_count',v_currency_count,
    'operational_currency_count',v_operational_currency_count,
    'currencies',v_currencies,
    'allocation_status',CASE
      WHEN v_currency_count=0 THEN 'NO_FINANCIAL_ACTIVITY'
      WHEN v_currency_count=1 AND v_operational_currency_count<=1 THEN 'CALCULATED'
      ELSE 'MULTI_CURRENCY_REVIEW_REQUIRED' END,
    'calculation_policy','INVESTOR_PERCENT_X_OPERATIONAL_RESULT',
    'calculated_at',clock_timestamp(),'freshness','DIRECT_FRESH'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.get_investor_overview(
  p_usaha_id uuid,p_as_of_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_access text:=app_private.assert_investor_read_access(p_usaha_id);
  v_iid uuid;
  v_p public.investor_participation;
  v_ps date;
  v_pe date;
  v_name text;
  v_timezone text;
BEGIN
  SELECT u.timezone INTO v_timezone FROM public.usaha u
  WHERE u.usaha_id=p_usaha_id AND u.status='active';
  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  IF v_access='investor' THEN
    v_iid:=app_private.get_investor_id_for_principal(p_usaha_id);
  ELSE
    SELECT p.investor_id INTO v_iid
    FROM public.investor_participation p
    WHERE p.usaha_id=p_usaha_id AND p.status='active'
      AND p.effective_from<=p_as_of_date
      AND (p.effective_until IS NULL OR p.effective_until>p_as_of_date)
    ORDER BY p.effective_from DESC LIMIT 1;
    IF v_iid IS NULL THEN
      RETURN jsonb_build_object('status','NO_INVESTOR_CONFIG','usaha_id',p_usaha_id,'principal',v_access,'timezone',v_timezone);
    END IF;
  END IF;

  SELECT p.* INTO v_p FROM public.investor_participation p
  WHERE p.usaha_id=p_usaha_id AND p.investor_id=v_iid AND p.status='active'
    AND p.effective_from<=p_as_of_date
    AND (p.effective_until IS NULL OR p.effective_until>p_as_of_date)
  ORDER BY p.effective_from DESC LIMIT 1;

  IF v_p.participation_id IS NULL THEN
    RETURN jsonb_build_object('status','NO_INVESTOR_CONFIG','usaha_id',p_usaha_id,'investor_id',v_iid,'principal',v_access,'timezone',v_timezone);
  END IF;

  SELECT period_start,period_end_exclusive INTO v_ps,v_pe
  FROM app_private.investor_period_for_date(p_as_of_date,v_p.period_start_day,v_p.period_end_day);

  SELECT i.nama_tampilan INTO v_name FROM public.investor i
  WHERE i.usaha_id=p_usaha_id AND i.investor_id=v_iid;

  RETURN app_private.calculate_investor_period(p_usaha_id,v_iid,v_ps,v_pe)
    || jsonb_build_object('principal',v_access,'investor_name',v_name);
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.get_investor_period_result(
  p_usaha_id uuid,p_period_start date,p_period_end_exclusive date
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_access text:=app_private.assert_investor_read_access(p_usaha_id);
  v_iid uuid;
BEGIN
  IF v_access='investor' THEN
    v_iid:=app_private.get_investor_id_for_principal(p_usaha_id);
  ELSE
    SELECT p.investor_id INTO v_iid FROM public.investor_participation p
    WHERE p.usaha_id=p_usaha_id AND p.status='active'
      AND p.effective_from<=p_period_start
      AND (p.effective_until IS NULL OR p.effective_until>p_period_start)
    ORDER BY p.effective_from DESC LIMIT 1;
  END IF;
  IF v_iid IS NULL THEN
    RETURN jsonb_build_object('status','NO_INVESTOR_CONFIG','usaha_id',p_usaha_id);
  END IF;
  RETURN app_private.calculate_investor_period(p_usaha_id,v_iid,p_period_start,p_period_end_exclusive)
    || jsonb_build_object('principal',v_access);
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.get_investor_participation_history(
  p_usaha_id uuid,p_investor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_access text:=app_private.assert_investor_read_access(p_usaha_id);
  v_iid uuid;
  v_items jsonb;
BEGIN
  v_iid:=CASE WHEN v_access='investor' THEN app_private.get_investor_id_for_principal(p_usaha_id) ELSE p_investor_id END;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'participation_id',p.participation_id,
    'investor_id',p.investor_id,
    'percentage',p.percentage,
    'basis_type',p.basis_type,
    'operational_reserve_amount',p.operational_reserve_amount,
    'pengelola_akun_admin_id',CASE WHEN v_access='admin' THEN p.pengelola_akun_admin_id ELSE NULL END,
    'period_start_day',p.period_start_day,
    'period_end_day',p.period_end_day,
    'effective_from',p.effective_from,
    'effective_until',p.effective_until,
    'status',p.status,'updated_at',p.updated_at
  ) ORDER BY p.effective_from DESC),'[]'::jsonb) INTO v_items
  FROM public.investor_participation p
  WHERE p.usaha_id=p_usaha_id AND (v_iid IS NULL OR p.investor_id=v_iid);

  RETURN jsonb_build_object('principal',v_access,'investor_id',v_iid,'items',v_items);
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.get_investor_activity(
  p_usaha_id uuid,p_period_start date,p_period_end_exclusive date,
  p_limit integer DEFAULT 50,p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_access text:=app_private.assert_investor_read_access(p_usaha_id);
  v_iid uuid;
  v_p public.investor_participation;
  v_timezone text;
  v_items jsonb;
  v_total integer:=0;
BEGIN
  IF v_access='investor' THEN
    v_iid:=app_private.get_investor_id_for_principal(p_usaha_id);
  ELSE
    SELECT p.investor_id INTO v_iid FROM public.investor_participation p
    WHERE p.usaha_id=p_usaha_id AND p.status='active'
      AND p.effective_from<=p_period_start
      AND (p.effective_until IS NULL OR p.effective_until>p_period_start)
    ORDER BY p.effective_from DESC LIMIT 1;
  END IF;

  SELECT p.* INTO v_p FROM public.investor_participation p
  WHERE p.usaha_id=p_usaha_id AND p.investor_id=v_iid AND p.status='active'
    AND p.effective_from<=p_period_start
    AND (p.effective_until IS NULL OR p.effective_until>p_period_start)
  ORDER BY p.effective_from DESC LIMIT 1;

  SELECT u.timezone INTO v_timezone FROM public.usaha u
  WHERE u.usaha_id=p_usaha_id AND u.status='active';

  p_limit:=least(greatest(coalesce(p_limit,50),1),200);
  p_offset:=greatest(coalesce(p_offset,0),0);

  SELECT count(*) INTO v_total FROM public.transaksi_keuangan t
  WHERE t.usaha_id=p_usaha_id AND t.status='recorded' AND t.arah IN ('income','expense')
    AND t.tanggal_transaksi>=(p_period_start::text||' 00:00:00 '||v_timezone)::timestamptz
    AND t.tanggal_transaksi<(p_period_end_exclusive::text||' 00:00:00 '||v_timezone)::timestamptz;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'transaksi_keuangan_id',t.transaksi_keuangan_id,
    'nomor_transaksi',t.nomor_transaksi,
    'occurred_at',t.tanggal_transaksi,
    'direction',t.arah,
    'amount',round(CASE WHEN t.arah='income' THEN t.amount ELSE -t.amount END,2),
    'investor_impact',round(
      (CASE WHEN t.arah='income' THEN t.amount ELSE -t.amount END)
      * (v_p.percentage/100),2
    ),
    'currency_code',t.currency_code,
    'source_type',t.sumber_type,
    'expense_category',e.kategori_biaya,
    'activity_reason',CASE WHEN t.arah='income'
      THEN 'Pemasukan menambah hasil bersih'
      ELSE 'Pengeluaran mengurangi hasil bersih' END
  ) ORDER BY t.tanggal_transaksi DESC,t.transaksi_keuangan_id DESC),'[]'::jsonb) INTO v_items
  FROM (
    SELECT t.* FROM public.transaksi_keuangan t
    WHERE t.usaha_id=p_usaha_id AND t.status='recorded' AND t.arah IN ('income','expense')
      AND t.tanggal_transaksi>=(p_period_start::text||' 00:00:00 '||v_timezone)::timestamptz
      AND t.tanggal_transaksi<(p_period_end_exclusive::text||' 00:00:00 '||v_timezone)::timestamptz
    ORDER BY t.tanggal_transaksi DESC,t.transaksi_keuangan_id DESC
    LIMIT p_limit OFFSET p_offset
  ) t
  LEFT JOIN public.pengeluaran e ON e.usaha_id=t.usaha_id
    AND e.transaksi_keuangan_id=t.transaksi_keuangan_id;

  RETURN jsonb_build_object(
    'status','OK','principal',v_access,'investor_id',v_iid,'percentage',v_p.percentage,
    'period',jsonb_build_object('start',p_period_start,'end_exclusive',p_period_end_exclusive,'timezone',v_timezone),
    'items',v_items,'total',v_total,'limit',p_limit,'offset',p_offset
  );
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_set_investor_finance_config(
  p_usaha_id uuid,p_investor_id uuid,p_pengelola_akun_admin_id uuid,
  p_investor_percentage numeric,p_operational_reserve_amount numeric,
  p_period_start_day smallint,p_period_end_day smallint,p_effective_from date,
  p_idempotency_key text,p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.assert_investor_admin(p_usaha_id);
  v_existing public.investor_participation%rowtype;
  v_new_id uuid:=gen_random_uuid();
  v_existing_response jsonb;
  v_existing_hash text;
  v_idempotency_id uuid;
  v_hash text;
  v_response jsonb;
  v_closed boolean;
BEGIN
  IF p_investor_percentage IS NULL OR p_investor_percentage<0 OR p_investor_percentage>100 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: persentase investor harus 0-100' USING ERRCODE='22023';
  END IF;
  IF p_operational_reserve_amount IS NULL OR p_operational_reserve_amount<0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: reserve operasional tidak valid' USING ERRCODE='22023';
  END IF;
  IF p_period_start_day IS NULL OR p_period_start_day NOT BETWEEN 1 AND 31
     OR p_period_end_day IS NULL OR p_period_end_day<p_period_start_day OR p_period_end_day>31 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: rentang periode tidak valid' USING ERRCODE='22023';
  END IF;
  IF p_effective_from IS NULL OR p_effective_from <>
     (date_trunc('month',p_effective_from)::date+(p_period_start_day-1)) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: effective_from harus tepat pada hari mulai periode' USING ERRCODE='22023';
  END IF;
  IF nullif(btrim(p_idempotency_key),'') IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi' USING ERRCODE='22023';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.investor i
    WHERE i.usaha_id=p_usaha_id AND i.investor_id=p_investor_id AND i.status='active'
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: investor aktif tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku ON ku.akun_admin_id=aa.akun_admin_id
      AND ku.usaha_id=p_usaha_id AND ku.status='active' AND ku.revoked_at IS NULL
    WHERE aa.akun_admin_id=p_pengelola_akun_admin_id AND aa.status='active'
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: akun pengelola aktif tidak ditemukan pada usaha' USING ERRCODE='P0002';
  END IF;

  v_hash:=md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'investor_id',p_investor_id,
    'pengelola_akun_admin_id',p_pengelola_akun_admin_id,
    'percentage',p_investor_percentage,'reserve',p_operational_reserve_amount,
    'start',p_period_start_day,'end',p_period_end_day,'effective',p_effective_from
  )::text);

  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,auth.uid(),btrim(p_idempotency_key),'set_investor_finance_config',v_hash)
  ON CONFLICT(usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body,request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id AND actor_auth_user_id=auth.uid()
      AND command_name='set_investor_finance_config' AND key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text||':'||p_investor_id::text,0));

  SELECT * INTO v_existing
  FROM public.investor_participation p
  WHERE p.usaha_id=p_usaha_id AND p.investor_id=p_investor_id
    AND p.status='active' AND p.effective_from=p_effective_from
  FOR UPDATE;

  SELECT EXISTS(
    SELECT 1 FROM public.investor_finance_period p
    WHERE p.usaha_id=p_usaha_id AND p.period_start=p_effective_from
  ) INTO v_closed;

  IF v_closed THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: periode sudah closed, konfigurasi tidak dapat diubah' USING ERRCODE='23514';
  END IF;

  IF v_existing.participation_id IS NOT NULL THEN
    UPDATE public.investor_participation
    SET percentage=p_investor_percentage,
        operational_reserve_amount=p_operational_reserve_amount,
        pengelola_akun_admin_id=p_pengelola_akun_admin_id,
        period_start_day=p_period_start_day,
        period_end_day=p_period_end_day
    WHERE participation_id=v_existing.participation_id;
  ELSE
    UPDATE public.investor_participation p
    SET effective_until=p_effective_from
    WHERE p.usaha_id=p_usaha_id AND p.investor_id=p_investor_id
      AND p.status='active' AND (p.effective_until IS NULL OR p.effective_until>p_effective_from)
      AND p.effective_from<p_effective_from;

    INSERT INTO public.investor_participation(
      participation_id,usaha_id,investor_id,percentage,basis_type,
      period_start_day,period_end_day,effective_from,status,
      operational_reserve_amount,pengelola_akun_admin_id
    ) VALUES(
      v_new_id,p_usaha_id,p_investor_id,p_investor_percentage,'net_operational_result',
      p_period_start_day,p_period_end_day,p_effective_from,'active',
      p_operational_reserve_amount,p_pengelola_akun_admin_id
    );
  END IF;

  v_response:=jsonb_build_object(
    'participation_id',coalesce(v_existing.participation_id,v_new_id),
    'investor_id',p_investor_id,'percentage',p_investor_percentage,
    'operational_reserve_amount',p_operational_reserve_amount,
    'pengelola_akun_admin_id',p_pengelola_akun_admin_id,
    'period_start_day',p_period_start_day,'period_end_day',p_period_end_day,
    'effective_from',p_effective_from,'basis_type','net_operational_result'
  );

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  ) VALUES(
    p_usaha_id,auth.uid(),v_admin_id,'set_investor_finance_config','investor_participation',
    coalesce(v_existing.participation_id,v_new_id),'admin-command',p_request_id,v_response
  );

  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES(
    p_usaha_id,'investor.config.changed','investor_participation',
    coalesce(v_existing.participation_id,v_new_id),v_response
  );

  UPDATE public.idempotency_key SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_set_investor_participation(
  p_usaha_id uuid,p_investor_id uuid,p_percentage numeric,
  p_period_start_day smallint,p_period_end_day smallint,p_effective_from date,
  p_idempotency_key text,p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.assert_investor_admin(p_usaha_id);
  v_operator uuid;
  v_reserve numeric:=0;
BEGIN
  SELECT p.pengelola_akun_admin_id,p.operational_reserve_amount
  INTO v_operator,v_reserve
  FROM public.investor_participation p
  WHERE p.usaha_id=p_usaha_id AND p.investor_id=p_investor_id AND p.status='active'
    AND p.effective_from<=p_effective_from
  ORDER BY p.effective_from DESC LIMIT 1;

  v_operator:=coalesce(v_operator,v_admin_id);

  RETURN app_private.command_set_investor_finance_config(
    p_usaha_id,p_investor_id,v_operator,p_percentage,v_reserve,
    p_period_start_day,p_period_end_day,p_effective_from,p_idempotency_key,p_request_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_set_finance_account_role(
  p_usaha_id uuid,p_akun_keuangan_id uuid,p_fungsi_akun text,
  p_investor_id uuid,p_pengelola_akun_admin_id uuid,p_idempotency_key text,p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.assert_finance_admin(p_usaha_id);
  v_account public.akun_keuangan%rowtype;
  v_role text:=lower(btrim(coalesce(p_fungsi_akun,'')));
  v_hash text;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_response jsonb;
BEGIN
  IF v_role NOT IN ('operasional','investor','pengelola') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: fungsi akun tidak didukung' USING ERRCODE='22023';
  END IF;
  IF nullif(btrim(p_idempotency_key),'') IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi' USING ERRCODE='22023';
  END IF;

  IF v_role='investor' AND p_investor_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: akun investor membutuhkan investor_id' USING ERRCODE='22023';
  END IF;
  IF v_role='pengelola' AND p_pengelola_akun_admin_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: akun pengelola membutuhkan akun admin' USING ERRCODE='22023';
  END IF;
  IF v_role='operasional' AND (p_investor_id IS NOT NULL OR p_pengelola_akun_admin_id IS NOT NULL) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: akun operasional tidak memiliki stakeholder owner' USING ERRCODE='22023';
  END IF;
  IF v_role='investor' AND p_pengelola_akun_admin_id IS NOT NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: akun investor tidak membutuhkan akun pengelola' USING ERRCODE='22023';
  END IF;
  IF v_role='pengelola' AND p_investor_id IS NOT NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: akun pengelola tidak membutuhkan investor_id' USING ERRCODE='22023';
  END IF;

  v_hash:=md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'akun_keuangan_id',p_akun_keuangan_id,
    'fungsi_akun',v_role,'investor_id',p_investor_id,
    'pengelola_akun_admin_id',p_pengelola_akun_admin_id
  )::text);

  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,auth.uid(),btrim(p_idempotency_key),'set_finance_account_role',v_hash)
  ON CONFLICT(usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body,request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id AND actor_auth_user_id=auth.uid()
      AND command_name='set_finance_account_role' AND key=btrim(p_idempotency_key);

    IF v_existing_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE='40001';
  END IF;

  SELECT * INTO v_account
  FROM public.akun_keuangan
  WHERE usaha_id=p_usaha_id AND akun_keuangan_id=p_akun_keuangan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: akun keuangan tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  IF v_role='investor' AND NOT EXISTS(
    SELECT 1 FROM public.investor i
    WHERE i.usaha_id=p_usaha_id AND i.investor_id=p_investor_id AND i.status='active'
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: investor aktif tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  IF v_role='pengelola' AND NOT EXISTS(
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id=aa.akun_admin_id
     AND ku.usaha_id=p_usaha_id
     AND ku.status='active'
     AND ku.revoked_at IS NULL
    WHERE aa.akun_admin_id=p_pengelola_akun_admin_id
      AND aa.status='active'
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: akun pengelola aktif tidak ditemukan pada usaha' USING ERRCODE='P0002';
  END IF;

  UPDATE public.akun_keuangan
  SET fungsi_akun=v_role,
      investor_id=p_investor_id,
      pengelola_akun_admin_id=p_pengelola_akun_admin_id
  WHERE usaha_id=p_usaha_id AND akun_keuangan_id=p_akun_keuangan_id;

  v_response:=jsonb_build_object(
    'akun_keuangan_id',p_akun_keuangan_id,
    'fungsi_akun',v_role,
    'investor_id',p_investor_id,
    'pengelola_akun_admin_id',p_pengelola_akun_admin_id
  );

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  ) VALUES(
    p_usaha_id,auth.uid(),v_admin_id,'set_finance_account_role','akun_keuangan',
    p_akun_keuangan_id,'admin-command',p_request_id,v_response
  );

  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES(
    p_usaha_id,'finance.account.role_changed','akun_keuangan',p_akun_keuangan_id,v_response
  );

  UPDATE public.idempotency_key
  SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_close_investor_period(
  p_usaha_id uuid,p_period_start date,p_idempotency_key text,p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.assert_investor_admin(p_usaha_id);
  v_existing public.investor_finance_period%rowtype;
  v_p public.investor_participation;
  v_ps date:=p_period_start;
  v_pe date;
  v_timezone text;
  v_now date;
  v_income numeric:=0;
  v_expense numeric:=0;
  v_net numeric:=0;
  v_investor numeric:=0;
  v_operator numeric:=0;
  v_cash numeric:=0;
  v_distributable numeric:=0;
  v_shortfall numeric:=0;
  v_currency_count integer:=0;
  v_currency char(3);
  v_period_id uuid:=gen_random_uuid();
  v_ia_id uuid:=gen_random_uuid();
  v_oa_id uuid:=gen_random_uuid();
  v_idempotency_id uuid;
  v_response jsonb;
BEGIN
  IF p_period_start IS NULL OR p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: closing parameter belum lengkap' USING ERRCODE='22023';
  END IF;

  SELECT u.timezone INTO v_timezone FROM public.usaha u WHERE u.usaha_id=p_usaha_id AND u.status='active';
  IF v_timezone IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002'; END IF;

  SELECT p.* INTO v_p FROM public.investor_participation p
  WHERE p.usaha_id=p_usaha_id AND p.status='active'
    AND p.effective_from<=p_period_start
    AND (p.effective_until IS NULL OR p.effective_until>p_period_start)
  ORDER BY p.effective_from DESC LIMIT 1;
  IF v_p.participation_id IS NULL THEN
    RAISE EXCEPTION 'CONFIG_REQUIRED: konfigurasi investor belum tersedia' USING ERRCODE='55000';
  END IF;

  SELECT period_start,period_end_exclusive INTO v_ps,v_pe
  FROM app_private.investor_period_for_date(p_period_start,v_p.period_start_day,v_p.period_end_day);
  IF v_ps<>p_period_start THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: period_start bukan awal periode' USING ERRCODE='22023';
  END IF;

  v_now:=(now() AT TIME ZONE v_timezone)::date;
  IF v_now<v_pe THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: periode belum berakhir' USING ERRCODE='23514';
  END IF;

  v_response:=NULL;
  -- The period_start itself is the deterministic command key; the explicit
  -- idempotency key is still recorded so retry can return the same result.
  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(
    p_usaha_id,auth.uid(),btrim(p_idempotency_key),'close_investor_period',
    md5(jsonb_build_object('usaha_id',p_usaha_id,'period_start',v_ps)::text)
  )
  ON CONFLICT(usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body INTO v_response
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id AND actor_auth_user_id=auth.uid()
      AND command_name='close_investor_period' AND key=btrim(p_idempotency_key);
    IF v_response IS NOT NULL THEN RETURN v_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: closing idempotency record exists without response' USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text||':'||v_ps::text,0));

  SELECT * INTO v_existing FROM public.investor_finance_period p
  WHERE p.usaha_id=p_usaha_id AND p.period_start=v_ps FOR UPDATE;
  IF v_existing.period_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'period_id',v_existing.period_id,'period_start',v_existing.period_start,
      'period_end_exclusive',v_existing.period_end_exclusive,'status','closed',
      'investor_allocation',v_existing.investor_allocation,'operator_allocation',v_existing.operator_allocation
    );
  END IF;

  SELECT count(DISTINCT t.currency_code),
         coalesce(sum(CASE WHEN t.arah='income' THEN t.amount ELSE 0 END),0),
         coalesce(sum(CASE WHEN t.arah='expense' THEN t.amount ELSE 0 END),0),
         min(t.currency_code)::char(3)
  INTO v_currency_count,v_income,v_expense,v_currency
  FROM public.transaksi_keuangan t
  WHERE t.usaha_id=p_usaha_id AND t.status='recorded' AND t.arah IN ('income','expense')
    AND t.tanggal_transaksi>=(v_ps::text||' 00:00:00 '||v_timezone)::timestamptz
    AND t.tanggal_transaksi<(v_pe::text||' 00:00:00 '||v_timezone)::timestamptz;

  IF v_currency_count>1 THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: multi-currency period requires review' USING ERRCODE='23514';
  END IF;

  IF v_currency IS NULL THEN
    SELECT min(a.mata_uang)::char(3) INTO v_currency
    FROM public.akun_keuangan a
    WHERE a.usaha_id=p_usaha_id AND a.status='active' AND a.fungsi_akun='operasional';
  END IF;
  v_currency:=coalesce(v_currency,'IDR');

  v_net:=v_income-v_expense;
  v_investor:=round(greatest(v_net,0)*(v_p.percentage/100),2);
  v_operator:=round(greatest(v_net,0)-v_investor,2);

  SELECT (x.payload->>'saldo')::numeric INTO v_cash
  FROM (SELECT app_private.finance_operational_cash_summary(p_usaha_id) payload) x;

  v_distributable:=round(greatest(coalesce(v_cash,0)-v_p.operational_reserve_amount,0),2);
  v_shortfall:=round(greatest(v_p.operational_reserve_amount-coalesce(v_cash,0),0),2);

  INSERT INTO public.investor_finance_period(
    period_id,usaha_id,participation_id,investor_id,pengelola_akun_admin_id,
    period_start,period_end_exclusive,timezone,currency_code,investor_percentage,
    operational_reserve_amount,income_recorded,expense_recorded,net_operational_result,
    investor_allocation,operator_allocation,operational_cash_at_close,
    distributable_cash_at_close,reserve_shortfall_at_close,status,closed_by_admin_id
  ) VALUES(
    v_period_id,p_usaha_id,v_p.participation_id,v_p.investor_id,v_p.pengelola_akun_admin_id,
    v_ps,v_pe,v_timezone,v_currency,v_p.percentage,v_p.operational_reserve_amount,
    v_income,v_expense,v_net,v_investor,v_operator,coalesce(v_cash,0),
    v_distributable,v_shortfall,'closed',v_admin_id
  );

  INSERT INTO public.investor_period_allocation(
    allocation_id,usaha_id,period_id,investor_id,currency_code,
    result_basis_amount,percentage,allocation_amount
  ) VALUES(v_ia_id,p_usaha_id,v_period_id,v_p.investor_id,v_currency,
           greatest(v_net,0),v_p.percentage,v_investor);

  INSERT INTO public.operator_period_allocation(
    allocation_id,usaha_id,period_id,pengelola_akun_admin_id,currency_code,
    result_basis_amount,percentage,allocation_amount
  ) VALUES(v_oa_id,p_usaha_id,v_period_id,v_p.pengelola_akun_admin_id,v_currency,
           greatest(v_net,0),round(100-v_p.percentage,4),v_operator);

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  ) VALUES(
    p_usaha_id,auth.uid(),v_admin_id,'close_investor_period','investor_finance_period',v_period_id,
    'admin-command',p_request_id,
    jsonb_build_object(
      'period_start',v_ps,'period_end_exclusive',v_pe,
      'income_recorded',v_income,'expense_recorded',v_expense,'net_operational_result',v_net,
      'investor_allocation',v_investor,'operator_allocation',v_operator,
      'operational_reserve_amount',v_p.operational_reserve_amount,
      'operational_cash_at_close',v_cash,'distributable_cash_at_close',v_distributable
    )
  );

  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES(
    p_usaha_id,'investor.period.closed','investor_finance_period',v_period_id,
    jsonb_build_object('period_id',v_period_id,'investor_allocation',v_investor,
      'operator_allocation',v_operator,'distributable_cash',v_distributable)
  );

  v_response:=jsonb_build_object(
    'period_id',v_period_id,'period_start',v_ps,'period_end_exclusive',v_pe,'status','closed',
    'income_recorded',v_income,'expense_recorded',v_expense,'net_operational_result',v_net,
    'investor_allocation',v_investor,'operator_allocation',v_operator,
    'operational_reserve_amount',v_p.operational_reserve_amount,
    'operational_cash_at_close',coalesce(v_cash,0),'distributable_cash_at_close',v_distributable,
    'reserve_shortfall_at_close',v_shortfall,'investor_allocation_id',v_ia_id,'operator_allocation_id',v_oa_id
  );

  UPDATE public.idempotency_key
  SET response_status=200,response_body=v_response
  WHERE usaha_id=p_usaha_id AND actor_auth_user_id=auth.uid()
    AND command_name='close_investor_period' AND key=btrim(p_idempotency_key);

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_distribute_investor_allocation(
  p_usaha_id uuid,p_allocation_id uuid,p_source_account_id uuid,p_target_account_id uuid,
  p_amount numeric,p_distributed_at timestamptz,p_catatan text,p_idempotency_key text,p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.assert_investor_admin(p_usaha_id);
  v_alloc public.investor_period_allocation%rowtype;
  v_period public.investor_finance_period%rowtype;
  v_source public.akun_keuangan%rowtype;
  v_target public.akun_keuangan%rowtype;
  v_balance numeric;
  v_remaining numeric;
  v_time timestamptz:=coalesce(p_distributed_at,now());
  v_distribution_id uuid:=gen_random_uuid();
  v_transfer_id uuid:=gen_random_uuid();
  v_transaction_id uuid:=gen_random_uuid();
  v_timezone text;
  v_response jsonb;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_hash text;
BEGIN
  IF p_amount IS NULL OR p_amount<=0 OR p_request_id IS NULL OR nullif(btrim(p_idempotency_key),'') IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: distribusi belum lengkap' USING ERRCODE='22023';
  END IF;

  v_hash:=md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'allocation_id',p_allocation_id,
    'source_account_id',p_source_account_id,'target_account_id',p_target_account_id,
    'amount',p_amount,'distributed_at',v_time,'catatan',nullif(btrim(coalesce(p_catatan,'')),'')
  )::text);

  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,auth.uid(),btrim(p_idempotency_key),'distribute_investor_allocation',v_hash)
  ON CONFLICT(usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body,request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id AND actor_auth_user_id=auth.uid()
      AND command_name='distribute_investor_allocation' AND key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text||':'||p_allocation_id::text,0));

  SELECT * INTO v_alloc FROM public.investor_period_allocation a
  WHERE a.usaha_id=p_usaha_id AND a.allocation_id=p_allocation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: investor allocation tidak ditemukan' USING ERRCODE='P0002'; END IF;

  SELECT * INTO v_period FROM public.investor_finance_period p
  WHERE p.usaha_id=p_usaha_id AND p.period_id=v_alloc.period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'INTEGRITY_ERROR: investor period tidak ditemukan' USING ERRCODE='23514'; END IF;

  SELECT * INTO v_source FROM public.akun_keuangan a
  WHERE a.usaha_id=p_usaha_id AND a.akun_keuangan_id=p_source_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: akun sumber tidak ditemukan' USING ERRCODE='P0002'; END IF;

  SELECT * INTO v_target FROM public.akun_keuangan a
  WHERE a.usaha_id=p_usaha_id AND a.akun_keuangan_id=p_target_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: akun target tidak ditemukan' USING ERRCODE='P0002'; END IF;

  IF v_source.fungsi_akun<>'operasional' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: sumber distribusi harus akun usaha' USING ERRCODE='23514';
  END IF;
  IF v_target.fungsi_akun<>'investor' OR v_target.investor_id<>v_alloc.investor_id THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: target distribusi tidak cocok dengan allocation' USING ERRCODE='23514';
  END IF;
  IF v_source.mata_uang<>v_target.mata_uang OR v_source.mata_uang<>v_alloc.currency_code THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: currency tidak cocok' USING ERRCODE='23514';
  END IF;

  v_remaining:=v_alloc.allocation_amount-v_alloc.distributed_amount;
  IF p_amount>v_remaining THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: distribusi melebihi sisa allocation' USING ERRCODE='23514';
  END IF;

  v_balance:=app_private.finance_account_balance(p_usaha_id,p_source_account_id);
  IF v_balance-p_amount<v_period.operational_reserve_amount THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: distribusi akan mengurangi saldo usaha di bawah reserve operasional'
      USING ERRCODE='23514';
  END IF;

  SELECT u.timezone INTO v_timezone FROM public.usaha u WHERE u.usaha_id=p_usaha_id AND u.status='active';

  INSERT INTO public.transaksi_keuangan(
    transaksi_keuangan_id,usaha_id,nomor_transaksi,jenis,arah,tanggal_transaksi,
    amount,currency_code,sumber_type,sumber_id,status,catatan
  ) VALUES(
    v_transaction_id,p_usaha_id,
    app_private.next_business_number(p_usaha_id,'TRX',to_char(v_time at time zone v_timezone,'YYYY'))::text,
    'transfer','transfer',v_time,p_amount,v_source.mata_uang,'investor_distribution',v_distribution_id,'recorded',
    nullif(btrim(coalesce(p_catatan,'')),'')
  );

  INSERT INTO public.transfer_akun_keuangan(
    transfer_akun_keuangan_id,usaha_id,transaksi_keuangan_id,dari_akun_keuangan_id,ke_akun_keuangan_id,
    amount,mata_uang,dipindahkan_at,dicatat_by_admin_id,request_id,catatan,status
  ) VALUES(
    v_transfer_id,p_usaha_id,v_transaction_id,p_source_account_id,p_target_account_id,p_amount,v_source.mata_uang,
    v_time,v_admin_id,p_request_id,nullif(btrim(coalesce(p_catatan,'')),'') ,'recorded'
  );

  INSERT INTO public.pergerakan_akun_keuangan(
    usaha_id,akun_keuangan_id,transaksi_keuangan_id,arah,amount,mata_uang,terjadi_at,
    sumber_type,sumber_id,status,dicatat_by_admin_id,request_id,catatan
  ) VALUES
    (p_usaha_id,p_source_account_id,v_transaction_id,'keluar',p_amount,v_source.mata_uang,v_time,
     'investor_distribution',v_distribution_id,'recorded',v_admin_id,p_request_id,nullif(btrim(coalesce(p_catatan,'')),'')),
    (p_usaha_id,p_target_account_id,v_transaction_id,'masuk',p_amount,v_target.mata_uang,v_time,
     'investor_distribution',v_distribution_id,'recorded',v_admin_id,p_request_id,nullif(btrim(coalesce(p_catatan,'')),''));

  INSERT INTO public.investor_period_distribution(
    distribution_id,usaha_id,allocation_id,source_account_id,target_account_id,transfer_id,
    amount,currency_code,distributed_at,dicatat_by_admin_id,request_id,catatan
  ) VALUES(
    v_distribution_id,p_usaha_id,p_allocation_id,p_source_account_id,p_target_account_id,v_transfer_id,
    p_amount,v_source.mata_uang,v_time,v_admin_id,p_request_id,nullif(btrim(coalesce(p_catatan,'')),'')
  );

  UPDATE public.investor_period_allocation
  SET distributed_amount=distributed_amount+p_amount,
      status=CASE
        WHEN distributed_amount+p_amount>=allocation_amount THEN 'settled'
        ELSE 'partially_distributed' END
  WHERE allocation_id=p_allocation_id;

  v_response:=jsonb_build_object(
    'distribution_id',v_distribution_id,'allocation_id',p_allocation_id,
    'transfer_id',v_transfer_id,'transaksi_keuangan_id',v_transaction_id,
    'amount',p_amount,'remaining_allocation',round(v_remaining-p_amount,2),'status','recorded'
  );

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary
  ) VALUES(
    p_usaha_id,auth.uid(),v_admin_id,'distribute_investor_allocation','investor_period_distribution',
    v_distribution_id,'admin-command',p_request_id,v_response
  );

  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES(p_usaha_id,'investor.distribution.recorded','investor_period_distribution',v_distribution_id,v_response);

  UPDATE public.idempotency_key
  SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_withdraw_operator_allocation(
  p_usaha_id uuid,p_allocation_id uuid,p_source_account_id uuid,p_target_account_id uuid,
  p_amount numeric,p_withdrawn_at timestamptz,p_catatan text,p_idempotency_key text,p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.assert_investor_admin(p_usaha_id);
  v_alloc public.operator_period_allocation%rowtype;
  v_period public.investor_finance_period%rowtype;
  v_source public.akun_keuangan%rowtype;
  v_target public.akun_keuangan%rowtype;
  v_balance numeric;
  v_remaining numeric;
  v_time timestamptz:=coalesce(p_withdrawn_at,now());
  v_withdrawal_id uuid:=gen_random_uuid();
  v_transfer_id uuid:=gen_random_uuid();
  v_transaction_id uuid:=gen_random_uuid();
  v_timezone text;
  v_response jsonb;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_hash text;
BEGIN
  IF p_amount IS NULL OR p_amount<=0 OR p_request_id IS NULL OR nullif(btrim(p_idempotency_key),'') IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: withdrawal belum lengkap' USING ERRCODE='22023';
  END IF;

  v_hash:=md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'allocation_id',p_allocation_id,
    'source_account_id',p_source_account_id,'target_account_id',p_target_account_id,
    'amount',p_amount,'withdrawn_at',v_time,'catatan',nullif(btrim(coalesce(p_catatan,'')),'')
  )::text);

  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,auth.uid(),btrim(p_idempotency_key),'withdraw_operator_allocation',v_hash)
  ON CONFLICT(usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body,request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id AND actor_auth_user_id=auth.uid()
      AND command_name='withdraw_operator_allocation' AND key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text||':'||p_allocation_id::text,0));

  SELECT * INTO v_alloc FROM public.operator_period_allocation a
  WHERE a.usaha_id=p_usaha_id AND a.allocation_id=p_allocation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: operator allocation tidak ditemukan' USING ERRCODE='P0002'; END IF;

  SELECT * INTO v_period FROM public.investor_finance_period p
  WHERE p.usaha_id=p_usaha_id AND p.period_id=v_alloc.period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'INTEGRITY_ERROR: investor period tidak ditemukan' USING ERRCODE='23514'; END IF;

  SELECT * INTO v_source FROM public.akun_keuangan a
  WHERE a.usaha_id=p_usaha_id AND a.akun_keuangan_id=p_source_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: akun sumber tidak ditemukan' USING ERRCODE='P0002'; END IF;

  SELECT * INTO v_target FROM public.akun_keuangan a
  WHERE a.usaha_id=p_usaha_id AND a.akun_keuangan_id=p_target_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: akun target tidak ditemukan' USING ERRCODE='P0002'; END IF;

  IF v_source.fungsi_akun<>'operasional' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: sumber withdrawal harus akun usaha' USING ERRCODE='23514';
  END IF;
  IF v_target.fungsi_akun<>'pengelola' OR v_target.pengelola_akun_admin_id<>v_alloc.pengelola_akun_admin_id THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: target withdrawal tidak cocok dengan allocation' USING ERRCODE='23514';
  END IF;
  IF v_source.mata_uang<>v_target.mata_uang OR v_source.mata_uang<>v_alloc.currency_code THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: currency tidak cocok' USING ERRCODE='23514';
  END IF;

  v_remaining:=v_alloc.allocation_amount-v_alloc.distributed_amount;
  IF p_amount>v_remaining THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: withdrawal melebihi sisa allocation' USING ERRCODE='23514';
  END IF;

  v_balance:=app_private.finance_account_balance(p_usaha_id,p_source_account_id);
  IF v_balance-p_amount<v_period.operational_reserve_amount THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: withdrawal akan mengurangi saldo usaha di bawah reserve operasional'
      USING ERRCODE='23514';
  END IF;

  SELECT u.timezone INTO v_timezone FROM public.usaha u WHERE u.usaha_id=p_usaha_id AND u.status='active';

  INSERT INTO public.transaksi_keuangan(
    transaksi_keuangan_id,usaha_id,nomor_transaksi,jenis,arah,tanggal_transaksi,
    amount,currency_code,sumber_type,sumber_id,status,catatan
  ) VALUES(
    v_transaction_id,p_usaha_id,
    app_private.next_business_number(p_usaha_id,'TRX',to_char(v_time at time zone v_timezone,'YYYY'))::text,
    'transfer','transfer',v_time,p_amount,v_source.mata_uang,'operator_withdrawal',v_withdrawal_id,'recorded',
    nullif(btrim(coalesce(p_catatan,'')),'')
  );

  INSERT INTO public.transfer_akun_keuangan(
    transfer_akun_keuangan_id,usaha_id,transaksi_keuangan_id,dari_akun_keuangan_id,ke_akun_keuangan_id,
    amount,mata_uang,dipindahkan_at,dicatat_by_admin_id,request_id,catatan,status
  ) VALUES(
    v_transfer_id,p_usaha_id,v_transaction_id,p_source_account_id,p_target_account_id,p_amount,v_source.mata_uang,
    v_time,v_admin_id,p_request_id,nullif(btrim(coalesce(p_catatan,'')),'') ,'recorded'
  );

  INSERT INTO public.pergerakan_akun_keuangan(
    usaha_id,akun_keuangan_id,transaksi_keuangan_id,arah,amount,mata_uang,terjadi_at,
    sumber_type,sumber_id,status,dicatat_by_admin_id,request_id,catatan
  ) VALUES
    (p_usaha_id,p_source_account_id,v_transaction_id,'keluar',p_amount,v_source.mata_uang,v_time,
     'operator_withdrawal',v_withdrawal_id,'recorded',v_admin_id,p_request_id,nullif(btrim(coalesce(p_catatan,'')),'')),
    (p_usaha_id,p_target_account_id,v_transaction_id,'masuk',p_amount,v_target.mata_uang,v_time,
     'operator_withdrawal',v_withdrawal_id,'recorded',v_admin_id,p_request_id,nullif(btrim(coalesce(p_catatan,'')),''));

  INSERT INTO public.operator_period_withdrawal(
    withdrawal_id,usaha_id,allocation_id,source_account_id,target_account_id,transfer_id,
    amount,currency_code,withdrawn_at,dicatat_by_admin_id,request_id,catatan
  ) VALUES(
    v_withdrawal_id,p_usaha_id,p_allocation_id,p_source_account_id,p_target_account_id,v_transfer_id,
    p_amount,v_source.mata_uang,v_time,v_admin_id,p_request_id,nullif(btrim(coalesce(p_catatan,'')),'')
  );

  UPDATE public.operator_period_allocation
  SET distributed_amount=distributed_amount+p_amount,
      status=CASE
        WHEN distributed_amount+p_amount>=allocation_amount THEN 'settled'
        ELSE 'partially_distributed' END
  WHERE allocation_id=p_allocation_id;

  v_response:=jsonb_build_object(
    'withdrawal_id',v_withdrawal_id,'allocation_id',p_allocation_id,
    'transfer_id',v_transfer_id,'transaksi_keuangan_id',v_transaction_id,
    'amount',p_amount,'remaining_allocation',round(v_remaining-p_amount,2),'status','recorded'
  );

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary
  ) VALUES(
    p_usaha_id,auth.uid(),v_admin_id,'withdraw_operator_allocation','operator_period_withdrawal',
    v_withdrawal_id,'admin-command',p_request_id,v_response
  );

  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES(p_usaha_id,'investor.operator_withdrawal.recorded','operator_period_withdrawal',v_withdrawal_id,v_response);

  UPDATE public.idempotency_key
  SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.get_investor_realtime_checkpoint(p_usaha_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_access text:=app_private.assert_investor_read_access(p_usaha_id); v_seq bigint; v_at timestamptz;
BEGIN
  SELECT max(event_seq),max(occurred_at) INTO v_seq,v_at
  FROM public.investor_realtime_event WHERE usaha_id=p_usaha_id;
  RETURN jsonb_build_object('principal',v_access,'last_event_seq',coalesce(v_seq,0),'last_event_at',v_at);
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.replay_investor_realtime_events(
  p_usaha_id uuid,p_after_event_seq bigint DEFAULT 0,p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_access text:=app_private.assert_investor_read_access(p_usaha_id);
  v_count integer:=0;
  r record;
BEGIN
  p_limit:=least(greatest(coalesce(p_limit,100),1),100);
  FOR r IN
    SELECT * FROM public.investor_realtime_event
    WHERE usaha_id=p_usaha_id AND event_seq>greatest(coalesce(p_after_event_seq,0),0)
    ORDER BY event_seq LIMIT p_limit
  LOOP
    BEGIN
      PERFORM realtime.send(
        r.payload||jsonb_build_object('event_seq',r.event_seq,'replayed',true),
        r.event_type,'finance:usaha:'||p_usaha_id::text,true
      );
      UPDATE public.investor_realtime_event
      SET delivered_at=clock_timestamp(),attempt_count=attempt_count+1,last_error=NULL
      WHERE event_seq=r.event_seq;
      v_count:=v_count+1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.investor_realtime_event
      SET attempt_count=attempt_count+1,last_error=SQLERRM
      WHERE event_seq=r.event_seq;
    END;
  END LOOP;
  RETURN jsonb_build_object('principal',v_access,'replayed',v_count,'after_event_seq',greatest(coalesce(p_after_event_seq,0),0));
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.investor_reconciliation(p_usaha_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.assert_investor_admin(p_usaha_id);
  v_config_count integer;
  v_investor_count integer;
  v_op_account_count integer;
  v_inv_account_count integer;
  v_opr_account_count integer;
  v_unsettled integer;
  v_pending integer;
  v_currency_count integer;
BEGIN
  SELECT count(*) INTO v_config_count FROM public.investor_participation
  WHERE usaha_id=p_usaha_id AND status='active';

  SELECT count(*) INTO v_investor_count FROM public.investor
  WHERE usaha_id=p_usaha_id AND status='active';

  SELECT count(*) INTO v_op_account_count FROM public.akun_keuangan
  WHERE usaha_id=p_usaha_id AND status='active' AND fungsi_akun='operasional';

  SELECT count(*) INTO v_inv_account_count FROM public.akun_keuangan
  WHERE usaha_id=p_usaha_id AND status='active' AND fungsi_akun='investor';

  SELECT count(*) INTO v_opr_account_count FROM public.akun_keuangan
  WHERE usaha_id=p_usaha_id AND status='active' AND fungsi_akun='pengelola';

  SELECT count(*) INTO v_unsettled FROM (
    SELECT allocation_id FROM public.investor_period_allocation
    WHERE usaha_id=p_usaha_id AND status<>'settled'
    UNION ALL
    SELECT allocation_id FROM public.operator_period_allocation
    WHERE usaha_id=p_usaha_id AND status<>'settled'
  ) q;

  SELECT count(*) INTO v_pending FROM public.investor_realtime_event
  WHERE usaha_id=p_usaha_id AND delivered_at IS NULL;

  SELECT count(DISTINCT mata_uang) INTO v_currency_count FROM public.akun_keuangan
  WHERE usaha_id=p_usaha_id AND status='active' AND fungsi_akun='operasional';

  RETURN jsonb_build_object(
    'status',CASE WHEN v_config_count=0 OR v_investor_count=0 OR v_op_account_count=0 OR v_currency_count>1 THEN 'ATTENTION' ELSE 'HEALTHY' END,
    'checked_by_admin_id',v_admin_id,
    'active_investor_count',v_investor_count,
    'active_config_count',v_config_count,
    'operational_account_count',v_op_account_count,
    'investor_account_count',v_inv_account_count,
    'operator_account_count',v_opr_account_count,
    'unsettled_allocations',v_unsettled,
    'pending_realtime_events',v_pending,
    'operational_currency_count',v_currency_count,
    'negative_result_policy','investor_allocation_zero',
    'open_period_formula','investor_percentage_x_operational_result'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.broadcast_investor_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_usaha_id uuid:=coalesce(NEW.usaha_id,OLD.usaha_id);
  v_event_id uuid:=gen_random_uuid();
  v_event_seq bigint;
  v_type text;
  v_aggregate_id uuid;
  v_payload jsonb;
BEGIN
  v_type:=CASE TG_TABLE_NAME
    WHEN 'transaksi_keuangan' THEN 'finance.changed'
    WHEN 'investor' THEN 'investor.changed'
    WHEN 'investor_participation' THEN 'investor.config.changed'
    WHEN 'akun_keuangan' THEN 'finance.account.changed'
    WHEN 'pergerakan_akun_keuangan' THEN 'finance.account.movement.changed'
    WHEN 'investor_finance_period' THEN 'investor.period.changed'
    WHEN 'investor_period_allocation' THEN 'investor.allocation.changed'
    WHEN 'operator_period_allocation' THEN 'investor.operator_allocation.changed'
    ELSE 'investor.changed' END;

  v_aggregate_id:=CASE TG_TABLE_NAME
    WHEN 'transaksi_keuangan' THEN coalesce(NEW.transaksi_keuangan_id,OLD.transaksi_keuangan_id)
    WHEN 'investor' THEN coalesce(NEW.investor_id,OLD.investor_id)
    WHEN 'investor_participation' THEN coalesce(NEW.participation_id,OLD.participation_id)
    WHEN 'akun_keuangan' THEN coalesce(NEW.akun_keuangan_id,OLD.akun_keuangan_id)
    WHEN 'pergerakan_akun_keuangan' THEN coalesce(NEW.pergerakan_akun_keuangan_id,OLD.pergerakan_akun_keuangan_id)
    WHEN 'investor_finance_period' THEN coalesce(NEW.period_id,OLD.period_id)
    WHEN 'investor_period_allocation' THEN coalesce(NEW.allocation_id,OLD.allocation_id)
    WHEN 'operator_period_allocation' THEN coalesce(NEW.allocation_id,OLD.allocation_id)
    ELSE NULL END;

  IF v_usaha_id IS NULL THEN RETURN coalesce(NEW,OLD); END IF;

  v_payload:=jsonb_build_object('event_id',v_event_id,'aggregate_id',v_aggregate_id,'occurred_at',clock_timestamp());

  INSERT INTO public.investor_realtime_event(
    event_id,usaha_id,event_type,aggregate_type,aggregate_id,payload
  ) VALUES(
    v_event_id,v_usaha_id,v_type,TG_TABLE_NAME,v_aggregate_id,v_payload
  ) RETURNING event_seq INTO v_event_seq;

  BEGIN
    PERFORM realtime.send(
      v_payload||jsonb_build_object('event_seq',v_event_seq),
      v_type,'finance:usaha:'||v_usaha_id::text,true
    );
    UPDATE public.investor_realtime_event
    SET delivered_at=clock_timestamp(),attempt_count=attempt_count+1,last_error=NULL
    WHERE event_seq=v_event_seq;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.investor_realtime_event
    SET attempt_count=attempt_count+1,last_error=SQLERRM
    WHERE event_seq=v_event_seq;
  END;

  RETURN coalesce(NEW,OLD);
END;
$function$;

DROP TRIGGER IF EXISTS transaksi_keuangan_investor_realtime ON public.transaksi_keuangan;
CREATE TRIGGER transaksi_keuangan_investor_realtime
AFTER INSERT OR UPDATE OR DELETE ON public.transaksi_keuangan
FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_investor_event();

DROP TRIGGER IF EXISTS investor_realtime_broadcast ON public.investor;
CREATE TRIGGER investor_realtime_broadcast
AFTER INSERT OR UPDATE OR DELETE ON public.investor
FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_investor_event();

DROP TRIGGER IF EXISTS investor_participation_realtime_broadcast ON public.investor_participation;
CREATE TRIGGER investor_participation_realtime_broadcast
AFTER INSERT OR UPDATE OR DELETE ON public.investor_participation
FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_investor_event();

DROP TRIGGER IF EXISTS akun_keuangan_investor_realtime ON public.akun_keuangan;
CREATE TRIGGER akun_keuangan_investor_realtime
AFTER INSERT OR UPDATE OR DELETE ON public.akun_keuangan
FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_investor_event();

DROP TRIGGER IF EXISTS pergerakan_akun_keuangan_investor_realtime ON public.pergerakan_akun_keuangan;
CREATE TRIGGER pergerakan_akun_keuangan_investor_realtime
AFTER INSERT OR UPDATE OR DELETE ON public.pergerakan_akun_keuangan
FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_investor_event();

DROP TRIGGER IF EXISTS investor_finance_period_realtime ON public.investor_finance_period;
CREATE TRIGGER investor_finance_period_realtime
AFTER INSERT OR UPDATE OR DELETE ON public.investor_finance_period
FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_investor_event();

DROP TRIGGER IF EXISTS investor_period_allocation_realtime ON public.investor_period_allocation;
CREATE TRIGGER investor_period_allocation_realtime
AFTER INSERT OR UPDATE OR DELETE ON public.investor_period_allocation
FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_investor_event();

DROP TRIGGER IF EXISTS operator_period_allocation_realtime ON public.operator_period_allocation;
CREATE TRIGGER operator_period_allocation_realtime
AFTER INSERT OR UPDATE OR DELETE ON public.operator_period_allocation
FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_investor_event();

CREATE OR REPLACE FUNCTION public.get_investor_overview(p_usaha_id uuid,p_as_of_date date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$ SELECT app_private.get_investor_overview($1,$2); $function$;

CREATE OR REPLACE FUNCTION public.get_investor_period_result(p_usaha_id uuid,p_period_start date,p_period_end_exclusive date)
RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$ SELECT app_private.get_investor_period_result($1,$2,$3); $function$;

CREATE OR REPLACE FUNCTION public.get_investor_participation_history(p_usaha_id uuid,p_investor_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$ SELECT app_private.get_investor_participation_history($1,$2); $function$;

CREATE OR REPLACE FUNCTION public.get_investor_activity(
  p_usaha_id uuid,p_period_start date,p_period_end_exclusive date,p_limit integer DEFAULT 50,p_offset integer DEFAULT 0
)
RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$ SELECT app_private.get_investor_activity($1,$2,$3,$4,$5); $function$;

CREATE OR REPLACE FUNCTION public.investor_reconciliation(p_usaha_id uuid)
RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$ SELECT app_private.investor_reconciliation($1); $function$;

CREATE OR REPLACE FUNCTION public.command_set_investor_finance_config(
  p_usaha_id uuid,p_investor_id uuid,p_pengelola_akun_admin_id uuid,p_investor_percentage numeric,
  p_operational_reserve_amount numeric,p_period_start_day smallint,p_period_end_day smallint,
  p_effective_from date,p_idempotency_key text,p_request_id uuid
)
RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$ SELECT app_private.command_set_investor_finance_config($1,$2,$3,$4,$5,$6,$7,$8,$9,$10); $function$;

CREATE OR REPLACE FUNCTION public.command_set_finance_account_role(
  p_usaha_id uuid,p_akun_keuangan_id uuid,p_fungsi_akun text,p_investor_id uuid,
  p_pengelola_akun_admin_id uuid,p_idempotency_key text,p_request_id uuid
)
RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$ SELECT app_private.command_set_finance_account_role($1,$2,$3,$4,$5,$6,$7); $function$;

CREATE OR REPLACE FUNCTION public.command_close_investor_period(
  p_usaha_id uuid,p_period_start date,p_idempotency_key text,p_request_id uuid
)
RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$ SELECT app_private.command_close_investor_period($1,$2,$3,$4); $function$;

CREATE OR REPLACE FUNCTION public.command_distribute_investor_allocation(
  p_usaha_id uuid,p_allocation_id uuid,p_source_account_id uuid,p_target_account_id uuid,
  p_amount numeric,p_distributed_at timestamptz,p_catatan text,p_idempotency_key text,p_request_id uuid
)
RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$ SELECT app_private.command_distribute_investor_allocation($1,$2,$3,$4,$5,$6,$7,$8,$9); $function$;

CREATE OR REPLACE FUNCTION public.command_withdraw_operator_allocation(
  p_usaha_id uuid,p_allocation_id uuid,p_source_account_id uuid,p_target_account_id uuid,
  p_amount numeric,p_withdrawn_at timestamptz,p_catatan text,p_idempotency_key text,p_request_id uuid
)
RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$ SELECT app_private.command_withdraw_operator_allocation($1,$2,$3,$4,$5,$6,$7,$8,$9); $function$;

CREATE OR REPLACE FUNCTION public.get_investor_realtime_checkpoint(p_usaha_id uuid)
RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$ SELECT app_private.get_investor_realtime_checkpoint($1); $function$;

CREATE OR REPLACE FUNCTION public.replay_investor_realtime_events(
  p_usaha_id uuid,p_after_event_seq bigint DEFAULT 0,p_limit integer DEFAULT 100
)
RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$ SELECT app_private.replay_investor_realtime_events($1,$2,$3); $function$;

CREATE OR REPLACE FUNCTION public.finance_operational_account_summary(p_usaha_id uuid)
RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$ SELECT app_private.finance_operational_cash_summary($1); $function$;

GRANT EXECUTE ON FUNCTION app_private.get_investor_overview(uuid,date) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_investor_period_result(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_investor_participation_history(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_investor_activity(uuid,date,date,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.investor_reconciliation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_set_investor_finance_config(uuid,uuid,uuid,numeric,numeric,smallint,smallint,date,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_set_finance_account_role(uuid,uuid,text,uuid,uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_close_investor_period(uuid,date,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_distribute_investor_allocation(uuid,uuid,uuid,uuid,numeric,timestamptz,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_withdraw_operator_allocation(uuid,uuid,uuid,uuid,numeric,timestamptz,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_investor_realtime_checkpoint(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.replay_investor_realtime_events(uuid,bigint,integer) TO authenticated;

REVOKE ALL ON FUNCTION public.get_investor_overview(uuid,date) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_investor_period_result(uuid,date,date) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_investor_participation_history(uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_investor_activity(uuid,date,date,integer,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.investor_reconciliation(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.command_set_investor_finance_config(uuid,uuid,uuid,numeric,numeric,smallint,smallint,date,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.command_set_finance_account_role(uuid,uuid,text,uuid,uuid,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.command_close_investor_period(uuid,date,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.command_distribute_investor_allocation(uuid,uuid,uuid,uuid,numeric,timestamptz,text,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.command_withdraw_operator_allocation(uuid,uuid,uuid,uuid,numeric,timestamptz,text,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_investor_realtime_checkpoint(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.replay_investor_realtime_events(uuid,bigint,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.finance_operational_account_summary(uuid) FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.get_investor_overview(uuid,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_investor_period_result(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_investor_participation_history(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_investor_activity(uuid,date,date,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.investor_reconciliation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_set_investor_finance_config(uuid,uuid,uuid,numeric,numeric,smallint,smallint,date,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_set_finance_account_role(uuid,uuid,text,uuid,uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_close_investor_period(uuid,date,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_distribute_investor_allocation(uuid,uuid,uuid,uuid,numeric,timestamptz,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_withdraw_operator_allocation(uuid,uuid,uuid,uuid,numeric,timestamptz,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_investor_realtime_checkpoint(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replay_investor_realtime_events(uuid,bigint,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_operational_account_summary(uuid) TO authenticated;

REVOKE ALL ON TABLE public.investor_finance_period FROM anon,authenticated;
REVOKE ALL ON TABLE public.investor_period_allocation FROM anon,authenticated;
REVOKE ALL ON TABLE public.operator_period_allocation FROM anon,authenticated;
REVOKE ALL ON TABLE public.investor_period_distribution FROM anon,authenticated;
REVOKE ALL ON TABLE public.operator_period_withdrawal FROM anon,authenticated;
REVOKE ALL ON TABLE public.investor_realtime_event FROM anon,authenticated;
