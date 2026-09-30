-- Inventaris Phase 1 trusted transaction slice:
-- Register physical unit -> move unit -> mark unit READY after explicit verified inspection.
-- Return/inspection/maintenance workflows remain owned by their respective modules.

CREATE OR REPLACE FUNCTION app_private.command_register_inventory_unit(
  p_usaha_id uuid,
  p_barang_id uuid,
  p_varian_barang_id uuid,
  p_kode_unit text,
  p_serial_number text,
  p_lokasi_id uuid,
  p_tanggal_diperoleh date,
  p_sumber_pembelian_detail_id uuid,
  p_catatan_internal text,
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
  v_unit_id uuid := gen_random_uuid();
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_code text := nullif(btrim(coalesce(p_kode_unit, '')), '');
  v_serial text := nullif(btrim(coalesce(p_serial_number, '')), '');
  v_note text := nullif(btrim(coalesce(p_catatan_internal, '')), '');
  v_response jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL OR p_barang_id IS NULL OR v_code IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id, barang_id, dan kode_unit wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi' USING ERRCODE = '22023';
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
    FROM public.usaha u
    WHERE u.usaha_id = p_usaha_id
      AND u.status = 'active'
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.barang b
    WHERE b.usaha_id = p_usaha_id
      AND b.barang_id = p_barang_id
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: barang tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  IF p_varian_barang_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.varian_barang v
       WHERE v.usaha_id = p_usaha_id
         AND v.varian_barang_id = p_varian_barang_id
         AND v.barang_id = p_barang_id
     )
  THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: varian tidak sesuai dengan barang pada usaha aktif' USING ERRCODE = '23514';
  END IF;

  IF p_lokasi_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.lokasi l
       WHERE l.usaha_id = p_usaha_id
         AND l.lokasi_id = p_lokasi_id
         AND l.status = 'active'
     )
  THEN
    RAISE EXCEPTION 'NOT_FOUND: lokasi aktif tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'barang_id', p_barang_id,
    'varian_barang_id', p_varian_barang_id,
    'kode_unit', v_code,
    'serial_number', v_serial,
    'lokasi_id', p_lokasi_id,
    'tanggal_diperoleh', p_tanggal_diperoleh,
    'sumber_pembelian_detail_id', p_sumber_pembelian_detail_id,
    'catatan_internal', v_note
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
    'register_inventory_unit',
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
      AND ik.command_name = 'register_inventory_unit'
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
    hashtextextended(p_usaha_id::text || ':unit-code:' || v_code, 0)
  );

  INSERT INTO public.unit_barang (
    unit_barang_id,
    usaha_id,
    barang_id,
    varian_barang_id,
    kode_unit,
    serial_number,
    lokasi_id,
    tanggal_diperoleh,
    sumber_pembelian_detail_id,
    status,
    kondisi_ringkas,
    catatan_internal
  )
  VALUES (
    v_unit_id,
    p_usaha_id,
    p_barang_id,
    p_varian_barang_id,
    v_code,
    v_serial,
    p_lokasi_id,
    p_tanggal_diperoleh,
    p_sumber_pembelian_detail_id,
    'inspection_pending',
    NULL,
    v_note
  );

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
    v_unit_id,
    'unit_registered',
    now(),
    NULL,
    'inspection_pending',
    NULL,
    p_lokasi_id,
    'inventory',
    v_unit_id,
    v_admin_id,
    v_note,
    jsonb_build_object('registered_via', 'admin-command')
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
    'register_unit',
    'unit_barang',
    v_unit_id,
    'admin-command',
    p_request_id,
    jsonb_build_object(
      'unit_barang_id', v_unit_id,
      'barang_id', p_barang_id,
      'varian_barang_id', p_varian_barang_id,
      'kode_unit', v_code,
      'status', 'inspection_pending',
      'lokasi_id', p_lokasi_id
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
    'inventory.unit_registered',
    'unit_barang',
    v_unit_id,
    jsonb_build_object(
      'unit_barang_id', v_unit_id,
      'kode_unit', v_code,
      'status', 'inspection_pending',
      'lokasi_id', p_lokasi_id
    )
  );

  v_response := jsonb_build_object(
    'unit_barang_id', v_unit_id,
    'usaha_id', p_usaha_id,
    'kode_unit', v_code,
    'status', 'inspection_pending',
    'lokasi_id', p_lokasi_id
  );

  UPDATE public.idempotency_key
  SET response_status = 200,
      response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$;


CREATE OR REPLACE FUNCTION app_private.command_move_inventory_unit(
  p_usaha_id uuid,
  p_unit_barang_id uuid,
  p_lokasi_id uuid,
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
    'catatan', v_note
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
    'catatan', v_note
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

  IF v_unit.status IN ('rented', 'lost', 'inactive') THEN
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
  THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: hasil pemeriksaan terakhir belum menyatakan unit normal dan lengkap' USING ERRCODE = '23514';
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


CREATE OR REPLACE FUNCTION app_private.command_reconcile_inventory_unit_mutation(
  p_usaha_id uuid,
  p_command_name text,
  p_idempotency_key text
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
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL
     OR p_command_name NOT IN (
       'register_inventory_unit',
       'move_inventory_unit',
       'mark_inventory_unit_ready'
     )
     OR p_idempotency_key IS NULL
     OR btrim(p_idempotency_key) = ''
  THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: reconciliation input tidak valid' USING ERRCODE = '22023';
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

  SELECT *
  INTO v_row
  FROM public.idempotency_key ik
  WHERE ik.usaha_id = p_usaha_id
    AND ik.actor_auth_user_id = v_auth_user_id
    AND ik.command_name = p_command_name
    AND ik.key = btrim(p_idempotency_key);

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'state', 'not_found',
      'response', null
    );
  END IF;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_row.response_body IS NULL THEN 'unknown' ELSE 'committed' END,
    'response', v_row.response_body
  );
END;
$function$;


REVOKE ALL ON FUNCTION app_private.command_register_inventory_unit(uuid,uuid,uuid,text,text,uuid,date,uuid,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_register_inventory_unit(uuid,uuid,uuid,text,text,uuid,date,uuid,text,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_register_inventory_unit(uuid,uuid,uuid,text,text,uuid,date,uuid,text,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_register_inventory_unit(uuid,uuid,uuid,text,text,uuid,date,uuid,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_move_inventory_unit(uuid,uuid,uuid,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_move_inventory_unit(uuid,uuid,uuid,text,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_move_inventory_unit(uuid,uuid,uuid,text,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_move_inventory_unit(uuid,uuid,uuid,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_mark_inventory_unit_ready(uuid,uuid,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_mark_inventory_unit_ready(uuid,uuid,text,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_mark_inventory_unit_ready(uuid,uuid,text,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_mark_inventory_unit_ready(uuid,uuid,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_reconcile_inventory_unit_mutation(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_reconcile_inventory_unit_mutation(uuid,text,text) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_reconcile_inventory_unit_mutation(uuid,text,text) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_reconcile_inventory_unit_mutation(uuid,text,text) TO authenticated;
