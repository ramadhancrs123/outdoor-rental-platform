CREATE OR REPLACE FUNCTION app_private.command_operational_process_unit_return(p_usaha_id uuid, p_penyewaan_id uuid, p_unit_barang_id uuid, p_hasil text, p_kelengkapan_status text, p_keputusan_operasional text, p_catatan text, p_findings jsonb, p_idempotency_key text, p_request_id uuid, p_expected_rental_updated_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_rental public.penyewaan%ROWTYPE;
  v_unit public.unit_barang%ROWTYPE;
  v_detail_id uuid;
  v_inspection_id uuid;
  v_inspection public.pemeriksaan%ROWTYPE;
  v_maintenance_id uuid;
  v_return_response jsonb;
  v_start_response jsonb;
  v_complete_response jsonb;
  v_ready_response jsonb;
  v_response jsonb;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_readiness_state text := 'blocked';
  v_block_reason text;
  v_findings jsonb := COALESCE(p_findings,'[]'::jsonb);
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;

  IF p_usaha_id IS NULL
     OR p_penyewaan_id IS NULL
     OR p_unit_barang_id IS NULL
     OR p_hasil IS NULL
     OR p_kelengkapan_status IS NULL
     OR p_keputusan_operasional IS NULL
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key)=''
     OR p_request_id IS NULL
     OR p_expected_rental_updated_at IS NULL
  THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: konteks return/inspection wajib lengkap'
      USING ERRCODE='22023';
  END IF;

  IF jsonb_typeof(v_findings) <> 'array' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: findings harus berupa array' USING ERRCODE='22023';
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
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha'
      USING ERRCODE='42501';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,
    'penyewaan_id',p_penyewaan_id,
    'unit_barang_id',p_unit_barang_id,
    'hasil',p_hasil,
    'kelengkapan_status',p_kelengkapan_status,
    'keputusan_operasional',p_keputusan_operasional,
    'catatan',nullif(btrim(coalesce(p_catatan,'')),''),
    'findings',v_findings,
    'expected_rental_updated_at',p_expected_rental_updated_at
  )::text);

  INSERT INTO public.idempotency_key(
    usaha_id,actor_auth_user_id,key,command_name,request_hash
  )
  VALUES(
    p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),
    'operational_process_unit_return',v_request_hash
  )
  ON CONFLICT (usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body,request_hash
    INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id
      AND actor_auth_user_id=v_auth_user_id
      AND command_name='operational_process_unit_return'
      AND key=btrim(p_idempotency_key);

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda'
        USING ERRCODE='23505';
    END IF;

    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;

    RAISE EXCEPTION 'UNKNOWN_OUTCOME: return orchestration memiliki idempotency record tanpa response'
      USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_usaha_id::text||':operational-return:'||p_penyewaan_id::text||':'||p_unit_barang_id::text,
      0
    )
  );

  SELECT *
  INTO v_rental
  FROM public.penyewaan
  WHERE usaha_id=p_usaha_id
    AND penyewaan_id=p_penyewaan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: penyewaan tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  IF v_rental.updated_at IS DISTINCT FROM p_expected_rental_updated_at THEN
    RAISE EXCEPTION 'STALE_DATA: rental berubah sejak dibuka. Muat ulang sebelum memproses unit return.'
      USING ERRCODE='40001';
  END IF;

  SELECT *
  INTO v_unit
  FROM public.unit_barang
  WHERE usaha_id=p_usaha_id
    AND unit_barang_id=p_unit_barang_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: unit tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  -- Step 1: canonical Return command.
  v_return_response := app_private.command_process_unit_return(
    p_usaha_id,
    p_penyewaan_id,
    ARRAY[p_unit_barang_id],
    nullif(btrim(coalesce(p_catatan,'')),''),
    btrim(p_idempotency_key)||':return',
    p_request_id,
    p_expected_rental_updated_at
  );

  v_detail_id := (v_return_response->'detail_pengembalian_ids'->>0)::uuid;

  -- Return changes unit_barang.updated_at as part of the canonical handoff.
  -- Refresh the row before passing its concurrency token into Inspection.
  SELECT *
  INTO v_unit
  FROM public.unit_barang
  WHERE usaha_id=p_usaha_id
    AND unit_barang_id=p_unit_barang_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: return berhasil tetapi unit tidak dapat direkonsiliasi' USING ERRCODE='40001';
  END IF;

  -- Step 2: canonical Inspection start.
  v_start_response := public.command_start_inspection(
    p_usaha_id,
    v_detail_id,
    p_unit_barang_id,
    btrim(p_idempotency_key)||':inspection:start',
    p_request_id
  );

  v_inspection_id := (v_start_response->>'pemeriksaan_id')::uuid;

  SELECT *
  INTO v_inspection
  FROM public.pemeriksaan
  WHERE usaha_id=p_usaha_id
    AND pemeriksaan_id=v_inspection_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: inspection start berhasil tetapi record tidak ditemukan'
      USING ERRCODE='40001';
  END IF;

  -- Step 3: canonical Inspection completion.
  v_complete_response := public.command_complete_inspection(
    p_usaha_id,
    v_inspection_id,
    p_hasil,
    p_kelengkapan_status,
    p_keputusan_operasional,
    p_catatan,
    v_findings,
    btrim(p_idempotency_key)||':inspection:complete',
    p_request_id,
    v_inspection.updated_at,
    v_unit.updated_at
  );

  -- Refresh unit state after inspection + its trigger.
  SELECT *
  INTO v_unit
  FROM public.unit_barang
  WHERE usaha_id=p_usaha_id
    AND unit_barang_id=p_unit_barang_id
  FOR UPDATE;

  SELECT pm.perawatan_id
  INTO v_maintenance_id
  FROM public.perawatan pm
  WHERE pm.usaha_id=p_usaha_id
    AND pm.pemeriksaan_id=v_inspection_id
  ORDER BY pm.created_at ASC
  LIMIT 1;

  IF v_maintenance_id IS NOT NULL THEN
    v_readiness_state := 'maintenance_required';
    v_block_reason := 'Unit memerlukan tindak lanjut perawatan sebelum readiness.';
  ELSIF p_hasil <> 'normal' THEN
    v_readiness_state := 'blocked';
    v_block_reason := 'Hasil pemeriksaan tidak memenuhi readiness normal.';
  ELSIF p_kelengkapan_status <> 'complete' THEN
    v_readiness_state := 'blocked';
    v_block_reason := 'Kelengkapan unit belum complete.';
  ELSIF p_keputusan_operasional NOT IN ('ready_review','no_action','readiness_review') THEN
    v_readiness_state := 'blocked';
    v_block_reason := 'Keputusan operasional belum memenuhi readiness review.';
  ELSE
    BEGIN
      v_ready_response := public.command_mark_inventory_unit_ready(
        p_usaha_id,
        p_unit_barang_id,
        nullif(btrim(coalesce(p_catatan,'')),''),
        btrim(p_idempotency_key)||':ready',
        p_request_id,
        v_unit.updated_at
      );

      v_readiness_state := 'ready';
      v_block_reason := NULL;
    EXCEPTION
      WHEN SQLSTATE '23514' THEN
        v_readiness_state := 'blocked';
        v_block_reason := SQLERRM;
    END;
  END IF;

  v_response := jsonb_build_object(
    'pengembalian_id',v_return_response->>'pengembalian_id',
    'detail_pengembalian_id',v_detail_id,
    'pemeriksaan_id',v_inspection_id,
    'perawatan_id',v_maintenance_id,
    'penyewaan_id',p_penyewaan_id,
    'unit_barang_id',p_unit_barang_id,
    'return',v_return_response,
    'inspection',v_complete_response,
    'maintenance_required',v_maintenance_id IS NOT NULL,
    'readiness_state',v_readiness_state,
    'block_reason',v_block_reason,
    'unit_status',(
      SELECT status
      FROM public.unit_barang
      WHERE usaha_id=p_usaha_id
        AND unit_barang_id=p_unit_barang_id
    ),
    'ready_response',v_ready_response
  );

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,
    entity_type,entity_id,source_application,request_id,change_summary
  )
  VALUES(
    p_usaha_id,v_auth_user_id,v_admin_id,'operational_process_unit_return',
    'detail_pengembalian',v_detail_id,'admin-command',p_request_id,
    jsonb_build_object(
      'penyewaan_id',p_penyewaan_id,
      'unit_barang_id',p_unit_barang_id,
      'pemeriksaan_id',v_inspection_id,
      'perawatan_id',v_maintenance_id,
      'readiness_state',v_readiness_state
    )
  );

  INSERT INTO public.outbox_event(
    usaha_id,event_type,aggregate_type,aggregate_id,payload
  )
  VALUES(
    p_usaha_id,
    'operational.unit_return_processed',
    'detail_pengembalian',
    v_detail_id,
    jsonb_build_object(
      'penyewaan_id',p_penyewaan_id,
      'unit_barang_id',p_unit_barang_id,
      'pemeriksaan_id',v_inspection_id,
      'perawatan_id',v_maintenance_id,
      'readiness_state',v_readiness_state
    )
  );

  UPDATE public.idempotency_key
  SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;

  RETURN v_response;
END;
$function$
