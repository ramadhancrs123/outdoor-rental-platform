-- Follow-up: idempotency_key has response_status/response_body but no completed_at.
CREATE OR REPLACE FUNCTION app_private.command_create_lokasi(
  p_usaha_id uuid, p_nama text, p_tipe text, p_alamat text, p_keterangan text,
  p_idempotency_key text, p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_lokasi_id uuid := gen_random_uuid();
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_name text := nullif(btrim(coalesce(p_nama, '')), '');
  v_type text := coalesce(nullif(btrim(coalesce(p_tipe, '')), ''), 'gudang');
  v_address text := nullif(btrim(coalesce(p_alamat, '')), '');
  v_note text := nullif(btrim(coalesce(p_keterangan, '')), '');
  v_response jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000'; END IF;
  IF p_usaha_id IS NULL OR v_name IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id dan nama lokasi wajib diisi' USING ERRCODE='22023'; END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' THEN RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi' USING ERRCODE='22023'; END IF;

  SELECT aa.akun_admin_id INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku ON ku.akun_admin_id=aa.akun_admin_id AND ku.status='active' AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id=v_auth_user_id AND aa.status='active' AND aa.role='super_admin' AND ku.usaha_id=p_usaha_id;
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.usaha u WHERE u.usaha_id=p_usaha_id AND u.status='active') THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  v_request_hash := md5(jsonb_build_object('usaha_id',p_usaha_id,'nama',v_name,'tipe',v_type,'alamat',v_address,'keterangan',v_note)::text);
  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'create_lokasi',v_request_hash)
  ON CONFLICT (usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body,ik.request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key ik
    WHERE ik.usaha_id=p_usaha_id AND ik.actor_auth_user_id=v_auth_user_id
      AND ik.command_name='create_lokasi' AND ik.key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE='40001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_usaha_id::text || ':lokasi-name:' || lower(v_name),0));
  IF EXISTS (SELECT 1 FROM public.lokasi l WHERE l.usaha_id=p_usaha_id AND lower(l.nama)=lower(v_name)) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: nama lokasi sudah digunakan dalam usaha' USING ERRCODE='23505';
  END IF;

  INSERT INTO public.lokasi(lokasi_id,usaha_id,nama,tipe,alamat,keterangan,status,created_at,updated_at)
  VALUES(v_lokasi_id,p_usaha_id,v_name,v_type,v_address,v_note,'active',now(),now())
  RETURNING to_jsonb(lokasi) INTO v_response;

  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,occurred_at,source_application,request_id,change_summary,reason)
  VALUES(p_usaha_id,v_auth_user_id,v_admin_id,'create','lokasi',v_lokasi_id,now(),'admin-command',p_request_id,
         jsonb_build_object('nama',v_name,'tipe',v_type,'status','active'),'Pembuatan master lokasi');

  UPDATE public.idempotency_key SET response_body=v_response,response_status=200 WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_update_lokasi(
  p_usaha_id uuid, p_lokasi_id uuid, p_nama text, p_tipe text, p_alamat text, p_keterangan text,
  p_status text, p_expected_updated_at timestamptz, p_idempotency_key text, p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_row public.lokasi%ROWTYPE;
  v_name text := nullif(btrim(coalesce(p_nama,'')),'');
  v_type text := coalesce(nullif(btrim(coalesce(p_tipe,'')),''),'gudang');
  v_address text := nullif(btrim(coalesce(p_alamat,'')),'');
  v_note text := nullif(btrim(coalesce(p_keterangan,'')),'');
  v_status text := nullif(btrim(coalesce(p_status,'')),'');
  v_response jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000'; END IF;
  IF p_usaha_id IS NULL OR p_lokasi_id IS NULL OR v_name IS NULL OR v_status NOT IN ('active','inactive') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: data lokasi tidak valid' USING ERRCODE='22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' THEN RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi' USING ERRCODE='22023'; END IF;

  SELECT aa.akun_admin_id INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku ON ku.akun_admin_id=aa.akun_admin_id AND ku.status='active' AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id=v_auth_user_id AND aa.status='active' AND aa.role='super_admin' AND ku.usaha_id=p_usaha_id;
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_row FROM public.lokasi l WHERE l.usaha_id=p_usaha_id AND l.lokasi_id=p_lokasi_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: lokasi tidak ditemukan dalam usaha aktif' USING ERRCODE='P0002'; END IF;

  v_request_hash := md5(jsonb_build_object('usaha_id',p_usaha_id,'lokasi_id',p_lokasi_id,'nama',v_name,'tipe',v_type,'alamat',v_address,'keterangan',v_note,'status',v_status,'expected_updated_at',p_expected_updated_at)::text);
  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'update_lokasi',v_request_hash)
  ON CONFLICT (usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body,ik.request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key ik
    WHERE ik.usaha_id=p_usaha_id AND ik.actor_auth_user_id=v_auth_user_id
      AND ik.command_name='update_lokasi' AND ik.key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE='40001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_usaha_id::text || ':lokasi-update:' || p_lokasi_id::text,0));
  IF p_expected_updated_at IS NOT NULL AND v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_DATA: lokasi sudah berubah, muat data terbaru' USING ERRCODE='40001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.lokasi l
    WHERE l.usaha_id=p_usaha_id AND l.lokasi_id<>p_lokasi_id AND lower(l.nama)=lower(v_name)
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: nama lokasi sudah digunakan dalam usaha' USING ERRCODE='23505';
  END IF;

  UPDATE public.lokasi
  SET nama=v_name,tipe=v_type,alamat=v_address,keterangan=v_note,status=v_status,updated_at=now()
  WHERE usaha_id=p_usaha_id AND lokasi_id=p_lokasi_id
    AND (p_expected_updated_at IS NULL OR updated_at=p_expected_updated_at)
  RETURNING to_jsonb(lokasi) INTO v_response;
  IF v_response IS NULL THEN RAISE EXCEPTION 'STALE_DATA: lokasi sudah berubah, muat data terbaru' USING ERRCODE='40001'; END IF;

  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,occurred_at,source_application,request_id,change_summary,reason)
  VALUES(p_usaha_id,v_auth_user_id,v_admin_id,'update','lokasi',p_lokasi_id,now(),'admin-command',p_request_id,
         jsonb_build_object('before',jsonb_build_object('nama',v_row.nama,'tipe',v_row.tipe,'alamat',v_row.alamat,'keterangan',v_row.keterangan,'status',v_row.status),
                            'after',jsonb_build_object('nama',v_name,'tipe',v_type,'alamat',v_address,'keterangan',v_note,'status',v_status)),
         'Pembaruan master lokasi');

  UPDATE public.idempotency_key SET response_body=v_response,response_status=200 WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$;
