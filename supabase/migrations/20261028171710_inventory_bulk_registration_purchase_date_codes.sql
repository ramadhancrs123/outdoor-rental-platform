-- Date-based purchase numbers: first purchase per tenant/date uses PB-YYYY-MM-DD.
-- Further purchases on the same date use a deterministic suffix, e.g. -002, -003.
CREATE OR REPLACE FUNCTION app_private.purchase_number_preview(
  p_usaha_id uuid,
  p_tanggal_pembelian date
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_base text;
  v_existing bigint := 0;
BEGIN
  PERFORM app_private.procurement_require_admin(p_usaha_id);
  IF p_tanggal_pembelian IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tanggal pembelian wajib diisi' USING ERRCODE='22023';
  END IF;

  v_base := 'PB-' || to_char(p_tanggal_pembelian, 'YYYY-MM-DD');
  SELECT coalesce(max(
    CASE
      WHEN p.nomor_pembelian = v_base THEN 1
      WHEN p.nomor_pembelian ~ ('^' || v_base || '-[0-9]+$')
        THEN substring(p.nomor_pembelian FROM ('^' || v_base || '-([0-9]+)$'))::bigint
      ELSE 0
    END
  ), 0)
  INTO v_existing
  FROM public.pembelian p
  WHERE p.usaha_id = p_usaha_id
    AND (p.nomor_pembelian = v_base OR p.nomor_pembelian ~ ('^' || v_base || '-[0-9]+$'));

  IF v_existing = 0 THEN
    RETURN v_base;
  END IF;
  RETURN v_base || '-' || lpad((v_existing + 1)::text, 3, '0');
END;
$function$;

REVOKE ALL ON FUNCTION app_private.purchase_number_preview(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.purchase_number_preview(uuid,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.purchase_number_preview(p_usaha_id uuid, p_tanggal_pembelian date)
RETURNS text
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.purchase_number_preview($1, $2);
$function$;
REVOKE ALL ON FUNCTION public.purchase_number_preview(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_number_preview(uuid,date) TO authenticated;

-- Enforce the same format on the server so concurrent requests or stale previews cannot
-- create duplicate numbers. A date lock serializes purchases for the same tenant/date.
CREATE OR REPLACE FUNCTION app_private.normalize_purchase_number_by_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_base text;
  v_existing bigint := 0;
BEGIN
  IF NEW.usaha_id IS NULL OR NEW.tanggal_pembelian IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha dan tanggal pembelian wajib diisi' USING ERRCODE='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.usaha_id::text || ':purchase-date:' || NEW.tanggal_pembelian::text, 0
  ));
  v_base := 'PB-' || to_char(NEW.tanggal_pembelian, 'YYYY-MM-DD');

  SELECT coalesce(max(
    CASE
      WHEN p.nomor_pembelian = v_base THEN 1
      WHEN p.nomor_pembelian ~ ('^' || v_base || '-[0-9]+$')
        THEN substring(p.nomor_pembelian FROM ('^' || v_base || '-([0-9]+)$'))::bigint
      ELSE 0
    END
  ), 0)
  INTO v_existing
  FROM public.pembelian p
  WHERE p.usaha_id = NEW.usaha_id
    AND (p.nomor_pembelian = v_base OR p.nomor_pembelian ~ ('^' || v_base || '-[0-9]+$'));

  NEW.nomor_pembelian := CASE
    WHEN v_existing = 0 THEN v_base
    ELSE v_base || '-' || lpad((v_existing + 1)::text, 3, '0')
  END;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION app_private.normalize_purchase_number_by_date() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_pembelian_normalize_date_number ON public.pembelian;
CREATE TRIGGER trg_pembelian_normalize_date_number
BEFORE INSERT ON public.pembelian
FOR EACH ROW EXECUTE FUNCTION app_private.normalize_purchase_number_by_date();

-- Atomic bulk inventory registration. Every physical unit still goes through the existing
-- trusted single-unit command, so IDs, unit codes, history, audit and outbox are generated
-- consistently; a failure rolls back the entire batch.
CREATE OR REPLACE FUNCTION app_private.command_register_inventory_units(
  p_usaha_id uuid,
  p_barang_id uuid,
  p_varian_barang_id uuid,
  p_jumlah_unit integer,
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
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_note text := nullif(btrim(coalesce(p_catatan_internal, '')), '');
  v_units jsonb := '[]'::jsonb;
  v_unit jsonb;
  v_response jsonb;
  v_index integer;
  v_inner_key text;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;
  IF p_usaha_id IS NULL OR p_barang_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id dan barang wajib diisi' USING ERRCODE='22023';
  END IF;
  IF p_jumlah_unit IS NULL OR p_jumlah_unit < 1 OR p_jumlah_unit > 250 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: jumlah unit harus antara 1 dan 250' USING ERRCODE='22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi' USING ERRCODE='22023';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'barang_id', p_barang_id,
    'varian_barang_id', p_varian_barang_id,
    'jumlah_unit', p_jumlah_unit,
    'lokasi_id', p_lokasi_id,
    'tanggal_diperoleh', p_tanggal_diperoleh,
    'sumber_pembelian_detail_id', p_sumber_pembelian_detail_id,
    'catatan_internal', v_note
  )::text);

  INSERT INTO public.idempotency_key(usaha_id, actor_auth_user_id, key, command_name, request_hash)
  VALUES(p_usaha_id, v_auth_user_id, btrim(p_idempotency_key), 'register_inventory_units', v_request_hash)
  ON CONFLICT(usaha_id, actor_auth_user_id, command_name, key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.response_body, ik.request_hash
    INTO v_existing_response, v_existing_hash
    FROM public.idempotency_key ik
    WHERE ik.usaha_id = p_usaha_id
      AND ik.actor_auth_user_id = v_auth_user_id
      AND ik.command_name = 'register_inventory_units'
      AND ik.key = btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE='40001';
  END IF;

  FOR v_index IN 1..p_jumlah_unit LOOP
    v_inner_key := left(btrim(p_idempotency_key) || ':unit:' || lpad(v_index::text, 4, '0'), 200);
    v_unit := app_private.command_register_inventory_unit(
      p_usaha_id,
      p_barang_id,
      p_varian_barang_id,
      NULL,
      NULL,
      p_lokasi_id,
      p_tanggal_diperoleh,
      p_sumber_pembelian_detail_id,
      v_note,
      v_inner_key,
      p_request_id
    );
    v_units := v_units || jsonb_build_array(v_unit);
  END LOOP;

  v_response := jsonb_build_object(
    'usaha_id', p_usaha_id,
    'jumlah_unit', p_jumlah_unit,
    'units', v_units
  );
  UPDATE public.idempotency_key
  SET response_status = 200, response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;
  RETURN v_response;
END;
$function$;
REVOKE ALL ON FUNCTION app_private.command_register_inventory_units(uuid,uuid,uuid,integer,uuid,date,uuid,text,text,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_register_inventory_units(uuid,uuid,uuid,integer,uuid,date,uuid,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.command_register_inventory_units(
  p_usaha_id uuid,
  p_barang_id uuid,
  p_varian_barang_id uuid,
  p_jumlah_unit integer,
  p_lokasi_id uuid,
  p_tanggal_diperoleh date,
  p_sumber_pembelian_detail_id uuid,
  p_catatan_internal text,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_register_inventory_units($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
$function$;
REVOKE ALL ON FUNCTION public.command_register_inventory_units(uuid,uuid,uuid,integer,uuid,date,uuid,text,text,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_register_inventory_units(uuid,uuid,uuid,integer,uuid,date,uuid,text,text,uuid) TO authenticated;

-- Allow the existing reconciliation endpoint to report the atomic batch response.
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
     OR p_command_name NOT IN ('register_inventory_unit', 'register_inventory_units', 'move_inventory_unit', 'mark_inventory_unit_ready')
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: reconciliation input tidak valid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku ON ku.akun_admin_id = aa.akun_admin_id
      AND ku.status = 'active' AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id = v_auth_user_id AND aa.status = 'active'
      AND aa.role = 'super_admin' AND ku.usaha_id = p_usaha_id
  ) THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.idempotency_key ik
  WHERE ik.usaha_id = p_usaha_id AND ik.actor_auth_user_id = v_auth_user_id
    AND ik.command_name = p_command_name AND ik.key = btrim(p_idempotency_key);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found', 'response', null);
  END IF;
  RETURN jsonb_build_object(
    'state', CASE WHEN v_row.response_body IS NULL THEN 'unknown' ELSE 'committed' END,
    'response', v_row.response_body
  );
END;
$function$;
REVOKE ALL ON FUNCTION app_private.command_reconcile_inventory_unit_mutation(uuid,text,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_reconcile_inventory_unit_mutation(uuid,text,text) TO authenticated;
