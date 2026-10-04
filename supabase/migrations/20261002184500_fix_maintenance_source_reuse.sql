-- Clarify the duplicate-maintenance contract before insert.
-- An inspection may have at most one maintenance task; the unique index remains
-- the database invariant, while the command returns a business conflict instead
-- of falling through to a raw unique-constraint/unknown-outcome path.

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
    WHERE pm.usaha_id=p_usaha_id
      AND pm.unit_barang_id=p_unit_barang_id
      AND pm.status IN ('planned','in_progress')
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

    IF EXISTS (
      SELECT 1
      FROM public.perawatan pm
      WHERE pm.usaha_id=p_usaha_id
        AND pm.pemeriksaan_id=p_pemeriksaan_id
    ) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: pemeriksaan ini sudah memiliki perawatan. Buka perawatan yang sudah ada.' USING ERRCODE='23514';
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