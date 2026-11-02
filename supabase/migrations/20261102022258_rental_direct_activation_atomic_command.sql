CREATE OR REPLACE FUNCTION app_private.command_create_and_activate_direct_rental(
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_created jsonb;
  v_activated jsonb;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
BEGIN
  IF v_key IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi' USING ERRCODE = '22023';
  END IF;
  v_created := app_private.command_create_direct_rental(
    p_usaha_id,p_penyewa_id,p_jadwal_mulai,p_jadwal_kembali,p_lines,p_catatan,
    v_key || ':create',p_request_id
  );
  v_activated := app_private.command_operational_activate_rental(
    p_usaha_id,(v_created->>'penyewaan_id')::uuid,p_catatan,v_key || ':activate',p_request_id
  );
  RETURN v_created || v_activated;
END;
$function$;
REVOKE ALL ON FUNCTION app_private.command_create_and_activate_direct_rental(uuid,uuid,timestamptz,timestamptz,jsonb,text,text,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_create_and_activate_direct_rental(uuid,uuid,timestamptz,timestamptz,jsonb,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.command_create_and_activate_direct_rental(
  p_usaha_id uuid,p_penyewa_id uuid,p_jadwal_mulai timestamptz,p_jadwal_kembali timestamptz,
  p_lines jsonb,p_catatan text,p_idempotency_key text,p_request_id uuid
)
RETURNS jsonb LANGUAGE sql SET search_path TO '' AS $function$
  SELECT app_private.command_create_and_activate_direct_rental(
    p_usaha_id,p_penyewa_id,p_jadwal_mulai,p_jadwal_kembali,p_lines,p_catatan,p_idempotency_key,p_request_id
  );
$function$;
REVOKE ALL ON FUNCTION public.command_create_and_activate_direct_rental(uuid,uuid,timestamptz,timestamptz,jsonb,text,text,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_create_and_activate_direct_rental(uuid,uuid,timestamptz,timestamptz,jsonb,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.command_reconcile_direct_rental_activation(p_usaha_id uuid,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_create_response jsonb;
  v_activate_response jsonb;
  v_create_found boolean := false;
  v_activate_found boolean := false;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
BEGIN
  IF v_auth_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000'; END IF;
  IF p_usaha_id IS NULL OR v_key IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id dan idempotency_key wajib diisi' USING ERRCODE = '22023'; END IF;
  SELECT aa.akun_admin_id INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku ON ku.akun_admin_id=aa.akun_admin_id AND ku.usaha_id=p_usaha_id AND ku.status='active' AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id=v_auth_user_id AND aa.status='active';
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE = '42501'; END IF;
  SELECT ik.response_body INTO v_create_response FROM public.idempotency_key ik
  WHERE ik.usaha_id=p_usaha_id AND ik.actor_auth_user_id=v_auth_user_id AND ik.command_name='create_direct_rental' AND ik.key=v_key || ':create';
  v_create_found := FOUND;
  SELECT ik.response_body INTO v_activate_response FROM public.idempotency_key ik
  WHERE ik.usaha_id=p_usaha_id AND ik.actor_auth_user_id=v_auth_user_id AND ik.command_name='operational_activate_rental' AND ik.key=v_key || ':activate';
  v_activate_found := FOUND;
  IF NOT v_create_found AND NOT v_activate_found THEN RETURN jsonb_build_object('state','not_found','response',NULL); END IF;
  IF v_create_response IS NOT NULL AND v_activate_response IS NOT NULL THEN
    RETURN jsonb_build_object('state','committed','response',v_create_response || v_activate_response);
  END IF;
  RETURN jsonb_build_object('state','unknown','response',NULL);
END;
$function$;
REVOKE ALL ON FUNCTION app_private.command_reconcile_direct_rental_activation(uuid,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_reconcile_direct_rental_activation(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.command_reconcile_direct_rental_activation(p_usaha_id uuid,p_idempotency_key text)
RETURNS jsonb LANGUAGE sql SET search_path TO '' AS $function$
  SELECT app_private.command_reconcile_direct_rental_activation(p_usaha_id,p_idempotency_key);
$function$;
REVOKE ALL ON FUNCTION public.command_reconcile_direct_rental_activation(uuid,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_reconcile_direct_rental_activation(uuid,text) TO authenticated;
NOTIFY pgrst, 'reload schema';
