-- Finance command reconciliation boundary.
-- Read-only lookup of committed idempotent command responses.
-- A missing response means the original command did not commit its idempotency record.

CREATE OR REPLACE FUNCTION app_private.command_reconcile_payment(
  p_usaha_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_row public.idempotency_key%ROWTYPE;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id dan idempotency_key wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id = aa.akun_admin_id
     AND ku.status = 'active'
     AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id = v_auth_user_id
      AND aa.status = 'active'
      AND aa.role = 'super_admin'
      AND ku.usaha_id = p_usaha_id
  ) THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses finance pada usaha' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_row
  FROM public.idempotency_key ik
  WHERE ik.usaha_id = p_usaha_id
    AND ik.actor_auth_user_id = v_auth_user_id
    AND ik.command_name = 'record_payment'
    AND ik.key = btrim(p_idempotency_key);

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'state', 'not_found',
      'response', null
    );
  END IF;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_row.response_body IS NULL THEN 'unknown' ELSE 'committed' END,
    'response', v_row.response_body
  );
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_reconcile_expense(
  p_usaha_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_row public.idempotency_key%ROWTYPE;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id dan idempotency_key wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id = aa.akun_admin_id
     AND ku.status = 'active'
     AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id = v_auth_user_id
      AND aa.status = 'active'
      AND aa.role = 'super_admin'
      AND ku.usaha_id = p_usaha_id
  ) THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses finance pada usaha' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_row
  FROM public.idempotency_key ik
  WHERE ik.usaha_id = p_usaha_id
    AND ik.actor_auth_user_id = v_auth_user_id
    AND ik.command_name = 'record_expense'
    AND ik.key = btrim(p_idempotency_key);

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'state', 'not_found',
      'response', null
    );
  END IF;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_row.response_body IS NULL THEN 'unknown' ELSE 'committed' END,
    'response', v_row.response_body
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_reconcile_payment(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_reconcile_payment(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_reconcile_payment(uuid, text) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_reconcile_payment(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_reconcile_expense(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_reconcile_expense(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_reconcile_expense(uuid, text) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_reconcile_expense(uuid, text) TO authenticated;
