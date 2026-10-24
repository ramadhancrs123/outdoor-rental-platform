-- Align database read context with the application's admin-first identity resolver.
-- Admin access is business-scoped through active membership; an investor fallback
-- applies only when the same auth user has no active super-admin membership for this usaha.
CREATE OR REPLACE FUNCTION app_private.assert_investor_read_access(p_usaha_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required'
      USING ERRCODE = '28000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id = aa.akun_admin_id
     AND ku.usaha_id = p_usaha_id
     AND ku.status = 'active'
     AND ku.revoked_at IS NULL
    JOIN public.usaha u
      ON u.usaha_id = p_usaha_id
     AND u.status = 'active'
    WHERE aa.auth_user_id = auth.uid()
      AND aa.status = 'active'
      AND aa.role = 'super_admin'
  ) THEN
    RETURN 'admin';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.investor i
    WHERE i.usaha_id = p_usaha_id
      AND i.auth_user_id = auth.uid()
      AND i.status = 'active'
  ) THEN
    RETURN 'investor';
  END IF;

  RAISE EXCEPTION 'AUTHORIZATION_ERROR: principal tidak memiliki akses investor pada usaha'
    USING ERRCODE = '42501';
END;
$function$;
