-- Fix investor currency semantics and stakeholder movement guards.
CREATE OR REPLACE FUNCTION app_private.finance_operational_cash_summary(p_usaha_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  WITH b AS (
    SELECT a.akun_keuangan_id,a.nama_akun,a.mata_uang,
           app_private.finance_account_balance(p_usaha_id,a.akun_keuangan_id) saldo
    FROM public.akun_keuangan a
    WHERE a.usaha_id=p_usaha_id AND a.status='active' AND a.fungsi_akun='operasional'
  ),
  s AS (
    SELECT count(DISTINCT mata_uang) currency_count,coalesce(sum(saldo),0) total_saldo
    FROM b
  )
  SELECT jsonb_build_object(
    'accounts',coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
        'akun_keuangan_id',akun_keuangan_id,'nama_akun',nama_akun,
        'mata_uang',mata_uang,'saldo',round(saldo,2)
      ) ORDER BY nama_akun) FROM b),'[]'::jsonb),
    'saldo',CASE WHEN s.currency_count<=1 THEN round(s.total_saldo,2) ELSE NULL END,
    'currency_count',s.currency_count
  ) INTO v_result
  FROM s;
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

  IF v_account.fungsi_akun='investor' THEN
    IF NOT (NEW.arah='masuk' AND NEW.sumber_type='investor_distribution') THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: akun investor hanya boleh menerima distribusi investor' USING ERRCODE='23514';
    END IF;
  ELSIF v_account.fungsi_akun='pengelola' THEN
    IF NOT (NEW.arah='masuk' AND NEW.sumber_type='operator_withdrawal') THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: akun pengelola hanya boleh menerima withdrawal pengelola' USING ERRCODE='23514';
    END IF;
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

  RETURN NEW;
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
  v_investor numeric;
  v_operator numeric;
  v_cash numeric;
  v_estimated_distributable numeric;
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

  IF v_currency_count<=1 AND v_operational_currency_count<=1 THEN
    v_investor:=round(greatest(v_net,0)*(v_p.percentage/100),2);
    v_operator:=round(greatest(v_net,0)-v_investor,2);
    v_estimated_distributable:=round(greatest(coalesce(v_cash,0)-v_p.operational_reserve_amount,0),2);
  ELSE
    v_investor:=NULL;
    v_operator:=NULL;
    v_estimated_distributable:=NULL;
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
    'operational_cash',CASE WHEN v_operational_currency_count<=1 THEN round(coalesce(v_cash,0),2) ELSE NULL END,
    'estimated_distributable_cash',v_estimated_distributable,
    'transaction_count',v_count,'currency_count',v_currency_count,
    'operational_currency_count',v_operational_currency_count,
    'currencies',v_currencies,
    'allocation_status',CASE
      WHEN v_currency_count=0 AND v_operational_currency_count<=1 THEN 'NO_FINANCIAL_ACTIVITY'
      WHEN v_currency_count=1 AND v_operational_currency_count=1 THEN 'CALCULATED'
      ELSE 'MULTI_CURRENCY_REVIEW_REQUIRED' END,
    'calculation_policy','INVESTOR_PERCENT_X_OPERATIONAL_RESULT',
    'calculated_at',clock_timestamp(),'freshness','DIRECT_FRESH'
  );
END;
$function$;