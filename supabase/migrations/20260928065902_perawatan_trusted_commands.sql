-- Perawatan trusted command boundary.
-- Perawatan owns maintenance work facts.
-- Inventaris owns physical unit state; this migration uses a private handoff helper.
-- Finance owns actual money transactions.
-- Completion never marks a unit READY.

CREATE OR REPLACE FUNCTION app_private.apply_inventory_maintenance_state(
  p_usaha_id uuid,
  p_unit_barang_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_actor_admin_id uuid,
  p_catatan text,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_unit public.unit_barang%ROWTYPE;
  v_note text := nullif(btrim(coalesce(p_catatan, '')), '');
  v_status_before text;
BEGIN
  IF p_usaha_id IS NULL OR p_unit_barang_id IS NULL OR p_source_type IS NULL OR p_source_id IS NULL
     OR p_actor_admin_id IS NULL OR p_expected_updated_at IS NULL
  THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: konteks unit maintenance wajib lengkap' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_unit FROM public.unit_barang
  WHERE usaha_id=p_usaha_id AND unit_barang_id=p_unit_barang_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: unit tidak ditemukan dalam usaha aktif' USING ERRCODE='P0002';
  END IF;
  IF v_unit.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_DATA: unit berubah sebelum handoff maintenance. Muat data terbaru.' USING ERRCODE='40001';
  END IF;
  IF v_unit.status='maintenance' THEN
    RETURN jsonb_build_object('unit_barang_id',p_unit_barang_id,'status','maintenance','changed',false);
  END IF;
  IF v_unit.status NOT IN ('ready','inspection_pending') THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: unit berstatus % tidak dapat masuk state maintenance',v_unit.status USING ERRCODE='23514';
  END IF;
  v_status_before := v_unit.status;
  UPDATE public.unit_barang SET status='maintenance'
  WHERE usaha_id=p_usaha_id AND unit_barang_id=p_unit_barang_id;
  INSERT INTO public.riwayat_unit(
    usaha_id,unit_barang_id,jenis_kejadian,terjadi_at,status_sebelum,status_sesudah,
    lokasi_sebelum_id,lokasi_sesudah_id,sumber_type,sumber_id,actor_akun_admin_id,catatan,metadata
  ) VALUES (
    p_usaha_id,p_unit_barang_id,'unit_marked_maintenance',now(),v_status_before,'maintenance',
    v_unit.lokasi_id,v_unit.lokasi_id,p_source_type,p_source_id,p_actor_admin_id,v_note,
    jsonb_build_object('handoff','perawatan','status_before',v_status_before,'status_after','maintenance')
  );
  INSERT INTO public.audit_log(
    usaha_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,change_summary
  ) VALUES (
    p_usaha_id,p_actor_admin_id,'mark_unit_maintenance','unit_barang',p_unit_barang_id,'maintenance-handoff',
    jsonb_build_object('status_before',v_status_before,'status_after','maintenance','source_type',p_source_type,'source_id',p_source_id)
  );
  INSERT INTO public.outbox_event(
    usaha_id,event_type,aggregate_type,aggregate_id,payload
  ) VALUES (
    p_usaha_id,'inventory.unit_maintenance','unit_barang',p_unit_barang_id,
    jsonb_build_object('unit_barang_id',p_unit_barang_id,'status','maintenance','status_before',v_status_before,'source_type',p_source_type,'source_id',p_source_id)
  );
  RETURN jsonb_build_object('unit_barang_id',p_unit_barang_id,'status','maintenance','changed',true);
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_create_maintenance(
  p_usaha_id uuid,p_unit_barang_id uuid,p_pemeriksaan_id uuid,p_jenis_perawatan text,
  p_deskripsi_pekerjaan text,p_pelaksana text,p_biaya numeric,p_currency_code text,
  p_catatan text,p_idempotency_key text,p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_unit public.unit_barang%ROWTYPE;
  v_inspection public.pemeriksaan%ROWTYPE;
  v_maintenance_id uuid := gen_random_uuid();
  v_idempotency_id uuid;
  v_request_hash text;
  v_existing_hash text;
  v_existing_response jsonb;
  v_response jsonb;
  v_type text := nullif(btrim(coalesce(p_jenis_perawatan,'')),'');
  v_work text := nullif(btrim(coalesce(p_deskripsi_pekerjaan,'')),'');
  v_executor text := nullif(btrim(coalesce(p_pelaksana,'')),'');
  v_currency text := upper(nullif(btrim(coalesce(p_currency_code,'')),''));
  v_note text := nullif(btrim(coalesce(p_catatan,'')),'');
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;
  IF p_usaha_id IS NULL OR p_unit_barang_id IS NULL OR v_type IS NULL OR v_work IS NULL
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tenant, unit, jenis, deskripsi, request_id, dan idempotency_key wajib diisi' USING ERRCODE='22023';
  END IF;
  IF v_currency IS NULL OR v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: currency_code harus berupa kode ISO 3 huruf' USING ERRCODE='22023';
  END IF;
  IF p_biaya IS NOT NULL AND p_biaya < 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: biaya tidak boleh negatif' USING ERRCODE='22023';
  END IF;

  SELECT aa.akun_admin_id INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id=aa.akun_admin_id AND ku.usaha_id=p_usaha_id
   AND ku.status='active' AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id=v_auth_user_id AND aa.status='active' AND aa.role='super_admin';
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text||':maintenance-unit:'||p_unit_barang_id::text,0));
  SELECT * INTO v_unit FROM public.unit_barang
  WHERE usaha_id=p_usaha_id AND unit_barang_id=p_unit_barang_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: unit tidak ditemukan dalam usaha aktif' USING ERRCODE='P0002';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'unit_barang_id',p_unit_barang_id,'pemeriksaan_id',p_pemeriksaan_id,
    'jenis_perawatan',v_type,'deskripsi_pekerjaan',v_work,'pelaksana',v_executor,
    'biaya',p_biaya,'currency_code',v_currency,'catatan',v_note
  )::text);
  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'create_maintenance',v_request_hash)
  ON CONFLICT (usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;
  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body,ik.request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key ik
    WHERE ik.usaha_id=p_usaha_id AND ik.actor_auth_user_id=v_auth_user_id
      AND ik.command_name='create_maintenance' AND ik.key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: create maintenance memiliki idempotency record tanpa response' USING ERRCODE='40001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.perawatan pm
    WHERE pm.usaha_id=p_usaha_id AND pm.unit_barang_id=p_unit_barang_id AND pm.status IN ('planned','in_progress')
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: unit masih memiliki maintenance yang belum selesai' USING ERRCODE='23514';
  END IF;

  IF p_pemeriksaan_id IS NOT NULL THEN
    SELECT * INTO v_inspection FROM public.pemeriksaan pi
    WHERE pi.usaha_id=p_usaha_id AND pi.pemeriksaan_id=p_pemeriksaan_id AND pi.unit_barang_id=p_unit_barang_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: pemeriksaan tidak ditemukan atau unit tidak cocok' USING ERRCODE='23514';
    END IF;
    IF v_inspection.hasil='pending' THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: pemeriksaan sumber belum selesai' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.temuan_pemeriksaan tf
      WHERE tf.usaha_id=p_usaha_id AND tf.pemeriksaan_id=p_pemeriksaan_id
    ) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: maintenance dari pemeriksaan harus dapat ditelusuri ke finding' USING ERRCODE='23514';
    END IF;
    IF v_unit.status NOT IN ('inspection_pending','maintenance') THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: maintenance berbasis pemeriksaan harus dimulai dari state inspeksi/perawatan, bukan %',v_unit.status USING ERRCODE='23514';
    END IF;
  ELSE
    IF v_unit.status <> 'ready' THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: maintenance manual fase awal hanya dapat dibuat dari unit ready' USING ERRCODE='23514';
    END IF;
    IF v_note IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: maintenance manual wajib memiliki alasan pada catatan' USING ERRCODE='22023';
    END IF;
  END IF;

  PERFORM app_private.apply_inventory_maintenance_state(
    p_usaha_id,p_unit_barang_id,'perawatan',v_maintenance_id,v_admin_id,v_note,v_unit.updated_at
  );

  INSERT INTO public.perawatan(
    perawatan_id,usaha_id,unit_barang_id,pemeriksaan_id,jenis_perawatan,deskripsi_pekerjaan,
    status,dimulai_at,selesai_at,biaya,currency_code,pelaksana,catatan
  ) VALUES(
    v_maintenance_id,p_usaha_id,p_unit_barang_id,p_pemeriksaan_id,v_type,v_work,
    'planned',NULL,NULL,p_biaya,v_currency,v_executor,v_note
  );

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary
  ) VALUES(
    p_usaha_id,v_auth_user_id,v_admin_id,'create_maintenance','perawatan',v_maintenance_id,'admin-command',p_request_id,
    jsonb_build_object('unit_barang_id',p_unit_barang_id,'pemeriksaan_id',p_pemeriksaan_id,'jenis_perawatan',v_type,'status','planned','biaya',p_biaya)
  );
  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES(
    p_usaha_id,'maintenance.created','perawatan',v_maintenance_id,
    jsonb_build_object('perawatan_id',v_maintenance_id,'unit_barang_id',p_unit_barang_id,'pemeriksaan_id',p_pemeriksaan_id,
      'jenis_perawatan',v_type,'status','planned','biaya',p_biaya,'currency_code',v_currency)
  );

  v_response := jsonb_build_object(
    'perawatan_id',v_maintenance_id,'usaha_id',p_usaha_id,'unit_barang_id',p_unit_barang_id,
    'pemeriksaan_id',p_pemeriksaan_id,'jenis_perawatan',v_type,'status','planned','biaya',p_biaya,'currency_code',v_currency
  );
  UPDATE public.idempotency_key SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_start_maintenance(
  p_usaha_id uuid,p_perawatan_id uuid,p_expected_updated_at timestamptz,
  p_expected_unit_updated_at timestamptz,p_idempotency_key text,p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_maintenance public.perawatan%ROWTYPE;
  v_unit public.unit_barang%ROWTYPE;
  v_idempotency_id uuid;
  v_request_hash text;
  v_existing_hash text;
  v_existing_response jsonb;
  v_response jsonb;
  v_unit_id uuid;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;
  IF p_usaha_id IS NULL OR p_perawatan_id IS NULL OR p_expected_updated_at IS NULL OR p_expected_unit_updated_at IS NULL
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: maintenance, expected state, request_id, dan idempotency_key wajib diisi' USING ERRCODE='22023';
  END IF;

  SELECT aa.akun_admin_id INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id=aa.akun_admin_id AND ku.usaha_id=p_usaha_id
   AND ku.status='active' AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id=v_auth_user_id AND aa.status='active' AND aa.role='super_admin';
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501';
  END IF;

  SELECT unit_barang_id INTO v_unit_id
  FROM public.perawatan
  WHERE usaha_id=p_usaha_id AND perawatan_id=p_perawatan_id;
  IF v_unit_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: maintenance tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text||':maintenance-unit:'||v_unit_id::text,0));

  v_request_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'perawatan_id',p_perawatan_id,
    'expected_updated_at',p_expected_updated_at,'expected_unit_updated_at',p_expected_unit_updated_at
  )::text);
  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'start_maintenance',v_request_hash)
  ON CONFLICT (usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;
  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body,ik.request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key ik
    WHERE ik.usaha_id=p_usaha_id AND ik.actor_auth_user_id=v_auth_user_id
      AND ik.command_name='start_maintenance' AND ik.key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: start maintenance memiliki idempotency record tanpa response' USING ERRCODE='40001';
  END IF;

  SELECT * INTO v_maintenance FROM public.perawatan
  WHERE usaha_id=p_usaha_id AND perawatan_id=p_perawatan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: maintenance tidak ditemukan' USING ERRCODE='P0002';
  END IF;
  SELECT * INTO v_unit FROM public.unit_barang
  WHERE usaha_id=p_usaha_id AND unit_barang_id=v_maintenance.unit_barang_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: unit maintenance tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  IF v_maintenance.updated_at IS DISTINCT FROM p_expected_updated_at OR v_unit.updated_at IS DISTINCT FROM p_expected_unit_updated_at THEN
    RAISE EXCEPTION 'STALE_DATA: maintenance atau unit berubah sejak data dibuka. Muat data terbaru.' USING ERRCODE='40001';
  END IF;
  IF v_maintenance.status <> 'planned' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: maintenance berstatus % tidak dapat dimulai',v_maintenance.status USING ERRCODE='23514';
  END IF;
  IF v_unit.status <> 'maintenance' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: unit tidak lagi berada pada state maintenance' USING ERRCODE='23514';
  END IF;

  UPDATE public.perawatan SET status='in_progress',dimulai_at=now()
  WHERE usaha_id=p_usaha_id AND perawatan_id=p_perawatan_id;

  INSERT INTO public.riwayat_unit(
    usaha_id,unit_barang_id,jenis_kejadian,terjadi_at,status_sebelum,status_sesudah,
    lokasi_sebelum_id,lokasi_sesudah_id,sumber_type,sumber_id,actor_akun_admin_id,catatan,metadata
  ) VALUES(
    p_usaha_id,v_maintenance.unit_barang_id,'maintenance_started',now(),'maintenance','maintenance',
    v_unit.lokasi_id,v_unit.lokasi_id,'perawatan',p_perawatan_id,v_admin_id,NULL,
    jsonb_build_object('perawatan_id',p_perawatan_id)
  );
  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary
  ) VALUES(
    p_usaha_id,v_auth_user_id,v_admin_id,'start_maintenance','perawatan',p_perawatan_id,'admin-command',p_request_id,
    jsonb_build_object('status_before','planned','status_after','in_progress','dimulai_at','server-time')
  );
  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES(
    p_usaha_id,'maintenance.started','perawatan',p_perawatan_id,
    jsonb_build_object('perawatan_id',p_perawatan_id,'unit_barang_id',v_maintenance.unit_barang_id,'status','in_progress')
  );

  v_response := jsonb_build_object(
    'perawatan_id',p_perawatan_id,'unit_barang_id',v_maintenance.unit_barang_id,'status','in_progress','dimulai_at',now()
  );
  UPDATE public.idempotency_key SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_complete_maintenance(
  p_usaha_id uuid,p_perawatan_id uuid,p_expected_updated_at timestamptz,p_expected_unit_updated_at timestamptz,
  p_pelaksana text,p_biaya numeric,p_currency_code text,p_catatan text,p_idempotency_key text,p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_maintenance public.perawatan%ROWTYPE;
  v_unit public.unit_barang%ROWTYPE;
  v_idempotency_id uuid;
  v_request_hash text;
  v_existing_hash text;
  v_existing_response jsonb;
  v_response jsonb;
  v_executor text;
  v_currency text;
  v_new_cost numeric;
  v_new_note text;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;
  IF p_usaha_id IS NULL OR p_perawatan_id IS NULL OR p_expected_updated_at IS NULL OR p_expected_unit_updated_at IS NULL
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: maintenance, expected state, request_id, dan idempotency_key wajib diisi' USING ERRCODE='22023';
  END IF;
  IF p_biaya IS NOT NULL AND p_biaya < 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: biaya tidak boleh negatif' USING ERRCODE='22023';
  END IF;
  IF p_currency_code IS NOT NULL AND upper(btrim(p_currency_code)) !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: currency_code harus berupa kode ISO 3 huruf' USING ERRCODE='22023';
  END IF;

  SELECT aa.akun_admin_id INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id=aa.akun_admin_id AND ku.usaha_id=p_usaha_id
   AND ku.status='active' AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id=v_auth_user_id AND aa.status='active' AND aa.role='super_admin';
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'perawatan_id',p_perawatan_id,'expected_updated_at',p_expected_updated_at,
    'expected_unit_updated_at',p_expected_unit_updated_at,'pelaksana',nullif(btrim(coalesce(p_pelaksana,'')),''),
    'biaya',p_biaya,'currency_code',upper(nullif(btrim(coalesce(p_currency_code,'')),'')),
    'catatan',nullif(btrim(coalesce(p_catatan,'')),'')
  )::text);
  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'complete_maintenance',v_request_hash)
  ON CONFLICT (usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;
  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body,ik.request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key ik
    WHERE ik.usaha_id=p_usaha_id AND ik.actor_auth_user_id=v_auth_user_id
      AND ik.command_name='complete_maintenance' AND ik.key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: complete maintenance memiliki idempotency record tanpa response' USING ERRCODE='40001';
  END IF;

  SELECT * INTO v_maintenance FROM public.perawatan
  WHERE usaha_id=p_usaha_id AND perawatan_id=p_perawatan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: maintenance tidak ditemukan' USING ERRCODE='P0002';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text||':maintenance-unit:'||v_maintenance.unit_barang_id::text,0));
  SELECT * INTO v_unit FROM public.unit_barang
  WHERE usaha_id=p_usaha_id AND unit_barang_id=v_maintenance.unit_barang_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: unit maintenance tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  IF v_maintenance.updated_at IS DISTINCT FROM p_expected_updated_at OR v_unit.updated_at IS DISTINCT FROM p_expected_unit_updated_at THEN
    RAISE EXCEPTION 'STALE_DATA: maintenance atau unit berubah sejak data dibuka. Muat data terbaru.' USING ERRCODE='40001';
  END IF;
  IF v_maintenance.status <> 'in_progress' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: maintenance berstatus % tidak dapat diselesaikan',v_maintenance.status USING ERRCODE='23514';
  END IF;
  IF v_unit.status <> 'maintenance' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: unit tidak lagi berada pada state maintenance' USING ERRCODE='23514';
  END IF;

  v_executor := COALESCE(nullif(btrim(coalesce(p_pelaksana,'')),''),v_maintenance.pelaksana);
  v_new_cost := COALESCE(p_biaya,v_maintenance.biaya);
  v_currency := upper(COALESCE(nullif(btrim(coalesce(p_currency_code,'')),''),v_maintenance.currency_code));
  v_new_note := COALESCE(nullif(btrim(coalesce(p_catatan,'')),''),v_maintenance.catatan);

  UPDATE public.perawatan
  SET status='completed',selesai_at=now(),pelaksana=v_executor,biaya=v_new_cost,currency_code=v_currency,catatan=v_new_note
  WHERE usaha_id=p_usaha_id AND perawatan_id=p_perawatan_id;

  INSERT INTO public.riwayat_unit(
    usaha_id,unit_barang_id,jenis_kejadian,terjadi_at,status_sebelum,status_sesudah,
    lokasi_sebelum_id,lokasi_sesudah_id,sumber_type,sumber_id,actor_akun_admin_id,catatan,metadata
  ) VALUES(
    p_usaha_id,v_maintenance.unit_barang_id,'maintenance_completed',now(),'maintenance','maintenance',
    v_unit.lokasi_id,v_unit.lokasi_id,'perawatan',p_perawatan_id,v_admin_id,v_new_note,
    jsonb_build_object('perawatan_id',p_perawatan_id,'biaya',v_new_cost,'currency_code',v_currency,'verification_required',true)
  );
  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary
  ) VALUES(
    p_usaha_id,v_auth_user_id,v_admin_id,'complete_maintenance','perawatan',p_perawatan_id,'admin-command',p_request_id,
    jsonb_build_object('status_before','in_progress','status_after','completed','selesai_at','server-time','biaya',v_new_cost,'currency_code',v_currency,'pelaksana',v_executor)
  );
  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES(
    p_usaha_id,'maintenance.completed','perawatan',p_perawatan_id,
    jsonb_build_object('perawatan_id',p_perawatan_id,'unit_barang_id',v_maintenance.unit_barang_id,'status','completed','biaya',v_new_cost,'currency_code',v_currency,'verification_required',true)
  );

  v_response := jsonb_build_object(
    'perawatan_id',p_perawatan_id,'unit_barang_id',v_maintenance.unit_barang_id,'status','completed',
    'dimulai_at',v_maintenance.dimulai_at,'selesai_at',now(),'biaya',v_new_cost,'currency_code',v_currency,
    'pelaksana',v_executor,'verification_required',true
  );
  UPDATE public.idempotency_key SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_reconcile_maintenance_mutation(
  p_usaha_id uuid,p_command_name text,p_idempotency_key text
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
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;
  IF p_usaha_id IS NULL OR p_command_name NOT IN ('create_maintenance','start_maintenance','complete_maintenance')
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: reconciliation input tidak valid' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id=aa.akun_admin_id AND ku.usaha_id=p_usaha_id
     AND ku.status='active' AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id=v_auth_user_id AND aa.status='active' AND aa.role='super_admin'
  ) THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_row
  FROM public.idempotency_key ik
  WHERE ik.usaha_id=p_usaha_id AND ik.actor_auth_user_id=v_auth_user_id
    AND ik.command_name=p_command_name AND ik.key=btrim(p_idempotency_key);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state','not_found','response',null,'command_name',p_command_name);
  END IF;
  RETURN jsonb_build_object(
    'state',CASE WHEN v_row.response_body IS NULL THEN 'unknown' ELSE 'committed' END,
    'response',v_row.response_body,'command_name',p_command_name
  );
END;
$function$;

CREATE UNIQUE INDEX IF NOT EXISTS perawatan_one_open_per_unit_idx
  ON public.perawatan(usaha_id,unit_barang_id)
  WHERE status IN ('planned','in_progress');

CREATE INDEX IF NOT EXISTS perawatan_usaha_status_created_idx
  ON public.perawatan(usaha_id,status,created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='perawatan_status_valid' AND conrelid='public.perawatan'::regclass
  ) THEN
    ALTER TABLE public.perawatan ADD CONSTRAINT perawatan_status_valid
      CHECK (status IN ('planned','in_progress','completed','cancelled'));
  END IF;
END
$$;

DROP POLICY IF EXISTS maintenance_insert_member ON public.perawatan;
DROP POLICY IF EXISTS maintenance_update_member ON public.perawatan;
DROP POLICY IF EXISTS maintenance_delete_member ON public.perawatan;
REVOKE INSERT, UPDATE, DELETE ON public.perawatan FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.perawatan FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.perawatan FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.perawatan FROM service_role;

REVOKE ALL ON FUNCTION app_private.apply_inventory_maintenance_state(uuid,uuid,text,uuid,uuid,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.apply_inventory_maintenance_state(uuid,uuid,text,uuid,uuid,text,timestamptz) FROM anon;
REVOKE ALL ON FUNCTION app_private.apply_inventory_maintenance_state(uuid,uuid,text,uuid,uuid,text,timestamptz) FROM authenticated;
REVOKE ALL ON FUNCTION app_private.apply_inventory_maintenance_state(uuid,uuid,text,uuid,uuid,text,timestamptz) FROM service_role;

REVOKE ALL ON FUNCTION app_private.command_create_maintenance(uuid,uuid,uuid,text,text,text,numeric,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_create_maintenance(uuid,uuid,uuid,text,text,text,numeric,text,text,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_create_maintenance(uuid,uuid,uuid,text,text,text,numeric,text,text,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_create_maintenance(uuid,uuid,uuid,text,text,text,numeric,text,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_start_maintenance(uuid,uuid,timestamptz,timestamptz,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_start_maintenance(uuid,uuid,timestamptz,timestamptz,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_start_maintenance(uuid,uuid,timestamptz,timestamptz,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_start_maintenance(uuid,uuid,timestamptz,timestamptz,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_complete_maintenance(uuid,uuid,timestamptz,timestamptz,text,numeric,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_complete_maintenance(uuid,uuid,timestamptz,timestamptz,text,numeric,text,text,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_complete_maintenance(uuid,uuid,timestamptz,timestamptz,text,numeric,text,text,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_complete_maintenance(uuid,uuid,timestamptz,timestamptz,text,numeric,text,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_reconcile_maintenance_mutation(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_reconcile_maintenance_mutation(uuid,text,text) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_reconcile_maintenance_mutation(uuid,text,text) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_reconcile_maintenance_mutation(uuid,text,text) TO authenticated;
