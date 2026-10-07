-- Expose Paket Sewa media trusted commands through authenticated PostgREST RPC wrappers.
-- app_private remains closed; public wrappers are the authenticated Data API boundary.

CREATE OR REPLACE FUNCTION public.command_add_paket_media(
  p_usaha_id uuid,
  p_paket_sewa_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_media_type text DEFAULT 'image',
  p_urutan integer DEFAULT 1,
  p_is_cover boolean DEFAULT false,
  p_idempotency_key text DEFAULT NULL,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_add_paket_media(
    $1,$2,$3,$4,$5,$6,$7,$8,$9
  );
$function$;

CREATE OR REPLACE FUNCTION public.command_remove_paket_media(
  p_usaha_id uuid,
  p_paket_media_id uuid,
  p_idempotency_key text DEFAULT NULL,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_remove_paket_media(
    $1,$2,$3,$4
  );
$function$;

CREATE OR REPLACE FUNCTION public.command_set_paket_media_cover(
  p_usaha_id uuid,
  p_paket_media_id uuid,
  p_is_cover boolean DEFAULT true,
  p_idempotency_key text DEFAULT NULL,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_set_paket_media_cover(
    $1,$2,$3,$4,$5
  );
$function$;

CREATE OR REPLACE FUNCTION public.command_reorder_paket_media(
  p_usaha_id uuid,
  p_paket_sewa_id uuid,
  p_orders jsonb,
  p_idempotency_key text DEFAULT NULL,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_reorder_paket_media(
    $1,$2,$3,$4,$5
  );
$function$;

REVOKE ALL ON FUNCTION public.command_add_paket_media(uuid,uuid,text,text,text,integer,boolean,text,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.command_remove_paket_media(uuid,uuid,text,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.command_set_paket_media_cover(uuid,uuid,boolean,text,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.command_reorder_paket_media(uuid,uuid,jsonb,text,uuid) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.command_add_paket_media(uuid,uuid,text,text,text,integer,boolean,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_remove_paket_media(uuid,uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_set_paket_media_cover(uuid,uuid,boolean,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_reorder_paket_media(uuid,uuid,jsonb,text,uuid) TO authenticated;
