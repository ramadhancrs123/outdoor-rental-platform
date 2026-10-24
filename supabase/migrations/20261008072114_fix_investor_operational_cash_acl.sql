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
  )
  SELECT jsonb_build_object(
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

CREATE OR REPLACE FUNCTION public.finance_operational_account_summary(p_usaha_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_access text:=app_private.assert_investor_read_access(p_usaha_id);
BEGIN
  RETURN app_private.finance_operational_cash_summary(p_usaha_id);
END;
$function$;