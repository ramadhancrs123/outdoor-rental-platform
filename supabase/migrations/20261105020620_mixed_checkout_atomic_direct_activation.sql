-- Atomic combined checkout variant for the "Langsung Sewa" action.
-- Retail sale, draft rental creation, automatic unit assignment and handover
-- all commit or roll back together. The existing command remains draft-only.

CREATE OR REPLACE FUNCTION app_private.command_create_mixed_checkout_and_activate(
  p_usaha_id uuid,
  p_penyewa_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz,
  p_rental_lines jsonb,
  p_sale_lines jsonb,
  p_akun_keuangan_id uuid,
  p_metode text,
  p_payment_rental_amount numeric,
  p_dibayar_at timestamptz,
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
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_checkout_response jsonb;
  v_activation_response jsonb;
  v_rental_id uuid;
  v_response jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL
     OR p_penyewa_id IS NULL
     OR p_rental_lines IS NULL
     OR jsonb_typeof(p_rental_lines) <> 'array'
     OR jsonb_array_length(p_rental_lines) = 0
     OR p_sale_lines IS NULL
     OR jsonb_typeof(p_sale_lines) <> 'array'
     OR jsonb_array_length(p_sale_lines) = 0
  THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: checkout gabungan membutuhkan minimal satu baris rental dan satu baris pembelian'
      USING ERRCODE = '22023';
  END IF;

  PERFORM app_private.assert_finance_admin(p_usaha_id);

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi'
      USING ERRCODE = '22023';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'penyewa_id', p_penyewa_id,
    'jadwal_mulai', p_jadwal_mulai,
    'jadwal_kembali', p_jadwal_kembali,
    'rental_lines', p_rental_lines,
    'sale_lines', p_sale_lines,
    'akun_keuangan_id', p_akun_keuangan_id,
    'metode', p_metode,
    'payment_rental_amount', coalesce(p_payment_rental_amount, 0),
    'dibayar_at', p_dibayar_at,
    'catatan', p_catatan,
    'activation_mode', 'direct'
  )::text);

  INSERT INTO public.idempotency_key(
    usaha_id,
    actor_auth_user_id,
    key,
    command_name,
    request_hash
  )
  VALUES(
    p_usaha_id,
    v_auth_user_id,
    btrim(p_idempotency_key),
    'create_mixed_checkout_and_activate',
    v_request_hash
  )
  ON CONFLICT(usaha_id, actor_auth_user_id, command_name, key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body, request_hash
    INTO v_existing_response, v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id = p_usaha_id
      AND actor_auth_user_id = v_auth_user_id
      AND command_name = 'create_mixed_checkout_and_activate'
      AND key = btrim(p_idempotency_key);

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key checkout langsung sudah digunakan untuk payload berbeda'
        USING ERRCODE = '23505';
    END IF;

    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;

    RAISE EXCEPTION 'UNKNOWN_OUTCOME: status checkout gabungan dan aktivasi belum dapat dipastikan'
      USING ERRCODE = '40001';
  END IF;

  -- The nested commands share this database transaction. Any failure during
  -- assignment or handover rolls back the sale, rental, ledger, audit and outbox.
  v_checkout_response := app_private.command_create_mixed_checkout(
    p_usaha_id,
    p_penyewa_id,
    p_jadwal_mulai,
    p_jadwal_kembali,
    p_rental_lines,
    p_sale_lines,
    p_akun_keuangan_id,
    p_metode,
    coalesce(p_payment_rental_amount, 0),
    p_dibayar_at,
    p_catatan,
    left(btrim(p_idempotency_key) || ':mixed', 240),
    p_request_id
  );

  v_rental_id := nullif(v_checkout_response->>'penyewaan_id', '')::uuid;
  IF v_rental_id IS NULL THEN
    RAISE EXCEPTION 'INTERNAL_ERROR: checkout gabungan tidak mengembalikan penyewaan_id'
      USING ERRCODE = 'P0001';
  END IF;

  v_activation_response := app_private.command_operational_activate_rental(
    p_usaha_id,
    v_rental_id,
    p_catatan,
    left(btrim(p_idempotency_key) || ':activate', 240),
    p_request_id
  );

  v_response := v_checkout_response || jsonb_build_object(
    'rental_activation',
    v_activation_response
  );

  UPDATE public.idempotency_key
  SET response_status = 200,
      response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_create_mixed_checkout_and_activate(
  uuid,uuid,timestamptz,timestamptz,jsonb,jsonb,uuid,text,numeric,timestamptz,text,text,uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_create_mixed_checkout_and_activate(
  uuid,uuid,timestamptz,timestamptz,jsonb,jsonb,uuid,text,numeric,timestamptz,text,text,uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.command_create_mixed_checkout_and_activate(
  p_usaha_id uuid,
  p_penyewa_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz,
  p_rental_lines jsonb,
  p_sale_lines jsonb,
  p_akun_keuangan_id uuid,
  p_metode text,
  p_payment_rental_amount numeric,
  p_dibayar_at timestamptz,
  p_catatan text,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_create_mixed_checkout_and_activate(
    p_usaha_id,
    p_penyewa_id,
    p_jadwal_mulai,
    p_jadwal_kembali,
    p_rental_lines,
    p_sale_lines,
    p_akun_keuangan_id,
    p_metode,
    p_payment_rental_amount,
    p_dibayar_at,
    p_catatan,
    p_idempotency_key,
    p_request_id
  );
$function$;

REVOKE ALL ON FUNCTION public.command_create_mixed_checkout_and_activate(
  uuid,uuid,timestamptz,timestamptz,jsonb,jsonb,uuid,text,numeric,timestamptz,text,text,uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_create_mixed_checkout_and_activate(
  uuid,uuid,timestamptz,timestamptz,jsonb,jsonb,uuid,text,numeric,timestamptz,text,text,uuid
) TO authenticated;


-- Extend the existing authenticated command reconciliation boundary to include
-- the atomic direct-activation variant.
CREATE OR REPLACE FUNCTION app_private.command_reconcile_retail_command(
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

  PERFORM app_private.catalog_require_admin(p_usaha_id);

  IF p_command_name NOT IN (
    'create_sale',
    'create_sale_with_renter',
    'create_mixed_checkout',
    'create_mixed_checkout_and_activate',
    'adjust_sale_stock',
    'set_barang_sales_config',
    'set_varian_sales_config'
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: command penjualan tidak dikenal' USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_row
  FROM public.idempotency_key
  WHERE usaha_id = p_usaha_id
    AND actor_auth_user_id = v_auth_user_id
    AND command_name = p_command_name
    AND key = btrim(p_idempotency_key);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found', 'response', NULL);
  END IF;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_row.response_body IS NULL THEN 'unknown' ELSE 'committed' END,
    'response', v_row.response_body
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
