-- Public PostgREST RPC wrappers for procurement trusted commands.
-- Pattern follows the existing public -> app_private command boundary.
-- Wrappers are SECURITY INVOKER; app_private owns authorization and mutation semantics.

CREATE OR REPLACE FUNCTION public.command_create_supplier(
  p_usaha_id uuid,
  p_nama text,
  p_nomor_telepon text,
  p_email text,
  p_alamat text,
  p_catatan text,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_create_supplier($1,$2,$3,$4,$5,$6,$7,$8);
$function$;

CREATE OR REPLACE FUNCTION public.command_update_supplier(
  p_usaha_id uuid,
  p_pemasok_id uuid,
  p_nama text,
  p_nomor_telepon text,
  p_email text,
  p_alamat text,
  p_catatan text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_update_supplier($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
$function$;

CREATE OR REPLACE FUNCTION public.command_set_supplier_status(
  p_usaha_id uuid,
  p_pemasok_id uuid,
  p_status text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_set_supplier_status($1,$2,$3,$4,$5,$6);
$function$;

CREATE OR REPLACE FUNCTION public.command_create_purchase(
  p_usaha_id uuid,
  p_pemasok_id uuid,
  p_nomor_pembelian text,
  p_tanggal_pembelian date,
  p_lines jsonb,
  p_catatan text,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_create_purchase($1,$2,$3,$4,$5,$6,$7,$8);
$function$;

CREATE OR REPLACE FUNCTION public.command_update_purchase_draft(
  p_usaha_id uuid,
  p_pembelian_id uuid,
  p_pemasok_id uuid,
  p_nomor_pembelian text,
  p_tanggal_pembelian date,
  p_lines jsonb,
  p_catatan text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_update_purchase_draft($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
$function$;

CREATE OR REPLACE FUNCTION public.command_reconcile_procurement_mutation(
  p_usaha_id uuid,
  p_command_name text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_reconcile_procurement_mutation($1,$2,$3);
$function$;

REVOKE ALL ON FUNCTION public.command_create_supplier(uuid,text,text,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.command_update_supplier(uuid,uuid,text,text,text,text,text,timestamptz,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.command_set_supplier_status(uuid,uuid,text,timestamptz,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.command_create_purchase(uuid,uuid,text,date,jsonb,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.command_update_purchase_draft(uuid,uuid,uuid,text,date,jsonb,text,timestamptz,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.command_reconcile_procurement_mutation(uuid,text,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.command_create_supplier(uuid,text,text,text,text,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_update_supplier(uuid,uuid,text,text,text,text,text,timestamptz,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_set_supplier_status(uuid,uuid,text,timestamptz,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_create_purchase(uuid,uuid,text,date,jsonb,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_update_purchase_draft(uuid,uuid,uuid,text,date,jsonb,text,timestamptz,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_reconcile_procurement_mutation(uuid,text,text) TO authenticated;
