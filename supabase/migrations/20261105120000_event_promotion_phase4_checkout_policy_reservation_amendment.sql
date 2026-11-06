
-- Phase 4: explicit checkout discount policy and audited reservation amendment.
-- This migration is intentionally local-only until reviewed and separately approved.

CREATE TABLE public.kebijakan_diskon_checkout (
  usaha_id uuid PRIMARY KEY REFERENCES public.usaha(usaha_id) ON DELETE RESTRICT,
  manual_discount_enabled boolean NOT NULL DEFAULT false,
  allow_above_loyalty boolean NOT NULL DEFAULT false,
  max_discount_percent numeric(5,2),
  max_discount_amount numeric(14,2),
  require_reason boolean NOT NULL DEFAULT true,
  allowed_reason_codes text[] NOT NULL DEFAULT ARRAY[
    'service_recovery',
    'customer_retention',
    'manager_adjustment',
    'other'
  ]::text[],
  created_by_akun_admin_id uuid REFERENCES public.akun_admin(akun_admin_id) ON DELETE SET NULL,
  updated_by_akun_admin_id uuid REFERENCES public.akun_admin(akun_admin_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kebijakan_diskon_checkout_percent_check
    CHECK (max_discount_percent IS NULL OR max_discount_percent BETWEEN 0.01 AND 100.00),
  CONSTRAINT kebijakan_diskon_checkout_amount_check
    CHECK (max_discount_amount IS NULL OR max_discount_amount > 0),
  CONSTRAINT kebijakan_diskon_checkout_manual_limit_check
    CHECK (
      manual_discount_enabled = false
      OR max_discount_percent IS NOT NULL
      OR max_discount_amount IS NOT NULL
    ),
  CONSTRAINT kebijakan_diskon_checkout_override_check
    CHECK (allow_above_loyalty = false OR manual_discount_enabled = true),
  CONSTRAINT kebijakan_diskon_checkout_reason_codes_check
    CHECK (cardinality(allowed_reason_codes) > 0)
);

ALTER TABLE public.kebijakan_diskon_checkout ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kebijakan_diskon_checkout FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.kebijakan_diskon_checkout TO authenticated;

CREATE POLICY kebijakan_diskon_checkout_member_read
  ON public.kebijakan_diskon_checkout
  FOR SELECT TO authenticated
  USING (app_private.has_usaha_access(usaha_id));

CREATE OR REPLACE FUNCTION app_private.command_set_checkout_discount_policy(
  p_usaha_id uuid,
  p_manual_discount_enabled boolean,
  p_allow_above_loyalty boolean,
  p_max_discount_percent numeric,
  p_max_discount_amount numeric,
  p_require_reason boolean,
  p_allowed_reason_codes text[],
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor_admin_id uuid;
  v_auth_user_id uuid := auth.uid();
  v_hash text;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_before jsonb;
  v_response jsonb;
  v_codes text[] := coalesce(p_allowed_reason_codes, ARRAY[]::text[]);
BEGIN
  v_actor_admin_id := app_private.require_usaha_permission(p_usaha_id, 'event_promotion.manage');

  IF p_manual_discount_enabled IS NULL
     OR p_allow_above_loyalty IS NULL
     OR p_require_reason IS NULL
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = ''
     OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: konfigurasi diskon checkout tidak lengkap'
      USING ERRCODE = '22023';
  END IF;

  IF p_max_discount_percent IS NOT NULL
     AND (p_max_discount_percent <= 0 OR p_max_discount_percent > 100) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: batas persentase harus di atas 0 dan maksimal 100'
      USING ERRCODE = '22023';
  END IF;

  IF p_max_discount_amount IS NOT NULL AND p_max_discount_amount <= 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: batas nominal harus lebih besar dari nol'
      USING ERRCODE = '22023';
  END IF;

  IF p_manual_discount_enabled
     AND p_max_discount_percent IS NULL
     AND p_max_discount_amount IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: diskon manual membutuhkan batas persentase atau nominal'
      USING ERRCODE = '22023';
  END IF;

  IF p_allow_above_loyalty AND NOT p_manual_discount_enabled THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: override loyalitas memerlukan diskon manual aktif'
      USING ERRCODE = '22023';
  END IF;

  IF cardinality(v_codes) = 0
     OR EXISTS (
       SELECT 1 FROM unnest(v_codes) code
       WHERE code NOT IN ('service_recovery','customer_retention','manager_adjustment','other')
     ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: daftar alasan diskon tidak valid'
      USING ERRCODE = '22023';
  END IF;

  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'manual_discount_enabled', p_manual_discount_enabled,
    'allow_above_loyalty', p_allow_above_loyalty,
    'max_discount_percent', p_max_discount_percent,
    'max_discount_amount', p_max_discount_amount,
    'require_reason', p_require_reason,
    'allowed_reason_codes', v_codes
  )::text);

  INSERT INTO public.idempotency_key (
    usaha_id, actor_auth_user_id, key, command_name, request_hash
  )
  VALUES (
    p_usaha_id, v_auth_user_id, btrim(p_idempotency_key),
    'set_checkout_discount_policy', v_hash
  )
  ON CONFLICT (usaha_id, actor_auth_user_id, command_name, key)
  DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT request_hash, response_body
      INTO v_existing_hash, v_existing_response
    FROM public.idempotency_key
    WHERE usaha_id = p_usaha_id
      AND actor_auth_user_id = v_auth_user_id
      AND command_name = 'set_checkout_discount_policy'
      AND key = btrim(p_idempotency_key);

    IF v_existing_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda'
        USING ERRCODE = '23505';
    END IF;

    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;

    RAISE EXCEPTION 'UNKNOWN_OUTCOME: hasil perubahan kebijakan belum tersedia'
      USING ERRCODE = '40001';
  END IF;

  SELECT to_jsonb(k)
    INTO v_before
  FROM public.kebijakan_diskon_checkout k
  WHERE k.usaha_id = p_usaha_id
  FOR UPDATE;

  INSERT INTO public.kebijakan_diskon_checkout (
    usaha_id,
    manual_discount_enabled,
    allow_above_loyalty,
    max_discount_percent,
    max_discount_amount,
    require_reason,
    allowed_reason_codes,
    created_by_akun_admin_id,
    updated_by_akun_admin_id
  )
  VALUES (
    p_usaha_id,
    p_manual_discount_enabled,
    p_allow_above_loyalty,
    p_max_discount_percent,
    p_max_discount_amount,
    p_require_reason,
    v_codes,
    v_actor_admin_id,
    v_actor_admin_id
  )
  ON CONFLICT (usaha_id) DO UPDATE SET
    manual_discount_enabled = EXCLUDED.manual_discount_enabled,
    allow_above_loyalty = EXCLUDED.allow_above_loyalty,
    max_discount_percent = EXCLUDED.max_discount_percent,
    max_discount_amount = EXCLUDED.max_discount_amount,
    require_reason = EXCLUDED.require_reason,
    allowed_reason_codes = EXCLUDED.allowed_reason_codes,
    updated_by_akun_admin_id = EXCLUDED.updated_by_akun_admin_id,
    updated_at = now();

  SELECT jsonb_build_object(
    'usaha_id', k.usaha_id,
    'manual_discount_enabled', k.manual_discount_enabled,
    'allow_above_loyalty', k.allow_above_loyalty,
    'max_discount_percent', k.max_discount_percent,
    'max_discount_amount', k.max_discount_amount,
    'require_reason', k.require_reason,
    'allowed_reason_codes', k.allowed_reason_codes,
    'updated_at', k.updated_at
  )
  INTO v_response
  FROM public.kebijakan_diskon_checkout k
  WHERE k.usaha_id = p_usaha_id;

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, request_id, change_summary
  )
  VALUES (
    p_usaha_id, v_auth_user_id, v_actor_admin_id, 'configure',
    'kebijakan_diskon_checkout', p_usaha_id, 'admin-command', p_request_id,
    jsonb_build_object('before', v_before, 'after', v_response)
  );

  UPDATE public.idempotency_key
  SET response_status = 200, response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_set_checkout_discount_policy(
  uuid, boolean, boolean, numeric, numeric, boolean, text[], text, uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.command_set_checkout_discount_policy(
  p_usaha_id uuid,
  p_manual_discount_enabled boolean,
  p_allow_above_loyalty boolean,
  p_max_discount_percent numeric,
  p_max_discount_amount numeric,
  p_require_reason boolean,
  p_allowed_reason_codes text[],
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.command_set_checkout_discount_policy(
    $1,$2,$3,$4,$5,$6,$7,$8,$9
  );
$function$;

REVOKE ALL ON FUNCTION public.command_set_checkout_discount_policy(
  uuid, boolean, boolean, numeric, numeric, boolean, text[], text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_set_checkout_discount_policy(
  uuid, boolean, boolean, numeric, numeric, boolean, text[], text, uuid
) TO authenticated;

-- The manual discount resolver remains server-authoritative and now enforces
-- the business policy, reason whitelist, and per-business caps.
CREATE OR REPLACE FUNCTION app_private.resolve_checkout_discount(
  p_usaha_id uuid,
  p_penyewa_id uuid,
  p_rental_subtotal numeric,
  p_discount_request jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_mode text := coalesce(p_discount_request->>'mode', 'none');
  v_admin_id uuid;
  v_loyalty jsonb;
  v_policy public.kebijakan_diskon_checkout%ROWTYPE;
  v_has_policy boolean := false;
  v_eligible boolean := false;
  v_recommended numeric(14,2) := 0;
  v_actual numeric(14,2) := 0;
  v_bonus numeric(14,2) := 0;
  v_reason_code text;
  v_reason_note text;
  v_percent numeric(7,4);
BEGIN
  IF p_rental_subtotal IS NULL OR p_rental_subtotal < 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: subtotal rental tidak valid'
      USING ERRCODE = '22023';
  END IF;

  IF v_mode = 'none' THEN
    RETURN jsonb_build_object(
      'source', 'none',
      'actual_amount', 0,
      'recommended_amount', 0,
      'bonus_amount', 0,
      'reason_code', NULL,
      'reason_note', NULL
    );
  END IF;

  IF v_mode NOT IN ('loyalty', 'manual') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: mode diskon harus none, loyalty, atau manual'
      USING ERRCODE = '22023';
  END IF;

  v_admin_id := app_private.require_usaha_permission(
    p_usaha_id, 'checkout_discount.apply'
  );

  v_loyalty := app_private.resolve_loyalty_discount_snapshot(
    p_usaha_id, p_penyewa_id, p_rental_subtotal
  );
  v_eligible := coalesce((v_loyalty->>'eligible')::boolean, false);
  v_recommended := coalesce((v_loyalty->>'recommended_amount')::numeric, 0);

  IF v_mode = 'loyalty' THEN
    IF NOT v_eligible OR v_recommended <= 0 THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: penyewa belum memenuhi syarat program loyalitas atau nilai rekomendasi nol'
        USING ERRCODE = '23514';
    END IF;
    v_actual := v_recommended;
    v_reason_code := 'loyalty_model_a';
    v_reason_note := NULL;
  ELSE
    SELECT * INTO v_policy
    FROM public.kebijakan_diskon_checkout
    WHERE usaha_id = p_usaha_id;

    v_has_policy := FOUND;
    IF NOT v_has_policy OR NOT v_policy.manual_discount_enabled THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: diskon manual belum diaktifkan pada kebijakan usaha'
        USING ERRCODE = '23514';
    END IF;

    IF p_discount_request->>'amount' IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: nominal diskon manual wajib diisi'
        USING ERRCODE = '22023';
    END IF;

    v_actual := round((p_discount_request->>'amount')::numeric, 2);
    v_reason_code := coalesce(nullif(btrim(p_discount_request->>'reason_code'), ''), 'other');
    v_reason_note := nullif(btrim(coalesce(p_discount_request->>'reason_note', p_discount_request->>'reason', '')), '');

    IF v_actual <= 0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: nominal diskon manual harus lebih besar dari nol'
        USING ERRCODE = '22023';
    END IF;

    IF v_policy.require_reason AND v_reason_note IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: alasan pemberian diskon wajib diisi'
        USING ERRCODE = '22023';
    END IF;

    IF NOT (v_reason_code = ANY(v_policy.allowed_reason_codes)) THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: kategori alasan diskon tidak diizinkan oleh kebijakan usaha'
        USING ERRCODE = '22023';
    END IF;

    IF v_policy.max_discount_amount IS NOT NULL
       AND v_actual > v_policy.max_discount_amount THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: nominal diskon melebihi batas kebijakan usaha'
        USING ERRCODE = '23514';
    END IF;

    IF v_policy.max_discount_percent IS NOT NULL AND p_rental_subtotal > 0 THEN
      v_percent := (v_actual / p_rental_subtotal) * 100;
      IF v_percent > v_policy.max_discount_percent THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: persentase diskon melebihi batas kebijakan usaha'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    IF v_eligible AND v_actual > v_recommended THEN
      IF NOT v_policy.allow_above_loyalty THEN
        RAISE EXCEPTION 'AUTHORIZATION_ERROR: kebijakan usaha tidak mengizinkan diskon di atas rekomendasi loyalitas'
          USING ERRCODE = '42501';
      END IF;
      PERFORM app_private.require_usaha_permission(
        p_usaha_id, 'checkout_discount.override'
      );
      v_bonus := round(v_actual - v_recommended, 2);
    END IF;
  END IF;

  IF v_actual > round(p_rental_subtotal, 2) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: diskon rental tidak boleh melebihi subtotal rental'
      USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'source', v_mode,
    'program_loyalitas_id', v_loyalty->'program_loyalitas_id',
    'program_version', v_loyalty->'program_version',
    'completed_rental_count', v_loyalty->'completed_rental_count',
    'minimum_completed_rentals', v_loyalty->'minimum_completed_rentals',
    'eligible', v_eligible,
    'recommended_discount_percent', v_loyalty->'recommended_discount_percent',
    'recommended_amount', v_recommended,
    'actual_amount', v_actual,
    'bonus_amount', v_bonus,
    'reason_code', v_reason_code,
    'reason_note', v_reason_note
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.resolve_checkout_discount(uuid, uuid, numeric, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- Full-line amendment. Client sends only the new targets, quantities, tariff
-- selectors, and notes. Effective prices and promo snapshots are resolved here.
CREATE OR REPLACE FUNCTION app_private.command_amend_reservation(
  p_usaha_id uuid,
  p_reservasi_id uuid,
  p_expected_updated_at timestamptz,
  p_lines jsonb,
  p_reason text,
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
  v_reservation public.reservasi%ROWTYPE;
  v_existing_hash text;
  v_existing_response jsonb;
  v_idempotency_id uuid;
  v_request_hash text;
  v_before_lines jsonb;
  v_after_lines jsonb := '[]'::jsonb;
  v_input jsonb;
  v_resolved jsonb;
  v_line_count integer := 0;
  v_target_count integer;
  v_barang_id uuid;
  v_varian_barang_id uuid;
  v_parent_barang_id uuid;
  v_paket_sewa_id uuid;
  v_tarif_sewa_id uuid;
  v_quantity numeric(14,3);
  v_unit_price numeric(14,2);
  v_subtotal numeric(14,2);
  v_currency_code text;
  v_line_note text;
  v_harga_normal numeric(14,2);
  v_diskon_persen numeric(5,2);
  v_nominal_diskon numeric(14,2);
  v_promosi_katalog_id uuid;
  v_promosi_paket_id uuid;
  v_durasi_unit_snapshot text;
  v_durasi_nilai_snapshot numeric(12,4);
  v_tariff record;
  v_package_price record;
  v_catalog_promo record;
  v_component record;
  v_available numeric;
  v_reserved numeric;
  v_requested numeric;
  v_response jsonb;
BEGIN
  v_admin_id := app_private.require_usaha_permission(p_usaha_id, 'reservation.amend');

  IF p_usaha_id IS NULL
     OR p_reservasi_id IS NULL
     OR p_expected_updated_at IS NULL
     OR p_lines IS NULL
     OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_lines) = 0
     OR p_reason IS NULL OR length(btrim(p_reason)) < 3 OR length(p_reason) > 500
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = ''
     OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: reservasi, detail baru, alasan, dan metadata request wajib valid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text, 0));

  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'reservasi_id', p_reservasi_id,
    'expected_updated_at', p_expected_updated_at,
    'lines', p_lines,
    'reason', btrim(p_reason)
  )::text);

  INSERT INTO public.idempotency_key (
    usaha_id, actor_auth_user_id, key, command_name, request_hash
  )
  VALUES (
    p_usaha_id, v_auth_user_id, btrim(p_idempotency_key),
    'amend_reservation', v_request_hash
  )
  ON CONFLICT (usaha_id, actor_auth_user_id, command_name, key)
  DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.request_hash, ik.response_body
      INTO v_existing_hash, v_existing_response
    FROM public.idempotency_key ik
    WHERE ik.usaha_id = p_usaha_id
      AND ik.actor_auth_user_id = v_auth_user_id
      AND ik.command_name = 'amend_reservation'
      AND ik.key = btrim(p_idempotency_key);

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk perubahan berbeda'
        USING ERRCODE = '23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: hasil amendment reservasi belum dapat dipastikan'
      USING ERRCODE = '40001';
  END IF;

  SELECT *
    INTO v_reservation
  FROM public.reservasi
  WHERE usaha_id = p_usaha_id
    AND reservasi_id = p_reservasi_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: reservasi tidak ditemukan pada usaha aktif'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_reservation.status <> 'confirmed'
     OR v_reservation.stock_lock_status <> 'locked' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: amendment hanya diizinkan untuk reservasi confirmed dengan kapasitas terkunci'
      USING ERRCODE = '23514';
  END IF;

  IF v_reservation.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: reservasi berubah sejak dibuka. Muat ulang sebelum mengubah kesepakatan.'
      USING ERRCODE = '40001';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.created_at,d.detail_reservasi_id), '[]'::jsonb)
    INTO v_before_lines
  FROM public.detail_reservasi d
  WHERE d.usaha_id = p_usaha_id
    AND d.reservasi_id = p_reservasi_id;

  IF jsonb_array_length(v_before_lines) = 0 THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: reservasi tidak mempunyai detail yang dapat diamend'
      USING ERRCODE = '23514';
  END IF;

  -- Resolve a new immutable price snapshot for every submitted line.
  FOR v_input IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_target_count := num_nonnulls(
      nullif(v_input->>'barang_id','')::uuid,
      nullif(v_input->>'varian_barang_id','')::uuid,
      nullif(v_input->>'paket_sewa_id','')::uuid
    );

    IF v_target_count <> 1 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: setiap detail harus memiliki tepat satu target barang, varian, atau paket'
        USING ERRCODE = '22023';
    END IF;

    v_barang_id := nullif(v_input->>'barang_id','')::uuid;
    v_varian_barang_id := nullif(v_input->>'varian_barang_id','')::uuid;
    v_paket_sewa_id := nullif(v_input->>'paket_sewa_id','')::uuid;
    v_tarif_sewa_id := nullif(v_input->>'tarif_sewa_id','')::uuid;
    v_quantity := (v_input->>'jumlah')::numeric;
    v_line_note := nullif(btrim(coalesce(v_input->>'catatan','')), '');

    IF v_quantity IS NULL OR v_quantity <= 0 OR v_quantity > 100000 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: jumlah detail harus lebih besar dari nol dan masih wajar'
        USING ERRCODE = '22023';
    END IF;
    IF v_tarif_sewa_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: tarif sewa wajib dipilih pada setiap detail amendment'
        USING ERRCODE = '22023';
    END IF;

    v_harga_normal := NULL;
    v_unit_price := NULL;
    v_currency_code := 'IDR';
    v_diskon_persen := 0;
    v_nominal_diskon := 0;
    v_promosi_katalog_id := NULL;
    v_promosi_paket_id := NULL;
    v_durasi_unit_snapshot := NULL;
    v_durasi_nilai_snapshot := NULL;

    IF v_paket_sewa_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.paket_sewa p
        WHERE p.usaha_id = p_usaha_id
          AND p.paket_sewa_id = v_paket_sewa_id
          AND p.status = 'active'
      ) THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: paket tidak aktif atau bukan milik usaha ini'
          USING ERRCODE = '23514';
      END IF;

      SELECT t.tarif_sewa_id, t.nominal, t.durasi_unit, t.durasi_nilai, t.currency_code
        INTO v_tariff
      FROM public.tarif_sewa t
      WHERE t.usaha_id = p_usaha_id
        AND t.tarif_sewa_id = v_tarif_sewa_id
        AND t.paket_sewa_id = v_paket_sewa_id
        AND t.status = 'active'
        AND t.berlaku_mulai <= now()
        AND (t.berlaku_sampai IS NULL OR t.berlaku_sampai > now());

      IF NOT FOUND THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: tarif paket tidak aktif atau tidak cocok dengan paket'
          USING ERRCODE = '23514';
      END IF;

      SELECT * INTO v_package_price
      FROM app_private.resolve_package_promo_price(
        p_usaha_id, v_paket_sewa_id, v_tarif_sewa_id, now()
      );

      IF FOUND THEN
        v_harga_normal := v_package_price.harga_normal;
        v_unit_price := v_package_price.harga_efektif;
        v_promosi_paket_id := v_package_price.promosi_paket_id;
      ELSE
        v_harga_normal := v_tariff.nominal;
        v_unit_price := v_tariff.nominal;
        v_promosi_paket_id := NULL;
      END IF;
      v_durasi_unit_snapshot := v_tariff.durasi_unit;
      v_durasi_nilai_snapshot := v_tariff.durasi_nilai;
      v_currency_code := btrim(v_tariff.currency_code::text);
    ELSE
      IF v_varian_barang_id IS NOT NULL THEN
        SELECT vb.barang_id
          INTO v_parent_barang_id
        FROM public.varian_barang vb
        JOIN public.barang b
          ON b.usaha_id = vb.usaha_id
         AND b.barang_id = vb.barang_id
        WHERE vb.usaha_id = p_usaha_id
          AND vb.varian_barang_id = v_varian_barang_id
          AND vb.status = 'active'
          AND b.status = 'active'
          AND coalesce(vb.is_rentable, b.is_rentable) = true;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'BUSINESS_CONFLICT: varian tidak aktif atau tidak dapat disewakan'
            USING ERRCODE = '23514';
        END IF;
        v_barang_id := NULL;
      ELSE
        SELECT b.barang_id
          INTO v_parent_barang_id
        FROM public.barang b
        WHERE b.usaha_id = p_usaha_id
          AND b.barang_id = v_barang_id
          AND b.status = 'active'
          AND b.is_rentable = true;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'BUSINESS_CONFLICT: barang tidak aktif atau tidak dapat disewakan'
            USING ERRCODE = '23514';
        END IF;
      END IF;

      SELECT t.tarif_sewa_id, t.nominal, t.durasi_unit, t.durasi_nilai, t.currency_code
        INTO v_tariff
      FROM public.tarif_sewa t
      WHERE t.usaha_id = p_usaha_id
        AND t.tarif_sewa_id = v_tarif_sewa_id
        AND t.status = 'active'
        AND t.berlaku_mulai <= now()
        AND (t.berlaku_sampai IS NULL OR t.berlaku_sampai > now())
        AND (
          (v_varian_barang_id IS NOT NULL AND (
            t.varian_barang_id = v_varian_barang_id
            OR (t.varian_barang_id IS NULL AND t.barang_id = v_parent_barang_id)
          ))
          OR (v_varian_barang_id IS NULL AND t.varian_barang_id IS NULL AND t.barang_id = v_barang_id)
        );

      IF NOT FOUND THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: tarif tidak aktif atau tidak cocok dengan barang/varian'
          USING ERRCODE = '23514';
      END IF;

      SELECT * INTO v_catalog_promo
      FROM app_private.resolve_catalog_promo_price(
        p_usaha_id, v_parent_barang_id, v_varian_barang_id, 'rental', now()
      );

      v_harga_normal := v_tariff.nominal;
      v_unit_price := v_tariff.nominal;
      IF FOUND THEN
        v_promosi_katalog_id := v_catalog_promo.promosi_katalog_id;
        v_diskon_persen := v_catalog_promo.diskon_persen;
        v_unit_price := round(v_harga_normal * (100 - v_diskon_persen) / 100, 2);
        v_nominal_diskon := round((v_harga_normal - v_unit_price) * v_quantity, 2);
      END IF;

      v_durasi_unit_snapshot := v_tariff.durasi_unit;
      v_durasi_nilai_snapshot := v_tariff.durasi_nilai;
      v_currency_code := btrim(v_tariff.currency_code::text);
    END IF;

    IF v_currency_code <> 'IDR' THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: amendment tahap ini hanya mendukung IDR'
        USING ERRCODE = '22023';
    END IF;
    IF v_unit_price IS NULL OR v_unit_price < 0
       OR v_durasi_unit_snapshot IS NULL
       OR v_durasi_nilai_snapshot IS NULL OR v_durasi_nilai_snapshot <= 0 THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: harga atau snapshot durasi tarif tidak valid'
        USING ERRCODE = '23514';
    END IF;

    -- The browser must confirm exactly the server-resolved snapshot it previewed.
    -- A changed promo, tariff, price, or duration forces a fresh preview.
    IF v_input ? 'expected_unit_price'
       AND (v_input->>'expected_unit_price')::numeric IS DISTINCT FROM v_unit_price THEN
      RAISE EXCEPTION 'STALE_DATA: harga efektif berubah sejak preview; tinjau ulang perubahan reservasi'
        USING ERRCODE = '40001';
    END IF;
    IF v_input ? 'expected_harga_normal'
       AND (v_input->>'expected_harga_normal')::numeric IS DISTINCT FROM v_harga_normal THEN
      RAISE EXCEPTION 'STALE_DATA: harga normal berubah sejak preview; tinjau ulang perubahan reservasi'
        USING ERRCODE = '40001';
    END IF;
    IF v_input ? 'expected_diskon_persen'
       AND (v_input->>'expected_diskon_persen')::numeric IS DISTINCT FROM v_diskon_persen THEN
      RAISE EXCEPTION 'STALE_DATA: persentase diskon berubah sejak preview; tinjau ulang perubahan reservasi'
        USING ERRCODE = '40001';
    END IF;
    IF v_input ? 'expected_promosi_katalog_id'
       AND nullif(v_input->>'expected_promosi_katalog_id','')::uuid IS DISTINCT FROM v_promosi_katalog_id THEN
      RAISE EXCEPTION 'STALE_DATA: promosi katalog berubah sejak preview; tinjau ulang perubahan reservasi'
        USING ERRCODE = '40001';
    END IF;
    IF v_input ? 'expected_promosi_paket_id'
       AND nullif(v_input->>'expected_promosi_paket_id','')::uuid IS DISTINCT FROM v_promosi_paket_id THEN
      RAISE EXCEPTION 'STALE_DATA: promosi paket berubah sejak preview; tinjau ulang perubahan reservasi'
        USING ERRCODE = '40001';
    END IF;
    IF v_input ? 'expected_durasi_unit'
       AND nullif(v_input->>'expected_durasi_unit','') IS DISTINCT FROM v_durasi_unit_snapshot THEN
      RAISE EXCEPTION 'STALE_DATA: satuan durasi berubah sejak preview; tinjau ulang perubahan reservasi'
        USING ERRCODE = '40001';
    END IF;
    IF v_input ? 'expected_durasi_nilai'
       AND (v_input->>'expected_durasi_nilai')::numeric IS DISTINCT FROM v_durasi_nilai_snapshot THEN
      RAISE EXCEPTION 'STALE_DATA: nilai durasi berubah sejak preview; tinjau ulang perubahan reservasi'
        USING ERRCODE = '40001';
    END IF;

    v_subtotal := round(v_quantity * v_unit_price, 2);
    v_nominal_diskon := CASE
      WHEN v_paket_sewa_id IS NOT NULL
        THEN greatest(0, round((v_harga_normal - v_unit_price) * v_quantity, 2))
      ELSE greatest(0, v_nominal_diskon)
    END;
    IF v_input ? 'expected_nominal_diskon'
       AND (v_input->>'expected_nominal_diskon')::numeric IS DISTINCT FROM v_nominal_diskon THEN
      RAISE EXCEPTION 'STALE_DATA: nominal diskon berubah sejak preview; tinjau ulang perubahan reservasi'
        USING ERRCODE = '40001';
    END IF;
    IF v_input ? 'expected_currency_code'
       AND btrim(v_input->>'expected_currency_code') IS DISTINCT FROM v_currency_code THEN
      RAISE EXCEPTION 'STALE_DATA: mata uang berubah sejak preview; tinjau ulang perubahan reservasi'
        USING ERRCODE = '40001';
    END IF;

    v_resolved := jsonb_build_object(
      'barang_id', v_barang_id,
      'varian_barang_id', v_varian_barang_id,
      'paket_sewa_id', v_paket_sewa_id,
      'jumlah', v_quantity,
      'unit_price', v_unit_price,
      'currency_code', v_currency_code,
      'subtotal', v_subtotal,
      'catatan', v_line_note,
      'tarif_sewa_id', v_tarif_sewa_id,
      'promosi_paket_id', v_promosi_paket_id,
      'promosi_katalog_id', v_promosi_katalog_id,
      'harga_normal_snapshot', v_harga_normal,
      'diskon_persen_snapshot', v_diskon_persen,
      'nominal_diskon_snapshot', v_nominal_diskon,
      'durasi_unit_snapshot', v_durasi_unit_snapshot,
      'durasi_nilai_snapshot', v_durasi_nilai_snapshot
    );
    v_after_lines := v_after_lines || jsonb_build_array(v_resolved);
    v_line_count := v_line_count + 1;
  END LOOP;

  -- Revalidate capacity under the tenant lock, excluding this reservation's
  -- existing locked demand and including package component quantities.
  FOR v_component IN
    WITH expanded AS (
      SELECT
        CASE WHEN x->>'varian_barang_id' IS NULL THEN (x->>'barang_id')::uuid ELSE NULL::uuid END AS barang_id,
        nullif(x->>'varian_barang_id','')::uuid AS varian_barang_id,
        (x->>'jumlah')::numeric AS required_qty,
        NULL::uuid AS paket_sewa_id
      FROM jsonb_array_elements(v_after_lines) x
      WHERE x->>'paket_sewa_id' IS NULL

      UNION ALL

      SELECT
        cp.barang_id,
        cp.varian_barang_id,
        (x->>'jumlah')::numeric * cp.jumlah,
        NULL::uuid
      FROM jsonb_array_elements(v_after_lines) x
      JOIN public.komponen_paket cp
        ON cp.usaha_id = p_usaha_id
       AND cp.paket_sewa_id = (x->>'paket_sewa_id')::uuid
      WHERE x->>'paket_sewa_id' IS NOT NULL
    )
    SELECT
      CASE WHEN varian_barang_id IS NULL THEN barang_id ELSE NULL::uuid END AS barang_id,
      varian_barang_id,
      sum(required_qty) AS required_qty
    FROM expanded
    WHERE barang_id IS NOT NULL OR varian_barang_id IS NOT NULL
    GROUP BY CASE WHEN varian_barang_id IS NULL THEN barang_id ELSE NULL::uuid END,
             varian_barang_id
  LOOP
    SELECT count(*)
      INTO v_available
    FROM (
      SELECT u.unit_barang_id
      FROM public.unit_barang u
      WHERE u.usaha_id = p_usaha_id
        AND u.status = 'ready'
        AND (
          (v_component.varian_barang_id IS NULL AND u.barang_id = v_component.barang_id)
          OR (v_component.varian_barang_id IS NOT NULL AND u.varian_barang_id = v_component.varian_barang_id)
        )
      FOR UPDATE
    ) locked_ready_units;

    v_reserved := app_private.reservation_locked_component_requirement(
      p_usaha_id,
      v_reservation.mulai_reservasi,
      v_reservation.selesai_reservasi,
      v_component.barang_id,
      v_component.varian_barang_id,
      p_reservasi_id
    );
    v_requested := coalesce(v_component.required_qty, 0);

    IF v_available - v_reserved < v_requested THEN
      RAISE EXCEPTION
        'BUSINESS_CONFLICT: kapasitas tidak cukup untuk perubahan reservasi; requested=%, available=%',
        v_requested, greatest(v_available - v_reserved, 0)
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  DELETE FROM public.detail_reservasi
  WHERE usaha_id = p_usaha_id
    AND reservasi_id = p_reservasi_id;

  FOR v_resolved IN SELECT value FROM jsonb_array_elements(v_after_lines)
  LOOP
    INSERT INTO public.detail_reservasi (
      usaha_id, reservasi_id, barang_id, varian_barang_id, paket_sewa_id,
      jumlah, unit_price, currency_code, subtotal, catatan,
      tarif_sewa_id, promosi_paket_id, promosi_katalog_id,
      harga_normal_snapshot, diskon_persen_snapshot, nominal_diskon_snapshot,
      durasi_unit_snapshot, durasi_nilai_snapshot
    )
    VALUES (
      p_usaha_id, p_reservasi_id,
      nullif(v_resolved->>'barang_id','')::uuid,
      nullif(v_resolved->>'varian_barang_id','')::uuid,
      nullif(v_resolved->>'paket_sewa_id','')::uuid,
      (v_resolved->>'jumlah')::numeric,
      (v_resolved->>'unit_price')::numeric,
      coalesce(v_resolved->>'currency_code','IDR'),
      (v_resolved->>'subtotal')::numeric,
      nullif(v_resolved->>'catatan',''),
      (v_resolved->>'tarif_sewa_id')::uuid,
      nullif(v_resolved->>'promosi_paket_id','')::uuid,
      nullif(v_resolved->>'promosi_katalog_id','')::uuid,
      (v_resolved->>'harga_normal_snapshot')::numeric,
      coalesce((v_resolved->>'diskon_persen_snapshot')::numeric,0),
      coalesce((v_resolved->>'nominal_diskon_snapshot')::numeric,0),
      v_resolved->>'durasi_unit_snapshot',
      (v_resolved->>'durasi_nilai_snapshot')::numeric
    );
  END LOOP;

  UPDATE public.reservasi
  SET updated_at = now()
  WHERE usaha_id = p_usaha_id
    AND reservasi_id = p_reservasi_id
  RETURNING * INTO v_reservation;

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, request_id, change_summary
  )
  VALUES (
    p_usaha_id, v_auth_user_id, v_admin_id, 'amend',
    'reservasi', p_reservasi_id, 'admin-command', p_request_id,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'status', v_reservation.status,
      'stock_lock_status', v_reservation.stock_lock_status,
      'before_lines', v_before_lines,
      'after_lines', v_after_lines
    )
  );

  INSERT INTO public.outbox_event (
    usaha_id, event_type, aggregate_type, aggregate_id, payload
  )
  VALUES (
    p_usaha_id, 'reservation.amended', 'reservasi', p_reservasi_id,
    jsonb_build_object(
      'reservation_id', p_reservasi_id,
      'updated_at', v_reservation.updated_at,
      'line_count', v_line_count,
      'reason', btrim(p_reason)
    )
  );

  v_response := jsonb_build_object(
    'reservasi_id', p_reservasi_id,
    'status', v_reservation.status,
    'stock_lock_status', v_reservation.stock_lock_status,
    'updated_at', v_reservation.updated_at,
    'line_count', v_line_count
  );

  UPDATE public.idempotency_key
  SET response_status = 200, response_body = v_response
  WHERE usaha_id = p_usaha_id
    AND actor_auth_user_id = v_auth_user_id
    AND command_name = 'amend_reservation'
    AND key = btrim(p_idempotency_key);

  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_amend_reservation(
  uuid, uuid, timestamptz, jsonb, text, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.command_amend_reservation(
  p_usaha_id uuid,
  p_reservasi_id uuid,
  p_expected_updated_at timestamptz,
  p_lines jsonb,
  p_reason text,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.command_amend_reservation(
    $1,$2,$3,$4,$5,$6,$7
  );
$function$;

REVOKE ALL ON FUNCTION public.command_amend_reservation(
  uuid, uuid, timestamptz, jsonb, text, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_amend_reservation(
  uuid, uuid, timestamptz, jsonb, text, text, uuid
) TO authenticated;


-- Read-only pricing and stock preview. This lets the operator approve the exact
-- server-resolved price snapshot before the atomic amendment command is called.
CREATE OR REPLACE FUNCTION app_private.preview_reservation_amendment(
  p_usaha_id uuid,
  p_reservasi_id uuid,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_reservation public.reservasi%ROWTYPE;
  v_admin_id uuid;
  v_input jsonb;
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_target_count integer;
  v_barang_id uuid;
  v_varian_barang_id uuid;
  v_paket_sewa_id uuid;
  v_tarif_sewa_id uuid;
  v_parent_barang_id uuid;
  v_quantity numeric(14,3);
  v_unit_price numeric(14,2);
  v_harga_normal numeric(14,2);
  v_diskon_persen numeric(5,2);
  v_nominal_diskon numeric(14,2);
  v_promosi_katalog_id uuid;
  v_promosi_paket_id uuid;
  v_durasi_unit text;
  v_durasi_nilai numeric(12,4);
  v_currency_code text;
  v_note text;
  v_tariff record;
  v_package_price record;
  v_catalog_promo record;
  v_component record;
  v_available numeric;
  v_reserved numeric;
  v_requested numeric;
  v_before numeric := 0;
  v_after numeric := 0;
BEGIN
  v_admin_id := app_private.require_usaha_permission(p_usaha_id, 'reservation.amend');

  IF p_usaha_id IS NULL
     OR p_reservasi_id IS NULL
     OR p_lines IS NULL
     OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: reservasi dan detail preview wajib diisi'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_reservation
  FROM public.reservasi
  WHERE usaha_id = p_usaha_id
    AND reservasi_id = p_reservasi_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: reservasi tidak ditemukan pada usaha aktif'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_reservation.status <> 'confirmed'
     OR v_reservation.stock_lock_status <> 'locked' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: preview hanya tersedia untuk reservasi confirmed dengan kapasitas terkunci'
      USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(sum(d.subtotal),0)
  INTO v_before
  FROM public.detail_reservasi d
  WHERE d.usaha_id = p_usaha_id
    AND d.reservasi_id = p_reservasi_id;

  FOR v_input IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_target_count := num_nonnulls(
      nullif(v_input->>'barang_id','')::uuid,
      nullif(v_input->>'varian_barang_id','')::uuid,
      nullif(v_input->>'paket_sewa_id','')::uuid
    );
    IF v_target_count <> 1 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: setiap detail harus memiliki tepat satu target barang, varian, atau paket'
        USING ERRCODE = '22023';
    END IF;

    v_barang_id := nullif(v_input->>'barang_id','')::uuid;
    v_varian_barang_id := nullif(v_input->>'varian_barang_id','')::uuid;
    v_paket_sewa_id := nullif(v_input->>'paket_sewa_id','')::uuid;
    v_tarif_sewa_id := nullif(v_input->>'tarif_sewa_id','')::uuid;
    v_quantity := nullif(v_input->>'jumlah','')::numeric;
    v_note := nullif(btrim(coalesce(v_input->>'catatan','')), '');

    IF v_quantity IS NULL OR v_quantity <= 0 OR v_quantity > 100000 OR v_tarif_sewa_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: jumlah dan tarif sewa wajib valid'
        USING ERRCODE = '22023';
    END IF;

    v_parent_barang_id := NULL;
    v_harga_normal := NULL;
    v_unit_price := NULL;
    v_diskon_persen := 0;
    v_nominal_diskon := 0;
    v_promosi_katalog_id := NULL;
    v_promosi_paket_id := NULL;
    v_durasi_unit := NULL;
    v_durasi_nilai := NULL;
    v_currency_code := 'IDR';

    IF v_paket_sewa_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.paket_sewa p
        WHERE p.usaha_id = p_usaha_id
          AND p.paket_sewa_id = v_paket_sewa_id
          AND p.status = 'active'
      ) THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: paket tidak aktif atau bukan milik usaha ini'
          USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.komponen_paket cp
        WHERE cp.usaha_id = p_usaha_id
          AND cp.paket_sewa_id = v_paket_sewa_id
      ) THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: paket tidak memiliki komponen inventaris aktif'
          USING ERRCODE = '23514';
      END IF;

      SELECT t.tarif_sewa_id,t.nominal,t.durasi_unit,t.durasi_nilai,t.currency_code
        INTO v_tariff
      FROM public.tarif_sewa t
      WHERE t.usaha_id = p_usaha_id
        AND t.tarif_sewa_id = v_tarif_sewa_id
        AND t.paket_sewa_id = v_paket_sewa_id
        AND t.status = 'active'
        AND t.berlaku_mulai <= now()
        AND (t.berlaku_sampai IS NULL OR t.berlaku_sampai > now());

      IF NOT FOUND THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: tarif paket tidak aktif atau tidak cocok dengan paket'
          USING ERRCODE = '23514';
      END IF;

      SELECT * INTO v_package_price
      FROM app_private.resolve_package_promo_price(
        p_usaha_id,v_paket_sewa_id,v_tarif_sewa_id,now()
      );
      IF FOUND THEN
        v_harga_normal := v_package_price.harga_normal;
        v_unit_price := v_package_price.harga_efektif;
        v_promosi_paket_id := v_package_price.promosi_paket_id;
      ELSE
        v_harga_normal := v_tariff.nominal;
        v_unit_price := v_tariff.nominal;
      END IF;
      v_durasi_unit := v_tariff.durasi_unit;
      v_durasi_nilai := v_tariff.durasi_nilai;
      v_currency_code := btrim(v_tariff.currency_code::text);
    ELSE
      IF v_varian_barang_id IS NOT NULL THEN
        SELECT vb.barang_id
          INTO v_parent_barang_id
        FROM public.varian_barang vb
        JOIN public.barang b
          ON b.usaha_id = vb.usaha_id
         AND b.barang_id = vb.barang_id
        WHERE vb.usaha_id = p_usaha_id
          AND vb.varian_barang_id = v_varian_barang_id
          AND vb.status = 'active'
          AND b.status = 'active'
          AND coalesce(vb.is_rentable,b.is_rentable) = true;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'BUSINESS_CONFLICT: varian tidak aktif atau tidak dapat disewakan'
            USING ERRCODE = '23514';
        END IF;
        v_barang_id := NULL;
      ELSE
        SELECT b.barang_id
          INTO v_parent_barang_id
        FROM public.barang b
        WHERE b.usaha_id = p_usaha_id
          AND b.barang_id = v_barang_id
          AND b.status = 'active'
          AND b.is_rentable = true;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'BUSINESS_CONFLICT: barang tidak aktif atau tidak dapat disewakan'
            USING ERRCODE = '23514';
        END IF;
      END IF;

      SELECT t.tarif_sewa_id,t.nominal,t.durasi_unit,t.durasi_nilai,t.currency_code
        INTO v_tariff
      FROM public.tarif_sewa t
      WHERE t.usaha_id = p_usaha_id
        AND t.tarif_sewa_id = v_tarif_sewa_id
        AND t.status = 'active'
        AND t.berlaku_mulai <= now()
        AND (t.berlaku_sampai IS NULL OR t.berlaku_sampai > now())
        AND (
          (v_varian_barang_id IS NOT NULL AND (
            t.varian_barang_id = v_varian_barang_id
            OR (t.varian_barang_id IS NULL AND t.barang_id = v_parent_barang_id)
          ))
          OR (v_varian_barang_id IS NULL AND t.varian_barang_id IS NULL AND t.barang_id = v_barang_id)
        );
      IF NOT FOUND THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: tarif tidak aktif atau tidak cocok dengan barang/varian'
          USING ERRCODE = '23514';
      END IF;

      SELECT * INTO v_catalog_promo
      FROM app_private.resolve_catalog_promo_price(
        p_usaha_id,v_parent_barang_id,v_varian_barang_id,'rental',now()
      );
      v_harga_normal := v_tariff.nominal;
      v_unit_price := v_tariff.nominal;
      IF FOUND THEN
        v_promosi_katalog_id := v_catalog_promo.promosi_katalog_id;
        v_diskon_persen := v_catalog_promo.diskon_persen;
        v_unit_price := round(v_harga_normal * (100-v_diskon_persen)/100,2);
        v_nominal_diskon := round((v_harga_normal-v_unit_price)*v_quantity,2);
      END IF;
      v_durasi_unit := v_tariff.durasi_unit;
      v_durasi_nilai := v_tariff.durasi_nilai;
      v_currency_code := btrim(v_tariff.currency_code::text);
    END IF;

    IF v_currency_code <> 'IDR'
       OR v_unit_price IS NULL OR v_unit_price < 0
       OR v_harga_normal IS NULL OR v_durasi_unit IS NULL
       OR v_durasi_nilai IS NULL OR v_durasi_nilai <= 0 THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: harga, mata uang, atau snapshot durasi tidak valid'
        USING ERRCODE = '23514';
    END IF;

    v_nominal_diskon := greatest(
      0,
      CASE WHEN v_paket_sewa_id IS NOT NULL
        THEN round((v_harga_normal-v_unit_price)*v_quantity,2)
        ELSE v_nominal_diskon
      END
    );

    v_line := jsonb_build_object(
      'barang_id',v_barang_id,
      'varian_barang_id',v_varian_barang_id,
      'paket_sewa_id',v_paket_sewa_id,
      'tarif_sewa_id',v_tarif_sewa_id,
      'jumlah',v_quantity,
      'catatan',v_note,
      'unit_price',v_unit_price,
      'currency_code',v_currency_code,
      'subtotal',round(v_quantity*v_unit_price,2),
      'harga_normal_snapshot',v_harga_normal,
      'diskon_persen_snapshot',v_diskon_persen,
      'nominal_diskon_snapshot',v_nominal_diskon,
      'promosi_katalog_id',v_promosi_katalog_id,
      'promosi_paket_id',v_promosi_paket_id,
      'durasi_unit_snapshot',v_durasi_unit,
      'durasi_nilai_snapshot',v_durasi_nilai
    );
    v_lines := v_lines || jsonb_build_array(v_line);
    v_after := v_after + round(v_quantity*v_unit_price,2);
  END LOOP;

  -- A non-locking preview is advisory only; the amendment command rechecks
  -- stock under tenant/unit locks immediately before replacing the detail rows.
  FOR v_component IN
    WITH expanded AS (
      SELECT
        CASE WHEN x->>'varian_barang_id' IS NULL THEN (x->>'barang_id')::uuid ELSE NULL::uuid END AS barang_id,
        nullif(x->>'varian_barang_id','')::uuid AS varian_barang_id,
        (x->>'jumlah')::numeric AS required_qty
      FROM jsonb_array_elements(v_lines) x
      WHERE x->>'paket_sewa_id' IS NULL
      UNION ALL
      SELECT cp.barang_id,cp.varian_barang_id,
        (x->>'jumlah')::numeric*cp.jumlah
      FROM jsonb_array_elements(v_lines) x
      JOIN public.komponen_paket cp
        ON cp.usaha_id=p_usaha_id
       AND cp.paket_sewa_id=(x->>'paket_sewa_id')::uuid
      WHERE x->>'paket_sewa_id' IS NOT NULL
    )
    SELECT
      CASE WHEN varian_barang_id IS NULL THEN barang_id ELSE NULL::uuid END AS barang_id,
      varian_barang_id,sum(required_qty) AS required_qty
    FROM expanded
    WHERE barang_id IS NOT NULL OR varian_barang_id IS NOT NULL
    GROUP BY CASE WHEN varian_barang_id IS NULL THEN barang_id ELSE NULL::uuid END,varian_barang_id
  LOOP
    SELECT count(*) INTO v_available
    FROM public.unit_barang u
    WHERE u.usaha_id=p_usaha_id AND u.status='ready'
      AND (
        (v_component.varian_barang_id IS NULL AND u.barang_id=v_component.barang_id)
        OR (v_component.varian_barang_id IS NOT NULL AND u.varian_barang_id=v_component.varian_barang_id)
      );
    v_reserved := app_private.reservation_locked_component_requirement(
      p_usaha_id,v_reservation.mulai_reservasi,v_reservation.selesai_reservasi,
      v_component.barang_id,v_component.varian_barang_id,p_reservasi_id
    );
    v_requested := coalesce(v_component.required_qty,0);
    IF v_available-v_reserved<v_requested THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: kapasitas tidak cukup untuk preview perubahan reservasi'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'reservasi_id',p_reservasi_id,
    'reservation_updated_at',v_reservation.updated_at,
    'total_before',round(v_before,2),
    'total_after',round(v_after,2),
    'delta',round(v_after-v_before,2),
    'line_count',jsonb_array_length(v_lines),
    'lines',v_lines,
    'note','Harga final divalidasi ulang saat command amendment. Jika snapshot berubah, command ditolak dan preview harus diulang.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.preview_reservation_amendment(uuid,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.preview_reservation_amendment(
  p_usaha_id uuid,
  p_reservasi_id uuid,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.preview_reservation_amendment($1,$2,$3);
$function$;

REVOKE ALL ON FUNCTION public.preview_reservation_amendment(uuid,uuid,jsonb)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.preview_reservation_amendment(uuid,uuid,jsonb)
  TO authenticated;
