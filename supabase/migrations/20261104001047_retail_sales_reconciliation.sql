CREATE OR REPLACE FUNCTION app_private.command_reconcile_retail_command(
  p_usaha_id uuid,
  p_command_name text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_row public.idempotency_key%ROWTYPE;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;
  PERFORM app_private.catalog_require_admin(p_usaha_id);
  IF p_command_name NOT IN (
    'create_sale',
    'create_mixed_checkout',
    'adjust_sale_stock',
    'set_barang_sales_config',
    'set_varian_sales_config'
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: command penjualan tidak dikenal' USING ERRCODE='22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_row
  FROM public.idempotency_key
  WHERE usaha_id=p_usaha_id
    AND actor_auth_user_id=v_auth_user_id
    AND command_name=p_command_name
    AND key=btrim(p_idempotency_key);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state','not_found','response',NULL);
  END IF;
  RETURN jsonb_build_object(
    'state',CASE WHEN v_row.response_body IS NULL THEN 'unknown' ELSE 'committed' END,
    'response',v_row.response_body
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.command_reconcile_retail_command(
  p_usaha_id uuid,p_command_name text,p_idempotency_key text
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_reconcile_retail_command($1,$2,$3);
$function$;

REVOKE ALL ON FUNCTION app_private.command_reconcile_retail_command(uuid,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION app_private.command_reconcile_retail_command(uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.command_reconcile_retail_command(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.command_reconcile_retail_command(uuid,text,text) TO authenticated;
