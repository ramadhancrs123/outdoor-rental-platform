-- Pengembalian trusted transaction slice:
-- active rental -> one atomic unit-level return batch -> inspection handoff.
--
-- Semantics locked by modules/pengembalian.md:
-- Return != Inspection != Maintenance != Ready.
-- This command records actual receipt using server time and never mutates
-- physical readiness directly; Inventory owns the unit transition to inspection_pending.

CREATE OR REPLACE FUNCTION app_private.command_process_unit_return(
  p_usaha_id uuid,
  p_penyewaan_id uuid,
  p_unit_barang_ids uuid[],
  p_catatan text,
  p_idempotency_key text,
  p_request_id uuid,
  p_expected_rental_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_timezone text;
  v_rental public.penyewaan%ROWTYPE;
  v_unit public.unit_barang%ROWTYPE;
  v_return_id uuid := gen_random_uuid();
  v_return_number text;
  v_return_counter bigint;
  v_received_at timestamptz := now();
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_expected_unit_count bigint;
  v_returned_unit_count bigint;
  v_detail_id uuid;
  v_unit_id uuid;
  v_unit_ids uuid[];
  v_returned_unit_ids uuid[] := ARRAY[]::uuid[];
  v_detail_ids uuid[] := ARRAY[]::uuid[];
  v_rental_status text;
  v_response jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL
     OR p_penyewaan_id IS NULL
     OR p_unit_barang_ids IS NULL
     OR cardinality(p_unit_barang_ids) = 0
     OR p_request_id IS NULL
     OR p_expected_rental_updated_at IS NULL
  THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tenant, rental, minimal satu unit, request_id, dan expected_rental_updated_at wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF array_position(p_unit_barang_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: unit return tidak boleh mengandung NULL' USING ERRCODE = '22023';
  END IF;

  IF cardinality(p_unit_barang_ids) <> (
    SELECT count(DISTINCT x)::integer FROM unnest(p_unit_barang_ids) AS t(x)
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: unit return tidak boleh duplikat' USING ERRCODE = '22023';
  END IF;

  v_unit_ids := ARRAY(
    SELECT x
    FROM unnest(p_unit_barang_ids) AS t(x)
    ORDER BY x
  );

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

  SELECT u.timezone
  INTO v_timezone
  FROM public.usaha u
  WHERE u.usaha_id = p_usaha_id
    AND u.status = 'active';

  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'penyewaan_id', p_penyewaan_id,
    'unit_barang_ids', v_unit_ids,
    'catatan', nullif(btrim(coalesce(p_catatan, '')), ''),
    'expected_rental_updated_at', p_expected_rental_updated_at
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
    'process_unit_return',
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
      AND ik.command_name = 'process_unit_return'
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
    hashtextextended(p_usaha_id::text || ':rental-return:' || p_penyewaan_id::text, 0)
  );

  SELECT *
  INTO v_rental
  FROM public.penyewaan
  WHERE usaha_id = p_usaha_id
    AND penyewaan_id = p_penyewaan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: penyewaan tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  IF v_rental.updated_at IS DISTINCT FROM p_expected_rental_updated_at THEN
    RAISE EXCEPTION 'STALE_DATA: data rental berubah sejak halaman dibuka. Muat ulang rental sebelum memproses pengembalian.' USING ERRCODE = '40001';
  END IF;

  IF v_rental.status NOT IN ('active', 'return_in_progress') THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: rental tidak berada pada state yang dapat menerima return; status sekarang %', v_rental.status USING ERRCODE = '23514';
  END IF;

  SELECT count(*)
  INTO v_expected_unit_count
  FROM public.penetapan_unit pu
  JOIN public.detail_penyewaan dp
    ON dp.usaha_id = pu.usaha_id
   AND dp.detail_penyewaan_id = pu.detail_penyewaan_id
  WHERE pu.usaha_id = p_usaha_id
    AND dp.penyewaan_id = p_penyewaan_id
    AND pu.status = 'assigned';

  IF v_expected_unit_count = 0 THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: rental tidak memiliki unit fisik yang ditetapkan untuk dikembalikan' USING ERRCODE = '23514';
  END IF;

  FOR v_unit_id IN
    SELECT x
    FROM unnest(v_unit_ids) AS t(x)
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_usaha_id::text || ':unit-return:' || v_unit_id::text, 0)
    );

    SELECT *
    INTO v_unit
    FROM public.unit_barang
    WHERE usaha_id = p_usaha_id
      AND unit_barang_id = v_unit_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_FOUND: unit % tidak ditemukan dalam usaha aktif', v_unit_id USING ERRCODE = 'P0002';
    END IF;

    IF v_unit.status <> 'rented' THEN
      IF EXISTS (
        SELECT 1
        FROM public.detail_pengembalian dr
        JOIN public.pengembalian r
          ON r.usaha_id = dr.usaha_id
         AND r.pengembalian_id = dr.pengembalian_id
        WHERE dr.usaha_id = p_usaha_id
          AND r.penyewaan_id = p_penyewaan_id
          AND dr.unit_barang_id = v_unit_id
      ) THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: unit % sudah pernah dicatat sebagai return untuk rental ini', v_unit.kode_unit USING ERRCODE = '23505';
      END IF;

      RAISE EXCEPTION 'BUSINESS_CONFLICT: unit % tidak lagi berada pada state rented. Muat ulang state unit.', v_unit.kode_unit USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.penetapan_unit pu
      JOIN public.detail_penyewaan dp
        ON dp.usaha_id = pu.usaha_id
       AND dp.detail_penyewaan_id = pu.detail_penyewaan_id
      WHERE pu.usaha_id = p_usaha_id
        AND pu.unit_barang_id = v_unit_id
        AND pu.status = 'assigned'
        AND dp.penyewaan_id = p_penyewaan_id
    ) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: unit % bukan unit yang ditetapkan pada rental ini', v_unit.kode_unit USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.detail_pengembalian dr
      JOIN public.pengembalian r
        ON r.usaha_id = dr.usaha_id
       AND r.pengembalian_id = dr.pengembalian_id
      WHERE dr.usaha_id = p_usaha_id
        AND r.penyewaan_id = p_penyewaan_id
        AND dr.unit_barang_id = v_unit_id
    ) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: unit % sudah memiliki fakta return untuk rental ini', v_unit.kode_unit USING ERRCODE = '23505';
    END IF;
  END LOOP;

  v_return_counter := app_private.next_business_number(
    p_usaha_id,
    'RET',
    to_char(v_received_at AT TIME ZONE v_timezone, 'YYYY')
  );
  v_return_number := 'RET-' || to_char(v_received_at AT TIME ZONE v_timezone, 'YYYY') || '-' || lpad(v_return_counter::text, 3, '0');

  INSERT INTO public.pengembalian (
    pengembalian_id,
    usaha_id,
    penyewaan_id,
    nomor_pengembalian,
    dimulai_at,
    selesai_at,
    status,
    diproses_by_admin_id,
    catatan
  )
  VALUES (
    v_return_id,
    p_usaha_id,
    p_penyewaan_id,
    v_return_number,
    v_received_at,
    v_received_at,
    'completed',
    v_admin_id,
    nullif(btrim(coalesce(p_catatan, '')), '')
  );

  FOR v_unit_id IN
    SELECT x
    FROM unnest(v_unit_ids) AS t(x)
  LOOP
    v_detail_id := gen_random_uuid();

    INSERT INTO public.detail_pengembalian (
      detail_pengembalian_id,
      usaha_id,
      pengembalian_id,
      unit_barang_id,
      diterima_at,
      kondisi_awal,
      status_pemeriksaan,
      catatan
    )
    VALUES (
      v_detail_id,
      p_usaha_id,
      v_return_id,
      v_unit_id,
      v_received_at,
      NULL,
      'pending',
      nullif(btrim(coalesce(p_catatan, '')), '')
    );

    SELECT ub.*
    INTO v_unit
    FROM public.unit_barang ub
    WHERE ub.usaha_id = p_usaha_id
      AND ub.unit_barang_id = v_unit_id;

    PERFORM app_private.command_mark_inventory_unit_inspection_pending(
      p_usaha_id,
      v_unit_id,
      v_detail_id,
      'return-handoff-' || btrim(p_idempotency_key) || '-' || v_unit_id::text,
      p_request_id,
      v_unit.updated_at
    );

    v_returned_unit_ids := array_append(v_returned_unit_ids, v_unit_id);
    v_detail_ids := array_append(v_detail_ids, v_detail_id);
  END LOOP;

  SELECT count(DISTINCT dr.unit_barang_id)
  INTO v_returned_unit_count
  FROM public.detail_pengembalian dr
  JOIN public.pengembalian r
    ON r.usaha_id = dr.usaha_id
   AND r.pengembalian_id = dr.pengembalian_id
  WHERE dr.usaha_id = p_usaha_id
    AND r.penyewaan_id = p_penyewaan_id;

  IF v_returned_unit_count = v_expected_unit_count THEN
    v_rental_status := 'completed';
  ELSE
    v_rental_status := 'return_in_progress';
  END IF;

  UPDATE public.penyewaan
  SET actual_return_started_at = COALESCE(actual_return_started_at, v_received_at),
      actual_return_completed_at = CASE
        WHEN v_rental_status = 'completed' THEN COALESCE(actual_return_completed_at, v_received_at)
        ELSE NULL
      END,
      status = v_rental_status
  WHERE usaha_id = p_usaha_id
    AND penyewaan_id = p_penyewaan_id;

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
    'process_unit_return',
    'pengembalian',
    v_return_id,
    'admin-command',
    p_request_id,
    jsonb_build_object(
      'penyewaan_id', p_penyewaan_id,
      'nomor_pengembalian', v_return_number,
      'unit_barang_ids', v_returned_unit_ids,
      'detail_pengembalian_ids', v_detail_ids,
      'actual_return_at', v_received_at,
      'rental_status_before', v_rental.status,
      'rental_status_after', v_rental_status,
      'expected_unit_count', v_expected_unit_count,
      'returned_unit_count', v_returned_unit_count
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
    'return.completed',
    'pengembalian',
    v_return_id,
    jsonb_build_object(
      'return_id', v_return_id,
      'return_number', v_return_number,
      'rental_id', p_penyewaan_id,
      'unit_barang_ids', v_returned_unit_ids,
      'detail_pengembalian_ids', v_detail_ids,
      'actual_return_at', v_received_at,
      'rental_status', v_rental_status,
      'is_full_return', v_rental_status = 'completed'
    )
  );

  v_response := jsonb_build_object(
    'pengembalian_id', v_return_id,
    'nomor_pengembalian', v_return_number,
    'penyewaan_id', p_penyewaan_id,
    'status', 'completed',
    'rental_status', v_rental_status,
    'actual_return_at', v_received_at,
    'unit_barang_ids', v_returned_unit_ids,
    'detail_pengembalian_ids', v_detail_ids,
    'returned_unit_count', v_returned_unit_count,
    'expected_unit_count', v_expected_unit_count
  );

  UPDATE public.idempotency_key
  SET response_status = 200,
      response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$;


CREATE OR REPLACE FUNCTION app_private.command_reconcile_return_mutation(
  p_usaha_id uuid,
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

  IF p_usaha_id IS NULL OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id dan idempotency_key wajib diisi' USING ERRCODE = '22023';
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
    AND ik.command_name = 'process_unit_return'
    AND ik.key = btrim(p_idempotency_key);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found', 'response', null);
  END IF;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_row.response_body IS NULL THEN 'unknown' ELSE 'committed' END,
    'response', v_row.response_body
  );
END;
$function$;


REVOKE ALL ON FUNCTION app_private.command_process_unit_return(uuid,uuid,uuid[],text,text,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_process_unit_return(uuid,uuid,uuid[],text,text,uuid,timestamptz) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_process_unit_return(uuid,uuid,uuid[],text,text,uuid,timestamptz) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_process_unit_return(uuid,uuid,uuid[],text,text,uuid,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_reconcile_return_mutation(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_reconcile_return_mutation(uuid,text) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_reconcile_return_mutation(uuid,text) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_reconcile_return_mutation(uuid,text) TO authenticated;
