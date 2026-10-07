CREATE OR REPLACE FUNCTION app_private.command_set_inventory_unit_operational_status(
  p_usaha_id uuid,
  p_unit_barang_id uuid,
  p_status text,
  p_alasan text,
  p_catatan text,
  p_expected_updated_at timestamptz,
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
  v_existing_hash text;
  v_existing_response jsonb;
  v_idempotency_id uuid;
  v_request_hash text;
  v_note text := nullif(btrim(coalesce(p_catatan, '')), '');
  v_reason text := nullif(btrim(coalesce(p_alasan, '')), '');
  v_response jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;
  IF p_usaha_id IS NULL OR p_unit_barang_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id dan unit_barang_id wajib diisi' USING ERRCODE='22023';
  END IF;
  IF p_status NOT IN ('damaged','lost','inactive') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: status operasional harus rusak, hilang, atau dinonaktifkan' USING ERRCODE='22023';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: alasan wajib diisi' USING ERRCODE='22023';
  END IF;
  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: expected_updated_at wajib diisi' USING ERRCODE='22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi' USING ERRCODE='22023';
  END IF;

  SELECT aa.akun_admin_id INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id = aa.akun_admin_id
   AND ku.status = 'active'
   AND ku.revoked_at IS NULL
   AND ku.usaha_id = p_usaha_id
  WHERE aa.auth_user_id = v_auth_user_id
    AND aa.status = 'active'
    AND aa.role = 'super_admin';

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'unit_barang_id', p_unit_barang_id,
    'status', p_status,
    'alasan', v_reason,
    'catatan', v_note,
    'expected_updated_at', p_expected_updated_at
  )::text);

  INSERT INTO public.idempotency_key (usaha_id, actor_auth_user_id, key, command_name, request_hash)
  VALUES (p_usaha_id, v_auth_user_id, btrim(p_idempotency_key), 'set_inventory_unit_operational_status', v_request_hash)
  ON CONFLICT (usaha_id, actor_auth_user_id, command_name, key)
  DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body, ik.request_hash
    INTO v_existing_response, v_existing_hash
    FROM public.idempotency_key ik
    WHERE ik.usaha_id = p_usaha_id
      AND ik.actor_auth_user_id = v_auth_user_id
      AND ik.command_name = 'set_inventory_unit_operational_status'
      AND ik.key = btrim(p_idempotency_key);

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text || ':unit:' || p_unit_barang_id::text, 0));

  SELECT * INTO v_unit
  FROM public.unit_barang
  WHERE usaha_id = p_usaha_id
    AND unit_barang_id = p_unit_barang_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: unit tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  IF v_unit.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'CONFLICT: data unit sudah berubah. Muat ulang detail unit sebelum mencoba lagi.' USING ERRCODE='40001';
  END IF;

  IF v_unit.status = 'rented' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: unit sedang disewa. Selesaikan proses penyewaan/pengembalian terlebih dahulu sebelum mengubah status operasional.' USING ERRCODE='23514';
  END IF;

  IF v_unit.status = p_status THEN
    v_response := jsonb_build_object(
      'unit_barang_id', v_unit.unit_barang_id,
      'usaha_id', v_unit.usaha_id,
      'kode_unit', v_unit.kode_unit,
      'status', v_unit.status,
      'state', 'unchanged'
    );
    UPDATE public.idempotency_key
    SET response_status = 200, response_body = v_response, completed_at = now()
    WHERE idempotency_key_id = v_idempotency_id;
    RETURN v_response;
  END IF;

  UPDATE public.unit_barang
  SET status = p_status, updated_at = now()
  WHERE usaha_id = p_usaha_id AND unit_barang_id = p_unit_barang_id;

  INSERT INTO public.riwayat_unit (
    usaha_id, unit_barang_id, jenis_kejadian, terjadi_at,
    status_sebelum, status_sesudah,
    lokasi_sebelum_id, lokasi_sesudah_id,
    sumber_type, sumber_id, actor_akun_admin_id, catatan, metadata
  )
  VALUES (
    p_usaha_id,
    p_unit_barang_id,
    CASE p_status
      WHEN 'damaged' THEN 'unit_marked_damaged'
      WHEN 'lost' THEN 'unit_marked_lost'
      WHEN 'inactive' THEN 'unit_deactivated'
    END,
    now(),
    v_unit.status,
    p_status,
    v_unit.lokasi_id,
    v_unit.lokasi_id,
    'inventory',
    p_unit_barang_id,
    v_admin_id,
    v_reason,
    jsonb_build_object('catatan', v_note, 'previous_status', v_unit.status, 'new_status', p_status)
  );

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, request_id, change_summary
  )
  VALUES (
    p_usaha_id, v_auth_user_id, v_admin_id, 'set_inventory_unit_operational_status',
    'unit_barang', p_unit_barang_id, 'inventaris', p_request_id,
    jsonb_build_object(
      'status_before', v_unit.status,
      'status_after', p_status,
      'alasan', v_reason,
      'catatan', v_note
    )
  );

  INSERT INTO public.outbox_event (
    usaha_id, event_type, aggregate_type, aggregate_id, payload
  )
  VALUES (
    p_usaha_id,
    'inventory.unit_status_changed',
    'unit_barang',
    p_unit_barang_id,
    jsonb_build_object(
      'unit_barang_id', p_unit_barang_id,
      'status_before', v_unit.status,
      'status_after', p_status,
      'alasan', v_reason
    )
  );

  v_response := jsonb_build_object(
    'unit_barang_id', p_unit_barang_id,
    'usaha_id', p_usaha_id,
    'kode_unit', v_unit.kode_unit,
    'status', p_status,
    'state', 'changed'
  );

  UPDATE public.idempotency_key
  SET response_status = 200, response_body = v_response, completed_at = now()
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
       'mark_inventory_unit_ready',
       'set_inventory_unit_operational_status'
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
    RETURN jsonb_build_object('state','not_found','response',null);
  END IF;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_row.response_body IS NULL THEN 'unknown' ELSE 'committed' END,
    'response', v_row.response_body
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_set_inventory_unit_operational_status(uuid,uuid,text,text,text,timestamptz,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_set_inventory_unit_operational_status(uuid,uuid,text,text,text,timestamptz,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_set_inventory_unit_operational_status(uuid,uuid,text,text,text,timestamptz,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_set_inventory_unit_operational_status(uuid,uuid,text,text,text,timestamptz,text,uuid) TO authenticated;
