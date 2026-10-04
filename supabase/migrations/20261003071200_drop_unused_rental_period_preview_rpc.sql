DROP FUNCTION IF EXISTS public.command_preview_rental_period(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS app_private.command_preview_rental_period(uuid, timestamptz, timestamptz);
NOTIFY pgrst, 'reload schema';
