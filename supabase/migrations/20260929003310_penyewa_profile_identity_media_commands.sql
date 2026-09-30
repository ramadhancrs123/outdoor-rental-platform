-- Penyewa completion boundary:
-- profile update, identity evidence, verification, renter photo,
-- reconciliation, tenant-aware authorization, audit and outbox.
-- Prepared locally; remote apply remains behind the normal approval gate.

CREATE OR REPLACE FUNCTION app_private.command_update_renter_profile(
  p_usaha_id uuid,p_penyewa_id uuid,p_nama_lengkap text,p_nomor_telepon text,
  p_alamat text,p_catatan_internal text,p_expected_updated_at timestamptz,
  p_idempotency_key text,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid:=auth.uid(); v_admin_id uuid; v_old public.penyewa%ROWTYPE;
  v_renter public.penyewa%ROWTYPE; v_response jsonb; v_idempotency_id uuid;
  v_existing_hash text; v_existing_response jsonb; v_request_hash text;
  v_name text:=btrim(coalesce(p_nama_lengkap,'')); v_phone text:=btrim(coalesce(p_nomor_telepon,''));
  v_phone_normalized text:=regexp_replace(v_phone,'\D','','g');
BEGIN
  IF v_auth_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000'; END IF;
  IF p_usaha_id IS NULL OR p_penyewa_id IS NULL OR v_name='' OR v_phone=''
     OR p_expected_updated_at IS NULL OR p_request_id IS NULL OR p_idempotency_key IS NULL OR btrim(p_idempotency_key)=''
    THEN RAISE EXCEPTION 'VALIDATION_ERROR: data profil penyewa belum lengkap' USING ERRCODE='22023'; END IF;
  IF v_phone_normalized='' THEN RAISE EXCEPTION 'VALIDATION_ERROR: nomor telepon tidak valid' USING ERRCODE='22023'; END IF;

  SELECT aa.akun_admin_id INTO v_admin_id
  FROM public.akun_admin aa JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id=aa.akun_admin_id AND ku.usaha_id=p_usaha_id
   AND ku.status='active' AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id=v_auth_user_id AND aa.status='active';
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501'; END IF;

  v_request_hash:=md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'penyewa_id',p_penyewa_id,'nama_lengkap',v_name,
    'nomor_telepon',v_phone,'alamat',nullif(btrim(coalesce(p_alamat,'')),''),
    'catatan_internal',nullif(btrim(coalesce(p_catatan_internal,'')),''),
    'expected_updated_at',p_expected_updated_at
  )::text);

  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'update_renter_profile',v_request_hash)
  ON CONFLICT (usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body,ik.request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key ik WHERE ik.usaha_id=p_usaha_id AND ik.actor_auth_user_id=v_auth_user_id
      AND ik.command_name='update_renter_profile' AND ik.key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE='40001';
  END IF;

  SELECT * INTO v_old FROM public.penyewa
  WHERE usaha_id=p_usaha_id AND penyewa_id=p_penyewa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: penyewa tidak ditemukan dalam usaha ini' USING ERRCODE='P0002'; END IF;
  IF v_old.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_DATA: data penyewa berubah sejak halaman dibuka. Muat ulang sebelum menyimpan.' USING ERRCODE='40001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.penyewa
    WHERE usaha_id=p_usaha_id
      AND penyewa_id<>p_penyewa_id
      AND nomor_telepon_normalized=v_phone_normalized
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: nomor telepon sudah digunakan oleh penyewa lain dalam usaha ini' USING ERRCODE='23505';
  END IF;

  UPDATE public.penyewa SET nama_lengkap=v_name,nomor_telepon=v_phone,
    nomor_telepon_normalized=v_phone_normalized,
    alamat=nullif(btrim(coalesce(p_alamat,'')),''),
    catatan_internal=nullif(btrim(coalesce(p_catatan_internal,'')),''),
    updated_at=now()
  WHERE usaha_id=p_usaha_id AND penyewa_id=p_penyewa_id
  RETURNING * INTO v_renter;

  v_response:=jsonb_build_object(
    'penyewa_id',v_renter.penyewa_id,'usaha_id',v_renter.usaha_id,'nama_lengkap',v_renter.nama_lengkap,
    'nomor_telepon',v_renter.nomor_telepon,'alamat',v_renter.alamat,'catatan_internal',v_renter.catatan_internal,
    'status',v_renter.status,'updated_at',v_renter.updated_at);

  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary)
  VALUES(p_usaha_id,v_auth_user_id,v_admin_id,'update','penyewa',p_penyewa_id,'admin-command',p_request_id,
    jsonb_build_object(
      'nama_lengkap_changed',v_old.nama_lengkap IS DISTINCT FROM v_renter.nama_lengkap,
      'nomor_telepon_changed',v_old.nomor_telepon IS DISTINCT FROM v_renter.nomor_telepon,
      'alamat_changed',v_old.alamat IS DISTINCT FROM v_renter.alamat,
      'catatan_internal_changed',v_old.catatan_internal IS DISTINCT FROM v_renter.catatan_internal));

  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES(p_usaha_id,'renter.updated','penyewa',p_penyewa_id,
    jsonb_build_object('renter_id',p_penyewa_id,'updated_at',v_renter.updated_at));

  UPDATE public.idempotency_key SET response_status=200,response_body=v_response WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_add_renter_identity_evidence(
  p_usaha_id uuid,p_penyewa_id uuid,p_bukti_identitas_id uuid,p_jenis_identitas text,
  p_nomor_identitas_masked text,p_storage_bucket text,p_storage_path text,p_catatan text,
  p_idempotency_key text,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid:=auth.uid(); v_admin_id uuid; v_evidence public.bukti_identitas_penyewa%ROWTYPE;
  v_response jsonb; v_idempotency_id uuid; v_existing_hash text; v_existing_response jsonb; v_request_hash text;
BEGIN
  IF v_auth_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000'; END IF;
  IF p_usaha_id IS NULL OR p_penyewa_id IS NULL OR p_bukti_identitas_id IS NULL
     OR nullif(btrim(coalesce(p_jenis_identitas,'')),'') IS NULL OR p_storage_bucket<>'rental-private-identity'
     OR nullif(btrim(coalesce(p_storage_path,'')),'') IS NULL OR p_request_id IS NULL
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key)=''
    THEN RAISE EXCEPTION 'VALIDATION_ERROR: bukti identitas belum lengkap' USING ERRCODE='22023'; END IF;
  IF upper(btrim(p_jenis_identitas)) NOT IN ('KTP','SIM') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: jenis identitas fase awal hanya KTP atau SIM' USING ERRCODE='22023'; END IF;
  IF p_storage_path NOT LIKE p_usaha_id::text||'/'||p_penyewa_id::text||'/identity/'||p_bukti_identitas_id::text||'/%'
    THEN RAISE EXCEPTION 'AUTHORIZATION_ERROR: storage path identitas tidak sesuai tenant dan penyewa' USING ERRCODE='42501'; END IF;

  SELECT aa.akun_admin_id INTO v_admin_id
  FROM public.akun_admin aa JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id=aa.akun_admin_id AND ku.usaha_id=p_usaha_id AND ku.status='active' AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id=v_auth_user_id AND aa.status='active';
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.penyewa WHERE usaha_id=p_usaha_id AND penyewa_id=p_penyewa_id)
    THEN RAISE EXCEPTION 'NOT_FOUND: penyewa tidak ditemukan dalam usaha ini' USING ERRCODE='P0002'; END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=p_storage_bucket AND name=p_storage_path)
    THEN RAISE EXCEPTION 'NOT_FOUND: file bukti identitas belum ditemukan di storage' USING ERRCODE='P0002'; END IF;

  v_request_hash:=md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'penyewa_id',p_penyewa_id,'bukti_identitas_id',p_bukti_identitas_id,
    'jenis_identitas',upper(btrim(p_jenis_identitas)),'nomor_identitas_masked',nullif(btrim(coalesce(p_nomor_identitas_masked,'')),''),
    'storage_bucket',p_storage_bucket,'storage_path',p_storage_path,'catatan',nullif(btrim(coalesce(p_catatan,'')),'')
  )::text);

  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'add_renter_identity_evidence',v_request_hash)
  ON CONFLICT (usaha_id,actor_auth_user_id,command_name,key) DO NOTHING RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body,ik.request_hash INTO v_existing_response,v_existing_hash FROM public.idempotency_key ik
    WHERE ik.usaha_id=p_usaha_id AND ik.actor_auth_user_id=v_auth_user_id AND ik.command_name='add_renter_identity_evidence'
      AND ik.key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE='40001';
  END IF;

  INSERT INTO public.bukti_identitas_penyewa(
    bukti_identitas_id,usaha_id,penyewa_id,jenis_identitas,nomor_identitas_masked,storage_bucket,storage_path,status_verifikasi,catatan)
  VALUES(p_bukti_identitas_id,p_usaha_id,p_penyewa_id,upper(btrim(p_jenis_identitas)),
    nullif(btrim(coalesce(p_nomor_identitas_masked,'')),''),p_storage_bucket,p_storage_path,'pending',
    nullif(btrim(coalesce(p_catatan,'')),'')) RETURNING * INTO v_evidence;

  v_response:=jsonb_build_object(
    'bukti_identitas_id',v_evidence.bukti_identitas_id,'penyewa_id',v_evidence.penyewa_id,
    'jenis_identitas',v_evidence.jenis_identitas,'nomor_identitas_masked',v_evidence.nomor_identitas_masked,
    'status_verifikasi',v_evidence.status_verifikasi,'verified_at',v_evidence.verified_at,
    'verified_by_admin_id',v_evidence.verified_by_admin_id,'updated_at',v_evidence.updated_at);

  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary)
  VALUES(p_usaha_id,v_auth_user_id,v_admin_id,'add','bukti_identitas_penyewa',p_bukti_identitas_id,'admin-command',p_request_id,
    jsonb_build_object('penyewa_id',p_penyewa_id,'jenis_identitas',v_evidence.jenis_identitas,'status_verifikasi','pending'));

  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES(p_usaha_id,'renter.identity_evidence_added','penyewa',p_penyewa_id,
    jsonb_build_object('renter_id',p_penyewa_id,'evidence_id',p_bukti_identitas_id,'status','pending'));

  UPDATE public.idempotency_key SET response_status=200,response_body=v_response WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_verify_renter_identity_evidence(
  p_usaha_id uuid,p_penyewa_id uuid,p_bukti_identitas_id uuid,p_status_verifikasi text,p_catatan text,
  p_expected_updated_at timestamptz,p_idempotency_key text,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid:=auth.uid(); v_admin_id uuid; v_evidence public.bukti_identitas_penyewa%ROWTYPE;
  v_response jsonb; v_idempotency_id uuid; v_existing_hash text; v_existing_response jsonb; v_request_hash text;
BEGIN
  IF v_auth_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000'; END IF;
  IF p_usaha_id IS NULL OR p_penyewa_id IS NULL OR p_bukti_identitas_id IS NULL
     OR p_status_verifikasi NOT IN ('verified','rejected') OR p_expected_updated_at IS NULL
     OR p_request_id IS NULL OR p_idempotency_key IS NULL OR btrim(p_idempotency_key)=''
    THEN RAISE EXCEPTION 'VALIDATION_ERROR: hasil verifikasi belum lengkap' USING ERRCODE='22023'; END IF;

  SELECT aa.akun_admin_id INTO v_admin_id
  FROM public.akun_admin aa JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id=aa.akun_admin_id AND ku.usaha_id=p_usaha_id AND ku.status='active' AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id=v_auth_user_id AND aa.status='active';
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501'; END IF;

  v_request_hash:=md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'penyewa_id',p_penyewa_id,'bukti_identitas_id',p_bukti_identitas_id,
    'status_verifikasi',p_status_verifikasi,'catatan',nullif(btrim(coalesce(p_catatan,'')),''),
    'expected_updated_at',p_expected_updated_at)::text);

  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'verify_renter_identity_evidence',v_request_hash)
  ON CONFLICT (usaha_id,actor_auth_user_id,command_name,key) DO NOTHING RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body,ik.request_hash INTO v_existing_response,v_existing_hash FROM public.idempotency_key ik
    WHERE ik.usaha_id=p_usaha_id AND ik.actor_auth_user_id=v_auth_user_id AND ik.command_name='verify_renter_identity_evidence'
      AND ik.key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE='40001';
  END IF;

  SELECT * INTO v_evidence FROM public.bukti_identitas_penyewa
  WHERE usaha_id=p_usaha_id AND penyewa_id=p_penyewa_id AND bukti_identitas_id=p_bukti_identitas_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: bukti identitas tidak ditemukan' USING ERRCODE='P0002'; END IF;
  IF v_evidence.updated_at IS DISTINCT FROM p_expected_updated_at
    THEN RAISE EXCEPTION 'STALE_DATA: bukti identitas berubah sejak dibuka. Muat ulang sebelum memverifikasi.' USING ERRCODE='40001'; END IF;

  UPDATE public.bukti_identitas_penyewa SET
    status_verifikasi=p_status_verifikasi,
    verified_at=CASE WHEN p_status_verifikasi='verified' THEN now() ELSE NULL END,
    verified_by_admin_id=CASE WHEN p_status_verifikasi='verified' THEN v_admin_id ELSE NULL END,
    catatan=nullif(btrim(coalesce(p_catatan,'')),''),
    updated_at=now()
  WHERE usaha_id=p_usaha_id AND penyewa_id=p_penyewa_id AND bukti_identitas_id=p_bukti_identitas_id
  RETURNING * INTO v_evidence;

  v_response:=jsonb_build_object(
    'bukti_identitas_id',v_evidence.bukti_identitas_id,'penyewa_id',v_evidence.penyewa_id,
    'jenis_identitas',v_evidence.jenis_identitas,'nomor_identitas_masked',v_evidence.nomor_identitas_masked,
    'status_verifikasi',v_evidence.status_verifikasi,'verified_at',v_evidence.verified_at,
    'verified_by_admin_id',v_evidence.verified_by_admin_id,'updated_at',v_evidence.updated_at);

  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary)
  VALUES(p_usaha_id,v_auth_user_id,v_admin_id,'verify','bukti_identitas_penyewa',p_bukti_identitas_id,'admin-command',p_request_id,
    jsonb_build_object('penyewa_id',p_penyewa_id,'status_verifikasi',p_status_verifikasi));

  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES(p_usaha_id,CASE WHEN p_status_verifikasi='verified' THEN 'renter.identity_verified' ELSE 'renter.identity_verification_rejected' END,
    'penyewa',p_penyewa_id,jsonb_build_object('renter_id',p_penyewa_id,'evidence_id',p_bukti_identitas_id,'status_verifikasi',p_status_verifikasi));

  UPDATE public.idempotency_key SET response_status=200,response_body=v_response WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_add_renter_photo(
  p_usaha_id uuid,p_penyewa_id uuid,p_foto_penyewa_id uuid,p_konteks text,
  p_storage_bucket text,p_storage_path text,p_idempotency_key text,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid:=auth.uid(); v_admin_id uuid; v_photo public.foto_penyewa%ROWTYPE;
  v_response jsonb; v_idempotency_id uuid; v_existing_hash text; v_existing_response jsonb; v_request_hash text;
BEGIN
  IF v_auth_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000'; END IF;
  IF p_usaha_id IS NULL OR p_penyewa_id IS NULL OR p_foto_penyewa_id IS NULL
     OR nullif(btrim(coalesce(p_konteks,'')),'') IS NULL OR p_storage_bucket<>'rental-private-renter'
     OR nullif(btrim(coalesce(p_storage_path,'')),'') IS NULL OR p_request_id IS NULL
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key)=''
    THEN RAISE EXCEPTION 'VALIDATION_ERROR: foto penyewa belum lengkap' USING ERRCODE='22023'; END IF;
  IF p_storage_path NOT LIKE p_usaha_id::text||'/'||p_penyewa_id::text||'/photo/'||p_foto_penyewa_id::text||'/%'
    THEN RAISE EXCEPTION 'AUTHORIZATION_ERROR: storage path foto tidak sesuai tenant dan penyewa' USING ERRCODE='42501'; END IF;

  SELECT aa.akun_admin_id INTO v_admin_id
  FROM public.akun_admin aa JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id=aa.akun_admin_id AND ku.usaha_id=p_usaha_id AND ku.status='active' AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id=v_auth_user_id AND aa.status='active';
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.penyewa WHERE usaha_id=p_usaha_id AND penyewa_id=p_penyewa_id)
    THEN RAISE EXCEPTION 'NOT_FOUND: penyewa tidak ditemukan dalam usaha ini' USING ERRCODE='P0002'; END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=p_storage_bucket AND name=p_storage_path)
    THEN RAISE EXCEPTION 'NOT_FOUND: file foto penyewa belum ditemukan di storage' USING ERRCODE='P0002'; END IF;

  v_request_hash:=md5(jsonb_build_object('usaha_id',p_usaha_id,'penyewa_id',p_penyewa_id,'foto_penyewa_id',p_foto_penyewa_id,
    'konteks',btrim(p_konteks),'storage_bucket',p_storage_bucket,'storage_path',p_storage_path)::text);

  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'add_renter_photo',v_request_hash)
  ON CONFLICT (usaha_id,actor_auth_user_id,command_name,key) DO NOTHING RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body,ik.request_hash INTO v_existing_response,v_existing_hash FROM public.idempotency_key ik
    WHERE ik.usaha_id=p_usaha_id AND ik.actor_auth_user_id=v_auth_user_id AND ik.command_name='add_renter_photo' AND ik.key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE='40001';
  END IF;

  INSERT INTO public.foto_penyewa(
    foto_penyewa_id,usaha_id,penyewa_id,konteks,storage_bucket,storage_path,captured_at,captured_by_admin_id,status)
  VALUES(p_foto_penyewa_id,p_usaha_id,p_penyewa_id,btrim(p_konteks),p_storage_bucket,p_storage_path,now(),v_admin_id,'valid')
  RETURNING * INTO v_photo;

  v_response:=jsonb_build_object('foto_penyewa_id',v_photo.foto_penyewa_id,'penyewa_id',v_photo.penyewa_id,
    'konteks',v_photo.konteks,'storage_bucket',v_photo.storage_bucket,'storage_path',v_photo.storage_path,
    'status',v_photo.status,'captured_at',v_photo.captured_at);

  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary)
  VALUES(p_usaha_id,v_auth_user_id,v_admin_id,'capture','foto_penyewa',p_foto_penyewa_id,'admin-command',p_request_id,
    jsonb_build_object('penyewa_id',p_penyewa_id,'konteks',v_photo.konteks,'status','valid'));

  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES(p_usaha_id,'renter.photo_added','penyewa',p_penyewa_id,
    jsonb_build_object('renter_id',p_penyewa_id,'photo_id',p_foto_penyewa_id,'konteks',v_photo.konteks));

  UPDATE public.idempotency_key SET response_status=200,response_body=v_response WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_reconcile_renter_mutation(p_usaha_id uuid,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_auth_user_id uuid:=auth.uid(); v_row public.idempotency_key%ROWTYPE;
BEGIN
  IF v_auth_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.akun_admin aa JOIN public.keanggotaan_usaha ku ON ku.akun_admin_id=aa.akun_admin_id
      AND ku.usaha_id=p_usaha_id AND ku.status='active' AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id=v_auth_user_id AND aa.status='active')
  THEN RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_row FROM public.idempotency_key
  WHERE usaha_id=p_usaha_id AND actor_auth_user_id=v_auth_user_id AND key=btrim(p_idempotency_key)
    AND command_name IN('update_renter_profile','add_renter_identity_evidence','verify_renter_identity_evidence','add_renter_photo')
  ORDER BY created_at DESC LIMIT 1;

  IF NOT FOUND THEN RETURN jsonb_build_object('state','not_found','response',null); END IF;
  RETURN jsonb_build_object('state',CASE WHEN v_row.response_body IS NULL THEN 'unknown' ELSE 'committed' END,
    'response',v_row.response_body,'command_name',v_row.command_name);
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_update_renter_profile(uuid,uuid,text,text,text,text,timestamptz,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_update_renter_profile(uuid,uuid,text,text,text,text,timestamptz,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_update_renter_profile(uuid,uuid,text,text,text,text,timestamptz,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_update_renter_profile(uuid,uuid,text,text,text,text,timestamptz,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_add_renter_identity_evidence(uuid,uuid,uuid,text,text,text,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_add_renter_identity_evidence(uuid,uuid,uuid,text,text,text,text,text,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_add_renter_identity_evidence(uuid,uuid,uuid,text,text,text,text,text,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_add_renter_identity_evidence(uuid,uuid,uuid,text,text,text,text,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_verify_renter_identity_evidence(uuid,uuid,uuid,text,text,timestamptz,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_verify_renter_identity_evidence(uuid,uuid,uuid,text,text,timestamptz,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_verify_renter_identity_evidence(uuid,uuid,uuid,text,text,timestamptz,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_verify_renter_identity_evidence(uuid,uuid,uuid,text,text,timestamptz,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_add_renter_photo(uuid,uuid,uuid,text,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_add_renter_photo(uuid,uuid,uuid,text,text,text,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_add_renter_photo(uuid,uuid,uuid,text,text,text,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_add_renter_photo(uuid,uuid,uuid,text,text,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_reconcile_renter_mutation(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_reconcile_renter_mutation(uuid,text) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_reconcile_renter_mutation(uuid,text) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_reconcile_renter_mutation(uuid,text) TO authenticated;

INSERT INTO storage.buckets(id,name,public) VALUES('rental-private-renter','rental-private-renter',false)
ON CONFLICT (id) DO UPDATE SET public=false;

DROP POLICY IF EXISTS renter_private_read ON storage.objects;
DROP POLICY IF EXISTS renter_private_insert ON storage.objects;
DROP POLICY IF EXISTS renter_private_update ON storage.objects;
DROP POLICY IF EXISTS renter_private_delete ON storage.objects;

CREATE POLICY renter_private_read ON storage.objects FOR SELECT TO authenticated
USING(bucket_id='rental-private-renter' AND app_private.storage_path_has_usaha_access(name));
CREATE POLICY renter_private_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='rental-private-renter' AND app_private.storage_path_has_usaha_access(name));
CREATE POLICY renter_private_update ON storage.objects FOR UPDATE TO authenticated
USING(bucket_id='rental-private-renter' AND app_private.storage_path_has_usaha_access(name))
WITH CHECK(bucket_id='rental-private-renter' AND app_private.storage_path_has_usaha_access(name));
CREATE POLICY renter_private_delete ON storage.objects FOR DELETE TO authenticated
USING(bucket_id='rental-private-renter' AND app_private.storage_path_has_usaha_access(name));
