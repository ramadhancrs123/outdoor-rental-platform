CREATE OR REPLACE FUNCTION public.command_set_inventory_unit_operational_status(
  p_usaha_id uuid,
  p_unit_barang_id uuid,
  p_status text,
  p_alasan text,
  p_catatan text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT * FROM app_private.command_set_inventory_unit_operational_status(
    $1,$2,$3,$4,$5,$6,$7,$8
  );
$function$;

REVOKE ALL ON FUNCTION public.command_set_inventory_unit_operational_status(uuid,uuid,text,text,text,timestamptz,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.command_set_inventory_unit_operational_status(uuid,uuid,text,text,text,timestamptz,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION public.command_set_inventory_unit_operational_status(uuid,uuid,text,text,text,timestamptz,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.command_set_inventory_unit_operational_status(uuid,uuid,text,text,text,timestamptz,text,uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
