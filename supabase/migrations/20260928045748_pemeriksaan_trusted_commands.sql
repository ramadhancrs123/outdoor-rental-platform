-- Pemeriksaan trusted command slice.
-- Contract:
-- Return -> Inspection -> Inventory readiness review / Maintenance handoff.
-- Inspection never directly sets unit READY and never creates finance facts.

CREATE OR REPLACE FUNCTION app_private.command_start_inspection(
  p_usaha_id uuid,
  p_detail_pengembalian_id uuid,
  p_unit_barang_id uuid,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_detail public.detail_pengembalian%ROWTYPE;
  v_unit public.unit_barang%ROWTYPE;
  v_existing public.pemeriksaan%ROWTYPE;
  v_inspection_id uuid;
  v_request_hash text;
  v_idempotency_id uuid;
  v_response jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;

  IF p_usaha_id IS NULL OR p_detail_pengembalian_id IS NULL OR p_unit_barang_id IS NULL
     OR p_request_id IS NULL OR p_idempotency_key IS NULL OR btrim(p_idempotency_key)=''
  THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tenant, return detail, unit, request_id, dan idempotency_key wajib diisi' USING ERRCODE='22023';
  END IF;

  SELECT aa.akun_admin_id
  INTO v_admin_id
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

  v_request_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,
    'detail_pengembalian_id',p_detail_pengembalian_id,
    'unit_barang_id',p_unit_barang_id
  )::text);

  INSERT INTO public.idempotency_key(
    usaha_id,actor_auth_user_id,key,command_name,request_hash
  ) VALUES (
    p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'start_inspection',v_request_hash
  )
  ON CONFLICT (usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body,ik.request_hash
    INTO v_response,v_request_hash
    FROM public.idempotency_key ik
    WHERE ik.usaha_id=p_usaha_id
      AND ik.actor_auth_user_id=v_auth_user_id
      AND ik.command_name='start_inspection'
      AND ik.key=btrim(p_idempotency_key);

    IF v_request_hash IS DISTINCT FROM md5(jsonb_build_object(
      'usaha_id',p_usaha_id,
      'detail_pengembalian_id',p_detail_pengembalian_id,
      'unit_barang_id',p_unit_barang_id
    )::text) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;

    IF v_response IS NOT NULL THEN RETURN v_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: start inspection memiliki idempotency record tanpa response' USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_usaha_id::text||':inspection:'||p_unit_barang_id::text,0)
  );

  SELECT * INTO v_detail
  FROM public.detail_pengembalian
  WHERE usaha_id=p_usaha_id
    AND detail_pengembalian_id=p_detail_pengembalian_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: detail pengembalian tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  IF v_detail.unit_barang_id IS DISTINCT FROM p_unit_barang_id THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: unit inspection tidak cocok dengan unit return detail' USING ERRCODE='23514';
  END IF;

  IF v_detail.diterima_at IS NULL THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: unit belum tercatat diterima sehingga pemeriksaan belum dapat dimulai' USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_unit
  FROM public.unit_barang
  WHERE usaha_id=p_usaha_id
    AND unit_barang_id=p_unit_barang_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: unit tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  IF v_unit.status <> 'inspection_pending' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: unit tidak berada pada state inspection_pending' USING ERRCODE='23514';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.pemeriksaan
  WHERE usaha_id=p_usaha_id
    AND detail_pengembalian_id=p_detail_pengembalian_id
    AND hasil='pending'
  ORDER BY diperiksa_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.detail_pengembalian
    SET status_pemeriksaan='in_progress'
    WHERE usaha_id=p_usaha_id
      AND detail_pengembalian_id=p_detail_pengembalian_id;

    v_response:=jsonb_build_object(
      'pemeriksaan_id',v_existing.pemeriksaan_id,
      'detail_pengembalian_id',p_detail_pengembalian_id,
      'unit_barang_id',p_unit_barang_id,
      'state','in_progress',
      'reused_draft',true
    );

    UPDATE public.idempotency_key SET response_status=200,response_body=v_response
    WHERE idempotency_key_id=v_idempotency_id;
    RETURN v_response;
  END IF;

  SELECT p.*
  INTO v_existing
  FROM public.pemeriksaan p
  WHERE p.usaha_id=p_usaha_id
    AND p.detail_pengembalian_id=p_detail_pengembalian_id
  ORDER BY p.diperiksa_at DESC
  LIMIT 1;

  IF FOUND AND v_unit.updated_at <= v_existing.diperiksa_at THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: pemeriksaan terakhir masih merepresentasikan state unit saat ini. Tunggu perubahan workflow sebelum reinspection.' USING ERRCODE='23514';
  END IF;

  v_inspection_id:=gen_random_uuid();

  INSERT INTO public.pemeriksaan(
    pemeriksaan_id,usaha_id,detail_pengembalian_id,unit_barang_id,
    diperiksa_at,diperiksa_by_admin_id,hasil,kelengkapan_status,keputusan_operasional,catatan
  ) VALUES (
    v_inspection_id,p_usaha_id,p_detail_pengembalian_id,p_unit_barang_id,
    now(),v_admin_id,'pending','unknown','review',NULL
  );

  UPDATE public.detail_pengembalian
  SET status_pemeriksaan='in_progress'
  WHERE usaha_id=p_usaha_id
    AND detail_pengembalian_id=p_detail_pengembalian_id;

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,
    entity_type,entity_id,source_application,request_id,change_summary
  ) VALUES (
    p_usaha_id,v_auth_user_id,v_admin_id,'start_inspection',
    'pemeriksaan',v_inspection_id,'admin-command',p_request_id,
    jsonb_build_object(
      'detail_pengembalian_id',p_detail_pengembalian_id,
      'unit_barang_id',p_unit_barang_id
    )
  );

  INSERT INTO public.outbox_event(
    usaha_id,event_type,aggregate_type,aggregate_id,payload
  ) VALUES (
    p_usaha_id,'inspection.started','pemeriksaan',v_inspection_id,
    jsonb_build_object(
      'pemeriksaan_id',v_inspection_id,
      'detail_pengembalian_id',p_detail_pengembalian_id,
      'unit_barang_id',p_unit_barang_id
    )
  );

  v_response:=jsonb_build_object(
    'pemeriksaan_id',v_inspection_id,
    'detail_pengembalian_id',p_detail_pengembalian_id,
    'unit_barang_id',p_unit_barang_id,
    'state','in_progress',
    'reused_draft',false
  );

  UPDATE public.idempotency_key SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_complete_inspection(
  p_usaha_id uuid,
  p_pemeriksaan_id uuid,
  p_hasil text,
  p_kelengkapan_status text,
  p_keputusan_operasional text,
  p_catatan text,
  p_findings jsonb,
  p_idempotency_key text,
  p_request_id uuid,
  p_expected_inspection_updated_at timestamptz,
  p_expected_unit_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_inspection public.pemeriksaan%ROWTYPE;
  v_detail public.detail_pengembalian%ROWTYPE;
  v_unit public.unit_barang%ROWTYPE;
  v_request_hash text;
  v_idempotency_id uuid;
  v_response jsonb;
  v_findings jsonb := COALESCE(p_findings,'[]'::jsonb);
  v_finding jsonb;
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
    RAISE EXCEPTION 'VALIDATION_ERROR: konteks inspection dan expected state wajib diisi' USING ERRCODE='22023';
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

  SELECT aa.akun_admin_id
  INTO v_admin_id
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
    p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'complete_inspection',v_request_hash
  )
  ON CONFLICT (usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body,ik.request_hash
    INTO v_response,v_request_hash
    FROM public.idempotency_key ik
    WHERE ik.usaha_id=p_usaha_id
      AND ik.actor_auth_user_id=v_auth_user_id
      AND ik.command_name='complete_inspection'
      AND ik.key=btrim(p_idempotency_key);

    IF v_request_hash IS DISTINCT FROM md5(jsonb_build_object(
      'usaha_id',p_usaha_id,
      'pemeriksaan_id',p_pemeriksaan_id,
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
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: complete inspection memiliki idempotency record tanpa response' USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_usaha_id::text||':inspection:'||p_pemeriksaan_id::text,0)
  );

  SELECT * INTO v_inspection
  FROM public.pemeriksaan
  WHERE usaha_id=p_usaha_id
    AND pemeriksaan_id=p_pemeriksaan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: pemeriksaan tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  IF v_inspection.diperiksa_by_admin_id IS NULL THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: pemeriksaan belum memiliki actor' USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_detail
  FROM public.detail_pengembalian
  WHERE usaha_id=v_inspection.usaha_id
    AND detail_pengembalian_id=v_inspection.detail_pengembalian_id
  FOR UPDATE;

  IF NOT FOUND OR v_detail.unit_barang_id IS DISTINCT FROM v_inspection.unit_barang_id OR v_detail.diterima_at IS NULL THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: pemeriksaan tidak lagi memiliki return prerequisite yang valid' USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_unit
  FROM public.unit_barang
  WHERE usaha_id=p_usaha_id
    AND unit_barang_id=v_inspection.unit_barang_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: unit pemeriksaan tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  IF v_inspection.updated_at IS DISTINCT FROM p_expected_inspection_updated_at
     OR v_unit.updated_at IS DISTINCT FROM p_expected_unit_updated_at
  THEN
    RAISE EXCEPTION 'STALE_DATA: data pemeriksaan atau unit berubah sejak halaman dibuka. Muat ulang sebelum menyimpan.' USING ERRCODE='40001';
  END IF;

  IF v_inspection.hasil <> 'pending' OR v_detail.status_pemeriksaan <> 'in_progress' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: pemeriksaan bukan lagi berada pada state in_progress' USING ERRCODE='23514';
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

    IF v_finding->>'jenis_temuan' NOT IN ('normal','damage','loss','missing_component','dirty','other') THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: jenis_temuan tidak dikenali: %',v_finding->>'jenis_temuan' USING ERRCODE='22023';
    END IF;

    IF v_finding ? 'nominal_potensi_biaya'
       AND (v_finding->>'nominal_potensi_biaya') IS NOT NULL
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
    SELECT 1
    FROM public.pemeriksaan p
    WHERE p.usaha_id=p_usaha_id
      AND p.detail_pengembalian_id=v_detail.detail_pengembalian_id
      AND p.pemeriksaan_id<>p_pemeriksaan_id
      AND p.hasil<>'pending'
  ) INTO v_reinspection;

  SELECT p.pemeriksaan_id
  INTO v_reinspection_source
  FROM public.pemeriksaan p
  WHERE p.usaha_id=p_usaha_id
    AND p.detail_pengembalian_id=v_detail.detail_pengembalian_id
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

  UPDATE public.detail_pengembalian
  SET status_pemeriksaan='completed'
  WHERE usaha_id=p_usaha_id
    AND detail_pengembalian_id=v_detail.detail_pengembalian_id;

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,
    entity_type,entity_id,source_application,request_id,change_summary
  ) VALUES (
    p_usaha_id,v_auth_user_id,v_admin_id,'complete_inspection',
    'pemeriksaan',p_pemeriksaan_id,'admin-command',p_request_id,
    jsonb_build_object(
      'detail_pengembalian_id',v_detail.detail_pengembalian_id,
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
    p_usaha_id,'inspection.completed','pemeriksaan',p_pemeriksaan_id,
    jsonb_build_object(
      'pemeriksaan_id',p_pemeriksaan_id,
      'detail_pengembalian_id',v_detail.detail_pengembalian_id,
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
        'unit_barang_id',v_inspection.unit_barang_id,
        'detail_pengembalian_id',v_detail.detail_pengembalian_id,
        'finding_ids',v_finding_ids
      )
    );
  END IF;

  v_response:=jsonb_build_object(
    'pemeriksaan_id',p_pemeriksaan_id,
    'detail_pengembalian_id',v_detail.detail_pengembalian_id,
    'unit_barang_id',v_inspection.unit_barang_id,
    'state','completed',
    'hasil',p_hasil,
    'kelengkapan_status',p_kelengkapan_status,
    'keputusan_operasional',p_keputusan_operasional,
    'finding_ids',v_finding_ids,
    'finding_count',v_findings_count,
    'reinspection',v_reinspection,
    'reinspection_source_id',v_reinspection_source
  );

  UPDATE public.idempotency_key SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_attach_inspection_evidence(
  p_usaha_id uuid,
  p_pemeriksaan_id uuid,
  p_bukti_foto_kondisi_id uuid,
  p_unit_barang_id uuid,
  p_jenis_foto text,
  p_storage_bucket text,
  p_storage_path text,
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
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_inspection public.pemeriksaan%ROWTYPE;
  v_request_hash text;
  v_idempotency_id uuid;
  v_response jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;

  IF p_usaha_id IS NULL OR p_pemeriksaan_id IS NULL OR p_bukti_foto_kondisi_id IS NULL
     OR p_unit_barang_id IS NULL OR p_jenis_foto IS NULL
     OR p_storage_bucket IS NULL OR p_storage_path IS NULL
     OR p_request_id IS NULL OR p_idempotency_key IS NULL OR btrim(p_idempotency_key)=''
  THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: metadata evidence wajib lengkap' USING ERRCODE='22023';
  END IF;

  IF p_storage_bucket <> 'rental-private-condition' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: bucket evidence pemeriksaan tidak valid' USING ERRCODE='22023';
  END IF;

  IF p_storage_path NOT LIKE p_usaha_id::text||'/'||p_pemeriksaan_id::text||'/'||p_bukti_foto_kondisi_id::text||'/%' THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: storage path tidak sesuai tenant dan inspection' USING ERRCODE='42501';
  END IF;

  SELECT aa.akun_admin_id
  INTO v_admin_id
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
    'usaha_id',p_usaha_id,'pemeriksaan_id',p_pemeriksaan_id,
    'bukti_foto_kondisi_id',p_bukti_foto_kondisi_id,
    'unit_barang_id',p_unit_barang_id,'jenis_foto',p_jenis_foto,
    'storage_bucket',p_storage_bucket,'storage_path',p_storage_path,
    'catatan',nullif(btrim(coalesce(p_catatan,'')),'')
  )::text);

  INSERT INTO public.idempotency_key(
    usaha_id,actor_auth_user_id,key,command_name,request_hash
  ) VALUES (
    p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'attach_inspection_evidence',v_request_hash
  )
  ON CONFLICT (usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body,ik.request_hash
    INTO v_response,v_request_hash
    FROM public.idempotency_key ik
    WHERE ik.usaha_id=p_usaha_id
      AND ik.actor_auth_user_id=v_auth_user_id
      AND ik.command_name='attach_inspection_evidence'
      AND ik.key=btrim(p_idempotency_key);

    IF v_request_hash IS DISTINCT FROM md5(jsonb_build_object(
      'usaha_id',p_usaha_id,'pemeriksaan_id',p_pemeriksaan_id,
      'bukti_foto_kondisi_id',p_bukti_foto_kondisi_id,
      'unit_barang_id',p_unit_barang_id,'jenis_foto',p_jenis_foto,
      'storage_bucket',p_storage_bucket,'storage_path',p_storage_path,
      'catatan',nullif(btrim(coalesce(p_catatan,'')),'')
    )::text) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;

    IF v_response IS NOT NULL THEN RETURN v_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: attach evidence memiliki idempotency record tanpa response' USING ERRCODE='40001';
  END IF;

  SELECT *
  INTO v_inspection
  FROM public.pemeriksaan
  WHERE usaha_id=p_usaha_id
    AND pemeriksaan_id=p_pemeriksaan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: pemeriksaan tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  IF v_inspection.unit_barang_id IS DISTINCT FROM p_unit_barang_id THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: evidence unit tidak sama dengan inspection unit' USING ERRCODE='23514';
  END IF;

  IF v_inspection.hasil NOT IN ('pending') THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: evidence hanya dapat ditambahkan saat inspection masih in_progress' USING ERRCODE='23514';
  END IF;

  IF NOT EXISTS(
    SELECT 1
    FROM storage.objects so
    WHERE so.bucket_id=p_storage_bucket
      AND so.name=p_storage_path
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: object evidence belum ditemukan di storage' USING ERRCODE='P0002';
  END IF;

  INSERT INTO public.bukti_foto_kondisi(
    bukti_foto_kondisi_id,usaha_id,pemeriksaan_id,unit_barang_id,
    jenis_foto,storage_bucket,storage_path,captured_at,captured_by_admin_id,catatan
  ) VALUES (
    p_bukti_foto_kondisi_id,p_usaha_id,p_pemeriksaan_id,p_unit_barang_id,
    btrim(p_jenis_foto),p_storage_bucket,p_storage_path,now(),v_admin_id,
    nullif(btrim(coalesce(p_catatan,'')),'')
  );

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,
    entity_type,entity_id,source_application,request_id,change_summary
  ) VALUES (
    p_usaha_id,v_auth_user_id,v_admin_id,'attach_inspection_evidence',
    'bukti_foto_kondisi',p_bukti_foto_kondisi_id,'admin-command',p_request_id,
    jsonb_build_object(
      'pemeriksaan_id',p_pemeriksaan_id,
      'unit_barang_id',p_unit_barang_id,
      'jenis_foto',p_jenis_foto,
      'storage_bucket',p_storage_bucket,
      'storage_path',p_storage_path
    )
  );

  INSERT INTO public.outbox_event(
    usaha_id,event_type,aggregate_type,aggregate_id,payload
  ) VALUES (
    p_usaha_id,'inspection.evidence_attached','pemeriksaan',p_pemeriksaan_id,
    jsonb_build_object(
      'pemeriksaan_id',p_pemeriksaan_id,
      'bukti_foto_kondisi_id',p_bukti_foto_kondisi_id,
      'unit_barang_id',p_unit_barang_id,
      'storage_bucket',p_storage_bucket,
      'storage_path',p_storage_path,
      'jenis_foto',p_jenis_foto
    )
  );

  v_response:=jsonb_build_object(
    'bukti_foto_kondisi_id',p_bukti_foto_kondisi_id,
    'pemeriksaan_id',p_pemeriksaan_id,
    'unit_barang_id',p_unit_barang_id,
    'storage_bucket',p_storage_bucket,
    'storage_path',p_storage_path,
    'state','attached'
  );

  UPDATE public.idempotency_key SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_reconcile_inspection_mutation(
  p_usaha_id uuid,
  p_idempotency_key text
)
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
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id=aa.akun_admin_id
     AND ku.usaha_id=p_usaha_id
     AND ku.status='active'
     AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id=v_auth_user_id
      AND aa.status='active'
  ) THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501';
  END IF;

  SELECT *
  INTO v_row
  FROM public.idempotency_key
  WHERE usaha_id=p_usaha_id
    AND actor_auth_user_id=v_auth_user_id
    AND key=btrim(p_idempotency_key)
    AND command_name IN ('start_inspection','complete_inspection','attach_inspection_evidence')
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
$function$;

-- Trusted command boundary.
REVOKE ALL ON FUNCTION app_private.command_start_inspection(uuid,uuid,uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_start_inspection(uuid,uuid,uuid,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_start_inspection(uuid,uuid,uuid,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_start_inspection(uuid,uuid,uuid,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_complete_inspection(uuid,uuid,text,text,text,text,jsonb,text,uuid,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_complete_inspection(uuid,uuid,text,text,text,text,jsonb,text,uuid,timestamptz,timestamptz) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_complete_inspection(uuid,uuid,text,text,text,text,jsonb,text,uuid,timestamptz,timestamptz) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_complete_inspection(uuid,uuid,text,text,text,text,jsonb,text,uuid,timestamptz,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_attach_inspection_evidence(uuid,uuid,uuid,uuid,text,text,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_attach_inspection_evidence(uuid,uuid,uuid,uuid,text,text,text,text,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_attach_inspection_evidence(uuid,uuid,uuid,uuid,text,text,text,text,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_attach_inspection_evidence(uuid,uuid,uuid,uuid,text,text,text,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_reconcile_inspection_mutation(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_reconcile_inspection_mutation(uuid,text) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_reconcile_inspection_mutation(uuid,text) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_reconcile_inspection_mutation(uuid,text) TO authenticated;

-- Keep business mutations behind trusted commands.
DROP POLICY IF EXISTS inspection_insert_member ON public.pemeriksaan;
DROP POLICY IF EXISTS inspection_update_member ON public.pemeriksaan;
DROP POLICY IF EXISTS finding_insert_member ON public.temuan_pemeriksaan;
DROP POLICY IF EXISTS finding_update_member ON public.temuan_pemeriksaan;
DROP POLICY IF EXISTS condition_photo_insert_member ON public.bukti_foto_kondisi;
DROP POLICY IF EXISTS condition_photo_update_member ON public.bukti_foto_kondisi;

-- Private evidence storage: tenant-scoped path.
DROP POLICY IF EXISTS condition_object_insert_member ON storage.objects;
DROP POLICY IF EXISTS condition_object_select_member ON storage.objects;

CREATE POLICY condition_object_insert_member
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id='rental-private-condition'
  AND EXISTS (
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id=aa.akun_admin_id
     AND ku.status='active'
     AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id=auth.uid()
      AND aa.status='active'
      AND ku.usaha_id::text=split_part(name,'/',1)
  )
);

CREATE POLICY condition_object_select_member
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id='rental-private-condition'
  AND EXISTS (
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id=aa.akun_admin_id
     AND ku.status='active'
     AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id=auth.uid()
      AND aa.status='active'
      AND ku.usaha_id::text=split_part(name,'/',1)
  )
);

CREATE INDEX IF NOT EXISTS detail_pengembalian_usaha_status_pemeriksaan_idx
ON public.detail_pengembalian(usaha_id,status_pemeriksaan,diterima_at DESC);
