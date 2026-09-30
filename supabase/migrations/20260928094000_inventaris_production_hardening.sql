CREATE OR REPLACE FUNCTION app_private.command_move_inventory_unit(
  p_usaha_id uuid,
  p_unit_barang_id uuid,
  p_lokasi_id uuid,
  p_catatan text,
  p_idempotency_key text,
  p_request_id uuid,
  p_expected_updated_at timestamptz
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
  v_old_location_id uuid;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_note text := nullif(btrim(coalesce(p_catatan, '')), '');
  v_response jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL OR p_unit_barang_id IS NULL OR p_lokasi_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id, unit_barang_id, dan lokasi_id wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: expected_updated_at wajib diisi' USING ERRCODE = '22023';
  END IF;

  SELECT aa.akun_admin_id
  INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id = aa.akun_admin_id
   AND ku.status = 'active'
   AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id = v_auth_user_id
    AND aa.status = 'active'
    AND aa.role = 'super_admin'
    AND ku.usaha_id = p_usaha_id;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE = '42501';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'unit_barang_id', p_unit_barang_id,
    'lokasi_id', p_lokasi_id,
    'catatan', v_note,
    'expected_updated_at', p_expected_updated_at
  )::text);

  INSERT INTO public.idempotency_key (
    usaha_id,
    actor_auth_user_id,
    key,
    command_name,
    request_hash
  )
  VALUES (
    p_usaha_id,
    v_auth_user_id,
    btrim(p_idempotency_key),
    'move_inventory_unit',
    v_request_hash
  )
  ON CONFLICT (usaha_id, actor_auth_user_id, command_name, key)
  DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body, ik.request_hash
    INTO v_existing_response, v_existing_hash
    FROM public.idempotency_key ik
    WHERE ik.usaha_id = p_usaha_id
      AND ik.actor_auth_user_id = v_auth_user_id
      AND ik.command_name = 'move_inventory_unit'
      AND ik.key = btrim(p_idempotency_key);

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE = '23505';
    END IF;

    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;

    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE = '40001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_usaha_id::text || ':unit:' || p_unit_barang_id::text, 0)
  );

  SELECT *
  INTO v_unit
  FROM public.unit_barang
  WHERE usaha_id = p_usaha_id
    AND unit_barang_id = p_unit_barang_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: unit tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  IF v_unit.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_DATA: unit berubah sejak data dibuka. Muat ulang state terbaru sebelum memindahkan unit.' USING ERRCODE = '40001';
  END IF;

  IF v_unit.status = 'rented' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: unit yang sedang disewa tidak dapat dipindahkan oleh Inventaris' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.lokasi l
    WHERE l.usaha_id = p_usaha_id
      AND l.lokasi_id = p_lokasi_id
      AND l.status = 'active'
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: lokasi tujuan aktif tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  v_old_location_id := v_unit.lokasi_id;

  IF v_old_location_id = p_lokasi_id THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: unit sudah berada pada lokasi tujuan' USING ERRCODE = '23505';
  END IF;

  UPDATE public.unit_barang
  SET lokasi_id = p_lokasi_id
  WHERE usaha_id = p_usaha_id
    AND unit_barang_id = p_unit_barang_id;

  INSERT INTO public.riwayat_unit (
    usaha_id,
    unit_barang_id,
    jenis_kejadian,
    terjadi_at,
    status_sebelum,
    status_sesudah,
    lokasi_sebelum_id,
    lokasi_sesudah_id,
    sumber_type,
    sumber_id,
    actor_akun_admin_id,
    catatan,
    metadata
  )
  VALUES (
    p_usaha_id,
    p_unit_barang_id,
    'location_changed',
    now(),
    v_unit.status,
    v_unit.status,
    v_old_location_id,
    p_lokasi_id,
    'inventory',
    p_unit_barang_id,
    v_admin_id,
    v_note,
    jsonb_build_object(
      'location_before', v_old_location_id,
      'location_after', p_lokasi_id
    )
  );

  INSERT INTO public.audit_log (
    usaha_id,
    actor_auth_user_id,
    actor_akun_admin_id,
    action,
    entity_type,
    entity_id,
    source_application,
    request_id,
    change_summary
  )
  VALUES (
    p_usaha_id,
    v_auth_user_id,
    v_admin_id,
    'move_unit',
    'unit_barang',
    p_unit_barang_id,
    'admin-command',
    p_request_id,
    jsonb_build_object(
      'location_before', v_old_location_id,
      'location_after', p_lokasi_id,
      'status', v_unit.status
    )
  );

  INSERT INTO public.outbox_event (
    usaha_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload
  )
  VALUES (
    p_usaha_id,
    'inventory.unit_moved',
    'unit_barang',
    p_unit_barang_id,
    jsonb_build_object(
      'unit_barang_id', p_unit_barang_id,
      'location_before', v_old_location_id,
      'location_after', p_lokasi_id
    )
  );

  v_response := jsonb_build_object(
    'unit_barang_id', p_unit_barang_id,
    'status', v_unit.status,
    'lokasi_id', p_lokasi_id,
    'lokasi_sebelum_id', v_old_location_id
  );

  UPDATE public.idempotency_key
  SET response_status = 200,
      response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_mark_inventory_unit_ready(
  p_usaha_id uuid,
  p_unit_barang_id uuid,
  p_catatan text,
  p_idempotency_key text,
  p_request_id uuid,
  p_expected_updated_at timestamptz
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
  v_latest_inspection public.pemeriksaan%ROWTYPE;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_note text := nullif(btrim(coalesce(p_catatan, '')), '');
  v_response jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL OR p_unit_barang_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id dan unit_barang_id wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: expected_updated_at wajib diisi' USING ERRCODE = '22023';
  END IF;

  SELECT aa.akun_admin_id
  INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id = aa.akun_admin_id
   AND ku.status = 'active'
   AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id = v_auth_user_id
    AND aa.status = 'active'
    AND aa.role = 'super_admin'
    AND ku.usaha_id = p_usaha_id;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE = '42501';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'unit_barang_id', p_unit_barang_id,
    'catatan', v_note,
    'expected_updated_at', p_expected_updated_at
  )::text);

  INSERT INTO public.idempotency_key (
    usaha_id,
    actor_auth_user_id,
    key,
    command_name,
    request_hash
  )
  VALUES (
    p_usaha_id,
    v_auth_user_id,
    btrim(p_idempotency_key),
    'mark_inventory_unit_ready',
    v_request_hash
  )
  ON CONFLICT (usaha_id, actor_auth_user_id, command_name, key)
  DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body, ik.request_hash
    INTO v_existing_response, v_existing_hash
    FROM public.idempotency_key ik
    WHERE ik.usaha_id = p_usaha_id
      AND ik.actor_auth_user_id = v_auth_user_id
      AND ik.command_name = 'mark_inventory_unit_ready'
      AND ik.key = btrim(p_idempotency_key);

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE = '23505';
    END IF;

    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;

    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE = '40001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_usaha_id::text || ':unit:' || p_unit_barang_id::text, 0)
  );

  SELECT *
  INTO v_unit
  FROM public.unit_barang
  WHERE usaha_id = p_usaha_id
    AND unit_barang_id = p_unit_barang_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: unit tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  IF v_unit.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_DATA: unit berubah sejak data dibuka. Muat ulang state terbaru sebelum menetapkan READY.' USING ERRCODE = '40001';
  END IF;

  IF v_unit.status = 'ready' THEN
    v_response := jsonb_build_object(
      'unit_barang_id', p_unit_barang_id,
      'status', 'ready',
      'lokasi_id', v_unit.lokasi_id
    );

    UPDATE public.idempotency_key
    SET response_status = 200,
        response_body = v_response
    WHERE idempotency_key_id = v_idempotency_id;

    RETURN v_response;
  END IF;

  IF v_unit.status NOT IN ('inspection_pending', 'maintenance') THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: unit berstatus % tidak dapat dinyatakan READY dari Inventaris', v_unit.status USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO v_latest_inspection
  FROM public.pemeriksaan pi
  WHERE pi.usaha_id = p_usaha_id
    AND pi.unit_barang_id = p_unit_barang_id
  ORDER BY pi.diperiksa_at DESC, pi.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: unit wajib memiliki hasil pemeriksaan sebelum dapat READY' USING ERRCODE = '23514';
  END IF;

  IF v_latest_inspection.hasil <> 'normal'
     OR v_latest_inspection.kelengkapan_status <> 'complete'
     OR v_latest_inspection.keputusan_operasional NOT IN ('ready_review', 'no_action', 'readiness_review')
  THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: hasil pemeriksaan terakhir belum memenuhi readiness review yang sah' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.perawatan pm
    WHERE pm.usaha_id = p_usaha_id
      AND pm.unit_barang_id = p_unit_barang_id
      AND pm.status IN ('planned', 'in_progress')
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: unit masih memiliki perawatan yang belum selesai' USING ERRCODE = '23514';
  END IF;

  UPDATE public.unit_barang
  SET status = 'ready'
  WHERE usaha_id = p_usaha_id
    AND unit_barang_id = p_unit_barang_id;

  INSERT INTO public.riwayat_unit (
    usaha_id,
    unit_barang_id,
    jenis_kejadian,
    terjadi_at,
    status_sebelum,
    status_sesudah,
    lokasi_sebelum_id,
    lokasi_sesudah_id,
    sumber_type,
    sumber_id,
    actor_akun_admin_id,
    catatan,
    metadata
  )
  VALUES (
    p_usaha_id,
    p_unit_barang_id,
    'unit_marked_ready',
    now(),
    v_unit.status,
    'ready',
    v_unit.lokasi_id,
    v_unit.lokasi_id,
    'inventory',
    p_unit_barang_id,
    v_admin_id,
    v_note,
    jsonb_build_object(
      'inspection_id', v_latest_inspection.pemeriksaan_id,
      'inspection_result', v_latest_inspection.hasil,
      'completeness', v_latest_inspection.kelengkapan_status
    )
  );

  INSERT INTO public.audit_log (
    usaha_id,
    actor_auth_user_id,
    actor_akun_admin_id,
    action,
    entity_type,
    entity_id,
    source_application,
    request_id,
    change_summary
  )
  VALUES (
    p_usaha_id,
    v_auth_user_id,
    v_admin_id,
    'mark_unit_ready',
    'unit_barang',
    p_unit_barang_id,
    'admin-command',
    p_request_id,
    jsonb_build_object(
      'status_before', v_unit.status,
      'status_after', 'ready',
      'inspection_id', v_latest_inspection.pemeriksaan_id
    )
  );

  INSERT INTO public.outbox_event (
    usaha_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload
  )
  VALUES (
    p_usaha_id,
    'inventory.unit_ready',
    'unit_barang',
    p_unit_barang_id,
    jsonb_build_object(
      'unit_barang_id', p_unit_barang_id,
      'inspection_id', v_latest_inspection.pemeriksaan_id,
      'status', 'ready'
    )
  );

  v_response := jsonb_build_object(
    'unit_barang_id', p_unit_barang_id,
    'status', 'ready',
    'lokasi_id', v_unit.lokasi_id,
    'inspection_id', v_latest_inspection.pemeriksaan_id
  );

  UPDATE public.idempotency_key
  SET response_status = 200,
      response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.find_inventory_unit_candidates(
  p_usaha_id uuid,
  p_barang_id uuid,
  p_varian_barang_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_preferred_unit_id uuid,
  p_exclude_penyewaan_id uuid,
  p_limit integer
)
RETURNS TABLE (
  unit_barang_id uuid,
  unit_code text,
  status text,
  lokasi_id uuid,
  lokasi_nama text,
  eligibility boolean,
  conflict boolean,
  conflict_reason text,
  preferred boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;
  IF p_usaha_id IS NULL OR p_barang_id IS NULL OR p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tenant, barang, start_at, dan end_at valid wajib diisi' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT
      ub.unit_barang_id,
      ub.kode_unit AS unit_code,
      ub.status,
      ub.lokasi_id,
      l.nama AS lokasi_nama,
      (ub.unit_barang_id = p_preferred_unit_id) AS preferred,
      EXISTS (
        SELECT 1
        FROM public.penetapan_unit pu
        JOIN public.detail_penyewaan dp
          ON dp.usaha_id = pu.usaha_id
         AND dp.detail_penyewaan_id = pu.detail_penyewaan_id
        JOIN public.penyewaan p
          ON p.usaha_id = dp.usaha_id
         AND p.penyewaan_id = dp.penyewaan_id
        WHERE pu.usaha_id = ub.usaha_id
          AND pu.unit_barang_id = ub.unit_barang_id
          AND pu.status = 'assigned'
          AND (p_exclude_penyewaan_id IS NULL OR p.penyewaan_id <> p_exclude_penyewaan_id)
          AND p.status NOT IN ('draft', 'cancelled', 'completed')
          AND tstzrange(p.jadwal_mulai, p.jadwal_kembali, '[)')
              && tstzrange(p_start_at, p_end_at, '[)')
      ) AS conflict
    FROM public.unit_barang ub
    LEFT JOIN public.lokasi l
      ON l.usaha_id = ub.usaha_id
     AND l.lokasi_id = ub.lokasi_id
    WHERE ub.usaha_id = p_usaha_id
      AND ub.barang_id = p_barang_id
      AND (p_varian_barang_id IS NULL OR ub.varian_barang_id = p_varian_barang_id)
  )
  SELECT
    c.unit_barang_id,
    c.unit_code,
    c.status,
    c.lokasi_id,
    c.lokasi_nama,
    (c.status = 'ready' AND NOT c.conflict) AS eligibility,
    c.conflict,
    CASE
      WHEN c.status <> 'ready' THEN 'STATUS_NOT_READY'
      WHEN c.conflict THEN 'RENTAL_CONFLICT'
      ELSE NULL
    END AS conflict_reason,
    c.preferred
  FROM candidate c
  ORDER BY c.preferred DESC, (c.status = 'ready' AND NOT c.conflict) DESC, c.unit_code ASC
  LIMIT v_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_mark_inventory_unit_inspection_pending(
  p_usaha_id uuid,
  p_unit_barang_id uuid,
  p_detail_pengembalian_id uuid,
  p_idempotency_key text,
  p_request_id uuid,
  p_expected_updated_at timestamptz
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
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_response jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;
  IF p_usaha_id IS NULL OR p_unit_barang_id IS NULL OR p_detail_pengembalian_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tenant, unit, dan detail pengembalian wajib diisi' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan expected_updated_at wajib diisi' USING ERRCODE = '22023';
  END IF;

  SELECT aa.akun_admin_id
  INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id = aa.akun_admin_id
   AND ku.status = 'active'
   AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id = v_auth_user_id
    AND aa.status = 'active'
    AND aa.role = 'super_admin'
    AND ku.usaha_id = p_usaha_id;
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.detail_pengembalian dr
    WHERE dr.usaha_id = p_usaha_id
      AND dr.detail_pengembalian_id = p_detail_pengembalian_id
      AND dr.unit_barang_id = p_unit_barang_id
      AND dr.diterima_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: unit belum memiliki fakta penerimaan return yang valid' USING ERRCODE = '23514';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'unit_barang_id', p_unit_barang_id,
    'detail_pengembalian_id', p_detail_pengembalian_id,
    'expected_updated_at', p_expected_updated_at
  )::text);

  INSERT INTO public.idempotency_key (usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES (p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'mark_inventory_unit_inspection_pending',v_request_hash)
  ON CONFLICT (usaha_id, actor_auth_user_id, command_name, key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body,ik.request_hash
    INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key ik
    WHERE ik.usaha_id=p_usaha_id
      AND ik.actor_auth_user_id=v_auth_user_id
      AND ik.command_name='mark_inventory_unit_inspection_pending'
      AND ik.key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE = '23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE = '40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text || ':unit:' || p_unit_barang_id::text,0));

  SELECT * INTO v_unit
  FROM public.unit_barang
  WHERE usaha_id=p_usaha_id AND unit_barang_id=p_unit_barang_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: unit tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  IF v_unit.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_DATA: unit berubah sejak data dibuka. Muat ulang state terbaru sebelum meneruskan return.' USING ERRCODE = '40001';
  END IF;

  IF v_unit.status='inspection_pending' THEN
    v_response:=jsonb_build_object('unit_barang_id',p_unit_barang_id,'status','inspection_pending');
    UPDATE public.idempotency_key SET response_status=200,response_body=v_response WHERE idempotency_key_id=v_idempotency_id;
    RETURN v_response;
  END IF;

  IF v_unit.status<>'rented' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: unit tidak berada pada state rental aktif yang valid untuk dipindahkan ke inspection pending' USING ERRCODE = '23514';
  END IF;

  UPDATE public.unit_barang
  SET status='inspection_pending'
  WHERE usaha_id=p_usaha_id AND unit_barang_id=p_unit_barang_id;

  INSERT INTO public.riwayat_unit (
    usaha_id,unit_barang_id,jenis_kejadian,terjadi_at,status_sebelum,status_sesudah,
    lokasi_sebelum_id,lokasi_sesudah_id,sumber_type,sumber_id,actor_akun_admin_id,catatan,metadata
  )
  SELECT p_usaha_id,p_unit_barang_id,'unit_returned',dr.diterima_at,'rented','inspection_pending',
         v_unit.lokasi_id,v_unit.lokasi_id,'pengembalian',p_detail_pengembalian_id,v_admin_id,dr.catatan,
         jsonb_build_object('detail_pengembalian_id',p_detail_pengembalian_id,'diterima_at',dr.diterima_at)
  FROM public.detail_pengembalian dr
  WHERE dr.usaha_id=p_usaha_id AND dr.detail_pengembalian_id=p_detail_pengembalian_id;

  INSERT INTO public.audit_log (
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,source_application,request_id,change_summary
  )
  VALUES (
    p_usaha_id,v_auth_user_id,v_admin_id,'mark_unit_inspection_pending','unit_barang',p_unit_barang_id,'return-handoff',p_request_id,
    jsonb_build_object('status_before','rented','status_after','inspection_pending','detail_pengembalian_id',p_detail_pengembalian_id)
  );

  INSERT INTO public.outbox_event (
    usaha_id,event_type,aggregate_type,aggregate_id,payload
  )
  VALUES (
    p_usaha_id,'inventory.unit_inspection_pending','unit_barang',p_unit_barang_id,
    jsonb_build_object('unit_barang_id',p_unit_barang_id,'detail_pengembalian_id',p_detail_pengembalian_id,'status','inspection_pending')
  );

  v_response:=jsonb_build_object('unit_barang_id',p_unit_barang_id,'status','inspection_pending','detail_pengembalian_id',p_detail_pengembalian_id);
  UPDATE public.idempotency_key SET response_status=200,response_body=v_response WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$;


REVOKE ALL ON FUNCTION app_private.command_move_inventory_unit(uuid,uuid,uuid,text,text,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_move_inventory_unit(uuid,uuid,uuid,text,text,uuid,timestamptz) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_move_inventory_unit(uuid,uuid,uuid,text,text,uuid,timestamptz) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_move_inventory_unit(uuid,uuid,uuid,text,text,uuid,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_mark_inventory_unit_ready(uuid,uuid,text,text,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_mark_inventory_unit_ready(uuid,uuid,text,text,uuid,timestamptz) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_mark_inventory_unit_ready(uuid,uuid,text,text,uuid,timestamptz) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_mark_inventory_unit_ready(uuid,uuid,text,text,uuid,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION app_private.find_inventory_unit_candidates(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.find_inventory_unit_candidates(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,integer) FROM anon;
REVOKE ALL ON FUNCTION app_private.find_inventory_unit_candidates(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,integer) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.find_inventory_unit_candidates(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,integer) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_mark_inventory_unit_inspection_pending(uuid,uuid,uuid,text,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_mark_inventory_unit_inspection_pending(uuid,uuid,uuid,text,uuid,timestamptz) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_mark_inventory_unit_inspection_pending(uuid,uuid,uuid,text,uuid,timestamptz) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_mark_inventory_unit_inspection_pending(uuid,uuid,uuid,text,uuid,timestamptz) TO authenticated;

DROP FUNCTION IF EXISTS app_private.command_move_inventory_unit(uuid,uuid,uuid,text,text,uuid);
DROP FUNCTION IF EXISTS app_private.command_mark_inventory_unit_ready(uuid,uuid,text,text,uuid);
