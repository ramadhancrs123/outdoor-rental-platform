CREATE OR REPLACE FUNCTION app_private.get_investor_admin_finance_config(
  p_usaha_id uuid,
  p_investor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.assert_investor_admin(p_usaha_id);
  v_investor_id uuid;
  v_current jsonb;
  v_history jsonb;
BEGIN
  IF p_investor_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.investor i
      WHERE i.usaha_id = p_usaha_id
        AND i.investor_id = p_investor_id
    ) THEN
      RAISE EXCEPTION 'NOT_FOUND: investor tidak ditemukan pada usaha'
        USING ERRCODE='P0002';
    END IF;
    v_investor_id := p_investor_id;
  ELSE
    SELECT i.investor_id
      INTO v_investor_id
    FROM public.investor i
    WHERE i.usaha_id = p_usaha_id
      AND i.status = 'active'
    ORDER BY i.created_at ASC
    LIMIT 1;
  END IF;

  SELECT to_jsonb(row)
    INTO v_current
  FROM (
    SELECT
      p.participation_id,
      p.investor_id,
      p.percentage AS investor_percentage,
      p.operational_reserve_amount,
      p.pengelola_akun_admin_id,
      p.period_start_day,
      p.period_end_day,
      p.basis_type,
      p.effective_from,
      p.effective_until,
      p.status,
      p.updated_at
    FROM public.investor_participation p
    WHERE p.usaha_id = p_usaha_id
      AND p.investor_id = v_investor_id
      AND p.status = 'active'
      AND p.effective_from <= CURRENT_DATE
      AND (p.effective_until IS NULL OR p.effective_until > CURRENT_DATE)
    ORDER BY p.effective_from DESC
    LIMIT 1
  ) row;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'participation_id', p.participation_id,
        'investor_id', p.investor_id,
        'investor_percentage', p.percentage,
        'operational_reserve_amount', p.operational_reserve_amount,
        'pengelola_akun_admin_id', p.pengelola_akun_admin_id,
        'period_start_day', p.period_start_day,
        'period_end_day', p.period_end_day,
        'basis_type', p.basis_type,
        'effective_from', p.effective_from,
        'effective_until', p.effective_until,
        'status', p.status,
        'updated_at', p.updated_at
      )
      ORDER BY p.effective_from DESC
    ),
    '[]'::jsonb
  )
  INTO v_history
  FROM public.investor_participation p
  WHERE p.usaha_id = p_usaha_id
    AND (v_investor_id IS NULL OR p.investor_id = v_investor_id);

  RETURN jsonb_build_object(
    'status', CASE WHEN v_current IS NULL THEN 'NO_INVESTOR_CONFIG' ELSE 'OK' END,
    'principal', 'admin',
    'investor_id', v_investor_id,
    'current', v_current,
    'history', v_history
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_investor_admin_finance_config(
  p_usaha_id uuid,
  p_investor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.get_investor_admin_finance_config($1, $2);
$function$;

REVOKE ALL ON FUNCTION public.get_investor_admin_finance_config(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_investor_admin_finance_config(uuid,uuid) TO authenticated;
