-- Katalog trusted mutation boundary.
-- Product truth stays in Katalog; physical inventory, rental lifecycle and finance remain elsewhere.
-- Existing catalog schema/RLS/FKs are preserved; this migration adds trusted commands,
-- idempotency, stale-state protection, audit and reconciliation.

CREATE OR REPLACE FUNCTION app_private.catalog_require_admin(p_usaha_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;
  IF p_usaha_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id wajib diisi' USING ERRCODE='22023';
  END IF;

  SELECT aa.akun_admin_id
    INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id = aa.akun_admin_id
   AND ku.usaha_id = p_usaha_id
   AND ku.status = 'active'
   AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id = v_auth_user_id
    AND aa.status = 'active'
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501';
  END IF;

  RETURN v_admin_id;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.catalog_idempotency_claim(
  p_usaha_id uuid,
  p_command_name text,
  p_idempotency_key text,
  p_request_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.idempotency_key (
    usaha_id, actor_auth_user_id, key, command_name, request_hash
  )
  VALUES (
    p_usaha_id, v_auth_user_id, btrim(p_idempotency_key), p_command_name, p_request_hash
  )
  ON CONFLICT (usaha_id, actor_auth_user_id, command_name, key)
  DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NOT NULL THEN
    RETURN jsonb_build_object('state','new','idempotency_key_id',v_idempotency_id);
  END IF;

  SELECT ik.response_body, ik.request_hash
    INTO v_existing_response, v_existing_hash
  FROM public.idempotency_key ik
  WHERE ik.usaha_id = p_usaha_id
    AND ik.actor_auth_user_id = v_auth_user_id
    AND ik.command_name = p_command_name
    AND ik.key = btrim(p_idempotency_key);

  IF v_existing_hash IS DISTINCT FROM p_request_hash THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
  END IF;

  IF v_existing_response IS NOT NULL THEN
    RETURN jsonb_build_object('state','committed','response',v_existing_response);
  END IF;

  RETURN jsonb_build_object('state','unknown');
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.catalog_idempotency_finish(
  p_idempotency_key_id uuid,
  p_status integer,
  p_response jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  UPDATE public.idempotency_key
     SET response_status = p_status,
         response_body = p_response
   WHERE idempotency_key_id = p_idempotency_key_id;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_update_kategori_barang(
  p_usaha_id uuid,
  p_kategori_barang_id uuid,
  p_nama text,
  p_deskripsi text DEFAULT NULL,
  p_status text DEFAULT 'active',
  p_expected_updated_at timestamptz DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb;
  v_idempotency_id uuid;
  v_row public.kategori_barang%ROWTYPE;
  v_hash text;
BEGIN
  IF p_kategori_barang_id IS NULL OR p_nama IS NULL OR btrim(p_nama) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: kategori dan nama wajib diisi' USING ERRCODE='22023';
  END IF;
  IF p_status NOT IN ('active','inactive') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: status kategori tidak valid' USING ERRCODE='22023';
  END IF;

  v_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'id',p_kategori_barang_id,'nama',btrim(p_nama),
    'deskripsi',p_deskripsi,'status',p_status,'expected_updated_at',p_expected_updated_at
  )::text);
  v_claim := app_private.catalog_idempotency_claim(p_usaha_id,'update_kategori_barang',p_idempotency_key,v_hash);
  IF v_claim->>'state' = 'committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state' = 'unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: status command kategori belum dapat dipastikan' USING ERRCODE='40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  UPDATE public.kategori_barang
     SET nama=btrim(p_nama),
         deskripsi=NULLIF(btrim(p_deskripsi),''),
         status=p_status,
         updated_at=now()
   WHERE usaha_id=p_usaha_id
     AND kategori_barang_id=p_kategori_barang_id
     AND (p_expected_updated_at IS NULL OR updated_at=p_expected_updated_at)
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.kategori_barang
      WHERE usaha_id=p_usaha_id AND kategori_barang_id=p_kategori_barang_id
    ) THEN
      RAISE EXCEPTION 'NOT_FOUND: kategori tidak ditemukan' USING ERRCODE='P0002';
    END IF;
    RAISE EXCEPTION 'STALE_DATA: kategori sudah berubah, muat data terbaru' USING ERRCODE='40001';
  END IF;

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  )
  VALUES(
    p_usaha_id,auth.uid(),v_admin_id,'update','kategori_barang',v_row.kategori_barang_id,
    'admin-command',p_request_id,jsonb_build_object('nama',v_row.nama,'status',v_row.status)
  );

  v_claim := jsonb_build_object(
    'kategori_barang_id',v_row.kategori_barang_id,'usaha_id',v_row.usaha_id,
    'nama',v_row.nama,'deskripsi',v_row.deskripsi,'status',v_row.status,
    'updated_at',v_row.updated_at
  );
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim);
  RETURN v_claim;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: nama kategori sudah digunakan dalam Usaha ini' USING ERRCODE='23505';
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_create_barang(
  p_usaha_id uuid,p_kategori_barang_id uuid,p_nama text,p_slug text,
  p_deskripsi text DEFAULT NULL,p_ringkasan_publik text DEFAULT NULL,
  p_status text DEFAULT 'active',p_is_public boolean DEFAULT false,p_metadata jsonb DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb; v_idempotency_id uuid; v_row public.barang%ROWTYPE; v_hash text;
BEGIN
  IF p_nama IS NULL OR btrim(p_nama)='' OR p_slug IS NULL OR btrim(p_slug)='' OR p_kategori_barang_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: kategori, nama, dan slug wajib diisi' USING ERRCODE='22023';
  END IF;
  IF p_status NOT IN ('active','inactive') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: status barang tidak valid' USING ERRCODE='22023';
  END IF;
  IF p_is_public AND p_status <> 'active' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: barang publik harus berstatus active' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.kategori_barang
    WHERE usaha_id=p_usaha_id AND kategori_barang_id=p_kategori_barang_id
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: kategori tidak berada dalam Usaha ini' USING ERRCODE='22023';
  END IF;

  v_hash:=md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'kategori',p_kategori_barang_id,'nama',btrim(p_nama),
    'slug',lower(btrim(p_slug)),'deskripsi',p_deskripsi,'ringkasan',p_ringkasan_publik,
    'status',p_status,'is_public',p_is_public,'metadata',p_metadata
  )::text);
  v_claim:=app_private.catalog_idempotency_claim(p_usaha_id,'create_barang',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: pembuatan barang belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id:=(v_claim->>'idempotency_key_id')::uuid;

  INSERT INTO public.barang(
    usaha_id,kategori_barang_id,nama,slug,deskripsi,ringkasan_publik,status,is_public,metadata
  )
  VALUES(
    p_usaha_id,p_kategori_barang_id,btrim(p_nama),lower(btrim(p_slug)),
    NULLIF(btrim(p_deskripsi),''),NULLIF(btrim(p_ringkasan_publik),''),
    p_status,p_is_public,p_metadata
  )
  RETURNING * INTO v_row;

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  )
  VALUES(
    p_usaha_id,auth.uid(),v_admin_id,'create','barang',v_row.barang_id,'admin-command',p_request_id,
    jsonb_build_object('nama',v_row.nama,'slug',v_row.slug,'status',v_row.status,'is_public',v_row.is_public)
  );

  v_claim:=to_jsonb(v_row);
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim);
  RETURN v_claim;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: slug barang sudah digunakan dalam Usaha ini' USING ERRCODE='23505';
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_update_barang(
  p_usaha_id uuid,p_barang_id uuid,p_kategori_barang_id uuid,p_nama text,p_slug text,
  p_deskripsi text DEFAULT NULL,p_ringkasan_publik text DEFAULT NULL,p_metadata jsonb DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL,p_idempotency_key text DEFAULT NULL,p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb; v_idempotency_id uuid; v_row public.barang%ROWTYPE; v_hash text;
BEGIN
  IF p_barang_id IS NULL OR p_kategori_barang_id IS NULL OR p_nama IS NULL OR btrim(p_nama)='' OR p_slug IS NULL OR btrim(p_slug)='' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: kategori, nama, dan slug wajib diisi' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kategori_barang WHERE usaha_id=p_usaha_id AND kategori_barang_id=p_kategori_barang_id) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: kategori tidak berada dalam Usaha ini' USING ERRCODE='22023';
  END IF;

  v_hash:=md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'id',p_barang_id,'kategori',p_kategori_barang_id,'nama',btrim(p_nama),
    'slug',lower(btrim(p_slug)),'deskripsi',p_deskripsi,'ringkasan',p_ringkasan_publik,
    'metadata',p_metadata,'expected_updated_at',p_expected_updated_at
  )::text);
  v_claim:=app_private.catalog_idempotency_claim(p_usaha_id,'update_barang',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: perubahan barang belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id:=(v_claim->>'idempotency_key_id')::uuid;

  UPDATE public.barang
     SET kategori_barang_id=p_kategori_barang_id,
         nama=btrim(p_nama),
         slug=lower(btrim(p_slug)),
         deskripsi=NULLIF(btrim(p_deskripsi),''),
         ringkasan_publik=NULLIF(btrim(p_ringkasan_publik),''),
         metadata=p_metadata,
         updated_at=now()
   WHERE usaha_id=p_usaha_id
     AND barang_id=p_barang_id
     AND (p_expected_updated_at IS NULL OR updated_at=p_expected_updated_at)
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.barang WHERE usaha_id=p_usaha_id AND barang_id=p_barang_id) THEN
      RAISE EXCEPTION 'NOT_FOUND: barang tidak ditemukan' USING ERRCODE='P0002';
    END IF;
    RAISE EXCEPTION 'STALE_DATA: barang sudah berubah, muat data terbaru' USING ERRCODE='40001';
  END IF;

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  )
  VALUES(
    p_usaha_id,auth.uid(),v_admin_id,'update','barang',v_row.barang_id,'admin-command',p_request_id,
    jsonb_build_object('nama',v_row.nama,'slug',v_row.slug,'kategori_barang_id',v_row.kategori_barang_id)
  );

  v_claim:=to_jsonb(v_row);
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim);
  RETURN v_claim;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: slug barang sudah digunakan dalam Usaha ini' USING ERRCODE='23505';
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_set_barang_visibility(
  p_usaha_id uuid,p_barang_id uuid,p_is_public boolean,
  p_expected_updated_at timestamptz DEFAULT NULL,p_idempotency_key text DEFAULT NULL,p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb; v_idempotency_id uuid; v_row public.barang%ROWTYPE; v_hash text;
BEGIN
  v_hash:=md5(jsonb_build_object('usaha_id',p_usaha_id,'id',p_barang_id,'is_public',p_is_public,'expected_updated_at',p_expected_updated_at)::text);
  v_claim:=app_private.catalog_idempotency_claim(p_usaha_id,'set_barang_visibility',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: perubahan visibilitas barang belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id:=(v_claim->>'idempotency_key_id')::uuid;

  IF p_is_public AND NOT EXISTS (
    SELECT 1 FROM public.barang WHERE usaha_id=p_usaha_id AND barang_id=p_barang_id AND status='active'
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: barang harus active sebelum dipublikasikan' USING ERRCODE='22023';
  END IF;

  UPDATE public.barang
     SET is_public=p_is_public, updated_at=now()
   WHERE usaha_id=p_usaha_id AND barang_id=p_barang_id
     AND (p_expected_updated_at IS NULL OR updated_at=p_expected_updated_at)
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.barang WHERE usaha_id=p_usaha_id AND barang_id=p_barang_id) THEN
      RAISE EXCEPTION 'NOT_FOUND: barang tidak ditemukan' USING ERRCODE='P0002';
    END IF;
    RAISE EXCEPTION 'STALE_DATA: barang sudah berubah, muat data terbaru' USING ERRCODE='40001';
  END IF;

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  )
  VALUES(
    p_usaha_id,auth.uid(),v_admin_id,CASE WHEN p_is_public THEN 'publish' ELSE 'unpublish' END,
    'barang',v_row.barang_id,'admin-command',p_request_id,jsonb_build_object('is_public',v_row.is_public)
  );

  v_claim:=to_jsonb(jsonb_build_object('barang_id',v_row.barang_id,'usaha_id',v_row.usaha_id,'is_public',v_row.is_public,'status',v_row.status,'updated_at',v_row.updated_at));
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim);
  RETURN v_claim;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_set_barang_status(
  p_usaha_id uuid,p_barang_id uuid,p_status text,
  p_expected_updated_at timestamptz DEFAULT NULL,p_idempotency_key text DEFAULT NULL,p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb; v_idempotency_id uuid; v_row public.barang%ROWTYPE; v_hash text;
BEGIN
  IF p_status NOT IN ('active','inactive') THEN RAISE EXCEPTION 'VALIDATION_ERROR: status barang tidak valid' USING ERRCODE='22023'; END IF;

  v_hash:=md5(jsonb_build_object('usaha_id',p_usaha_id,'id',p_barang_id,'status',p_status,'expected_updated_at',p_expected_updated_at)::text);
  v_claim:=app_private.catalog_idempotency_claim(p_usaha_id,'set_barang_status',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: status barang belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id:=(v_claim->>'idempotency_key_id')::uuid;

  UPDATE public.barang
     SET status=p_status,is_public=CASE WHEN p_status='inactive' THEN false ELSE is_public END,updated_at=now()
   WHERE usaha_id=p_usaha_id AND barang_id=p_barang_id
     AND (p_expected_updated_at IS NULL OR updated_at=p_expected_updated_at)
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.barang WHERE usaha_id=p_usaha_id AND barang_id=p_barang_id) THEN
      RAISE EXCEPTION 'NOT_FOUND: barang tidak ditemukan' USING ERRCODE='P0002';
    END IF;
    RAISE EXCEPTION 'STALE_DATA: barang sudah berubah, muat data terbaru' USING ERRCODE='40001';
  END IF;

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  )
  VALUES(
    p_usaha_id,auth.uid(),v_admin_id,'status_change','barang',v_row.barang_id,'admin-command',p_request_id,
    jsonb_build_object('status',v_row.status,'is_public',v_row.is_public)
  );

  v_claim:=to_jsonb(v_row);
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim);
  RETURN v_claim;
END;
$function$;

-- Variant commands
CREATE OR REPLACE FUNCTION app_private.command_create_varian_barang(
  p_usaha_id uuid,p_barang_id uuid,p_nama text,
  p_kode_internal text DEFAULT NULL,p_deskripsi text DEFAULT NULL,p_atribut_pembeda jsonb DEFAULT NULL,
  p_status text DEFAULT 'active',p_idempotency_key text DEFAULT NULL,p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb; v_idempotency_id uuid; v_row public.varian_barang%ROWTYPE; v_hash text;
BEGIN
  IF p_nama IS NULL OR btrim(p_nama)='' THEN RAISE EXCEPTION 'VALIDATION_ERROR: nama varian wajib diisi' USING ERRCODE='22023'; END IF;
  IF p_status NOT IN ('active','inactive') THEN RAISE EXCEPTION 'VALIDATION_ERROR: status varian tidak valid' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.barang WHERE usaha_id=p_usaha_id AND barang_id=p_barang_id) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: barang induk tidak berada dalam Usaha ini' USING ERRCODE='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text || ':variant:' || p_barang_id::text,0));

  v_hash:=md5(jsonb_build_object('usaha_id',p_usaha_id,'barang_id',p_barang_id,'nama',btrim(p_nama),'kode_internal',p_kode_internal,'deskripsi',p_deskripsi,'atribut',p_atribut_pembeda,'status',p_status)::text);
  v_claim:=app_private.catalog_idempotency_claim(p_usaha_id,'create_varian_barang',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: pembuatan varian belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id:=(v_claim->>'idempotency_key_id')::uuid;

  INSERT INTO public.varian_barang(usaha_id,barang_id,nama,kode_internal,deskripsi,atribut_pembeda,status)
  VALUES(p_usaha_id,p_barang_id,btrim(p_nama),NULLIF(btrim(p_kode_internal),''),NULLIF(btrim(p_deskripsi),''),p_atribut_pembeda,p_status)
  RETURNING * INTO v_row;

  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary)
  VALUES(p_usaha_id,auth.uid(),v_admin_id,'create','varian_barang',v_row.varian_barang_id,'admin-command',p_request_id,jsonb_build_object('barang_id',v_row.barang_id,'nama',v_row.nama));

  v_claim:=to_jsonb(v_row); PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim); RETURN v_claim;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'BUSINESS_CONFLICT: nama varian sudah digunakan dalam barang ini' USING ERRCODE='23505';
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_update_varian_barang(
  p_usaha_id uuid,p_varian_barang_id uuid,p_nama text,
  p_kode_internal text DEFAULT NULL,p_deskripsi text DEFAULT NULL,p_atribut_pembeda jsonb DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL,p_idempotency_key text DEFAULT NULL,p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb; v_idempotency_id uuid; v_row public.varian_barang%ROWTYPE; v_hash text;
BEGIN
  IF p_nama IS NULL OR btrim(p_nama)='' THEN RAISE EXCEPTION 'VALIDATION_ERROR: nama varian wajib diisi' USING ERRCODE='22023'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text || ':variant:' || p_varian_barang_id::text,0));

  v_hash:=md5(jsonb_build_object('usaha_id',p_usaha_id,'id',p_varian_barang_id,'nama',btrim(p_nama),'kode_internal',p_kode_internal,'deskripsi',p_deskripsi,'atribut',p_atribut_pembeda,'expected_updated_at',p_expected_updated_at)::text);
  v_claim:=app_private.catalog_idempotency_claim(p_usaha_id,'update_varian_barang',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: perubahan varian belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id:=(v_claim->>'idempotency_key_id')::uuid;

  UPDATE public.varian_barang
     SET nama=btrim(p_nama),kode_internal=NULLIF(btrim(p_kode_internal),''),deskripsi=NULLIF(btrim(p_deskripsi),''),
         atribut_pembeda=p_atribut_pembeda,updated_at=now()
   WHERE usaha_id=p_usaha_id AND varian_barang_id=p_varian_barang_id
     AND (p_expected_updated_at IS NULL OR updated_at=p_expected_updated_at)
   RETURNING * INTO v_row;
  IF NOT FOUND THEN
    IF NOT EXISTS(SELECT 1 FROM public.varian_barang WHERE usaha_id=p_usaha_id AND varian_barang_id=p_varian_barang_id) THEN
      RAISE EXCEPTION 'NOT_FOUND: varian tidak ditemukan' USING ERRCODE='P0002';
    END IF;
    RAISE EXCEPTION 'STALE_DATA: varian sudah berubah, muat data terbaru' USING ERRCODE='40001';
  END IF;

  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary)
  VALUES(p_usaha_id,auth.uid(),v_admin_id,'update','varian_barang',v_row.varian_barang_id,'admin-command',p_request_id,jsonb_build_object('nama',v_row.nama));

  v_claim:=to_jsonb(v_row); PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim); RETURN v_claim;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'BUSINESS_CONFLICT: nama varian sudah digunakan dalam barang ini' USING ERRCODE='23505';
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_set_varian_status(
  p_usaha_id uuid,p_varian_barang_id uuid,p_status text,p_expected_updated_at timestamptz DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb; v_idempotency_id uuid; v_row public.varian_barang%ROWTYPE; v_hash text;
BEGIN
  IF p_status NOT IN ('active','inactive') THEN RAISE EXCEPTION 'VALIDATION_ERROR: status varian tidak valid' USING ERRCODE='22023'; END IF;
  v_hash:=md5(jsonb_build_object('usaha_id',p_usaha_id,'id',p_varian_barang_id,'status',p_status,'expected_updated_at',p_expected_updated_at)::text);
  v_claim:=app_private.catalog_idempotency_claim(p_usaha_id,'set_varian_status',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: status varian belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id:=(v_claim->>'idempotency_key_id')::uuid;

  UPDATE public.varian_barang SET status=p_status,updated_at=now()
   WHERE usaha_id=p_usaha_id AND varian_barang_id=p_varian_barang_id
   AND (p_expected_updated_at IS NULL OR updated_at=p_expected_updated_at)
   RETURNING * INTO v_row;
  IF NOT FOUND THEN
    IF NOT EXISTS(SELECT 1 FROM public.varian_barang WHERE usaha_id=p_usaha_id AND varian_barang_id=p_varian_barang_id) THEN
      RAISE EXCEPTION 'NOT_FOUND: varian tidak ditemukan' USING ERRCODE='P0002';
    END IF;
    RAISE EXCEPTION 'STALE_DATA: varian sudah berubah, muat data terbaru' USING ERRCODE='40001';
  END IF;

  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary)
  VALUES(p_usaha_id,auth.uid(),v_admin_id,'status_change','varian_barang',v_row.varian_barang_id,'admin-command',p_request_id,jsonb_build_object('status',v_row.status));

  v_claim:=to_jsonb(v_row); PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim); RETURN v_claim;
END;
$function$;

-- Package commands
CREATE OR REPLACE FUNCTION app_private.command_create_paket_sewa(
  p_usaha_id uuid,p_nama text,p_slug text,p_deskripsi text DEFAULT NULL,p_harga_dasar numeric DEFAULT NULL,
  p_currency_code text DEFAULT 'IDR',p_status text DEFAULT 'active',p_is_public boolean DEFAULT false,p_metadata jsonb DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb; v_idempotency_id uuid; v_row public.paket_sewa%ROWTYPE; v_hash text;
BEGIN
  IF p_nama IS NULL OR btrim(p_nama)='' OR p_slug IS NULL OR btrim(p_slug)='' THEN RAISE EXCEPTION 'VALIDATION_ERROR: nama dan slug paket wajib diisi' USING ERRCODE='22023'; END IF;
  IF p_harga_dasar IS NOT NULL AND p_harga_dasar < 0 THEN RAISE EXCEPTION 'VALIDATION_ERROR: harga dasar tidak boleh negatif' USING ERRCODE='22023'; END IF;
  IF p_currency_code !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'VALIDATION_ERROR: currency harus ISO 4217 3 huruf' USING ERRCODE='22023'; END IF;
  IF p_status NOT IN ('active','inactive','draft') THEN RAISE EXCEPTION 'VALIDATION_ERROR: status paket tidak valid' USING ERRCODE='22023'; END IF;
  IF p_is_public AND p_status <> 'active' THEN RAISE EXCEPTION 'VALIDATION_ERROR: paket publik harus active' USING ERRCODE='22023'; END IF;

  v_hash:=md5(jsonb_build_object('usaha_id',p_usaha_id,'nama',btrim(p_nama),'slug',lower(btrim(p_slug)),'deskripsi',p_deskripsi,'harga_dasar',p_harga_dasar,'currency',p_currency_code,'status',p_status,'is_public',p_is_public,'metadata',p_metadata)::text);
  v_claim:=app_private.catalog_idempotency_claim(p_usaha_id,'create_paket_sewa',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: pembuatan paket belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id:=(v_claim->>'idempotency_key_id')::uuid;

  INSERT INTO public.paket_sewa(usaha_id,nama,slug,deskripsi,harga_dasar,currency_code,status,is_public,metadata)
  VALUES(p_usaha_id,btrim(p_nama),lower(btrim(p_slug)),NULLIF(btrim(p_deskripsi),''),p_harga_dasar,p_currency_code,p_status,p_is_public,p_metadata)
  RETURNING * INTO v_row;

  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary)
  VALUES(p_usaha_id,auth.uid(),v_admin_id,'create','paket_sewa',v_row.paket_sewa_id,'admin-command',p_request_id,jsonb_build_object('nama',v_row.nama,'slug',v_row.slug));

  v_claim:=to_jsonb(v_row); PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim); RETURN v_claim;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'BUSINESS_CONFLICT: slug paket sudah digunakan dalam Usaha ini' USING ERRCODE='23505';
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_update_paket_sewa(
  p_usaha_id uuid,p_paket_sewa_id uuid,p_nama text,p_slug text,p_deskripsi text DEFAULT NULL,p_harga_dasar numeric DEFAULT NULL,
  p_currency_code text DEFAULT 'IDR',p_metadata jsonb DEFAULT NULL,p_expected_updated_at timestamptz DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb; v_idempotency_id uuid; v_row public.paket_sewa%ROWTYPE; v_hash text;
BEGIN
  IF p_nama IS NULL OR btrim(p_nama)='' OR p_slug IS NULL OR btrim(p_slug)='' THEN RAISE EXCEPTION 'VALIDATION_ERROR: nama dan slug paket wajib diisi' USING ERRCODE='22023'; END IF;
  IF p_harga_dasar IS NOT NULL AND p_harga_dasar < 0 THEN RAISE EXCEPTION 'VALIDATION_ERROR: harga dasar tidak boleh negatif' USING ERRCODE='22023'; END IF;
  IF p_currency_code !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'VALIDATION_ERROR: currency harus ISO 4217 3 huruf' USING ERRCODE='22023'; END IF;

  v_hash:=md5(jsonb_build_object('usaha_id',p_usaha_id,'id',p_paket_sewa_id,'nama',btrim(p_nama),'slug',lower(btrim(p_slug)),'deskripsi',p_deskripsi,'harga_dasar',p_harga_dasar,'currency',p_currency_code,'metadata',p_metadata,'expected_updated_at',p_expected_updated_at)::text);
  v_claim:=app_private.catalog_idempotency_claim(p_usaha_id,'update_paket_sewa',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: perubahan paket belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id:=(v_claim->>'idempotency_key_id')::uuid;

  UPDATE public.paket_sewa
     SET nama=btrim(p_nama),slug=lower(btrim(p_slug)),deskripsi=NULLIF(btrim(p_deskripsi),''),
         harga_dasar=p_harga_dasar,currency_code=p_currency_code,metadata=p_metadata,updated_at=now()
   WHERE usaha_id=p_usaha_id AND paket_sewa_id=p_paket_sewa_id
   AND (p_expected_updated_at IS NULL OR updated_at=p_expected_updated_at)
   RETURNING * INTO v_row;
  IF NOT FOUND THEN
    IF NOT EXISTS(SELECT 1 FROM public.paket_sewa WHERE usaha_id=p_usaha_id AND paket_sewa_id=p_paket_sewa_id) THEN
      RAISE EXCEPTION 'NOT_FOUND: paket tidak ditemukan' USING ERRCODE='P0002';
    END IF;
    RAISE EXCEPTION 'STALE_DATA: paket sudah berubah, muat data terbaru' USING ERRCODE='40001';
  END IF;

  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary)
  VALUES(p_usaha_id,auth.uid(),v_admin_id,'update','paket_sewa',v_row.paket_sewa_id,'admin-command',p_request_id,jsonb_build_object('nama',v_row.nama,'slug',v_row.slug));

  v_claim:=to_jsonb(v_row); PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim); RETURN v_claim;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'BUSINESS_CONFLICT: slug paket sudah digunakan dalam Usaha ini' USING ERRCODE='23505';
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_set_paket_state(
  p_usaha_id uuid,p_paket_sewa_id uuid,p_status text,p_is_public boolean,p_expected_updated_at timestamptz DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb; v_idempotency_id uuid; v_row public.paket_sewa%ROWTYPE; v_hash text;
BEGIN
  IF p_status NOT IN ('active','inactive','draft') THEN RAISE EXCEPTION 'VALIDATION_ERROR: status paket tidak valid' USING ERRCODE='22023'; END IF;
  IF p_is_public AND p_status <> 'active' THEN RAISE EXCEPTION 'VALIDATION_ERROR: paket publik harus active' USING ERRCODE='22023'; END IF;

  v_hash:=md5(jsonb_build_object('usaha_id',p_usaha_id,'id',p_paket_sewa_id,'status',p_status,'is_public',p_is_public,'expected_updated_at',p_expected_updated_at)::text);
  v_claim:=app_private.catalog_idempotency_claim(p_usaha_id,'set_paket_state',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: state paket belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id:=(v_claim->>'idempotency_key_id')::uuid;

  UPDATE public.paket_sewa
     SET status=p_status,is_public=p_is_public,updated_at=now()
   WHERE usaha_id=p_usaha_id AND paket_sewa_id=p_paket_sewa_id
   AND (p_expected_updated_at IS NULL OR updated_at=p_expected_updated_at)
   RETURNING * INTO v_row;
  IF NOT FOUND THEN
    IF NOT EXISTS(SELECT 1 FROM public.paket_sewa WHERE usaha_id=p_usaha_id AND paket_sewa_id=p_paket_sewa_id) THEN
      RAISE EXCEPTION 'NOT_FOUND: paket tidak ditemukan' USING ERRCODE='P0002';
    END IF;
    RAISE EXCEPTION 'STALE_DATA: paket sudah berubah, muat data terbaru' USING ERRCODE='40001';
  END IF;

  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary)
  VALUES(p_usaha_id,auth.uid(),v_admin_id,'state_change','paket_sewa',v_row.paket_sewa_id,'admin-command',p_request_id,jsonb_build_object('status',v_row.status,'is_public',v_row.is_public));

  v_claim:=to_jsonb(v_row); PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim); RETURN v_claim;
END;
$function$;

-- Package component commands
CREATE OR REPLACE FUNCTION app_private.command_add_komponen_paket(
  p_usaha_id uuid,p_paket_sewa_id uuid,p_barang_id uuid DEFAULT NULL,p_varian_barang_id uuid DEFAULT NULL,
  p_jumlah numeric DEFAULT NULL,p_catatan text DEFAULT NULL,p_idempotency_key text DEFAULT NULL,p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb; v_idempotency_id uuid; v_row public.komponen_paket%ROWTYPE; v_hash text;
BEGIN
  IF p_paket_sewa_id IS NULL OR p_jumlah IS NULL OR p_jumlah<=0 THEN RAISE EXCEPTION 'VALIDATION_ERROR: paket dan jumlah wajib valid' USING ERRCODE='22023'; END IF;
  IF num_nonnulls(p_barang_id,p_varian_barang_id)<>1 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: komponen harus menunjuk tepat satu barang atau varian' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.paket_sewa WHERE usaha_id=p_usaha_id AND paket_sewa_id=p_paket_sewa_id) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: paket tidak berada dalam Usaha ini' USING ERRCODE='22023';
  END IF;
  IF p_barang_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.barang WHERE usaha_id=p_usaha_id AND barang_id=p_barang_id) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: barang komponen tidak berada dalam Usaha ini' USING ERRCODE='22023';
  END IF;
  IF p_varian_barang_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.varian_barang WHERE usaha_id=p_usaha_id AND varian_barang_id=p_varian_barang_id) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: varian komponen tidak berada dalam Usaha ini' USING ERRCODE='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text || ':package:' || p_paket_sewa_id::text,0));

  v_hash:=md5(jsonb_build_object('usaha_id',p_usaha_id,'paket',p_paket_sewa_id,'barang',p_barang_id,'varian',p_varian_barang_id,'jumlah',p_jumlah,'catatan',p_catatan)::text);
  v_claim:=app_private.catalog_idempotency_claim(p_usaha_id,'add_komponen_paket',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: penambahan komponen paket belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id:=(v_claim->>'idempotency_key_id')::uuid;

  IF EXISTS (
    SELECT 1 FROM public.komponen_paket kp
    WHERE kp.usaha_id=p_usaha_id AND kp.paket_sewa_id=p_paket_sewa_id
      AND ((p_barang_id IS NOT NULL AND kp.barang_id=p_barang_id)
        OR (p_varian_barang_id IS NOT NULL AND kp.varian_barang_id=p_varian_barang_id))
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: target komponen sudah ada dalam paket' USING ERRCODE='23505';
  END IF;

  INSERT INTO public.komponen_paket(usaha_id,paket_sewa_id,barang_id,varian_barang_id,jumlah,catatan)
  VALUES(p_usaha_id,p_paket_sewa_id,p_barang_id,p_varian_barang_id,p_jumlah,NULLIF(btrim(p_catatan),''))
  RETURNING * INTO v_row;

  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary)
  VALUES(p_usaha_id,auth.uid(),v_admin_id,'create','komponen_paket',v_row.komponen_paket_id,'admin-command',p_request_id,
         jsonb_build_object('paket_sewa_id',v_row.paket_sewa_id,'barang_id',v_row.barang_id,'varian_barang_id',v_row.varian_barang_id,'jumlah',v_row.jumlah));

  v_claim:=to_jsonb(v_row); PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim); RETURN v_claim;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_remove_komponen_paket(
  p_usaha_id uuid,p_komponen_paket_id uuid,p_idempotency_key text DEFAULT NULL,p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb; v_idempotency_id uuid; v_row public.komponen_paket%ROWTYPE; v_hash text;
BEGIN
  v_hash:=md5(jsonb_build_object('usaha_id',p_usaha_id,'id',p_komponen_paket_id)::text);
  v_claim:=app_private.catalog_idempotency_claim(p_usaha_id,'remove_komponen_paket',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: penghapusan komponen belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id:=(v_claim->>'idempotency_key_id')::uuid;

  SELECT * INTO v_row FROM public.komponen_paket WHERE usaha_id=p_usaha_id AND komponen_paket_id=p_komponen_paket_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: komponen paket tidak ditemukan' USING ERRCODE='P0002'; END IF;

  DELETE FROM public.komponen_paket WHERE usaha_id=p_usaha_id AND komponen_paket_id=p_komponen_paket_id;

  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary)
  VALUES(p_usaha_id,auth.uid(),v_admin_id,'delete','komponen_paket',v_row.komponen_paket_id,'admin-command',p_request_id,
         jsonb_build_object('paket_sewa_id',v_row.paket_sewa_id,'barang_id',v_row.barang_id,'varian_barang_id',v_row.varian_barang_id,'jumlah',v_row.jumlah));

  v_claim:=jsonb_build_object('removed',true,'komponen_paket_id',v_row.komponen_paket_id);
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim); RETURN v_claim;
END;
$function$;

-- Tariff commands
CREATE OR REPLACE FUNCTION app_private.command_create_tarif_sewa(
  p_usaha_id uuid,p_barang_id uuid DEFAULT NULL,p_varian_barang_id uuid DEFAULT NULL,p_paket_sewa_id uuid DEFAULT NULL,
  p_nama text DEFAULT NULL,p_durasi_unit text DEFAULT NULL,p_durasi_nilai integer DEFAULT NULL,p_nominal numeric DEFAULT NULL,
  p_currency_code text DEFAULT 'IDR',p_berlaku_mulai timestamptz DEFAULT now(),p_berlaku_sampai timestamptz DEFAULT NULL,
  p_status text DEFAULT 'active',p_metadata jsonb DEFAULT NULL,p_idempotency_key text DEFAULT NULL,p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb; v_idempotency_id uuid; v_row public.tarif_sewa%ROWTYPE; v_hash text;
  v_target_key text;
BEGIN
  IF num_nonnulls(p_barang_id,p_varian_barang_id,p_paket_sewa_id)<>1 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tarif harus menunjuk tepat satu target' USING ERRCODE='22023';
  END IF;
  IF p_nama IS NULL OR btrim(p_nama)='' OR p_durasi_nilai IS NULL OR p_durasi_nilai<=0 OR p_nominal IS NULL OR p_nominal<0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: nama, durasi, dan nominal wajib valid' USING ERRCODE='22023';
  END IF;
  IF p_durasi_unit IS NULL OR btrim(p_durasi_unit)='' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: durasi_unit wajib diisi' USING ERRCODE='22023';
  END IF;
  IF p_berlaku_sampai IS NOT NULL AND p_berlaku_sampai<=p_berlaku_mulai THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: berlaku_sampai harus setelah berlaku_mulai' USING ERRCODE='22023';
  END IF;
  IF p_status NOT IN ('active','inactive') THEN RAISE EXCEPTION 'VALIDATION_ERROR: status tarif tidak valid' USING ERRCODE='22023'; END IF;
  IF p_currency_code !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'VALIDATION_ERROR: currency harus ISO 4217 3 huruf' USING ERRCODE='22023'; END IF;

  IF p_barang_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.barang WHERE usaha_id=p_usaha_id AND barang_id=p_barang_id) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: target barang tidak berada dalam Usaha ini' USING ERRCODE='22023';
  END IF;
  IF p_varian_barang_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.varian_barang WHERE usaha_id=p_usaha_id AND varian_barang_id=p_varian_barang_id) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: target varian tidak berada dalam Usaha ini' USING ERRCODE='22023';
  END IF;
  IF p_paket_sewa_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.paket_sewa WHERE usaha_id=p_usaha_id AND paket_sewa_id=p_paket_sewa_id) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: target paket tidak berada dalam Usaha ini' USING ERRCODE='22023';
  END IF;

  v_target_key:=p_usaha_id::text || ':tariff:' ||
    CASE WHEN p_barang_id IS NOT NULL THEN 'barang:'||p_barang_id::text
         WHEN p_varian_barang_id IS NOT NULL THEN 'varian:'||p_varian_barang_id::text
         ELSE 'paket:'||p_paket_sewa_id::text END;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_target_key,0));

  IF p_status='active' AND EXISTS(
    SELECT 1 FROM public.tarif_sewa t
    WHERE t.usaha_id=p_usaha_id AND t.status='active'
      AND ((p_barang_id IS NOT NULL AND t.barang_id=p_barang_id)
        OR (p_varian_barang_id IS NOT NULL AND t.varian_barang_id=p_varian_barang_id)
        OR (p_paket_sewa_id IS NOT NULL AND t.paket_sewa_id=p_paket_sewa_id))
      AND t.berlaku_mulai < COALESCE(p_berlaku_sampai,'infinity'::timestamptz)
      AND COALESCE(t.berlaku_sampai,'infinity'::timestamptz) > p_berlaku_mulai
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: periode tarif active tumpang tindih untuk target yang sama' USING ERRCODE='23505';
  END IF;

  v_hash:=md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'barang',p_barang_id,'varian',p_varian_barang_id,'paket',p_paket_sewa_id,
    'nama',btrim(p_nama),'durasi_unit',btrim(p_durasi_unit),'durasi_nilai',p_durasi_nilai,'nominal',p_nominal,
    'currency',p_currency_code,'mulai',p_berlaku_mulai,'sampai',p_berlaku_sampai,'status',p_status,'metadata',p_metadata
  )::text);
  v_claim:=app_private.catalog_idempotency_claim(p_usaha_id,'create_tarif_sewa',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: pembuatan tarif belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id:=(v_claim->>'idempotency_key_id')::uuid;

  INSERT INTO public.tarif_sewa(
    usaha_id,barang_id,varian_barang_id,paket_sewa_id,nama,durasi_unit,durasi_nilai,nominal,currency_code,
    berlaku_mulai,berlaku_sampai,status,metadata
  )
  VALUES(
    p_usaha_id,p_barang_id,p_varian_barang_id,p_paket_sewa_id,btrim(p_nama),btrim(p_durasi_unit),p_durasi_nilai,
    p_nominal,p_currency_code,p_berlaku_mulai,p_berlaku_sampai,p_status,p_metadata
  )
  RETURNING * INTO v_row;

  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary)
  VALUES(
    p_usaha_id,auth.uid(),v_admin_id,'create','tarif_sewa',v_row.tarif_sewa_id,'admin-command',p_request_id,
    jsonb_build_object('nama',v_row.nama,'nominal',v_row.nominal,'berlaku_mulai',v_row.berlaku_mulai,'berlaku_sampai',v_row.berlaku_sampai)
  );

  v_claim:=to_jsonb(v_row);
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim);
  RETURN v_claim;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_update_tarif_sewa(
  p_usaha_id uuid,p_tarif_sewa_id uuid,p_nama text,p_durasi_unit text,p_durasi_nilai integer,p_nominal numeric,
  p_berlaku_mulai timestamptz,p_berlaku_sampai timestamptz,p_metadata jsonb DEFAULT NULL,p_expected_updated_at timestamptz DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb; v_idempotency_id uuid; v_row public.tarif_sewa%ROWTYPE; v_hash text; v_target_key text;
BEGIN
  IF p_nama IS NULL OR btrim(p_nama)='' OR p_durasi_nilai IS NULL OR p_durasi_nilai<=0 OR p_nominal IS NULL OR p_nominal<0 OR p_durasi_unit IS NULL OR btrim(p_durasi_unit)='' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: nama, durasi, dan nominal wajib valid' USING ERRCODE='22023';
  END IF;
  IF p_berlaku_sampai IS NOT NULL AND p_berlaku_sampai<=p_berlaku_mulai THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: periode tarif tidak valid' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text || ':tariff-update:' || p_tarif_sewa_id::text,0));

  SELECT * INTO v_row FROM public.tarif_sewa WHERE usaha_id=p_usaha_id AND tarif_sewa_id=p_tarif_sewa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: tarif tidak ditemukan' USING ERRCODE='P0002'; END IF;

  v_target_key:=p_usaha_id::text || ':tariff:' ||
    CASE WHEN v_row.barang_id IS NOT NULL THEN 'barang:'||v_row.barang_id::text
         WHEN v_row.varian_barang_id IS NOT NULL THEN 'varian:'||v_row.varian_barang_id::text
         ELSE 'paket:'||v_row.paket_sewa_id::text END;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_target_key,0));

  v_hash:=md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'id',p_tarif_sewa_id,'nama',btrim(p_nama),'durasi_unit',btrim(p_durasi_unit),
    'durasi_nilai',p_durasi_nilai,'nominal',p_nominal,'mulai',p_berlaku_mulai,'sampai',p_berlaku_sampai,
    'metadata',p_metadata,'expected_updated_at',p_expected_updated_at
  )::text);
  v_claim:=app_private.catalog_idempotency_claim(p_usaha_id,'update_tarif_sewa',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: perubahan tarif belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id:=(v_claim->>'idempotency_key_id')::uuid;

  IF v_row.status='active' AND EXISTS(
    SELECT 1 FROM public.tarif_sewa t
    WHERE t.usaha_id=p_usaha_id AND t.tarif_sewa_id<>p_tarif_sewa_id AND t.status='active'
      AND ((v_row.barang_id IS NOT NULL AND t.barang_id=v_row.barang_id)
        OR (v_row.varian_barang_id IS NOT NULL AND t.varian_barang_id=v_row.varian_barang_id)
        OR (v_row.paket_sewa_id IS NOT NULL AND t.paket_sewa_id=v_row.paket_sewa_id))
      AND t.berlaku_mulai < COALESCE(p_berlaku_sampai,'infinity'::timestamptz)
      AND COALESCE(t.berlaku_sampai,'infinity'::timestamptz) > p_berlaku_mulai
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: periode tarif active tumpang tindih untuk target yang sama' USING ERRCODE='23505';
  END IF;

  UPDATE public.tarif_sewa
     SET nama=btrim(p_nama),durasi_unit=btrim(p_durasi_unit),durasi_nilai=p_durasi_nilai,nominal=p_nominal,
         berlaku_mulai=p_berlaku_mulai,berlaku_sampai=p_berlaku_sampai,metadata=p_metadata,updated_at=now()
   WHERE usaha_id=p_usaha_id AND tarif_sewa_id=p_tarif_sewa_id
     AND (p_expected_updated_at IS NULL OR updated_at=p_expected_updated_at)
   RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'STALE_DATA: tarif sudah berubah, muat data terbaru' USING ERRCODE='40001'; END IF;

  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary)
  VALUES(p_usaha_id,auth.uid(),v_admin_id,'update','tarif_sewa',v_row.tarif_sewa_id,'admin-command',p_request_id,jsonb_build_object('nominal',v_row.nominal,'mulai',v_row.berlaku_mulai,'sampai',v_row.berlaku_sampai));

  v_claim:=to_jsonb(v_row);
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim);
  RETURN v_claim;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_set_tarif_status(
  p_usaha_id uuid,p_tarif_sewa_id uuid,p_status text,p_expected_updated_at timestamptz DEFAULT NULL,p_idempotency_key text DEFAULT NULL,p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb; v_idempotency_id uuid; v_row public.tarif_sewa%ROWTYPE; v_hash text; v_target_key text;
BEGIN
  IF p_status NOT IN ('active','inactive') THEN RAISE EXCEPTION 'VALIDATION_ERROR: status tarif tidak valid' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_row FROM public.tarif_sewa WHERE usaha_id=p_usaha_id AND tarif_sewa_id=p_tarif_sewa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: tarif tidak ditemukan' USING ERRCODE='P0002'; END IF;

  v_target_key:=p_usaha_id::text || ':tariff:' ||
    CASE WHEN v_row.barang_id IS NOT NULL THEN 'barang:'||v_row.barang_id::text
         WHEN v_row.varian_barang_id IS NOT NULL THEN 'varian:'||v_row.varian_barang_id::text
         ELSE 'paket:'||v_row.paket_sewa_id::text END;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_target_key,0));

  v_hash:=md5(jsonb_build_object('usaha_id',p_usaha_id,'id',p_tarif_sewa_id,'status',p_status,'expected_updated_at',p_expected_updated_at)::text);
  v_claim:=app_private.catalog_idempotency_claim(p_usaha_id,'set_tarif_status',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: status tarif belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id:=(v_claim->>'idempotency_key_id')::uuid;

  IF p_status='active' AND EXISTS(
    SELECT 1 FROM public.tarif_sewa t
    WHERE t.usaha_id=p_usaha_id AND t.tarif_sewa_id<>p_tarif_sewa_id AND t.status='active'
      AND ((v_row.barang_id IS NOT NULL AND t.barang_id=v_row.barang_id)
        OR (v_row.varian_barang_id IS NOT NULL AND t.varian_barang_id=v_row.varian_barang_id)
        OR (v_row.paket_sewa_id IS NOT NULL AND t.paket_sewa_id=v_row.paket_sewa_id))
      AND t.berlaku_mulai < COALESCE(v_row.berlaku_sampai,'infinity'::timestamptz)
      AND COALESCE(t.berlaku_sampai,'infinity'::timestamptz) > v_row.berlaku_mulai
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: periode tarif active tumpang tindih untuk target yang sama' USING ERRCODE='23505';
  END IF;

  UPDATE public.tarif_sewa
   SET status=p_status,updated_at=now()
   WHERE usaha_id=p_usaha_id AND tarif_sewa_id=p_tarif_sewa_id
     AND (p_expected_updated_at IS NULL OR updated_at=p_expected_updated_at)
   RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'STALE_DATA: tarif sudah berubah, muat data terbaru' USING ERRCODE='40001'; END IF;

  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary)
  VALUES(p_usaha_id,auth.uid(),v_admin_id,'status_change','tarif_sewa',v_row.tarif_sewa_id,'admin-command',p_request_id,jsonb_build_object('status',v_row.status));

  v_claim:=to_jsonb(v_row);
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim);
  RETURN v_claim;
END;
$function$;

-- Media commands
CREATE OR REPLACE FUNCTION app_private.command_add_barang_media(
  p_usaha_id uuid,p_barang_id uuid,p_storage_bucket text,p_storage_path text,
  p_media_type text DEFAULT 'image',p_urutan integer DEFAULT 1,p_is_cover boolean DEFAULT false,
  p_idempotency_key text DEFAULT NULL,p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb; v_idempotency_id uuid; v_row public.barang_media%ROWTYPE; v_hash text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.barang WHERE usaha_id=p_usaha_id AND barang_id=p_barang_id) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: barang media tidak ditemukan dalam Usaha ini' USING ERRCODE='22023';
  END IF;
  IF p_storage_bucket IS NULL OR btrim(p_storage_bucket)='' OR p_storage_path IS NULL OR btrim(p_storage_path)='' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: storage bucket dan path wajib diisi' USING ERRCODE='22023';
  END IF;
  IF p_urutan < 1 THEN RAISE EXCEPTION 'VALIDATION_ERROR: urutan media harus >= 1' USING ERRCODE='22023'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text || ':media:' || p_barang_id::text,0));

  v_hash:=md5(jsonb_build_object('usaha_id',p_usaha_id,'barang_id',p_barang_id,'bucket',p_storage_bucket,'path',p_storage_path,'media_type',p_media_type,'urutan',p_urutan,'is_cover',p_is_cover)::text);
  v_claim:=app_private.catalog_idempotency_claim(p_usaha_id,'add_barang_media',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: penambahan media belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id:=(v_claim->>'idempotency_key_id')::uuid;

  IF p_is_cover THEN
    UPDATE public.barang_media
       SET is_cover=false,updated_at=now()
     WHERE usaha_id=p_usaha_id AND barang_id=p_barang_id AND status='valid';
  END IF;

  INSERT INTO public.barang_media(usaha_id,barang_id,storage_bucket,storage_path,media_type,urutan,is_cover,status)
  VALUES(p_usaha_id,p_barang_id,btrim(p_storage_bucket),btrim(p_storage_path),p_media_type,p_urutan,p_is_cover,'valid')
  RETURNING * INTO v_row;

  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary)
  VALUES(p_usaha_id,auth.uid(),v_admin_id,'create','barang_media',v_row.barang_media_id,'admin-command',p_request_id,
         jsonb_build_object('barang_id',v_row.barang_id,'path',v_row.storage_path,'is_cover',v_row.is_cover));

  v_claim:=to_jsonb(v_row);
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim);
  RETURN v_claim;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_remove_barang_media(
  p_usaha_id uuid,p_barang_media_id uuid,p_idempotency_key text DEFAULT NULL,p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb; v_idempotency_id uuid; v_row public.barang_media%ROWTYPE; v_hash text;
BEGIN
  v_hash:=md5(jsonb_build_object('usaha_id',p_usaha_id,'id',p_barang_media_id)::text);
  v_claim:=app_private.catalog_idempotency_claim(p_usaha_id,'remove_barang_media',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: penghapusan media belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id:=(v_claim->>'idempotency_key_id')::uuid;

  SELECT * INTO v_row FROM public.barang_media WHERE usaha_id=p_usaha_id AND barang_media_id=p_barang_media_id AND status='valid';
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: media valid tidak ditemukan' USING ERRCODE='P0002'; END IF;

  UPDATE public.barang_media SET status='deleted',is_cover=false,updated_at=now()
  WHERE usaha_id=p_usaha_id AND barang_media_id=p_barang_media_id;

  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary)
  VALUES(p_usaha_id,auth.uid(),v_admin_id,'delete','barang_media',v_row.barang_media_id,'admin-command',p_request_id,jsonb_build_object('barang_id',v_row.barang_id,'storage_path',v_row.storage_path));

  v_claim:=jsonb_build_object('removed',true,'barang_media_id',v_row.barang_media_id);
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim);
  RETURN v_claim;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_set_barang_media_cover(
  p_usaha_id uuid,p_barang_media_id uuid,p_is_cover boolean,p_idempotency_key text DEFAULT NULL,p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb; v_idempotency_id uuid; v_row public.barang_media%ROWTYPE; v_hash text;
BEGIN
  v_hash:=md5(jsonb_build_object('usaha_id',p_usaha_id,'id',p_barang_media_id,'is_cover',p_is_cover)::text);
  v_claim:=app_private.catalog_idempotency_claim(p_usaha_id,'set_barang_media_cover',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: perubahan cover media belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id:=(v_claim->>'idempotency_key_id')::uuid;

  SELECT * INTO v_row FROM public.barang_media
   WHERE usaha_id=p_usaha_id AND barang_media_id=p_barang_media_id AND status='valid';
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: media valid tidak ditemukan' USING ERRCODE='P0002'; END IF;

  IF p_is_cover THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text || ':media:' || v_row.barang_id::text,0));
    UPDATE public.barang_media SET is_cover=false,updated_at=now()
     WHERE usaha_id=p_usaha_id AND barang_id=v_row.barang_id AND status='valid';
  END IF;

  UPDATE public.barang_media SET is_cover=p_is_cover,updated_at=now()
   WHERE usaha_id=p_usaha_id AND barang_media_id=p_barang_media_id AND status='valid'
   RETURNING * INTO v_row;

  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary)
  VALUES(p_usaha_id,auth.uid(),v_admin_id,'update','barang_media',v_row.barang_media_id,'admin-command',p_request_id,jsonb_build_object('is_cover',v_row.is_cover));

  v_claim:=to_jsonb(v_row);
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim);
  RETURN v_claim;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_reorder_barang_media(
  p_usaha_id uuid,p_barang_id uuid,p_orders jsonb,p_idempotency_key text DEFAULT NULL,p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid:=app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb; v_idempotency_id uuid; v_hash text; v_item jsonb; v_count integer;
BEGIN
  IF p_orders IS NULL OR jsonb_typeof(p_orders)<>'array' OR jsonb_array_length(p_orders)=0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: daftar urutan media wajib berupa array non-empty' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text || ':media:' || p_barang_id::text,0));

  v_hash:=md5(jsonb_build_object('usaha_id',p_usaha_id,'barang_id',p_barang_id,'orders',p_orders)::text);
  v_claim:=app_private.catalog_idempotency_claim(p_usaha_id,'reorder_barang_media',p_idempotency_key,v_hash);
  IF v_claim->>'state'='committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state'='unknown' THEN RAISE EXCEPTION 'UNKNOWN_OUTCOME: reorder media belum dapat dipastikan' USING ERRCODE='40001'; END IF;
  v_idempotency_id:=(v_claim->>'idempotency_key_id')::uuid;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_orders) LOOP
    IF (v_item->>'barang_media_id') IS NULL OR (v_item->>'urutan') IS NULL OR (v_item->>'urutan')::int < 1 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: setiap item urutan media harus memiliki id dan urutan valid' USING ERRCODE='22023';
    END IF;
    UPDATE public.barang_media
       SET urutan=(v_item->>'urutan')::int,updated_at=now()
     WHERE usaha_id=p_usaha_id
       AND barang_id=p_barang_id
       AND barang_media_id=(v_item->>'barang_media_id')::uuid
       AND status='valid';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count=0 THEN
      RAISE EXCEPTION 'NOT_FOUND: salah satu media tidak berada pada barang ini' USING ERRCODE='P0002';
    END IF;
  END LOOP;

  INSERT INTO public.audit_log(usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary)
  VALUES(p_usaha_id,auth.uid(),v_admin_id,'reorder','barang_media',p_barang_id,'admin-command',p_request_id,jsonb_build_object('orders',p_orders));

  v_claim:=jsonb_build_object('barang_id',p_barang_id,'orders',p_orders);
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_claim);
  RETURN v_claim;
END;
$function$;

-- Reconciliation
CREATE OR REPLACE FUNCTION app_private.command_reconcile_catalog_mutation(
  p_usaha_id uuid,p_command_name text,p_idempotency_key text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid:=auth.uid();
  v_row public.idempotency_key%ROWTYPE;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;
  PERFORM app_private.catalog_require_admin(p_usaha_id);

  SELECT * INTO v_row
  FROM public.idempotency_key
  WHERE usaha_id=p_usaha_id
    AND actor_auth_user_id=v_auth_user_id
    AND command_name=p_command_name
    AND key=btrim(p_idempotency_key);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state','not_found','response',NULL);
  END IF;
  RETURN jsonb_build_object(
    'state',CASE WHEN v_row.response_body IS NULL THEN 'unknown' ELSE 'committed' END,
    'response',v_row.response_body
  );
END;
$function$;
