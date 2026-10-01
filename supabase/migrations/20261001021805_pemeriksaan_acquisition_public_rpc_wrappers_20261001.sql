-- ADR-007 public PostgREST RPC exposure.
-- Trusted implementation remains in app_private; browser calls these public SQL wrappers.

CREATE OR REPLACE FUNCTION public.command_start_acquisition_inspection(
  p_usaha_id uuid,
  p_unit_barang_id uuid,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_start_acquisition_inspection($1,$2,$3,$4);
$function$;

CREATE OR REPLACE FUNCTION public.command_complete_acquisition_inspection(
  p_usaha_id uuid,
  p_pemeriksaan_id uuid,
  p_hasil text,
  p_kelengkapan_status text,
  p_keputusan_operasional text,
  p_catatan text,
  p_findings jsonb,
  p_idempotency_key text,
  p_request_id uuid,
  p_expected_inspection_updated_at timestamptz,
  p_expected_unit_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_complete_acquisition_inspection($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);
$function$;

CREATE OR REPLACE FUNCTION public.command_correct_inventory_condition_summary(
  p_usaha_id uuid,
  p_unit_barang_id uuid,
  p_new_condition text,
  p_correction_reason text,
  p_correction_note text,
  p_source_pemeriksaan_id uuid,
  p_expected_updated_at timestamptz,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_correct_inventory_condition_summary($1,$2,$3,$4,$5,$6,$7,$8,$9);
$function$;

CREATE OR REPLACE FUNCTION public.command_reconcile_inventory_condition_mutation(
  p_usaha_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_reconcile_inventory_condition_mutation($1,$2);
$function$;

REVOKE ALL ON FUNCTION public.command_start_acquisition_inspection(uuid,uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.command_start_acquisition_inspection(uuid,uuid,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION public.command_start_acquisition_inspection(uuid,uuid,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.command_start_acquisition_inspection(uuid,uuid,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.command_complete_acquisition_inspection(uuid,uuid,text,text,text,text,jsonb,text,uuid,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.command_complete_acquisition_inspection(uuid,uuid,text,text,text,text,jsonb,text,uuid,timestamptz,timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.command_complete_acquisition_inspection(uuid,uuid,text,text,text,text,jsonb,text,uuid,timestamptz,timestamptz) FROM service_role;
GRANT EXECUTE ON FUNCTION public.command_complete_acquisition_inspection(uuid,uuid,text,text,text,text,jsonb,text,uuid,timestamptz,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.command_correct_inventory_condition_summary(uuid,uuid,text,text,text,uuid,timestamptz,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.command_correct_inventory_condition_summary(uuid,uuid,text,text,text,uuid,timestamptz,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION public.command_correct_inventory_condition_summary(uuid,uuid,text,text,text,uuid,timestamptz,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.command_correct_inventory_condition_summary(uuid,uuid,text,text,text,uuid,timestamptz,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.command_reconcile_inventory_condition_mutation(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.command_reconcile_inventory_condition_mutation(uuid,text) FROM anon;
REVOKE ALL ON FUNCTION public.command_reconcile_inventory_condition_mutation(uuid,text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.command_reconcile_inventory_condition_mutation(uuid,text) TO authenticated;
