CREATE OR REPLACE FUNCTION app_private.daftar_qr_unit(
  p_usaha_id uuid,
  p_unit_barang_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  qr_unit_id uuid,
  usaha_id uuid,
  unit_barang_id uuid,
  token_qr text,
  status_qr text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id = aa.akun_admin_id
     AND ku.usaha_id = p_usaha_id
     AND ku.status = 'active'
     AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id = v_auth_user_id
      AND aa.status = 'active'
  ) THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT q.qr_unit_id,q.usaha_id,q.unit_barang_id,q.token_qr,q.status_qr
  FROM public.qr_unit q
  WHERE q.usaha_id = p_usaha_id
    AND (p_unit_barang_ids IS NULL OR q.unit_barang_id = ANY(p_unit_barang_ids))
    AND q.status_qr = 'aktif'
  ORDER BY q.dibuat_at ASC,q.qr_unit_id ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.daftar_qr_penyewaan(
  p_usaha_id uuid,
  p_penyewaan_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  qr_penyewaan_id uuid,
  usaha_id uuid,
  penyewaan_id uuid,
  token_qr text,
  status_qr text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id = aa.akun_admin_id
     AND ku.usaha_id = p_usaha_id
     AND ku.status = 'active'
     AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id = v_auth_user_id
      AND aa.status = 'active'
  ) THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT q.qr_penyewaan_id,q.usaha_id,q.penyewaan_id,q.token_qr,q.status_qr
  FROM public.qr_penyewaan q
  WHERE q.usaha_id = p_usaha_id
    AND (p_penyewaan_ids IS NULL OR q.penyewaan_id = ANY(p_penyewaan_ids))
    AND q.status_qr = 'aktif'
  ORDER BY q.dibuat_at ASC,q.qr_penyewaan_id ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.daftar_qr_unit(
  p_usaha_id uuid,
  p_unit_barang_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  qr_unit_id uuid,
  usaha_id uuid,
  unit_barang_id uuid,
  token_qr text,
  status_qr text
)
LANGUAGE sql
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT * FROM app_private.daftar_qr_unit($1,$2);
$function$;

CREATE OR REPLACE FUNCTION public.daftar_qr_penyewaan(
  p_usaha_id uuid,
  p_penyewaan_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  qr_penyewaan_id uuid,
  usaha_id uuid,
  penyewaan_id uuid,
  token_qr text,
  status_qr text
)
LANGUAGE sql
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT * FROM app_private.daftar_qr_penyewaan($1,$2);
$function$;

REVOKE ALL ON FUNCTION public.daftar_qr_unit(uuid,uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.daftar_qr_penyewaan(uuid,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daftar_qr_unit(uuid,uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daftar_qr_penyewaan(uuid,uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
