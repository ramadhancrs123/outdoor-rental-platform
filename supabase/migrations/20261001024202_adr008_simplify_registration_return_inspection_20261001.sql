-- ADR-008: registration confirms admin pre-check and starts units at ready.
-- The return inspection contract remains separate and return-driven.

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
    'ready',
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
    'ready',
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
      'status', 'ready',
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
      'status', 'ready',
      'lokasi_id', p_lokasi_id
    )
  );

  v_response := jsonb_build_object(
    'unit_barang_id', v_unit_id,
    'usaha_id', p_usaha_id,
    'kode_unit', v_code,
    'status', 'ready',
    'lokasi_id', p_lokasi_id
  );

  UPDATE public.idempotency_key
  SET response_status = 200,
      response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$;
