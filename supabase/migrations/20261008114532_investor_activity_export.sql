CREATE OR REPLACE FUNCTION app_private.get_investor_activity_export(
  p_usaha_id uuid,
  p_period_start date,
  p_period_end_exclusive date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_access text := app_private.assert_investor_read_access(p_usaha_id);
  v_iid uuid;
  v_p public.investor_participation;
  v_timezone text;
  v_total integer := 0;
  v_items jsonb;
BEGIN
  IF v_access='investor' THEN
    v_iid := app_private.get_investor_id_for_principal(p_usaha_id);
  ELSE
    SELECT p.investor_id INTO v_iid
    FROM public.investor_participation p
    WHERE p.usaha_id=p_usaha_id
      AND p.status='active'
      AND p.effective_from<=p_period_start
      AND (p.effective_until IS NULL OR p.effective_until>p_period_start)
    ORDER BY p.effective_from DESC
    LIMIT 1;
  END IF;

  SELECT p.* INTO v_p
  FROM public.investor_participation p
  WHERE p.usaha_id=p_usaha_id
    AND p.investor_id=v_iid
    AND p.status='active'
    AND p.effective_from<=p_period_start
    AND (p.effective_until IS NULL OR p.effective_until>p_period_start)
  ORDER BY p.effective_from DESC
  LIMIT 1;

  IF v_p IS NULL THEN
    RAISE EXCEPTION 'CONFIG_REQUIRED: investor participation belum tersedia'
      USING ERRCODE='P0001';
  END IF;

  SELECT u.timezone INTO v_timezone
  FROM public.usaha u
  WHERE u.usaha_id=p_usaha_id
    AND u.status='active';

  SELECT count(*) INTO v_total
  FROM public.transaksi_keuangan t
  WHERE t.usaha_id=p_usaha_id
    AND t.status='recorded'
    AND t.arah IN ('income','expense')
    AND t.tanggal_transaksi >= (p_period_start::text||' 00:00:00 '||v_timezone)::timestamptz
    AND t.tanggal_transaksi < (p_period_end_exclusive::text||' 00:00:00 '||v_timezone)::timestamptz;

  IF v_total > 5000 THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: export terlalu besar. Persempit periode export.'
      USING ERRCODE='23514';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'transaksi_keuangan_id',t.transaksi_keuangan_id,
    'nomor_transaksi',t.nomor_transaksi,
    'occurred_at',t.tanggal_transaksi,
    'direction',t.arah,
    'amount',round(CASE WHEN t.arah='income' THEN t.amount ELSE -t.amount END,2),
    'investor_impact',round((CASE WHEN t.arah='income' THEN t.amount ELSE -t.amount END)*(v_p.percentage/100),2),
    'currency_code',t.currency_code,
    'source_type',t.sumber_type,
    'expense_category',e.kategori_biaya,
    'activity_reason',CASE WHEN t.arah='income'
      THEN 'Pemasukan menambah hasil bersih'
      ELSE 'Pengeluaran mengurangi hasil bersih' END
  ) ORDER BY t.tanggal_transaksi DESC,t.transaksi_keuangan_id DESC),'[]'::jsonb)
  INTO v_items
  FROM public.transaksi_keuangan t
  LEFT JOIN public.pengeluaran e
    ON e.usaha_id=t.usaha_id
   AND e.transaksi_keuangan_id=t.transaksi_keuangan_id
  WHERE t.usaha_id=p_usaha_id
    AND t.status='recorded'
    AND t.arah IN ('income','expense')
    AND t.tanggal_transaksi >= (p_period_start::text||' 00:00:00 '||v_timezone)::timestamptz
    AND t.tanggal_transaksi < (p_period_end_exclusive::text||' 00:00:00 '||v_timezone)::timestamptz;

  RETURN jsonb_build_object(
    'status','OK',
    'principal',v_access,
    'investor_id',v_iid,
    'percentage',v_p.percentage,
    'period',jsonb_build_object('start',p_period_start,'end_exclusive',p_period_end_exclusive,'timezone',v_timezone),
    'items',v_items,
    'total',v_total,
    'limit',v_total,
    'offset',0
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_investor_activity_export(
  p_usaha_id uuid,
  p_period_start date,
  p_period_end_exclusive date
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.get_investor_activity_export($1,$2,$3);
$function$;

REVOKE ALL ON FUNCTION public.get_investor_activity_export(uuid,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_investor_activity_export(uuid,date,date) TO authenticated;