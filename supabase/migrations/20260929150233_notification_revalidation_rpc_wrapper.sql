CREATE OR REPLACE FUNCTION public.revalidate_notification(p_pemberitahuan_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.revalidate_notification(p_pemberitahuan_id);
$function$;

REVOKE ALL ON FUNCTION public.revalidate_notification(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revalidate_notification(uuid) TO authenticated;
