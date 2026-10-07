-- Fix trusted public wrappers for operational commands.
-- Keep app_private functions closed to authenticated; public wrappers execute with
-- the postgres definer context and remain the authenticated entry points.

CREATE OR REPLACE FUNCTION public.command_operational_activate_rental(
  p_usaha_id uuid,
  p_penyewaan_id uuid,
  p_catatan text,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.command_operational_activate_rental($1,$2,$3,$4,$5);
$function$;

REVOKE ALL ON FUNCTION public.command_operational_activate_rental(uuid,uuid,text,text,uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.command_operational_activate_rental(uuid,uuid,text,text,uuid)
  TO authenticated;


CREATE OR REPLACE FUNCTION public.command_operational_process_unit_return(
  p_usaha_id uuid,
  p_penyewaan_id uuid,
  p_unit_barang_id uuid,
  p_hasil text,
  p_kelengkapan_status text,
  p_keputusan_operasional text,
  p_catatan text,
  p_findings jsonb,
  p_idempotency_key text,
  p_request_id uuid,
  p_expected_rental_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.command_operational_process_unit_return(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
  );
$function$;

REVOKE ALL ON FUNCTION public.command_operational_process_unit_return(
  uuid,uuid,uuid,text,text,text,text,jsonb,text,uuid,timestamptz
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.command_operational_process_unit_return(
  uuid,uuid,uuid,text,text,text,text,jsonb,text,uuid,timestamptz
) TO authenticated;
