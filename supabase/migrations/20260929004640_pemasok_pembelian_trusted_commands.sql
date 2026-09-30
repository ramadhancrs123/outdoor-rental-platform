-- Pemasok & Pembelian phase-1 trusted backend boundary.
-- Scope:
--   - supplier create/update/activate-deactivate
--   - purchase draft create/update
--   - idempotency + stale/concurrency
--   - tenant authorization + audit
--   - defense-in-depth supplier-state trigger
--
-- Explicit decision boundary:
-- Purchase final/committed status is not locked by the current source-of-truth.
-- This migration therefore does NOT invent ordered/completed/cancelled/finalized
-- semantics. Existing database triggers already treat any non-draft status as
-- historical/immutable; a future ADR must choose the official committed status.

CREATE OR REPLACE FUNCTION app_private.procurement_require_admin(
  p_usaha_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required'
      USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id wajib diisi'
      USING ERRCODE = '22023';
  END IF;

  SELECT aa.akun_admin_id
  INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id = aa.akun_admin_id
   AND ku.usaha_id = p_usaha_id
   AND ku.status = 'active'
   AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id = v_auth_user_id
    AND aa.status = 'active'
    AND aa.role = 'super_admin'
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses procurement pada usaha'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.usaha u
    WHERE u.usaha_id = p_usaha_id
      AND u.status = 'active'
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_admin_id;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.procurement_insert_purchase_lines(
  p_usaha_id uuid,
  p_pembelian_id uuid,
  p_lines jsonb
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_line jsonb;
  v_position integer := 0;
  v_barang_id uuid;
  v_varian_barang_id uuid;
  v_jumlah numeric;
  v_unit_price numeric;
  v_subtotal numeric(19,2);
  v_total numeric(19,2) := 0;
  v_deskripsi text;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: lines harus berupa array'
      USING ERRCODE = '22023';
  END IF;

  FOR v_line IN
    SELECT value
    FROM jsonb_array_elements(p_lines)
  LOOP
    v_position := v_position + 1;

    IF jsonb_typeof(v_line) <> 'object' THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: line % harus berupa object', v_position
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_barang_id := nullif(btrim(coalesce(v_line->>'barang_id', '')), '')::uuid;
      v_varian_barang_id := nullif(btrim(coalesce(v_line->>'varian_barang_id', '')), '')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: target line % memiliki UUID yang tidak valid', v_position
          USING ERRCODE = '22023';
    END;

    IF num_nonnulls(v_barang_id, v_varian_barang_id) <> 1 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: line % harus memiliki tepat satu target barang atau varian', v_position
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_jumlah := (v_line->>'jumlah')::numeric;
      v_unit_price := (v_line->>'unit_price')::numeric;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: jumlah/unit_price pada line % tidak valid', v_position
          USING ERRCODE = '22023';
    END;

    IF v_jumlah IS NULL OR v_jumlah <= 0 OR v_jumlah <> round(v_jumlah, 2) THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: jumlah pada line % harus > 0 dengan maksimal 2 desimal', v_position
        USING ERRCODE = '22023';
    END IF;

    IF v_unit_price IS NULL OR v_unit_price < 0 OR v_unit_price <> round(v_unit_price, 2) THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: unit_price pada line % harus >= 0 dengan maksimal 2 desimal', v_position
        USING ERRCODE = '22023';
    END IF;

    IF v_barang_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.barang b
      WHERE b.usaha_id = p_usaha_id
        AND b.barang_id = v_barang_id
    ) THEN
      RAISE EXCEPTION 'NOT_FOUND: barang pada line % tidak ditemukan dalam usaha aktif', v_position
        USING ERRCODE = 'P0002';
    END IF;

    IF v_varian_barang_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.varian_barang v
      WHERE v.usaha_id = p_usaha_id
        AND v.varian_barang_id = v_varian_barang_id
    ) THEN
      RAISE EXCEPTION 'NOT_FOUND: varian pada line % tidak ditemukan dalam usaha aktif', v_position
        USING ERRCODE = 'P0002';
    END IF;

    v_deskripsi := nullif(btrim(coalesce(v_line->>'deskripsi', '')), '');
    v_subtotal := round(v_jumlah * v_unit_price, 2);
    v_total := round(v_total + v_subtotal, 2);

    INSERT INTO public.detail_pembelian (
      detail_pembelian_id,
      usaha_id,
      pembelian_id,
      barang_id,
      varian_barang_id,
      deskripsi,
      jumlah,
      unit_price,
      subtotal
    )
    VALUES (
      gen_random_uuid(),
      p_usaha_id,
      p_pembelian_id,
      v_barang_id,
      v_varian_barang_id,
      v_deskripsi,
      v_jumlah,
      v_unit_price,
      v_subtotal
    );
  END LOOP;

  RETURN v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_create_supplier(
  p_usaha_id uuid,
  p_nama text,
  p_nomor_telepon text,
  p_email text,
  p_alamat text,
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
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_pemasok public.pemasok%ROWTYPE;
  v_response jsonb;
  v_name text := btrim(coalesce(p_nama, ''));
  v_phone text := nullif(btrim(coalesce(p_nomor_telepon, '')), '');
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_address text := nullif(btrim(coalesce(p_alamat, '')), '');
  v_note text := nullif(btrim(coalesce(p_catatan, '')), '');
BEGIN
  v_admin_id := app_private.procurement_require_admin(p_usaha_id);

  IF v_name = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: nama pemasok wajib diisi'
      USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi'
      USING ERRCODE = '22023';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: request_id wajib diisi'
      USING ERRCODE = '22023';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'nama', v_name,
    'nomor_telepon', v_phone,
    'email', v_email,
    'alamat', v_address,
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
    'create_supplier',
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
      AND ik.command_name = 'create_supplier'
      AND ik.key = btrim(p_idempotency_key);

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda'
        USING ERRCODE = '23505';
    END IF;

    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;

    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.pemasok (
    usaha_id,
    nama,
    nomor_telepon,
    email,
    alamat,
    status,
    catatan
  )
  VALUES (
    p_usaha_id,
    v_name,
    v_phone,
    v_email,
    v_address,
    'active',
    v_note
  )
  RETURNING * INTO v_pemasok;

  v_response := jsonb_build_object(
    'pemasok_id', v_pemasok.pemasok_id,
    'usaha_id', v_pemasok.usaha_id,
    'nama', v_pemasok.nama,
    'nomor_telepon', v_pemasok.nomor_telepon,
    'email', v_pemasok.email,
    'alamat', v_pemasok.alamat,
    'status', v_pemasok.status,
    'catatan', v_pemasok.catatan,
    'created_at', v_pemasok.created_at,
    'updated_at', v_pemasok.updated_at
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
    'create',
    'pemasok',
    v_pemasok.pemasok_id,
    'admin-command',
    p_request_id,
    jsonb_build_object(
      'operation', 'create_supplier',
      'status', v_pemasok.status,
      'has_phone', v_pemasok.nomor_telepon IS NOT NULL,
      'has_email', v_pemasok.email IS NOT NULL,
      'has_address', v_pemasok.alamat IS NOT NULL,
      'has_note', v_pemasok.catatan IS NOT NULL
    )
  );

  UPDATE public.idempotency_key
  SET response_status = 200,
      response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_update_supplier(
  p_usaha_id uuid,
  p_pemasok_id uuid,
  p_nama text,
  p_nomor_telepon text,
  p_email text,
  p_alamat text,
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
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_old public.pemasok%ROWTYPE;
  v_new public.pemasok%ROWTYPE;
  v_response jsonb;
  v_name text := btrim(coalesce(p_nama, ''));
  v_phone text := nullif(btrim(coalesce(p_nomor_telepon, '')), '');
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_address text := nullif(btrim(coalesce(p_alamat, '')), '');
  v_note text := nullif(btrim(coalesce(p_catatan, '')), '');
BEGIN
  v_admin_id := app_private.procurement_require_admin(p_usaha_id);

  IF p_pemasok_id IS NULL OR v_name = '' OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: data pemasok belum lengkap'
      USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi'
      USING ERRCODE = '22023';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'pemasok_id', p_pemasok_id,
    'nama', v_name,
    'nomor_telepon', v_phone,
    'email', v_email,
    'alamat', v_address,
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
    'update_supplier',
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
      AND ik.command_name = 'update_supplier'
      AND ik.key = btrim(p_idempotency_key);

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda'
        USING ERRCODE = '23505';
    END IF;

    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;

    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response'
      USING ERRCODE = '40001';
  END IF;

  SELECT *
  INTO v_old
  FROM public.pemasok
  WHERE usaha_id = p_usaha_id
    AND pemasok_id = p_pemasok_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: pemasok tidak ditemukan dalam usaha aktif'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_old.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_DATA: data pemasok berubah sejak dibuka. Muat ulang sebelum menyimpan.'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.pemasok
  SET nama = v_name,
      nomor_telepon = v_phone,
      email = v_email,
      alamat = v_address,
      catatan = v_note,
      updated_at = now()
  WHERE usaha_id = p_usaha_id
    AND pemasok_id = p_pemasok_id
  RETURNING * INTO v_new;

  v_response := jsonb_build_object(
    'pemasok_id', v_new.pemasok_id,
    'usaha_id', v_new.usaha_id,
    'nama', v_new.nama,
    'nomor_telepon', v_new.nomor_telepon,
    'email', v_new.email,
    'alamat', v_new.alamat,
    'status', v_new.status,
    'catatan', v_new.catatan,
    'created_at', v_new.created_at,
    'updated_at', v_new.updated_at
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
    'update',
    'pemasok',
    p_pemasok_id,
    'admin-command',
    p_request_id,
    jsonb_build_object(
      'operation', 'update_supplier',
      'nama_changed', v_old.nama IS DISTINCT FROM v_new.nama,
      'nomor_telepon_changed', v_old.nomor_telepon IS DISTINCT FROM v_new.nomor_telepon,
      'email_changed', v_old.email IS DISTINCT FROM v_new.email,
      'alamat_changed', v_old.alamat IS DISTINCT FROM v_new.alamat,
      'catatan_changed', v_old.catatan IS DISTINCT FROM v_new.catatan
    )
  );

  UPDATE public.idempotency_key
  SET response_status = 200,
      response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_set_supplier_status(
  p_usaha_id uuid,
  p_pemasok_id uuid,
  p_status text,
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
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_old public.pemasok%ROWTYPE;
  v_new public.pemasok%ROWTYPE;
  v_response jsonb;
  v_status text := lower(btrim(coalesce(p_status, '')));
BEGIN
  v_admin_id := app_private.procurement_require_admin(p_usaha_id);

  IF p_pemasok_id IS NULL OR v_status NOT IN ('active', 'inactive') OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: status pemasok tidak valid'
      USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi'
      USING ERRCODE = '22023';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'pemasok_id', p_pemasok_id,
    'status', v_status,
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
    'set_supplier_status',
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
      AND ik.command_name = 'set_supplier_status'
      AND ik.key = btrim(p_idempotency_key);

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda'
        USING ERRCODE = '23505';
    END IF;

    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;

    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response'
      USING ERRCODE = '40001';
  END IF;

  SELECT *
  INTO v_old
  FROM public.pemasok
  WHERE usaha_id = p_usaha_id
    AND pemasok_id = p_pemasok_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: pemasok tidak ditemukan dalam usaha aktif'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_old.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_DATA: data pemasok berubah sejak dibuka. Muat ulang sebelum menyimpan.'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.pemasok
  SET status = v_status,
      updated_at = now()
  WHERE usaha_id = p_usaha_id
    AND pemasok_id = p_pemasok_id
  RETURNING * INTO v_new;

  v_response := jsonb_build_object(
    'pemasok_id', v_new.pemasok_id,
    'usaha_id', v_new.usaha_id,
    'status', v_new.status,
    'updated_at', v_new.updated_at
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
    'status_change',
    'pemasok',
    p_pemasok_id,
    'admin-command',
    p_request_id,
    jsonb_build_object(
      'operation', 'set_supplier_status',
      'from', v_old.status,
      'to', v_new.status
    )
  );

  UPDATE public.idempotency_key
  SET response_status = 200,
      response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_create_purchase(
  p_usaha_id uuid,
  p_pemasok_id uuid,
  p_nomor_pembelian text,
  p_tanggal_pembelian date,
  p_lines jsonb,
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
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_purchase public.pembelian%ROWTYPE;
  v_total numeric(19,2);
  v_response jsonb;
  v_number text := btrim(coalesce(p_nomor_pembelian, ''));
  v_note text := nullif(btrim(coalesce(p_catatan, '')), '');
BEGIN
  v_admin_id := app_private.procurement_require_admin(p_usaha_id);

  IF p_pemasok_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.pemasok s
    WHERE s.usaha_id = p_usaha_id
      AND s.pemasok_id = p_pemasok_id
      AND s.status = 'active'
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: pemasok aktif tidak ditemukan dalam usaha'
      USING ERRCODE = '23514';
  END IF;

  IF v_number = '' OR p_tanggal_pembelian IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: nomor dan tanggal pembelian wajib diisi'
      USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi'
      USING ERRCODE = '22023';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: lines harus berupa array'
      USING ERRCODE = '22023';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'pemasok_id', p_pemasok_id,
    'nomor_pembelian', v_number,
    'tanggal_pembelian', p_tanggal_pembelian,
    'lines', p_lines,
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
    'create_purchase',
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
      AND ik.command_name = 'create_purchase'
      AND ik.key = btrim(p_idempotency_key);

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda'
        USING ERRCODE = '23505';
    END IF;

    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;

    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response'
      USING ERRCODE = '40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text || ':purchase-draft:' || v_number, 0));

  INSERT INTO public.pembelian (
    usaha_id,
    pemasok_id,
    nomor_pembelian,
    tanggal_pembelian,
    status,
    total_amount,
    currency_code,
    catatan
  )
  VALUES (
    p_usaha_id,
    p_pemasok_id,
    v_number,
    p_tanggal_pembelian,
    'draft',
    0,
    'IDR',
    v_note
  )
  RETURNING * INTO v_purchase;

  v_total := app_private.procurement_insert_purchase_lines(
    p_usaha_id,
    v_purchase.pembelian_id,
    p_lines
  );

  UPDATE public.pembelian
  SET total_amount = v_total,
      updated_at = now()
  WHERE usaha_id = p_usaha_id
    AND pembelian_id = v_purchase.pembelian_id
  RETURNING * INTO v_purchase;

  v_response := jsonb_build_object(
    'pembelian_id', v_purchase.pembelian_id,
    'usaha_id', v_purchase.usaha_id,
    'pemasok_id', v_purchase.pemasok_id,
    'nomor_pembelian', v_purchase.nomor_pembelian,
    'tanggal_pembelian', v_purchase.tanggal_pembelian,
    'status', v_purchase.status,
    'total_amount', v_purchase.total_amount,
    'currency_code', v_purchase.currency_code,
    'catatan', v_purchase.catatan,
    'line_count', jsonb_array_length(p_lines),
    'created_at', v_purchase.created_at,
    'updated_at', v_purchase.updated_at
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
    'create',
    'pembelian',
    v_purchase.pembelian_id,
    'admin-command',
    p_request_id,
    jsonb_build_object(
      'operation', 'create_purchase_draft',
      'nomor_pembelian', v_purchase.nomor_pembelian,
      'pemasok_id', v_purchase.pemasok_id,
      'status', v_purchase.status,
      'line_count', jsonb_array_length(p_lines),
      'total_amount', v_purchase.total_amount,
      'currency_code', v_purchase.currency_code
    )
  );

  UPDATE public.idempotency_key
  SET response_status = 200,
      response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_update_purchase_draft(
  p_usaha_id uuid,
  p_pembelian_id uuid,
  p_pemasok_id uuid,
  p_nomor_pembelian text,
  p_tanggal_pembelian date,
  p_lines jsonb,
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
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_old public.pembelian%ROWTYPE;
  v_new public.pembelian%ROWTYPE;
  v_total numeric(19,2);
  v_response jsonb;
  v_number text := btrim(coalesce(p_nomor_pembelian, ''));
  v_note text := nullif(btrim(coalesce(p_catatan, '')), '');
BEGIN
  v_admin_id := app_private.procurement_require_admin(p_usaha_id);

  IF p_pembelian_id IS NULL OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: pembelian dan expected_updated_at wajib diisi'
      USING ERRCODE = '22023';
  END IF;

  IF v_number = '' OR p_tanggal_pembelian IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: nomor dan tanggal pembelian wajib diisi'
      USING ERRCODE = '22023';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: lines harus berupa array'
      USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi'
      USING ERRCODE = '22023';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'pembelian_id', p_pembelian_id,
    'pemasok_id', p_pemasok_id,
    'nomor_pembelian', v_number,
    'tanggal_pembelian', p_tanggal_pembelian,
    'lines', p_lines,
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
    'update_purchase_draft',
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
      AND ik.command_name = 'update_purchase_draft'
      AND ik.key = btrim(p_idempotency_key);

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda'
        USING ERRCODE = '23505';
    END IF;

    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;

    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response'
      USING ERRCODE = '40001';
  END IF;

  SELECT *
  INTO v_old
  FROM public.pembelian
  WHERE usaha_id = p_usaha_id
    AND pembelian_id = p_pembelian_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: pembelian tidak ditemukan dalam usaha aktif'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_old.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_DATA: data pembelian berubah sejak dibuka. Muat ulang sebelum menyimpan.'
      USING ERRCODE = '40001';
  END IF;

  IF v_old.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: pembelian yang sudah committed tidak dapat diubah melalui draft command'
      USING ERRCODE = '23514';
  END IF;

  IF p_pemasok_id IS NOT NULL
     AND p_pemasok_id IS DISTINCT FROM v_old.pemasok_id
     AND NOT EXISTS (
       SELECT 1
       FROM public.pemasok s
       WHERE s.usaha_id = p_usaha_id
         AND s.pemasok_id = p_pemasok_id
         AND s.status = 'active'
     )
  THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: pemasok aktif tidak ditemukan dalam usaha'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.pembelian
  SET pemasok_id = p_pemasok_id,
      nomor_pembelian = v_number,
      tanggal_pembelian = p_tanggal_pembelian,
      catatan = v_note
  WHERE usaha_id = p_usaha_id
    AND pembelian_id = p_pembelian_id;

  DELETE FROM public.detail_pembelian
  WHERE usaha_id = p_usaha_id
    AND pembelian_id = p_pembelian_id;

  v_total := app_private.procurement_insert_purchase_lines(
    p_usaha_id,
    p_pembelian_id,
    p_lines
  );

  UPDATE public.pembelian
  SET total_amount = v_total,
      updated_at = now()
  WHERE usaha_id = p_usaha_id
    AND pembelian_id = p_pembelian_id
  RETURNING * INTO v_new;

  v_response := jsonb_build_object(
    'pembelian_id', v_new.pembelian_id,
    'usaha_id', v_new.usaha_id,
    'pemasok_id', v_new.pemasok_id,
    'nomor_pembelian', v_new.nomor_pembelian,
    'tanggal_pembelian', v_new.tanggal_pembelian,
    'status', v_new.status,
    'total_amount', v_new.total_amount,
    'currency_code', v_new.currency_code,
    'catatan', v_new.catatan,
    'line_count', jsonb_array_length(p_lines),
    'created_at', v_new.created_at,
    'updated_at', v_new.updated_at
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
    'update',
    'pembelian',
    p_pembelian_id,
    'admin-command',
    p_request_id,
    jsonb_build_object(
      'operation', 'update_purchase_draft',
      'nomor_changed', v_old.nomor_pembelian IS DISTINCT FROM v_new.nomor_pembelian,
      'tanggal_changed', v_old.tanggal_pembelian IS DISTINCT FROM v_new.tanggal_pembelian,
      'pemasok_changed', v_old.pemasok_id IS DISTINCT FROM v_new.pemasok_id,
      'catatan_changed', v_old.catatan IS DISTINCT FROM v_new.catatan,
      'line_count', jsonb_array_length(p_lines),
      'total_amount', v_new.total_amount,
      'currency_code', v_new.currency_code
    )
  );

  UPDATE public.idempotency_key
  SET response_status = 200,
      response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_reconcile_procurement_mutation(
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
  PERFORM app_private.procurement_require_admin(p_usaha_id);

  IF p_command_name NOT IN (
    'create_supplier',
    'update_supplier',
    'set_supplier_status',
    'create_purchase',
    'update_purchase_draft'
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: command_name procurement tidak didukung'
      USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_row
  FROM public.idempotency_key
  WHERE usaha_id = p_usaha_id
    AND actor_auth_user_id = v_auth_user_id
    AND command_name = p_command_name
    AND key = btrim(p_idempotency_key);

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'state', 'not_found',
      'response', NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_row.response_body IS NULL THEN 'unknown' ELSE 'committed' END,
    'response', v_row.response_body
  );
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.validate_purchase_supplier_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.pemasok_id IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR NEW.pemasok_id IS DISTINCT FROM OLD.pemasok_id
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.pemasok s
       WHERE s.usaha_id = NEW.usaha_id
         AND s.pemasok_id = NEW.pemasok_id
         AND s.status = 'active'
     )
  THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: pembelian baru hanya dapat menggunakan pemasok aktif'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_purchase_supplier_state ON public.pembelian;

CREATE TRIGGER trg_purchase_supplier_state
BEFORE INSERT OR UPDATE OF pemasok_id ON public.pembelian
FOR EACH ROW
EXECUTE FUNCTION app_private.validate_purchase_supplier_state();

REVOKE ALL ON FUNCTION app_private.procurement_require_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.procurement_insert_purchase_lines(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.validate_purchase_supplier_state() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION app_private.command_create_supplier(uuid,text,text,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.command_update_supplier(uuid,uuid,text,text,text,text,text,timestamptz,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.command_set_supplier_status(uuid,uuid,text,timestamptz,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.command_create_purchase(uuid,uuid,text,date,jsonb,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.command_update_purchase_draft(uuid,uuid,uuid,text,date,jsonb,text,timestamptz,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.command_reconcile_procurement_mutation(uuid,text,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION app_private.command_create_supplier(uuid,text,text,text,text,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_update_supplier(uuid,uuid,text,text,text,text,text,timestamptz,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_set_supplier_status(uuid,uuid,text,timestamptz,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_create_purchase(uuid,uuid,text,date,jsonb,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_update_purchase_draft(uuid,uuid,uuid,text,date,jsonb,text,timestamptz,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_reconcile_procurement_mutation(uuid,text,text) TO authenticated;
