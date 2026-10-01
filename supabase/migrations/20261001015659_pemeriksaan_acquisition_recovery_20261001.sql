-- ADR-007: acquisition inspection + bounded condition recovery.
-- This migration is synchronized from the verified remote functions after deployment.

ALTER TABLE public.pemeriksaan
  ADD COLUMN IF NOT EXISTS jenis_pemeriksaan text NOT NULL DEFAULT 'return';

ALTER TABLE public.pemeriksaan
  ALTER COLUMN detail_pengembalian_id DROP NOT NULL;

ALTER TABLE public.pemeriksaan
  DROP CONSTRAINT IF EXISTS pemeriksaan_kind_allowed_chk;

ALTER TABLE public.pemeriksaan
  ADD CONSTRAINT pemeriksaan_kind_allowed_chk
  CHECK (jenis_pemeriksaan IN ('return','acquisition'));

ALTER TABLE public.pemeriksaan
  DROP CONSTRAINT IF EXISTS pemeriksaan_kind_detail_consistency_chk;

ALTER TABLE public.pemeriksaan
  ADD CONSTRAINT pemeriksaan_kind_detail_consistency_chk
  CHECK (
    (jenis_pemeriksaan = 'return' AND detail_pengembalian_id IS NOT NULL)
    OR (jenis_pemeriksaan = 'acquisition' AND detail_pengembalian_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS pemeriksaan_usaha_kind_unit_idx
  ON public.pemeriksaan (usaha_id, jenis_pemeriksaan, unit_barang_id, diperiksa_at DESC);

CREATE INDEX IF NOT EXISTS pemeriksaan_usaha_kind_detail_idx
  ON public.pemeriksaan (usaha_id, jenis_pemeriksaan, detail_pengembalian_id, diperiksa_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS pemeriksaan_one_pending_acquisition_unit_idx
  ON public.pemeriksaan (usaha_id, unit_barang_id)
  WHERE jenis_pemeriksaan = 'acquisition' AND hasil = 'pending';

CREATE OR REPLACE FUNCTION app_private.command_start_acquisition_inspection(p_usaha_id uuid, p_unit_barang_id uuid, p_idempotency_key text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_unit public.unit_barang%ROWTYPE;
  v_existing public.pemeriksaan%ROWTYPE;
  v_latest public.pemeriksaan%ROWTYPE;
  v_idempotency_id uuid;
  v_request_hash text;
  v_response jsonb;
  v_inspection_id uuid;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;

  IF p_usaha_id IS NULL OR p_unit_barang_id IS NULL
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key)=''
     OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tenant, unit, idempotency_key, dan request_id wajib diisi' USING ERRCODE='22023';
  END IF;

  SELECT aa.akun_admin_id INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id=aa.akun_admin_id
   AND ku.usaha_id=p_usaha_id
   AND ku.status='active'
   AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id=v_auth_user_id
    AND aa.status='active';

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501';
  END IF;

  v_request_hash:=md5(jsonb_build_object(
    'usaha_id',p_usaha_id,
    'unit_barang_id',p_unit_barang_id,
    'jenis_pemeriksaan','acquisition'
  )::text);

  INSERT INTO public.idempotency_key(
    usaha_id,actor_auth_user_id,key,command_name,request_hash
  ) VALUES (
    p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'start_acquisition_inspection',v_request_hash
  )
  ON CONFLICT (usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body,request_hash
    INTO v_response,v_request_hash
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id
      AND actor_auth_user_id=v_auth_user_id
      AND command_name='start_acquisition_inspection'
      AND key=btrim(p_idempotency_key);

    IF v_request_hash IS DISTINCT FROM md5(jsonb_build_object(
      'usaha_id',p_usaha_id,
      'unit_barang_id',p_unit_barang_id,
      'jenis_pemeriksaan','acquisition'
    )::text) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_response IS NOT NULL THEN RETURN v_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: start acquisition inspection memiliki idempotency record tanpa response' USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_usaha_id::text||':inspection:acquisition:'||p_unit_barang_id::text,0)
  );

  SELECT * INTO v_unit
  FROM public.unit_barang
  WHERE usaha_id=p_usaha_id AND unit_barang_id=p_unit_barang_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: unit tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  IF v_unit.status <> 'inspection_pending' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: unit tidak berada pada state inspection_pending' USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_existing
  FROM public.pemeriksaan
  WHERE usaha_id=p_usaha_id
    AND jenis_pemeriksaan='acquisition'
    AND unit_barang_id=p_unit_barang_id
    AND hasil='pending'
  ORDER BY diperiksa_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_response:=jsonb_build_object(
      'pemeriksaan_id',v_existing.pemeriksaan_id,
      'unit_barang_id',p_unit_barang_id,
      'jenis_pemeriksaan','acquisition',
      'state','in_progress',
      'reused_draft',true
    );
    UPDATE public.idempotency_key SET response_status=200,response_body=v_response WHERE idempotency_key_id=v_idempotency_id;
    RETURN v_response;
  END IF;

  SELECT * INTO v_latest
  FROM public.pemeriksaan
  WHERE usaha_id=p_usaha_id
    AND jenis_pemeriksaan='acquisition'
    AND unit_barang_id=p_unit_barang_id
    AND hasil<>'pending'
  ORDER BY diperiksa_at DESC
  LIMIT 1;

  IF FOUND AND v_unit.updated_at <= v_latest.diperiksa_at THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: pemeriksaan acquisition terakhir masih merepresentasikan state unit saat ini' USING ERRCODE='23514';
  END IF;

  v_inspection_id:=gen_random_uuid();

  INSERT INTO public.pemeriksaan(
    pemeriksaan_id,usaha_id,jenis_pemeriksaan,detail_pengembalian_id,
    unit_barang_id,diperiksa_at,diperiksa_by_admin_id,
    hasil,kelengkapan_status,keputusan_operasional,catatan
  ) VALUES (
    v_inspection_id,p_usaha_id,'acquisition',NULL,
    p_unit_barang_id,now(),v_admin_id,
    'pending','unknown','review',NULL
  );

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,
    entity_type,entity_id,source_application,request_id,change_summary
  ) VALUES (
    p_usaha_id,v_auth_user_id,v_admin_id,'start_acquisition_inspection',
    'pemeriksaan',v_inspection_id,'admin-command',p_request_id,
    jsonb_build_object(
      'jenis_pemeriksaan','acquisition',
      'unit_barang_id',p_unit_barang_id
    )
  );

  INSERT INTO public.outbox_event(
    usaha_id,event_type,aggregate_type,aggregate_id,payload
  ) VALUES (
    p_usaha_id,'inspection.acquisition.started','pemeriksaan',v_inspection_id,
    jsonb_build_object(
      'pemeriksaan_id',v_inspection_id,
      'jenis_pemeriksaan','acquisition',
      'unit_barang_id',p_unit_barang_id
    )
  );

  v_response:=jsonb_build_object(
    'pemeriksaan_id',v_inspection_id,
    'detail_pengembalian_id',NULL,
    'unit_barang_id',p_unit_barang_id,
    'jenis_pemeriksaan','acquisition',
    'state','in_progress',
    'reused_draft',false
  );

  UPDATE public.idempotency_key SET response_status=200,response_body=v_response WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$


CREATE OR REPLACE FUNCTION app_private.command_complete_acquisition_inspection(p_usaha_id uuid, p_pemeriksaan_id uuid, p_hasil text, p_kelengkapan_status text, p_keputusan_operasional text, p_catatan text, p_findings jsonb, p_idempotency_key text, p_request_id uuid, p_expected_inspection_updated_at timestamp with time zone, p_expected_unit_updated_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_inspection public.pemeriksaan%ROWTYPE;
  v_unit public.unit_barang%ROWTYPE;
  v_idempotency_id uuid;
  v_request_hash text;
  v_response jsonb;
  v_finding jsonb;
  v_findings jsonb := COALESCE(p_findings,'[]'::jsonb);
  v_findings_count integer:=0;
  v_finding_ids uuid[]:=ARRAY[]::uuid[];
  v_has_non_normal boolean:=false;
  v_reinspection boolean:=false;
  v_reinspection_source uuid;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;

  IF p_usaha_id IS NULL OR p_pemeriksaan_id IS NULL
     OR p_hasil IS NULL OR p_kelengkapan_status IS NULL OR p_keputusan_operasional IS NULL
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key)=''
     OR p_request_id IS NULL
     OR p_expected_inspection_updated_at IS NULL OR p_expected_unit_updated_at IS NULL
  THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: konteks acquisition inspection dan expected state wajib diisi' USING ERRCODE='22023';
  END IF;

  IF jsonb_typeof(v_findings) <> 'array' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: findings harus berupa array' USING ERRCODE='22023';
  END IF;

  IF p_hasil NOT IN ('normal','issue_found') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: hasil pemeriksaan harus normal atau issue_found' USING ERRCODE='22023';
  END IF;

  IF p_kelengkapan_status NOT IN ('complete','incomplete','unknown') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: kelengkapan_status tidak dikenali' USING ERRCODE='22023';
  END IF;

  IF p_keputusan_operasional NOT IN (
    'ready_review','cleaning_required','maintenance_required','unavailable','follow_up_required','no_action','readiness_review'
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: keputusan_operasional tidak dikenali' USING ERRCODE='22023';
  END IF;

  v_request_hash:=md5(jsonb_build_object(
    'usaha_id',p_usaha_id,
    'pemeriksaan_id',p_pemeriksaan_id,
    'hasil',p_hasil,
    'kelengkapan_status',p_kelengkapan_status,
    'keputusan_operasional',p_keputusan_operasional,
    'catatan',nullif(btrim(coalesce(p_catatan,'')),''),
    'findings',v_findings,
    'expected_inspection_updated_at',p_expected_inspection_updated_at,
    'expected_unit_updated_at',p_expected_unit_updated_at
  )::text);

  SELECT aa.akun_admin_id INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id=aa.akun_admin_id
   AND ku.usaha_id=p_usaha_id
   AND ku.status='active'
   AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id=v_auth_user_id
    AND aa.status='active';

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.idempotency_key(
    usaha_id,actor_auth_user_id,key,command_name,request_hash
  ) VALUES (
    p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'complete_acquisition_inspection',v_request_hash
  )
  ON CONFLICT (usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body,request_hash
    INTO v_response,v_request_hash
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id
      AND actor_auth_user_id=v_auth_user_id
      AND command_name='complete_acquisition_inspection'
      AND key=btrim(p_idempotency_key);

    IF v_request_hash IS DISTINCT FROM md5(jsonb_build_object(
      'usaha_id',p_usaha_id,
      'p_pemeriksaan_id',p_pemeriksaan_id,
      'hasil',p_hasil,
      'kelengkapan_status',p_kelengkapan_status,
      'keputusan_operasional',p_keputusan_operasional,
      'catatan',nullif(btrim(coalesce(p_catatan,'')),''),
      'findings',v_findings,
      'expected_inspection_updated_at',p_expected_inspection_updated_at,
      'expected_unit_updated_at',p_expected_unit_updated_at
    )::text) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;

    IF v_response IS NOT NULL THEN RETURN v_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: complete acquisition inspection memiliki idempotency record tanpa response' USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_usaha_id::text||':inspection:acquisition:'||p_pemeriksaan_id::text,0)
  );

  SELECT * INTO v_inspection
  FROM public.pemeriksaan
  WHERE usaha_id=p_usaha_id
    AND pemeriksaan_id=p_pemeriksaan_id
    AND jenis_pemeriksaan='acquisition'
    AND detail_pengembalian_id IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: pemeriksaan acquisition tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  SELECT * INTO v_unit
  FROM public.unit_barang
  WHERE usaha_id=p_usaha_id
    AND unit_barang_id=v_inspection.unit_barang_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: unit acquisition inspection tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  IF v_inspection.updated_at IS DISTINCT FROM p_expected_inspection_updated_at
     OR v_unit.updated_at IS DISTINCT FROM p_expected_unit_updated_at
  THEN
    RAISE EXCEPTION 'STALE_DATA: data pemeriksaan atau unit berubah sejak halaman dibuka. Muat ulang sebelum menyimpan.' USING ERRCODE='40001';
  END IF;

  IF v_inspection.hasil <> 'pending' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: acquisition inspection bukan lagi berada pada state in_progress' USING ERRCODE='23514';
  END IF;

  IF v_unit.status <> 'inspection_pending' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: unit tidak lagi berada pada state inspection_pending' USING ERRCODE='23514';
  END IF;

  FOR v_finding IN SELECT value FROM jsonb_array_elements(v_findings)
  LOOP
    IF jsonb_typeof(v_finding) <> 'object'
       OR nullif(btrim(coalesce(v_finding->>'jenis_temuan','')),'') IS NULL
       OR nullif(btrim(coalesce(v_finding->>'deskripsi','')),'') IS NULL
    THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: setiap finding memerlukan jenis_temuan dan deskripsi' USING ERRCODE='22023';
    END IF;

    IF v_finding->>'jenis_temuan' NOT IN ('damage','loss','missing_component','dirty','other') THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: jenis_temuan tidak dikenali: %',v_finding->>'jenis_temuan' USING ERRCODE='22023';
    END IF;

    IF v_finding ? 'nominal_potensi_biaya'
       AND (v_finding->>'nominal_potensi_biaya') IS NOT NULL
       AND (v_finding->>'nominal_potensi_biaya') <> ''
       AND (v_finding->>'nominal_potensi_biaya')::numeric < 0
    THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: nominal_potensi_biaya tidak boleh negatif' USING ERRCODE='22023';
    END IF;

    IF (v_finding->>'jenis_temuan') <> 'normal' THEN
      v_has_non_normal:=true;
    END IF;
    v_findings_count:=v_findings_count+1;
  END LOOP;

  IF p_hasil='normal' AND v_findings_count>0 THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: hasil normal tidak boleh memiliki finding non-empty' USING ERRCODE='23514';
  END IF;

  IF p_hasil='issue_found' AND v_findings_count=0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: issue_found harus memiliki minimal satu finding' USING ERRCODE='22023';
  END IF;

  IF p_hasil='normal' AND v_has_non_normal THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: finding non-normal tidak konsisten dengan hasil normal' USING ERRCODE='23514';
  END IF;

  IF p_keputusan_operasional='maintenance_required' AND v_findings_count=0 THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: maintenance_required harus dapat ditelusuri ke finding' USING ERRCODE='23514';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.pemeriksaan p
    WHERE p.usaha_id=p_usaha_id
      AND p.jenis_pemeriksaan='acquisition'
      AND p.unit_barang_id=v_inspection.unit_barang_id
      AND p.pemeriksaan_id<>p_pemeriksaan_id
      AND p.hasil<>'pending'
  ) INTO v_reinspection;

  SELECT p.pemeriksaan_id
  INTO v_reinspection_source
  FROM public.pemeriksaan p
  WHERE p.usaha_id=p_usaha_id
    AND p.jenis_pemeriksaan='acquisition'
    AND p.unit_barang_id=v_inspection.unit_barang_id
    AND p.pemeriksaan_id<>p_pemeriksaan_id
    AND p.hasil<>'pending'
  ORDER BY p.diperiksa_at DESC
  LIMIT 1;

  UPDATE public.pemeriksaan
  SET diperiksa_at=now(),
      diperiksa_by_admin_id=v_admin_id,
      hasil=p_hasil,
      kelengkapan_status=p_kelengkapan_status,
      keputusan_operasional=p_keputusan_operasional,
      catatan=nullif(btrim(coalesce(p_catatan,'')),'')
  WHERE usaha_id=p_usaha_id
    AND pemeriksaan_id=p_pemeriksaan_id;

  DELETE FROM public.temuan_pemeriksaan
  WHERE usaha_id=p_usaha_id
    AND pemeriksaan_id=p_pemeriksaan_id;

  FOR v_finding IN SELECT value FROM jsonb_array_elements(v_findings)
  LOOP
    INSERT INTO public.temuan_pemeriksaan(
      usaha_id,pemeriksaan_id,jenis_temuan,deskripsi,tingkat,
      status_tindak_lanjut,nominal_potensi_biaya,currency_code
    ) VALUES (
      p_usaha_id,p_pemeriksaan_id,
      btrim(v_finding->>'jenis_temuan'),
      btrim(v_finding->>'deskripsi'),
      nullif(btrim(coalesce(v_finding->>'tingkat','')),''),
      COALESCE(NULLIF(btrim(coalesce(v_finding->>'status_tindak_lanjut','')),''),'open'),
      CASE WHEN v_finding->>'nominal_potensi_biaya' IS NULL OR v_finding->>'nominal_potensi_biaya'=''
           THEN NULL ELSE (v_finding->>'nominal_potensi_biaya')::numeric END,
      COALESCE(NULLIF(btrim(coalesce(v_finding->>'currency_code','')),''),'IDR')
    )
    RETURNING temuan_pemeriksaan_id INTO v_reinspection_source;
    v_finding_ids:=array_append(v_finding_ids,v_reinspection_source);
  END LOOP;

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,
    entity_type,entity_id,source_application,request_id,change_summary
  ) VALUES (
    p_usaha_id,v_auth_user_id,v_admin_id,'complete_acquisition_inspection',
    'pemeriksaan',p_pemeriksaan_id,'admin-command',p_request_id,
    jsonb_build_object(
      'jenis_pemeriksaan','acquisition',
      'unit_barang_id',v_inspection.unit_barang_id,
      'hasil',p_hasil,
      'kelengkapan_status',p_kelengkapan_status,
      'keputusan_operasional',p_keputusan_operasional,
      'finding_count',v_findings_count,
      'finding_ids',v_finding_ids,
      'reinspection',v_reinspection,
      'reinspection_source_id',v_reinspection_source
    )
  );

  INSERT INTO public.outbox_event(
    usaha_id,event_type,aggregate_type,aggregate_id,payload
  ) VALUES (
    p_usaha_id,'inspection.acquisition.completed','pemeriksaan',p_pemeriksaan_id,
    jsonb_build_object(
      'pemeriksaan_id',p_pemeriksaan_id,
      'jenis_pemeriksaan','acquisition',
      'unit_barang_id',v_inspection.unit_barang_id,
      'hasil',p_hasil,
      'kelengkapan_status',p_kelengkapan_status,
      'keputusan_operasional',p_keputusan_operasional,
      'finding_count',v_findings_count,
      'finding_ids',v_finding_ids,
      'reinspection',v_reinspection,
      'reinspection_source_id',v_reinspection_source
    )
  );

  IF p_keputusan_operasional='maintenance_required' THEN
    INSERT INTO public.outbox_event(
      usaha_id,event_type,aggregate_type,aggregate_id,payload
    ) VALUES (
      p_usaha_id,'inspection.maintenance_required','pemeriksaan',p_pemeriksaan_id,
      jsonb_build_object(
        'pemeriksaan_id',p_pemeriksaan_id,
        'jenis_pemeriksaan','acquisition',
        'unit_barang_id',v_inspection.unit_barang_id,
        'finding_ids',v_finding_ids
      )
    );
  END IF;

  v_response:=jsonb_build_object(
    'pemeriksaan_id',p_pemeriksaan_id,
    'detail_pengembalian_id',NULL,
    'unit_barang_id',v_inspection.unit_barang_id,
    'jenis_pemeriksaan','acquisition',
    'state','completed',
    'hasil',p_hasil,
    'kelengkapan_status',p_kelengkapan_status,
    'keputusan_operasional',p_keputusan_operasional,
    'finding_ids',v_finding_ids,
    'finding_count',v_findings_count,
    'reinspection',v_reinspection,
    'reinspection_source_id',v_reinspection_source
  );

  UPDATE public.idempotency_key SET response_status=200,response_body=v_response WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$


CREATE OR REPLACE FUNCTION app_private.command_correct_inventory_condition_summary(p_usaha_id uuid, p_unit_barang_id uuid, p_new_condition text, p_correction_reason text, p_correction_note text, p_source_pemeriksaan_id uuid, p_expected_updated_at timestamp with time zone, p_idempotency_key text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_unit public.unit_barang%ROWTYPE;
  v_source public.pemeriksaan%ROWTYPE;
  v_old_condition text;
  v_idempotency_id uuid;
  v_request_hash text;
  v_response jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;

  IF p_usaha_id IS NULL OR p_unit_barang_id IS NULL
     OR p_expected_updated_at IS NULL OR p_idempotency_key IS NULL OR btrim(p_idempotency_key)=''
     OR p_request_id IS NULL
     OR nullif(btrim(coalesce(p_new_condition,'')),'') IS NULL
     OR nullif(btrim(coalesce(p_correction_reason,'')),'') IS NULL
  THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: unit, kondisi baru, alasan koreksi, expected_updated_at, request_id, dan idempotency_key wajib diisi' USING ERRCODE='22023';
  END IF;

  SELECT aa.akun_admin_id INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id=aa.akun_admin_id
   AND ku.usaha_id=p_usaha_id
   AND ku.status='active'
   AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id=v_auth_user_id
    AND aa.status='active';

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501';
  END IF;

  v_request_hash:=md5(jsonb_build_object(
    'usaha_id',p_usaha_id,
    'unit_barang_id',p_unit_barang_id,
    'new_condition',btrim(p_new_condition),
    'correction_reason',btrim(p_correction_reason),
    'correction_note',nullif(btrim(coalesce(p_correction_note,'')),''),
    'source_pemeriksaan_id',p_source_pemeriksaan_id,
    'expected_updated_at',p_expected_updated_at
  )::text);

  INSERT INTO public.idempotency_key(
    usaha_id,actor_auth_user_id,key,command_name,request_hash
  ) VALUES (
    p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'correct_inventory_condition_summary',v_request_hash
  )
  ON CONFLICT (usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body,request_hash
    INTO v_response,v_request_hash
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id
      AND actor_auth_user_id=v_auth_user_id
      AND command_name='correct_inventory_condition_summary'
      AND key=btrim(p_idempotency_key);

    IF v_request_hash IS DISTINCT FROM md5(jsonb_build_object(
      'usaha_id',p_usaha_id,
      'unit_barang_id',p_unit_barang_id,
      'new_condition',btrim(p_new_condition),
      'correction_reason',btrim(p_correction_reason),
      'correction_note',nullif(btrim(coalesce(p_correction_note,'')),''),
      'source_pemeriksaan_id',p_source_pemeriksaan_id,
      'expected_updated_at',p_expected_updated_at
    )::text) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_response IS NOT NULL THEN RETURN v_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: koreksi kondisi memiliki idempotency record tanpa response' USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_usaha_id::text||':unit-condition:'||p_unit_barang_id::text,0)
  );

  SELECT * INTO v_unit
  FROM public.unit_barang
  WHERE usaha_id=p_usaha_id AND unit_barang_id=p_unit_barang_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: unit tidak ditemukan dalam Usaha aktif' USING ERRCODE='P0002';
  END IF;

  IF v_unit.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_DATA: unit berubah sejak data dibuka. Muat ulang state terbaru sebelum koreksi.' USING ERRCODE='40001';
  END IF;

  IF p_source_pemeriksaan_id IS NOT NULL THEN
    SELECT * INTO v_source
    FROM public.pemeriksaan
    WHERE usaha_id=p_usaha_id
      AND pemeriksaan_id=p_source_pemeriksaan_id
      AND unit_barang_id=p_unit_barang_id
      AND hasil<>'pending'
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: source pemeriksaan tidak valid untuk koreksi kondisi' USING ERRCODE='23514';
    END IF;
  END IF;

  v_old_condition:=v_unit.kondisi_ringkas;

  IF v_old_condition IS NOT DISTINCT FROM btrim(p_new_condition) THEN
    v_response:=jsonb_build_object(
      'unit_barang_id',p_unit_barang_id,
      'status',v_unit.status,
      'kondisi_ringkas',v_old_condition,
      'old_kondisi_ringkas',v_old_condition,
      'new_kondisi_ringkas',btrim(p_new_condition),
      'state','unchanged'
    );
    UPDATE public.idempotency_key SET response_status=200,response_body=v_response WHERE idempotency_key_id=v_idempotency_id;
    RETURN v_response;
  END IF;

  UPDATE public.unit_barang
  SET kondisi_ringkas=btrim(p_new_condition)
  WHERE usaha_id=p_usaha_id AND unit_barang_id=p_unit_barang_id;

  INSERT INTO public.riwayat_unit(
    usaha_id,unit_barang_id,jenis_kejadian,terjadi_at,
    status_sebelum,status_sesudah,lokasi_sebelum_id,lokasi_sesudah_id,
    sumber_type,sumber_id,actor_akun_admin_id,catatan,metadata
  ) VALUES (
    p_usaha_id,p_unit_barang_id,'condition_corrected',now(),
    v_unit.status,v_unit.status,v_unit.lokasi_id,v_unit.lokasi_id,
    CASE WHEN p_source_pemeriksaan_id IS NULL THEN 'manual_recovery' ELSE 'pemeriksaan' END,
    p_source_pemeriksaan_id,
    v_admin_id,
    nullif(btrim(p_correction_note),''),
    jsonb_build_object(
      'old_kondisi_ringkas',v_old_condition,
      'new_kondisi_ringkas',btrim(p_new_condition),
      'correction_reason',btrim(p_correction_reason),
      'source_pemeriksaan_id',p_source_pemeriksaan_id
    )
  );

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,
    entity_type,entity_id,source_application,request_id,change_summary
  ) VALUES (
    p_usaha_id,v_auth_user_id,v_admin_id,'correct_inventory_condition_summary',
    'unit_barang',p_unit_barang_id,'admin-command',p_request_id,
    jsonb_build_object(
      'old_kondisi_ringkas',v_old_condition,
      'new_kondisi_ringkas',btrim(p_new_condition),
      'correction_reason',btrim(p_correction_reason),
      'source_pemeriksaan_id',p_source_pemeriksaan_id
    )
  );

  INSERT INTO public.outbox_event(
    usaha_id,event_type,aggregate_type,aggregate_id,payload
  ) VALUES (
    p_usaha_id,'inventory.condition_summary_corrected','unit_barang',p_unit_barang_id,
    jsonb_build_object(
      'unit_barang_id',p_unit_barang_id,
      'old_kondisi_ringkas',v_old_condition,
      'new_kondisi_ringkas',btrim(p_new_condition),
      'correction_reason',btrim(p_correction_reason),
      'source_pemeriksaan_id',p_source_pemeriksaan_id
    )
  );

  v_response:=jsonb_build_object(
    'unit_barang_id',p_unit_barang_id,
    'status',v_unit.status,
    'kondisi_ringkas',btrim(p_new_condition),
    'old_kondisi_ringkas',v_old_condition,
    'new_kondisi_ringkas',btrim(p_new_condition),
    'state','corrected',
    'source_pemeriksaan_id',p_source_pemeriksaan_id
  );

  UPDATE public.idempotency_key SET response_status=200,response_body=v_response WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$


CREATE OR REPLACE FUNCTION app_private.command_reconcile_inspection_mutation(p_usaha_id uuid, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid:=auth.uid();
  v_row public.idempotency_key%ROWTYPE;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id=aa.akun_admin_id
     AND ku.usaha_id=p_usaha_id
     AND ku.status='active'
     AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id=v_auth_user_id AND aa.status='active'
  ) THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_row
  FROM public.idempotency_key
  WHERE usaha_id=p_usaha_id
    AND actor_auth_user_id=v_auth_user_id
    AND key=btrim(p_idempotency_key)
    AND command_name IN (
      'start_inspection',
      'complete_inspection',
      'attach_inspection_evidence',
      'start_acquisition_inspection',
      'complete_acquisition_inspection'
    )
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state','not_found','response',null);
  END IF;

  RETURN jsonb_build_object(
    'state',CASE WHEN v_row.response_body IS NULL THEN 'unknown' ELSE 'committed' END,
    'response',v_row.response_body,
    'command_name',v_row.command_name
  );
END;
$function$


CREATE OR REPLACE FUNCTION app_private.command_reconcile_inventory_condition_mutation(p_usaha_id uuid, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid:=auth.uid();
  v_row public.idempotency_key%ROWTYPE;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id=aa.akun_admin_id
     AND ku.usaha_id=p_usaha_id
     AND ku.status='active'
     AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id=v_auth_user_id AND aa.status='active'
  ) THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_row
  FROM public.idempotency_key
  WHERE usaha_id=p_usaha_id
    AND actor_auth_user_id=v_auth_user_id
    AND key=btrim(p_idempotency_key)
    AND command_name='correct_inventory_condition_summary'
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state','not_found','response',null);
  END IF;

  RETURN jsonb_build_object(
    'state',CASE WHEN v_row.response_body IS NULL THEN 'unknown' ELSE 'committed' END,
    'response',v_row.response_body,
    'command_name',v_row.command_name
  );
END;
$function$


REVOKE ALL ON FUNCTION app_private.command_start_acquisition_inspection(uuid,uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_start_acquisition_inspection(uuid,uuid,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_start_acquisition_inspection(uuid,uuid,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_start_acquisition_inspection(uuid,uuid,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_complete_acquisition_inspection(uuid,uuid,text,text,text,text,jsonb,text,uuid,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_complete_acquisition_inspection(uuid,uuid,text,text,text,text,jsonb,text,uuid,timestamptz,timestamptz) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_complete_acquisition_inspection(uuid,uuid,text,text,text,text,jsonb,text,uuid,timestamptz,timestamptz) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_complete_acquisition_inspection(uuid,uuid,text,text,text,text,jsonb,text,uuid,timestamptz,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_correct_inventory_condition_summary(uuid,uuid,text,text,text,uuid,timestamptz,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_correct_inventory_condition_summary(uuid,uuid,text,text,text,uuid,timestamptz,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_correct_inventory_condition_summary(uuid,uuid,text,text,text,uuid,timestamptz,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_correct_inventory_condition_summary(uuid,uuid,text,text,text,uuid,timestamptz,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_reconcile_inventory_condition_mutation(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_reconcile_inventory_condition_mutation(uuid,text) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_reconcile_inventory_condition_mutation(uuid,text) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_reconcile_inventory_condition_mutation(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_reconcile_inspection_mutation(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_reconcile_inspection_mutation(uuid,text) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_reconcile_inspection_mutation(uuid,text) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_reconcile_inspection_mutation(uuid,text) TO authenticated;
