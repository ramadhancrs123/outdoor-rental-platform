CREATE OR REPLACE FUNCTION public.command_preview_rental_period(
  p_usaha_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_preview_rental_period($1, $2, $3);
$function$;

REVOKE ALL ON FUNCTION public.command_preview_rental_period(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.command_preview_rental_period(uuid, timestamptz, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.command_preview_rental_period(uuid, timestamptz, timestamptz) FROM service_role;
GRANT EXECUTE ON FUNCTION public.command_preview_rental_period(uuid, timestamptz, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';
