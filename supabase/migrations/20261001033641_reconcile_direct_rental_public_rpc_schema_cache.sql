-- Reconcile the authenticated Data API wrappers for walk-in rental commands.
-- The live database already contains these public wrappers, but the local migration
-- history is missing their originating DDL. Re-declare them and reload PostgREST's
-- schema cache so the /rpc surface matches the database contract.

CREATE OR REPLACE FUNCTION public.command_create_direct_rental(
  p_usaha_id uuid,
  p_penyewa_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz,
  p_lines jsonb,
  p_catatan text,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT * FROM app_private.command_create_direct_rental(
    $1, $2, $3, $4, $5, $6, $7, $8
  );
$function$;

REVOKE ALL ON FUNCTION public.command_create_direct_rental(
  uuid, uuid, timestamptz, timestamptz, jsonb, text, text, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.command_create_direct_rental(
  uuid, uuid, timestamptz, timestamptz, jsonb, text, text, uuid
) FROM anon;
REVOKE ALL ON FUNCTION public.command_create_direct_rental(
  uuid, uuid, timestamptz, timestamptz, jsonb, text, text, uuid
) FROM service_role;
GRANT EXECUTE ON FUNCTION public.command_create_direct_rental(
  uuid, uuid, timestamptz, timestamptz, jsonb, text, text, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.command_reconcile_direct_rental_creation(
  p_usaha_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT * FROM app_private.command_reconcile_direct_rental_creation($1, $2);
$function$;

REVOKE ALL ON FUNCTION public.command_reconcile_direct_rental_creation(
  uuid, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.command_reconcile_direct_rental_creation(
  uuid, text
) FROM anon;
REVOKE ALL ON FUNCTION public.command_reconcile_direct_rental_creation(
  uuid, text
) FROM service_role;
GRANT EXECUTE ON FUNCTION public.command_reconcile_direct_rental_creation(
  uuid, text
) TO authenticated;

NOTIFY pgrst, 'reload schema';