CREATE OR REPLACE FUNCTION public.revalidate_notification(p_pemberitahuan_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT app_private.revalidate_notification(p_pemberitahuan_id);
$function$;
