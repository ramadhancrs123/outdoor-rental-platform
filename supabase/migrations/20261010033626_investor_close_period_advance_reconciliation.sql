-- Reconcile pre-close external payouts against final allocations during period close.
-- Over-advances are retained as review_required and recorded as advance_excess_amount.

CREATE OR REPLACE FUNCTION app_private.command_close_investor_period(p_usaha_id uuid, p_period_start date, p_idempotency_key text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
  v_operational_currency_count integer:=0;
  v_currency char(3);
  v_period_id uuid:=gen_random_uuid();
  v_ia_id uuid:=gen_random_uuid();
  v_oa_id uuid:=gen_random_uuid();
  v_investor_advance numeric:=0;
  v_operator_advance numeric:=0;
  v_investor_advance_used numeric:=0;
  v_operator_advance_used numeric:=0;
  v_investor_advance_excess numeric:=0;
  v_operator_advance_excess numeric:=0;
  v_idempotency_id uuid;
  v_existing_response jsonb;
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
  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(
    p_usaha_id,auth.uid(),btrim(p_idempotency_key),'close_investor_period',
    md5(jsonb_build_object('usaha_id',p_usaha_id,'period_start',v_ps)::text)
  )
  ON CONFLICT(usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body INTO v_existing_response
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id AND actor_auth_user_id=auth.uid()
      AND command_name='close_investor_period' AND key=btrim(p_idempotency_key);
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: closing idempotency record exists without response' USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text||':'||v_ps::text,0));

  SELECT * INTO v_existing FROM public.investor_finance_period p
  WHERE p.usaha_id=p_usaha_id AND p.period_start=v_ps FOR UPDATE;
  IF v_existing.period_id IS NOT NULL THEN
    v_response:=jsonb_build_object(
      'period_id',v_existing.period_id,'period_start',v_existing.period_start,
      'period_end_exclusive',v_existing.period_end_exclusive,'status','closed',
      'investor_allocation',v_existing.investor_allocation,'operator_allocation',v_existing.operator_allocation
    );
    UPDATE public.idempotency_key SET response_status=200,response_body=v_response
    WHERE idempotency_key_id=v_idempotency_id;
    RETURN v_response;
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

  SELECT (x.payload->>'saldo')::numeric,(x.payload->>'currency_count')::integer
  INTO v_cash,v_operational_currency_count
  FROM (SELECT app_private.finance_operational_cash_summary(p_usaha_id) payload) x;

  IF v_currency_count>1 OR v_operational_currency_count>1 THEN
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

  -- Reconcile recorded pre-close external payouts against the now-final rights.
  -- These rows were cash payouts already made, but had no allocation ID when created.
  SELECT coalesce(sum(p.amount),0) INTO v_investor_advance
  FROM public.investor_stakeholder_payout p
  WHERE p.usaha_id=p_usaha_id
    AND p.stakeholder_type='investor'
    AND p.period_start=v_ps
    AND p.period_id IS NULL
    AND p.investor_allocation_id IS NULL
    AND p.operator_allocation_id IS NULL
    AND p.payout_kind='allocation_payout'
    AND p.status='recorded';

  SELECT coalesce(sum(p.amount),0) INTO v_operator_advance
  FROM public.investor_stakeholder_payout p
  WHERE p.usaha_id=p_usaha_id
    AND p.stakeholder_type='pengelola'
    AND p.period_start=v_ps
    AND p.period_id IS NULL
    AND p.investor_allocation_id IS NULL
    AND p.operator_allocation_id IS NULL
    AND p.payout_kind='allocation_payout'
    AND p.status='recorded';

  v_investor_advance_used:=least(v_investor_advance,v_investor);
  v_operator_advance_used:=least(v_operator_advance,v_operator);
  v_investor_advance_excess:=greatest(v_investor_advance-v_investor_advance_used,0);
  v_operator_advance_excess:=greatest(v_operator_advance-v_operator_advance_used,0);

  IF v_investor_advance>0 THEN
    UPDATE public.investor_period_allocation a
    SET distributed_amount=v_investor_advance_used,
        advance_excess_amount=v_investor_advance_excess,
        status=CASE
          WHEN v_investor_advance_excess>0 THEN 'review_required'
          WHEN v_investor_advance_used>=a.allocation_amount AND a.allocation_amount>0 THEN 'settled'
          WHEN v_investor_advance_used>0 THEN 'partially_distributed'
          ELSE 'allocated'
        END
    WHERE a.allocation_id=v_ia_id AND a.usaha_id=p_usaha_id;

    UPDATE public.investor_stakeholder_payout p
    SET period_id=v_period_id,
        investor_allocation_id=v_ia_id
    WHERE p.usaha_id=p_usaha_id
      AND p.stakeholder_type='investor'
      AND p.period_start=v_ps
      AND p.period_id IS NULL
      AND p.investor_allocation_id IS NULL
      AND p.operator_allocation_id IS NULL
      AND p.payout_kind='allocation_payout'
      AND p.status='recorded';
  END IF;

  IF v_operator_advance>0 THEN
    UPDATE public.operator_period_allocation a
    SET distributed_amount=v_operator_advance_used,
        advance_excess_amount=v_operator_advance_excess,
        status=CASE
          WHEN v_operator_advance_excess>0 THEN 'review_required'
          WHEN v_operator_advance_used>=a.allocation_amount AND a.allocation_amount>0 THEN 'settled'
          WHEN v_operator_advance_used>0 THEN 'partially_distributed'
          ELSE 'allocated'
        END
    WHERE a.allocation_id=v_oa_id AND a.usaha_id=p_usaha_id;

    UPDATE public.investor_stakeholder_payout p
    SET period_id=v_period_id,
        operator_allocation_id=v_oa_id
    WHERE p.usaha_id=p_usaha_id
      AND p.stakeholder_type='pengelola'
      AND p.period_start=v_ps
      AND p.period_id IS NULL
      AND p.investor_allocation_id IS NULL
      AND p.operator_allocation_id IS NULL
      AND p.payout_kind='allocation_payout'
      AND p.status='recorded';
  END IF;

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
      'operational_cash_at_close',v_cash,'distributable_cash_at_close',v_distributable,
      'investor_advance_paid',v_investor_advance,'operator_advance_paid',v_operator_advance,
      'investor_advance_excess',v_investor_advance_excess,'operator_advance_excess',v_operator_advance_excess
    )
  );

  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES(
    p_usaha_id,'investor.period.closed','investor_finance_period',v_period_id,
    jsonb_build_object('period_id',v_period_id,'investor_allocation',v_investor,
      'operator_allocation',v_operator,'distributable_cash',v_distributable,
      'investor_advance_paid',v_investor_advance,'operator_advance_paid',v_operator_advance,
      'investor_advance_excess',v_investor_advance_excess,'operator_advance_excess',v_operator_advance_excess)
  );

  v_response:=jsonb_build_object(
    'period_id',v_period_id,'period_start',v_ps,'period_end_exclusive',v_pe,'status','closed',
    'income_recorded',v_income,'expense_recorded',v_expense,'net_operational_result',v_net,
    'investor_allocation',v_investor,'operator_allocation',v_operator,
    'operational_reserve_amount',v_p.operational_reserve_amount,
    'operational_cash_at_close',coalesce(v_cash,0),'distributable_cash_at_close',v_distributable,
    'reserve_shortfall_at_close',v_shortfall,'investor_allocation_id',v_ia_id,'operator_allocation_id',v_oa_id,
    'investor_advance_paid',v_investor_advance,'operator_advance_paid',v_operator_advance,
    'investor_advance_excess',v_investor_advance_excess,'operator_advance_excess',v_operator_advance_excess
  );

  UPDATE public.idempotency_key
  SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;

  RETURN v_response;
END;
$function$;

-- Safely reconcile advance payouts on periods closed by earlier versions.
-- Only recorded, unassociated external payouts are considered. Investor self-transfers
-- are excluded because their period_start and allocation IDs are null by contract.
DO $backfill$
DECLARE
  v_period record;
  v_i record;
  v_o record;
  v_i_total numeric;
  v_o_total numeric;
  v_i_available numeric;
  v_o_available numeric;
  v_i_used numeric;
  v_o_used numeric;
  v_i_excess numeric;
  v_o_excess numeric;
BEGIN
  FOR v_period IN
    SELECT DISTINCT f.period_id,f.usaha_id,f.period_start
    FROM public.investor_finance_period f
    JOIN public.investor_stakeholder_payout p
      ON p.usaha_id=f.usaha_id AND p.period_start=f.period_start
    WHERE p.period_id IS NULL
      AND p.investor_allocation_id IS NULL
      AND p.operator_allocation_id IS NULL
      AND p.payout_kind='allocation_payout'
      AND p.status='recorded'
    ORDER BY f.usaha_id,f.period_start
  LOOP
    SELECT a.allocation_id,a.allocation_amount,a.distributed_amount,
           a.transferred_out_amount,a.advance_excess_amount
    INTO v_i
    FROM public.investor_period_allocation a
    WHERE a.usaha_id=v_period.usaha_id AND a.period_id=v_period.period_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INTEGRITY_ERROR: closed period % has unassociated advance payouts but no Investor allocation',v_period.period_start
        USING ERRCODE='23514';
    END IF;

    SELECT a.allocation_id,a.allocation_amount,a.distributed_amount,
           a.transferred_in_amount,a.advance_excess_amount
    INTO v_o
    FROM public.operator_period_allocation a
    WHERE a.usaha_id=v_period.usaha_id AND a.period_id=v_period.period_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INTEGRITY_ERROR: closed period % has unassociated advance payouts but no Pengelola allocation',v_period.period_start
        USING ERRCODE='23514';
    END IF;

    SELECT coalesce(sum(p.amount),0) INTO v_i_total
    FROM public.investor_stakeholder_payout p
    WHERE p.usaha_id=v_period.usaha_id AND p.period_start=v_period.period_start
      AND p.period_id IS NULL AND p.investor_allocation_id IS NULL
      AND p.operator_allocation_id IS NULL AND p.stakeholder_type='investor'
      AND p.payout_kind='allocation_payout' AND p.status='recorded';

    SELECT coalesce(sum(p.amount),0) INTO v_o_total
    FROM public.investor_stakeholder_payout p
    WHERE p.usaha_id=v_period.usaha_id AND p.period_start=v_period.period_start
      AND p.period_id IS NULL AND p.investor_allocation_id IS NULL
      AND p.operator_allocation_id IS NULL AND p.stakeholder_type='pengelola'
      AND p.payout_kind='allocation_payout' AND p.status='recorded';

    IF v_i_total>0 THEN
      v_i_available:=greatest(v_i.allocation_amount-v_i.distributed_amount-v_i.transferred_out_amount,0);
      v_i_used:=least(v_i_total,v_i_available);
      v_i_excess:=greatest(v_i_total-v_i_used,0);

      UPDATE public.investor_period_allocation a
      SET distributed_amount=a.distributed_amount+v_i_used,
          advance_excess_amount=a.advance_excess_amount+v_i_excess,
          status=CASE
            WHEN v_i_excess>0 THEN 'review_required'
            WHEN a.distributed_amount+v_i_used+a.transferred_out_amount>=a.allocation_amount
              AND a.allocation_amount>0 THEN 'settled'
            WHEN a.distributed_amount+v_i_used>0 THEN 'partially_distributed'
            ELSE 'allocated'
          END
      WHERE a.allocation_id=v_i.allocation_id;

      UPDATE public.investor_stakeholder_payout p
      SET period_id=v_period.period_id,investor_allocation_id=v_i.allocation_id
      WHERE p.usaha_id=v_period.usaha_id AND p.period_start=v_period.period_start
        AND p.period_id IS NULL AND p.investor_allocation_id IS NULL
        AND p.operator_allocation_id IS NULL AND p.stakeholder_type='investor'
        AND p.payout_kind='allocation_payout' AND p.status='recorded';
    END IF;

    IF v_o_total>0 THEN
      v_o_available:=greatest(v_o.allocation_amount+v_o.transferred_in_amount-v_o.distributed_amount,0);
      v_o_used:=least(v_o_total,v_o_available);
      v_o_excess:=greatest(v_o_total-v_o_used,0);

      UPDATE public.operator_period_allocation a
      SET distributed_amount=a.distributed_amount+v_o_used,
          advance_excess_amount=a.advance_excess_amount+v_o_excess,
          status=CASE
            WHEN v_o_excess>0 THEN 'review_required'
            WHEN a.distributed_amount+v_o_used>=a.allocation_amount+a.transferred_in_amount
              AND a.allocation_amount+a.transferred_in_amount>0 THEN 'settled'
            WHEN a.distributed_amount+v_o_used>0 THEN 'partially_distributed'
            ELSE 'allocated'
          END
      WHERE a.allocation_id=v_o.allocation_id;

      UPDATE public.investor_stakeholder_payout p
      SET period_id=v_period.period_id,operator_allocation_id=v_o.allocation_id
      WHERE p.usaha_id=v_period.usaha_id AND p.period_start=v_period.period_start
        AND p.period_id IS NULL AND p.investor_allocation_id IS NULL
        AND p.operator_allocation_id IS NULL AND p.stakeholder_type='pengelola'
        AND p.payout_kind='allocation_payout' AND p.status='recorded';
    END IF;
  END LOOP;
END;
$backfill$;
