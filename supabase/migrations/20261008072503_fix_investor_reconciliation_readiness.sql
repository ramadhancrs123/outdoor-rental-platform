CREATE OR REPLACE FUNCTION app_private.investor_reconciliation(p_usaha_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.assert_investor_admin(p_usaha_id);
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
  v_status text;
BEGIN
  SELECT count(*) INTO v_current_config_count
  FROM public.investor_participation
  WHERE usaha_id=p_usaha_id
    AND status='active'
    AND effective_from<=CURRENT_DATE
    AND (effective_until IS NULL OR effective_until>CURRENT_DATE);

  SELECT count(*) INTO v_future_config_count
  FROM public.investor_participation
  WHERE usaha_id=p_usaha_id
    AND status='active'
    AND effective_from>CURRENT_DATE;

  SELECT count(*) INTO v_investor_count
  FROM public.investor
  WHERE usaha_id=p_usaha_id AND status='active';

  SELECT count(*) INTO v_op_account_count
  FROM public.akun_keuangan
  WHERE usaha_id=p_usaha_id AND status='active' AND fungsi_akun='operasional';

  SELECT count(*) INTO v_inv_account_count
  FROM public.akun_keuangan
  WHERE usaha_id=p_usaha_id AND status='active' AND fungsi_akun='investor';

  SELECT count(*) INTO v_opr_account_count
  FROM public.akun_keuangan
  WHERE usaha_id=p_usaha_id AND status='active' AND fungsi_akun='pengelola';

  SELECT count(*) INTO v_unsettled
  FROM (
    SELECT allocation_id
    FROM public.investor_period_allocation
    WHERE usaha_id=p_usaha_id AND status<>'settled'
    UNION ALL
    SELECT allocation_id
    FROM public.operator_period_allocation
    WHERE usaha_id=p_usaha_id AND status<>'settled'
  ) q;

  SELECT count(*) INTO v_pending
  FROM public.investor_realtime_event
  WHERE usaha_id=p_usaha_id AND delivered_at IS NULL;

  SELECT count(DISTINCT mata_uang) INTO v_currency_count
  FROM public.akun_keuangan
  WHERE usaha_id=p_usaha_id AND status='active' AND fungsi_akun='operasional';

  SELECT count(*) INTO v_negative_accounts
  FROM public.akun_keuangan a
  WHERE a.usaha_id=p_usaha_id AND a.status='active'
    AND app_private.finance_account_balance(a.usaha_id,a.akun_keuangan_id)<0;

  IF v_current_config_count=1
     AND v_investor_count=1
     AND v_op_account_count>=1
     AND v_inv_account_count=1
     AND v_opr_account_count=1
     AND v_currency_count=1
     AND v_pending=0
     AND v_negative_accounts=0 THEN
    v_status:='HEALTHY';
  ELSE
    v_status:='ATTENTION';
  END IF;

  RETURN jsonb_build_object(
    'status',v_status,
    'checked_by_admin_id',v_admin_id,
    'current_config_count',v_current_config_count,
    'future_config_count',v_future_config_count,
    'active_investor_count',v_investor_count,
    'operational_account_count',v_op_account_count,
    'investor_account_count',v_inv_account_count,
    'operator_account_count',v_opr_account_count,
    'unsettled_allocations',v_unsettled,
    'pending_realtime_events',v_pending,
    'operational_currency_count',v_currency_count,
    'negative_operational_or_stakeholder_accounts',v_negative_accounts,
    'negative_result_policy','investor_allocation_zero',
    'open_period_formula','investor_percentage_x_operational_result'
  );
END;
$function$;