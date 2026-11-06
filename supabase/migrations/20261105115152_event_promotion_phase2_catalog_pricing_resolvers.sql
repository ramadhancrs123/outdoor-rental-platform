-- Phase 2: authoritative promotion resolution and immutable catalog promo commands.
-- All prices are resolved from tenant catalog truth. The client never selects the winning promo.

CREATE OR REPLACE FUNCTION app_private.resolve_catalog_promo_price(
  p_usaha_id uuid,
  p_barang_id uuid,
  p_varian_barang_id uuid,
  p_channel text,
  p_as_of timestamptz DEFAULT now()
)
RETURNS TABLE (
  promosi_katalog_id uuid,
  diskon_persen numeric(5,2),
  matched_target text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_parent_barang_id uuid;
  v_is_eligible boolean;
  v_at timestamptz := coalesce(p_as_of, now());
BEGIN
  IF p_usaha_id IS NULL
     OR num_nonnulls(p_barang_id, p_varian_barang_id) <> 1
     OR p_channel IS NULL OR p_channel IS NULL OR p_channel NOT IN ('rental', 'sale') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tenant, tepat satu target, dan channel promo wajib valid'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize all catalog price reads/writes for one business so one checkout cannot
  -- price the same cart using two different promotion versions.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text, 0));

  IF p_varian_barang_id IS NOT NULL THEN
    SELECT vb.barang_id,
      CASE p_channel
        WHEN 'rental' THEN coalesce(vb.is_rentable, b.is_rentable)
        ELSE coalesce(vb.is_sellable, b.is_sellable)
      END
    INTO v_parent_barang_id, v_is_eligible
    FROM public.varian_barang vb
    JOIN public.barang b
      ON b.usaha_id = vb.usaha_id
     AND b.barang_id = vb.barang_id
    WHERE vb.usaha_id = p_usaha_id
      AND vb.varian_barang_id = p_varian_barang_id
      AND vb.status = 'active'
      AND b.status = 'active';
    IF NOT FOUND OR v_is_eligible IS DISTINCT FROM true THEN
      RETURN;
    END IF;

    -- A variant-specific promotion always wins. Product-level promotion is
    -- consulted only when there is no currently effective variant promotion.
    RETURN QUERY
    SELECT p.promosi_katalog_id, p.diskon_persen, 'variant'::text
    FROM public.promosi_katalog p
    WHERE p.usaha_id = p_usaha_id
      AND p.varian_barang_id = p_varian_barang_id
      AND p.barang_id IS NULL
      AND p.channel = p_channel
      AND p.status = 'active'
      AND p.ended_at IS NULL
      AND p.started_at <= v_at
      AND (p.valid_until IS NULL OR v_at < p.valid_until)
    ORDER BY p.started_at DESC, p.created_at DESC
    LIMIT 1;

    IF FOUND THEN
      RETURN;
    END IF;

    RETURN QUERY
    SELECT p.promosi_katalog_id, p.diskon_persen, 'product_fallback'::text
    FROM public.promosi_katalog p
    WHERE p.usaha_id = p_usaha_id
      AND p.barang_id = v_parent_barang_id
      AND p.varian_barang_id IS NULL
      AND p.channel = p_channel
      AND p.status = 'active'
      AND p.ended_at IS NULL
      AND p.started_at <= v_at
      AND (p.valid_until IS NULL OR v_at < p.valid_until)
    ORDER BY p.started_at DESC, p.created_at DESC
    LIMIT 1;
    RETURN;
  END IF;

  SELECT b.barang_id,
    CASE p_channel
      WHEN 'rental' THEN b.is_rentable
      ELSE b.is_sellable
    END
  INTO v_parent_barang_id, v_is_eligible
  FROM public.barang b
  WHERE b.usaha_id = p_usaha_id
    AND b.barang_id = p_barang_id
    AND b.status = 'active';

  IF NOT FOUND OR v_is_eligible IS DISTINCT FROM true THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.promosi_katalog_id, p.diskon_persen, 'product'::text
  FROM public.promosi_katalog p
  WHERE p.usaha_id = p_usaha_id
    AND p.barang_id = p_barang_id
    AND p.varian_barang_id IS NULL
    AND p.channel = p_channel
    AND p.status = 'active'
    AND p.ended_at IS NULL
    AND p.started_at <= v_at
    AND (p.valid_until IS NULL OR v_at < p.valid_until)
  ORDER BY p.started_at DESC, p.created_at DESC
  LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.resolve_catalog_promo_price(
  uuid, uuid, uuid, text, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.command_create_katalog_promo(
  p_usaha_id uuid,
  p_barang_id uuid,
  p_varian_barang_id uuid,
  p_channel text,
  p_diskon_persen numeric,
  p_started_at timestamptz,
  p_valid_until timestamptz DEFAULT NULL,
  p_is_public boolean DEFAULT false,
  p_status text DEFAULT 'active',
  p_idempotency_key text DEFAULT NULL,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.require_usaha_permission(p_usaha_id, 'event_promotion.manage');
  v_claim jsonb;
  v_idempotency_id uuid;
  v_hash text;
  v_barang_id uuid;
  v_parent_name text;
  v_channel_enabled boolean;
  v_sale_price numeric(14,2);
  v_promo_id uuid := gen_random_uuid();
  v_response jsonb;
  v_target_key uuid := coalesce(p_varian_barang_id, p_barang_id);
BEGIN
  IF num_nonnulls(p_barang_id, p_varian_barang_id) <> 1
     OR p_channel IS NULL OR p_channel NOT IN ('rental', 'sale')
     OR p_diskon_persen IS NULL
     OR p_diskon_persen <= 0
     OR (p_channel = 'rental' AND p_diskon_persen > 100)
     OR (p_channel = 'sale' AND p_diskon_persen >= 100)
     OR p_started_at IS NULL
     OR (p_valid_until IS NOT NULL AND (p_valid_until <= p_started_at OR (p_status = 'active' AND p_valid_until <= now())))
     OR p_status IS NULL OR p_status NOT IN ('draft', 'active')
     OR p_idempotency_key IS NULL
     OR btrim(p_idempotency_key) = ''
     OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: target, channel, persentase, jadwal dan status promo tidak valid'
      USING ERRCODE = '22023';
  END IF;

  IF p_varian_barang_id IS NOT NULL THEN
    SELECT b.barang_id, b.nama,
      CASE p_channel
        WHEN 'rental' THEN coalesce(v.is_rentable, b.is_rentable)
        ELSE coalesce(v.is_sellable, b.is_sellable)
      END,
      coalesce(v.harga_jual, b.harga_jual)
    INTO v_barang_id, v_parent_name, v_channel_enabled, v_sale_price
    FROM public.varian_barang v
    JOIN public.barang b
      ON b.usaha_id = v.usaha_id
     AND b.barang_id = v.barang_id
    WHERE v.usaha_id = p_usaha_id
      AND v.varian_barang_id = p_varian_barang_id
      AND v.status = 'active'
      AND b.status = 'active';
  ELSE
    SELECT b.barang_id, b.nama,
      CASE p_channel WHEN 'rental' THEN b.is_rentable ELSE b.is_sellable END,
      b.harga_jual
    INTO v_barang_id, v_parent_name, v_channel_enabled, v_sale_price
    FROM public.barang b
    WHERE b.usaha_id = p_usaha_id
      AND b.barang_id = p_barang_id
      AND b.status = 'active';
  END IF;

  IF v_barang_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: barang atau varian aktif tidak ditemukan di Usaha ini'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_channel_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: target belum diaktifkan untuk channel promo %', p_channel
      USING ERRCODE = '23514';
  END IF;
  IF p_channel = 'sale' AND (v_sale_price IS NULL OR v_sale_price <= 0) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: target belum memiliki harga jual yang valid'
      USING ERRCODE = '23514';
  END IF;
  IF p_channel = 'rental' AND NOT EXISTS (
    SELECT 1
    FROM public.tarif_sewa t
    WHERE t.usaha_id = p_usaha_id
      AND t.status = 'active'
      AND (
        (p_varian_barang_id IS NOT NULL AND (
          t.varian_barang_id = p_varian_barang_id
          OR (t.varian_barang_id IS NULL AND t.barang_id = v_barang_id)
        ))
        OR (p_barang_id IS NOT NULL AND t.barang_id = p_barang_id AND t.varian_barang_id IS NULL)
      )
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: target belum memiliki tarif rental aktif'
      USING ERRCODE = '23514';
  END IF;

  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'barang_id', p_barang_id,
    'varian_barang_id', p_varian_barang_id,
    'channel', p_channel,
    'diskon_persen', p_diskon_persen,
    'started_at', p_started_at,
    'valid_until', p_valid_until,
    'is_public', p_is_public,
    'status', p_status
  )::text);
  v_claim := app_private.catalog_idempotency_claim(
    p_usaha_id, 'create_katalog_promo', p_idempotency_key, v_hash
  );
  IF v_claim->>'state' = 'committed' THEN
    RETURN v_claim->'response';
  END IF;
  IF v_claim->>'state' = 'unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: status pembuatan promo katalog belum dapat dipastikan'
      USING ERRCODE = '40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text, 0));
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_usaha_id::text || ':catalog-promo:' || v_target_key::text || ':' || p_channel, 0)
  );

  IF p_status = 'active' AND EXISTS (
    SELECT 1
    FROM public.promosi_katalog p
    WHERE p.usaha_id = p_usaha_id
      AND p.channel = p_channel
      AND p.status = 'active'
      AND p.ended_at IS NULL
      AND (
        (p_barang_id IS NOT NULL AND p.barang_id = p_barang_id AND p.varian_barang_id IS NULL)
        OR (p_varian_barang_id IS NOT NULL AND p.varian_barang_id = p_varian_barang_id)
      )
      AND tstzrange(p.started_at, coalesce(p.valid_until, 'infinity'::timestamptz), '[)')
          && tstzrange(p_started_at, coalesce(p_valid_until, 'infinity'::timestamptz), '[)')
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: periode promo target dan channel ini bertabrakan dengan promo aktif/terjadwal'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.promosi_katalog (
    promosi_katalog_id, usaha_id, barang_id, varian_barang_id,
    channel, diskon_persen, is_public, status, started_at, valid_until,
    created_by_auth_user_id, created_by_akun_admin_id
  )
  VALUES (
    v_promo_id, p_usaha_id, p_barang_id, p_varian_barang_id,
    p_channel, round(p_diskon_persen, 2), coalesce(p_is_public, false),
    p_status, p_started_at, p_valid_until, auth.uid(), v_admin_id
  );

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, request_id, change_summary
  )
  VALUES (
    p_usaha_id, auth.uid(), v_admin_id, 'create',
    'promosi_katalog', v_promo_id, 'admin-command', p_request_id,
    jsonb_build_object(
      'target_type', CASE WHEN p_varian_barang_id IS NOT NULL THEN 'variant' ELSE 'product' END,
      'barang_id', p_barang_id,
      'varian_barang_id', p_varian_barang_id,
      'channel', p_channel,
      'diskon_persen', round(p_diskon_persen, 2),
      'started_at', p_started_at,
      'valid_until', p_valid_until,
      'status', p_status
    )
  );

  v_response := jsonb_build_object(
    'promosi_katalog_id', v_promo_id,
    'usaha_id', p_usaha_id,
    'barang_id', p_barang_id,
    'varian_barang_id', p_varian_barang_id,
    'channel', p_channel,
    'diskon_persen', round(p_diskon_persen, 2),
    'started_at', p_started_at,
    'valid_until', p_valid_until,
    'status', p_status,
    'updated_at', now()
  );
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id, 200, v_response);
  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_create_katalog_promo(
  uuid, uuid, uuid, text, numeric, timestamptz, timestamptz, boolean, text, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_create_katalog_promo(
  uuid, uuid, uuid, text, numeric, timestamptz, timestamptz, boolean, text, text, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.command_create_katalog_promo(
  p_usaha_id uuid,
  p_barang_id uuid,
  p_varian_barang_id uuid,
  p_channel text,
  p_diskon_persen numeric,
  p_started_at timestamptz,
  p_valid_until timestamptz DEFAULT NULL,
  p_is_public boolean DEFAULT false,
  p_status text DEFAULT 'active',
  p_idempotency_key text DEFAULT NULL,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_create_katalog_promo(
    p_usaha_id, p_barang_id, p_varian_barang_id, p_channel,
    p_diskon_persen, p_started_at, p_valid_until, p_is_public,
    p_status, p_idempotency_key, p_request_id
  );
$function$;

REVOKE ALL ON FUNCTION public.command_create_katalog_promo(
  uuid, uuid, uuid, text, numeric, timestamptz, timestamptz, boolean, text, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_create_katalog_promo(
  uuid, uuid, uuid, text, numeric, timestamptz, timestamptz, boolean, text, text, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.command_end_katalog_promo(
  p_usaha_id uuid,
  p_promosi_katalog_id uuid,
  p_expected_updated_at timestamptz,
  p_idempotency_key text,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.require_usaha_permission(p_usaha_id, 'event_promotion.manage');
  v_row public.promosi_katalog%ROWTYPE;
  v_claim jsonb;
  v_idempotency_id uuid;
  v_hash text;
  v_response jsonb;
BEGIN
  IF p_promosi_katalog_id IS NULL
     OR p_expected_updated_at IS NULL
     OR p_idempotency_key IS NULL
     OR btrim(p_idempotency_key) = ''
     OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: promo, expected_updated_at, idempotency_key dan request_id wajib diisi'
      USING ERRCODE = '22023';
  END IF;

  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'promosi_katalog_id', p_promosi_katalog_id,
    'expected_updated_at', p_expected_updated_at
  )::text);
  v_claim := app_private.catalog_idempotency_claim(
    p_usaha_id, 'end_katalog_promo', p_idempotency_key, v_hash
  );
  IF v_claim->>'state' = 'committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state' = 'unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: status penghentian promo belum dapat dipastikan'
      USING ERRCODE = '40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text, 0));

  SELECT * INTO v_row
  FROM public.promosi_katalog
  WHERE usaha_id = p_usaha_id
    AND promosi_katalog_id = p_promosi_katalog_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: promo katalog tidak ditemukan'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_DATA: promo sudah berubah, muat ulang sebelum menghentikan'
      USING ERRCODE = '40001';
  END IF;
  IF v_row.status <> 'active' OR v_row.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: hanya promo aktif/terjadwal yang dapat dihentikan'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.promosi_katalog
  SET status = 'ended',
      ended_at = now(),
      ended_by_auth_user_id = auth.uid(),
      ended_by_akun_admin_id = v_admin_id,
      updated_at = now()
  WHERE usaha_id = p_usaha_id
    AND promosi_katalog_id = p_promosi_katalog_id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, request_id, change_summary
  )
  VALUES (
    p_usaha_id, auth.uid(), v_admin_id, 'end',
    'promosi_katalog', p_promosi_katalog_id, 'admin-command', p_request_id,
    jsonb_build_object('status', 'ended', 'ended_at', v_row.ended_at)
  );

  v_response := jsonb_build_object(
    'promosi_katalog_id', v_row.promosi_katalog_id,
    'status', v_row.status,
    'ended_at', v_row.ended_at,
    'updated_at', v_row.updated_at
  );
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id, 200, v_response);
  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_end_katalog_promo(
  uuid, uuid, timestamptz, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_end_katalog_promo(
  uuid, uuid, timestamptz, text, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.command_end_katalog_promo(
  p_usaha_id uuid,
  p_promosi_katalog_id uuid,
  p_expected_updated_at timestamptz,
  p_idempotency_key text,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_end_katalog_promo(
    p_usaha_id, p_promosi_katalog_id, p_expected_updated_at,
    p_idempotency_key, p_request_id
  );
$function$;

REVOKE ALL ON FUNCTION public.command_end_katalog_promo(
  uuid, uuid, timestamptz, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_end_katalog_promo(
  uuid, uuid, timestamptz, text, uuid
) TO authenticated;

-- Preserve the existing package promo RPC contract while adding the exclusive
-- valid_until boundary to the server-side resolver.
CREATE OR REPLACE FUNCTION app_private.resolve_package_promo_price(
  p_usaha_id uuid,
  p_paket_sewa_id uuid,
  p_tarif_sewa_id uuid,
  p_as_of timestamptz DEFAULT now()
)
RETURNS TABLE (
  tarif_sewa_id uuid,
  harga_normal numeric(14,2),
  harga_efektif numeric(14,2),
  promosi_paket_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_at timestamptz := coalesce(p_as_of, now());
BEGIN
  IF p_usaha_id IS NULL OR p_paket_sewa_id IS NULL OR p_tarif_sewa_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tenant, package, dan tariff wajib diisi'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_usaha_id::text || ':package-promo:' || p_tarif_sewa_id::text, 0)
  );

  RETURN QUERY
  SELECT t.tarif_sewa_id, t.nominal,
         CASE WHEN pp.promosi_paket_id IS NOT NULL THEN pp.harga_promo ELSE t.nominal END,
         pp.promosi_paket_id
  FROM public.tarif_sewa t
  LEFT JOIN LATERAL (
    SELECT p.promosi_paket_id, p.harga_promo
    FROM public.promosi_paket_sewa p
    WHERE p.usaha_id = t.usaha_id
      AND p.tarif_sewa_id = t.tarif_sewa_id
      AND p.paket_sewa_id = t.paket_sewa_id
      AND p.status = 'active'
      AND p.started_at <= v_at
      AND (p.valid_until IS NULL OR v_at < p.valid_until)
      AND p.ended_at IS NULL
      AND p.harga_promo < t.nominal
    ORDER BY p.started_at DESC, p.created_at DESC
    LIMIT 1
  ) pp ON true
  WHERE t.usaha_id = p_usaha_id
    AND t.paket_sewa_id = p_paket_sewa_id
    AND t.tarif_sewa_id = p_tarif_sewa_id
    AND t.status = 'active'
    AND t.berlaku_mulai <= v_at
    AND (t.berlaku_sampai IS NULL OR v_at < t.berlaku_sampai);
END;
$function$;

REVOKE ALL ON FUNCTION app_private.resolve_package_promo_price(
  uuid, uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

-- Keep the legacy package promo writer signature for existing clients. The new
-- window command applies valid_until after the existing trusted transition succeeds.
CREATE OR REPLACE FUNCTION app_private.command_set_paket_promo_window(
  p_usaha_id uuid,
  p_paket_sewa_id uuid,
  p_tarif_sewa_id uuid,
  p_enabled boolean,
  p_harga_promo numeric DEFAULT NULL,
  p_valid_until timestamptz DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.require_usaha_permission(p_usaha_id, 'event_promotion.manage');
  v_claim jsonb;
  v_idempotency_id uuid;
  v_hash text;
  v_result jsonb;
  v_promo_id uuid;
  v_row public.promosi_paket_sewa%ROWTYPE;
BEGIN
  IF p_usaha_id IS NULL OR p_paket_sewa_id IS NULL OR p_tarif_sewa_id IS NULL
     OR p_enabled IS NULL OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = ''
     OR p_request_id IS NULL
     OR (p_enabled AND p_valid_until IS NOT NULL AND p_valid_until <= now()) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tenant, target, status, idempotency dan batas waktu promo paket tidak valid'
      USING ERRCODE = '22023';
  END IF;

  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'paket_sewa_id', p_paket_sewa_id,
    'tarif_sewa_id', p_tarif_sewa_id,
    'enabled', p_enabled,
    'harga_promo', p_harga_promo,
    'valid_until', p_valid_until,
    'expected_updated_at', p_expected_updated_at
  )::text);
  v_claim := app_private.catalog_idempotency_claim(
    p_usaha_id, 'set_paket_promo_window', p_idempotency_key, v_hash
  );
  IF v_claim->>'state' = 'committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state' = 'unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: perubahan jadwal promo paket belum dapat dipastikan'
      USING ERRCODE = '40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  v_result := app_private.command_set_paket_promo(
    p_usaha_id, p_paket_sewa_id, p_tarif_sewa_id, p_enabled,
    p_harga_promo, p_expected_updated_at,
    left(btrim(p_idempotency_key) || ':base', 240), p_request_id
  );
  v_promo_id := nullif(v_result->>'promosi_paket_id', '')::uuid;

  IF p_enabled AND v_promo_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_usaha_id::text || ':package-promo:' || p_tarif_sewa_id::text, 0)
    );
    SELECT * INTO v_row
    FROM public.promosi_paket_sewa
    WHERE usaha_id = p_usaha_id AND promosi_paket_id = v_promo_id
    FOR UPDATE;
    IF NOT FOUND OR v_row.status <> 'active' THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: promo paket tidak lagi aktif'
        USING ERRCODE = '23514';
    END IF;
    IF v_row.valid_until IS DISTINCT FROM p_valid_until THEN
      UPDATE public.promosi_paket_sewa
      SET valid_until = p_valid_until, updated_at = now()
      WHERE usaha_id = p_usaha_id AND promosi_paket_id = v_promo_id
      RETURNING * INTO v_row;

      INSERT INTO public.audit_log (
        usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
        entity_type, entity_id, source_application, request_id, change_summary
      )
      VALUES (
        p_usaha_id, auth.uid(), v_admin_id, 'schedule_window',
        'promosi_paket_sewa', v_promo_id, 'admin-command', p_request_id,
        jsonb_build_object('valid_until', p_valid_until)
      );
    END IF;
    v_result := v_result || jsonb_build_object(
      'valid_until', v_row.valid_until,
      'updated_at', v_row.updated_at
    );
  END IF;

  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id, 200, v_result);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_set_paket_promo_window(
  uuid, uuid, uuid, boolean, numeric, timestamptz, timestamptz, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_set_paket_promo_window(
  uuid, uuid, uuid, boolean, numeric, timestamptz, timestamptz, text, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.command_set_paket_promo_window(
  p_usaha_id uuid,
  p_paket_sewa_id uuid,
  p_tarif_sewa_id uuid,
  p_enabled boolean,
  p_harga_promo numeric DEFAULT NULL,
  p_valid_until timestamptz DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_set_paket_promo_window(
    p_usaha_id, p_paket_sewa_id, p_tarif_sewa_id, p_enabled,
    p_harga_promo, p_valid_until, p_expected_updated_at,
    p_idempotency_key, p_request_id
  );
$function$;

REVOKE ALL ON FUNCTION public.command_set_paket_promo_window(
  uuid, uuid, uuid, boolean, numeric, timestamptz, timestamptz, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_set_paket_promo_window(
  uuid, uuid, uuid, boolean, numeric, timestamptz, timestamptz, text, uuid
) TO authenticated;

COMMENT ON FUNCTION app_private.resolve_catalog_promo_price(uuid,uuid,uuid,text,timestamptz) IS
  'Server-authoritative channel resolver. Variant promotion has precedence; product promotion is fallback only.';
COMMENT ON FUNCTION app_private.resolve_package_promo_price(uuid,uuid,uuid,timestamptz) IS
  'Resolves package price in the half-open interval [started_at, valid_until); ended_at records manual stop.';



DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.detail_penyewaan'::regclass AND conname = 'detail_penyewaan_catalog_promo_requires_tariff_check') THEN
    ALTER TABLE public.detail_penyewaan
      ADD CONSTRAINT detail_penyewaan_catalog_promo_requires_tariff_check
      CHECK (promosi_katalog_id IS NULL OR (tarif_sewa_id IS NOT NULL AND paket_sewa_id IS NULL AND promosi_paket_id IS NULL));
  END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION app_private.validate_rental_line_math()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'app_private', 'pg_temp'
AS $function$
DECLARE
  v_status text;
  v_timezone text;
  v_jadwal_mulai timestamptz;
  v_jadwal_kembali timestamptz;
  v_barang_id uuid;
  v_duration_unit text;
  v_duration_value numeric;
  v_tariff_nominal numeric(14,2);
  v_period_seconds numeric;
  v_periods integer;
  v_expected_subtotal numeric(14,2);
  v_normal_tariff_nominal numeric(14,2);
  v_catalog_discount_percent numeric(5,2);
  v_expected_discount numeric(14,2);
BEGIN
  SELECT p.status, p.jadwal_mulai, p.jadwal_kembali, u.timezone
    INTO v_status, v_jadwal_mulai, v_jadwal_kembali, v_timezone
  FROM public.penyewaan p
  JOIN public.usaha u
    ON u.usaha_id = p.usaha_id
  WHERE p.usaha_id = COALESCE(NEW.usaha_id, OLD.usaha_id)
    AND p.penyewaan_id = COALESCE(NEW.penyewaan_id, OLD.penyewaan_id);

  IF v_status IS NOT NULL AND v_status NOT IN ('draft', 'prepared', 'ready_for_pickup') THEN
    RAISE EXCEPTION 'Operational rental detail is immutable; use a domain amendment/correction workflow';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF v_status IS NOT NULL AND v_status NOT IN ('draft', 'prepared', 'ready_for_pickup') THEN
      RAISE EXCEPTION 'Operational rental detail cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF v_jadwal_mulai IS NULL OR v_jadwal_kembali IS NULL OR v_jadwal_kembali <= v_jadwal_mulai THEN
    RAISE EXCEPTION 'Rental line schedule is invalid';
  END IF;

  v_barang_id := NEW.barang_id;

  IF NEW.varian_barang_id IS NOT NULL THEN
    SELECT vb.barang_id
      INTO v_barang_id
    FROM public.varian_barang vb
    WHERE vb.usaha_id = NEW.usaha_id
      AND vb.varian_barang_id = NEW.varian_barang_id
      AND vb.status = 'active';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Active rental variant could not be resolved for rental line';
    END IF;
  END IF;

  IF NEW.promosi_paket_id IS NOT NULL THEN
    IF NEW.tarif_sewa_id IS NULL OR NEW.paket_sewa_id IS NULL THEN
      RAISE EXCEPTION 'Package promotion snapshot requires package and tariff references';
    END IF;

    SELECT
      coalesce(NEW.durasi_unit_snapshot, t.durasi_unit),
      coalesce(NEW.durasi_nilai_snapshot, t.durasi_nilai),
      pp.harga_promo,
      pp.harga_normal
    INTO v_duration_unit, v_duration_value, v_tariff_nominal, v_normal_tariff_nominal
    FROM public.promosi_paket_sewa pp
    JOIN public.tarif_sewa t
      ON t.tarif_sewa_id = pp.tarif_sewa_id
     AND t.usaha_id = pp.usaha_id
    WHERE pp.usaha_id = NEW.usaha_id
      AND pp.promosi_paket_id = NEW.promosi_paket_id
      AND pp.tarif_sewa_id = NEW.tarif_sewa_id
      AND pp.paket_sewa_id = NEW.paket_sewa_id
      AND t.paket_sewa_id = NEW.paket_sewa_id
      AND (
        (NEW.durasi_unit_snapshot IS NOT NULL AND NEW.durasi_nilai_snapshot IS NOT NULL)
        OR (t.status = 'active' AND t.berlaku_mulai <= v_jadwal_mulai
            AND (t.berlaku_sampai IS NULL OR t.berlaku_sampai > v_jadwal_mulai))
      )
    LIMIT 1;

    IF NEW.harga_normal_snapshot IS NOT NULL
       AND NEW.harga_normal_snapshot IS DISTINCT FROM v_normal_tariff_nominal THEN
      RAISE EXCEPTION 'Package promotion normal-price snapshot is inconsistent';
    END IF;

  ELSIF NEW.promosi_katalog_id IS NOT NULL THEN
    IF NEW.tarif_sewa_id IS NULL OR NEW.paket_sewa_id IS NOT NULL OR NEW.promosi_paket_id IS NOT NULL THEN
      RAISE EXCEPTION 'Catalog promotion snapshot requires a non-package rental tariff';
    END IF;

    SELECT
      coalesce(NEW.durasi_unit_snapshot, t.durasi_unit),
      coalesce(NEW.durasi_nilai_snapshot, t.durasi_nilai),
      coalesce(NEW.harga_normal_snapshot, t.nominal),
      pk.diskon_persen
    INTO v_duration_unit, v_duration_value, v_normal_tariff_nominal, v_catalog_discount_percent
    FROM public.promosi_katalog pk
    JOIN public.tarif_sewa t
      ON t.usaha_id = pk.usaha_id
     AND t.tarif_sewa_id = NEW.tarif_sewa_id
    WHERE pk.usaha_id = NEW.usaha_id
      AND pk.promosi_katalog_id = NEW.promosi_katalog_id
      AND pk.channel = 'rental'
      AND (
        (NEW.varian_barang_id IS NOT NULL AND pk.varian_barang_id = NEW.varian_barang_id)
        OR (pk.varian_barang_id IS NULL AND pk.barang_id = v_barang_id)
      )
      AND (
        (NEW.varian_barang_id IS NOT NULL AND (
          t.varian_barang_id = NEW.varian_barang_id
          OR (t.varian_barang_id IS NULL AND t.barang_id = v_barang_id)
        ))
        OR (NEW.varian_barang_id IS NULL AND t.barang_id = v_barang_id AND t.varian_barang_id IS NULL)
      )
      AND (
        (NEW.durasi_unit_snapshot IS NOT NULL AND NEW.durasi_nilai_snapshot IS NOT NULL
          AND NEW.harga_normal_snapshot IS NOT NULL)
        OR (t.status = 'active' AND t.berlaku_mulai <= v_jadwal_mulai
            AND (t.berlaku_sampai IS NULL OR t.berlaku_sampai > v_jadwal_mulai))
      )
    LIMIT 1;

    IF v_catalog_discount_percent IS NULL OR v_normal_tariff_nominal IS NULL
       OR v_normal_tariff_nominal <= 0 THEN
      RAISE EXCEPTION 'Catalog promotion snapshot does not match rental target and tariff';
    END IF;
    IF NEW.harga_normal_snapshot IS DISTINCT FROM round(v_normal_tariff_nominal, 2)
       OR NEW.diskon_persen_snapshot IS DISTINCT FROM v_catalog_discount_percent THEN
      RAISE EXCEPTION 'Catalog promotion price snapshot is inconsistent';
    END IF;
    v_tariff_nominal := round(v_normal_tariff_nominal * (100 - v_catalog_discount_percent) / 100, 2);

  ELSIF NEW.tarif_sewa_id IS NOT NULL THEN
    SELECT
      coalesce(NEW.durasi_unit_snapshot, t.durasi_unit),
      coalesce(NEW.durasi_nilai_snapshot, t.durasi_nilai),
      coalesce(NEW.harga_normal_snapshot, t.nominal)
    INTO v_duration_unit, v_duration_value, v_tariff_nominal
    FROM public.tarif_sewa t
    WHERE t.usaha_id = NEW.usaha_id
      AND t.tarif_sewa_id = NEW.tarif_sewa_id
      AND (
        (NEW.durasi_unit_snapshot IS NOT NULL AND NEW.durasi_nilai_snapshot IS NOT NULL
          AND NEW.harga_normal_snapshot IS NOT NULL)
        OR (t.status = 'active' AND t.berlaku_mulai <= v_jadwal_mulai
            AND (t.berlaku_sampai IS NULL OR t.berlaku_sampai > v_jadwal_mulai))
      )
      AND (
        (NEW.paket_sewa_id IS NOT NULL AND t.paket_sewa_id = NEW.paket_sewa_id)
        OR (
          NEW.paket_sewa_id IS NULL
          AND v_barang_id IS NOT NULL
          AND (
            (NEW.varian_barang_id IS NOT NULL AND (
              t.varian_barang_id = NEW.varian_barang_id
              OR (t.varian_barang_id IS NULL AND t.barang_id = v_barang_id)
            ))
            OR (NEW.varian_barang_id IS NULL AND t.barang_id = v_barang_id AND t.varian_barang_id IS NULL)
          )
        )
      )
    LIMIT 1;

  ELSE
  SELECT
    t.durasi_unit,
    t.durasi_nilai,
    t.nominal
    INTO v_duration_unit, v_duration_value, v_tariff_nominal
  FROM public.tarif_sewa t
  WHERE t.usaha_id = NEW.usaha_id
    AND t.status = 'active'
    AND t.berlaku_mulai <= v_jadwal_mulai
    AND (t.berlaku_sampai IS NULL OR t.berlaku_sampai > v_jadwal_mulai)
    AND (
      (NEW.paket_sewa_id IS NOT NULL AND t.paket_sewa_id = NEW.paket_sewa_id)
      OR (
        NEW.paket_sewa_id IS NULL
        AND v_barang_id IS NOT NULL
        AND (
          (NEW.varian_barang_id IS NOT NULL AND (
            t.varian_barang_id = NEW.varian_barang_id
            OR (t.varian_barang_id IS NULL AND t.barang_id = v_barang_id)
          ))
          OR (NEW.varian_barang_id IS NULL AND t.barang_id = v_barang_id AND t.varian_barang_id IS NULL)
        )
      )
    )
  ORDER BY
    CASE
      WHEN NEW.varian_barang_id IS NOT NULL AND t.varian_barang_id = NEW.varian_barang_id THEN 0
      ELSE 1
    END,
    t.berlaku_mulai DESC,
    t.updated_at DESC
  LIMIT 1;
  END IF;

  IF v_duration_unit IS NULL OR v_duration_value IS NULL OR v_duration_value <= 0 THEN
    RAISE EXCEPTION 'Active rental tariff could not be resolved for rental line';
  END IF;

  v_period_seconds := CASE lower(btrim(v_duration_unit))
    WHEN 'jam' THEN v_duration_value * 3600
    WHEN 'hari' THEN v_duration_value * 86400
    WHEN 'minggu' THEN v_duration_value * 604800
    ELSE NULL
  END;

  IF v_period_seconds IS NULL THEN
    RAISE EXCEPTION 'Unsupported rental tariff duration unit: %', v_duration_unit;
  END IF;

  v_periods := GREATEST(
    1,
    ceil(
      extract(epoch FROM (v_jadwal_kembali - v_jadwal_mulai))
      / v_period_seconds
    )::integer
  );

  IF NEW.promosi_katalog_id IS NOT NULL THEN
    v_expected_discount := round(
      (v_normal_tariff_nominal - v_tariff_nominal) * NEW.jumlah * v_periods, 2
    );
    IF NEW.nominal_diskon_snapshot IS DISTINCT FROM v_expected_discount THEN
      RAISE EXCEPTION 'Catalog promotion discount snapshot does not match rental line math';
    END IF;
  ELSIF coalesce(NEW.diskon_persen_snapshot, 0) <> 0
     OR coalesce(NEW.nominal_diskon_snapshot, 0) <> 0 THEN
    RAISE EXCEPTION 'A rental catalog discount snapshot requires a promotion reference';
  END IF;

  IF NEW.unit_price IS DISTINCT FROM round(v_tariff_nominal, 2) THEN
    RAISE EXCEPTION 'Rental line unit price must equal active tariff nominal';
  END IF;

  v_expected_subtotal := round(NEW.jumlah * v_tariff_nominal * v_periods, 2);

  IF NEW.subtotal IS DISTINCT FROM v_expected_subtotal THEN
    RAISE EXCEPTION
      'Rental line subtotal must equal quantity multiplied by tariff nominal and tariff periods';
  END IF;

  RETURN NEW;
END;
$function$
;



-- Direct rental command resolves product/variant promotions from database truth before persisting lines.
CREATE OR REPLACE FUNCTION app_private.command_create_direct_rental(p_usaha_id uuid, p_penyewa_id uuid, p_jadwal_mulai timestamp with time zone, p_jadwal_kembali timestamp with time zone, p_lines jsonb, p_catatan text, p_idempotency_key text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_timezone text;
  v_default_tolerance_hours numeric;
  v_renter public.penyewa%ROWTYPE;
  v_rental_id uuid := gen_random_uuid();
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_tolerance_deadline timestamptz;
  v_currency text;
  v_total numeric(14,2) := 0;
  v_number bigint;
  v_rental_number text;
  v_line jsonb;
  v_detail_id uuid;
  v_response jsonb;
  v_target_count integer := 0;
  v_available numeric;
  v_reserved numeric;
  v_required numeric;
  v_barang_id uuid;
  v_parent_barang_id uuid;
  v_varian_id uuid;
  v_paket_id uuid;
  v_qty numeric;
  v_unit_price numeric(14,2);
  v_subtotal numeric(14,2);
  v_line_currency text;
  v_tariff_id uuid;
  v_tariff_duration_unit text;
  v_tariff_duration_value numeric;
  v_tariff_period_seconds numeric;
  v_duration_periods integer;
  v_client_duration_periods integer;
  v_tariff_nominal numeric(14,2);
  v_effective_nominal numeric(14,2);
  v_promosi_paket_id uuid;
  v_expected_subtotal numeric(14,2);
  v_pricing_at timestamptz := transaction_timestamp();
  v_catalog_promo_id uuid;
  v_catalog_discount_percent numeric(5,2) := 0;
  v_catalog_discount_amount numeric(14,2) := 0;
  v_calculated_lines jsonb := '[]'::jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL OR p_penyewa_id IS NULL OR p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: renter dan minimal satu detail rental wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF p_jadwal_mulai IS NULL OR p_jadwal_kembali IS NULL OR p_jadwal_kembali <= p_jadwal_mulai THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: jadwal rental tidak valid' USING ERRCODE = '22023';
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
    AND ku.usaha_id = p_usaha_id;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE = '42501';
  END IF;

  SELECT u.timezone, coalesce(u.default_tolerance_hours, 10)
  INTO v_timezone, v_default_tolerance_hours
  FROM public.usaha u
  WHERE u.usaha_id = p_usaha_id
    AND u.status = 'active';

  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_renter
  FROM public.penyewa
  WHERE usaha_id = p_usaha_id
    AND penyewa_id = p_penyewa_id
    AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: penyewa aktif tidak ditemukan dalam usaha ini' USING ERRCODE = 'P0002';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'penyewa_id', p_penyewa_id,
    'jadwal_mulai', p_jadwal_mulai,
    'jadwal_kembali', p_jadwal_kembali,
    'lines', p_lines,
    'catatan', nullif(btrim(coalesce(p_catatan, '')), '')
  )::text);

  INSERT INTO public.idempotency_key (
    usaha_id, actor_auth_user_id, key, command_name, request_hash
  )
  VALUES (
    p_usaha_id, v_auth_user_id, btrim(p_idempotency_key), 'create_direct_rental', v_request_hash
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
      AND ik.command_name = 'create_direct_rental'
      AND ik.key = btrim(p_idempotency_key);

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE = '23505';
    END IF;

    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;

    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE = '40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text, 0));

  v_currency := null;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_target_count := v_target_count + 1;
    v_barang_id := nullif(v_line->>'barang_id', '')::uuid;
    v_parent_barang_id := null;
    v_varian_id := nullif(v_line->>'varian_barang_id', '')::uuid;
    v_paket_id := nullif(v_line->>'paket_sewa_id', '')::uuid;
    v_qty := coalesce((v_line->>'jumlah')::numeric, 0);
    v_unit_price := coalesce((v_line->>'unit_price')::numeric, -1);
    v_subtotal := coalesce((v_line->>'subtotal')::numeric, -1);
    v_line_currency := coalesce(v_line->>'currency_code', 'IDR');
    v_tariff_id := nullif(v_line->>'tarif_sewa_id', '')::uuid;
    v_client_duration_periods := nullif(v_line->>'duration_periods', '')::integer;

    IF num_nonnulls(v_barang_id, v_varian_id, v_paket_id) <> 1 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: setiap detail rental harus memiliki tepat satu target katalog' USING ERRCODE = '22023';
    END IF;

    IF v_varian_id IS NOT NULL THEN
      SELECT vb.barang_id
      INTO v_parent_barang_id
      FROM public.varian_barang vb
      WHERE vb.usaha_id = p_usaha_id
        AND vb.varian_barang_id = v_varian_id
        AND vb.status = 'active';

      IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: varian tidak ditemukan atau tidak aktif dalam usaha ini' USING ERRCODE = 'P0002';
      END IF;
    END IF;

    IF v_qty <= 0 OR v_unit_price < 0 OR v_subtotal < 0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: quantity, unit_price, dan subtotal tidak valid' USING ERRCODE = '22023';
    END IF;

    IF v_tariff_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: tarif sewa wajib dipilih' USING ERRCODE = '22023';
    END IF;

    SELECT
      t.durasi_unit,
      t.durasi_nilai,
      t.nominal
    INTO
      v_tariff_duration_unit,
      v_tariff_duration_value,
      v_tariff_nominal
    FROM public.tarif_sewa t
    WHERE t.tarif_sewa_id = v_tariff_id
      AND t.usaha_id = p_usaha_id
      AND t.status = 'active'
      AND t.berlaku_mulai <= p_jadwal_mulai
      AND (t.berlaku_sampai IS NULL OR t.berlaku_sampai > p_jadwal_mulai)
      AND (
        (v_paket_id IS NOT NULL AND t.paket_sewa_id = v_paket_id)
        OR (
          v_paket_id IS NULL
          AND (
            (v_varian_id IS NOT NULL AND (
              t.varian_barang_id = v_varian_id
              OR (t.varian_barang_id IS NULL AND t.barang_id = v_parent_barang_id)
            ))
            OR (v_varian_id IS NULL AND v_barang_id IS NOT NULL AND t.barang_id = v_barang_id AND t.varian_barang_id IS NULL)
          )
        )
      )
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_FOUND: tarif sewa aktif tidak ditemukan untuk target katalog dan periode rental' USING ERRCODE = 'P0002';
    END IF;

    v_effective_nominal := v_tariff_nominal;
    v_promosi_paket_id := NULL;
    IF v_paket_id IS NOT NULL THEN
      SELECT rp.harga_efektif, rp.promosi_paket_id
        INTO v_effective_nominal, v_promosi_paket_id
      FROM app_private.resolve_package_promo_price(p_usaha_id, v_paket_id, v_tariff_id, now()) rp;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: tarif paket tidak dapat menyelesaikan harga promo' USING ERRCODE = '23514';
      END IF;
    END IF;

    v_catalog_promo_id := NULL;
    v_catalog_discount_percent := 0;
    v_catalog_discount_amount := 0;
    IF v_paket_id IS NULL THEN
      SELECT rp.promosi_katalog_id, rp.diskon_persen
        INTO v_catalog_promo_id, v_catalog_discount_percent
      FROM app_private.resolve_catalog_promo_price(
        p_usaha_id, v_barang_id, v_varian_id, 'rental', v_pricing_at
      ) rp;
      IF FOUND THEN
        v_effective_nominal := round(
          v_tariff_nominal * (100 - v_catalog_discount_percent) / 100, 2
        );
      END IF;
    END IF;

    v_tariff_period_seconds := CASE lower(btrim(v_tariff_duration_unit))
      WHEN 'jam' THEN v_tariff_duration_value * 3600
      WHEN 'hari' THEN v_tariff_duration_value * 86400
      WHEN 'minggu' THEN v_tariff_duration_value * 604800
      ELSE NULL
    END;

    IF v_tariff_period_seconds IS NULL
       OR v_tariff_duration_value IS NULL
       OR v_tariff_duration_value <= 0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: satuan durasi tarif tidak didukung' USING ERRCODE = '22023';
    END IF;

    v_duration_periods := GREATEST(
      1,
      CEIL(
        EXTRACT(EPOCH FROM (p_jadwal_kembali - p_jadwal_mulai))
        / v_tariff_period_seconds
      )::integer
    );

    IF v_client_duration_periods IS NOT NULL AND v_client_duration_periods <> v_duration_periods THEN
      RAISE EXCEPTION
        'BUSINESS_CONFLICT: periode tarif berubah; expected=%, received=%',
        v_duration_periods, v_client_duration_periods
        USING ERRCODE = '23514';
    END IF;

    IF v_catalog_promo_id IS NULL
       AND v_unit_price IS DISTINCT FROM round(v_effective_nominal, 2) THEN
      RAISE EXCEPTION
        'BUSINESS_CONFLICT: harga tarif berubah; expected=%, received=%',
        round(v_effective_nominal, 2), v_unit_price
        USING ERRCODE = '23514';
    END IF;

    v_expected_subtotal := round(v_qty * v_effective_nominal * v_duration_periods, 2);

    IF v_catalog_promo_id IS NULL AND v_subtotal IS DISTINCT FROM v_expected_subtotal THEN
      RAISE EXCEPTION
        'VALIDATION_ERROR: subtotal tidak sesuai durasi tarif; expected=%, received=%',
        v_expected_subtotal, v_subtotal
        USING ERRCODE = '22023';
    END IF;

    v_unit_price := round(v_effective_nominal, 2);
    v_subtotal := v_expected_subtotal;
    IF v_catalog_promo_id IS NOT NULL THEN
      v_catalog_discount_amount := round(
        (v_tariff_nominal - v_effective_nominal) * v_qty * v_duration_periods, 2
      );
    END IF;

    IF v_line_currency <> 'IDR' THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: currency fase awal adalah IDR' USING ERRCODE = '22023';
    END IF;

    IF v_currency IS NULL THEN
      v_currency := v_line_currency;
    ELSIF v_currency <> v_line_currency THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: semua detail rental harus menggunakan currency yang sama' USING ERRCODE = '22023';
    END IF;

    IF v_barang_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.barang b
      WHERE b.usaha_id = p_usaha_id AND b.barang_id = v_barang_id AND b.status = 'active'
    ) THEN
      RAISE EXCEPTION 'NOT_FOUND: barang tidak ditemukan atau tidak aktif dalam usaha ini' USING ERRCODE = 'P0002';
    END IF;

    IF v_varian_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.varian_barang vb
      WHERE vb.usaha_id = p_usaha_id AND vb.varian_barang_id = v_varian_id AND vb.status = 'active'
    ) THEN
      RAISE EXCEPTION 'NOT_FOUND: varian tidak ditemukan atau tidak aktif dalam usaha ini' USING ERRCODE = 'P0002';
    END IF;

    IF v_paket_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.paket_sewa ps
      WHERE ps.usaha_id = p_usaha_id AND ps.paket_sewa_id = v_paket_id AND ps.status = 'active'
    ) THEN
      RAISE EXCEPTION 'NOT_FOUND: paket tidak ditemukan atau tidak aktif dalam usaha ini' USING ERRCODE = 'P0002';
    END IF;

    IF v_varian_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.varian_barang vb
      WHERE vb.usaha_id = p_usaha_id AND vb.varian_barang_id = v_varian_id
        AND vb.status = 'active'
        AND (v_barang_id IS NULL OR vb.barang_id = v_barang_id)
    ) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: varian tidak termasuk barang yang dipilih' USING ERRCODE = '23514';
    END IF;

    IF v_currency IS NULL THEN
      v_currency := 'IDR';
    END IF;

    IF v_barang_id IS NOT NULL OR v_varian_id IS NOT NULL THEN
      SELECT count(*)
      INTO v_available
      FROM public.unit_barang ub
      WHERE ub.usaha_id = p_usaha_id
        AND ub.status = 'ready'
        AND (
          (v_varian_id IS NOT NULL AND ub.varian_barang_id = v_varian_id)
          OR (v_varian_id IS NULL AND ub.barang_id = v_barang_id)
        );

      v_reserved := app_private.reservation_locked_component_requirement(
        p_usaha_id,
        (p_jadwal_mulai AT TIME ZONE v_timezone)::date,
        (p_jadwal_kembali AT TIME ZONE v_timezone)::date,
        v_barang_id,
        v_varian_id,
        null
      );

      v_required := v_qty;
      IF v_available - v_reserved < v_required THEN
        RAISE EXCEPTION
          'BUSINESS_CONFLICT: kapasitas fisik tidak cukup untuk target rental; requested=%, available=%',
          v_required, greatest(v_available - v_reserved, 0)
          USING ERRCODE = '23514';
      END IF;
    ELSE
      IF NOT EXISTS (
        SELECT 1
        FROM public.komponen_paket cp
        WHERE cp.usaha_id = p_usaha_id
          AND cp.paket_sewa_id = v_paket_id
      ) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: paket belum memiliki komponen' USING ERRCODE = '22023';
      END IF;

      FOR v_barang_id, v_varian_id, v_required IN
        SELECT cp.barang_id, cp.varian_barang_id, v_qty * cp.jumlah
        FROM public.komponen_paket cp
        WHERE cp.usaha_id = p_usaha_id
          AND cp.paket_sewa_id = v_paket_id
      LOOP
        SELECT count(*)
        INTO v_available
        FROM public.unit_barang ub
        WHERE ub.usaha_id = p_usaha_id
          AND ub.status = 'ready'
          AND (
            (v_varian_id IS NOT NULL AND ub.varian_barang_id = v_varian_id)
            OR (v_varian_id IS NULL AND ub.barang_id = v_barang_id)
          );

        v_reserved := app_private.reservation_locked_component_requirement(
          p_usaha_id,
          (p_jadwal_mulai AT TIME ZONE v_timezone)::date,
          (p_jadwal_kembali AT TIME ZONE v_timezone)::date,
          v_barang_id,
          v_varian_id,
          null
        );

        IF v_available - v_reserved < v_required THEN
          RAISE EXCEPTION
            'BUSINESS_CONFLICT: kapasitas fisik paket tidak cukup; requested=%, available=%',
            v_required, greatest(v_available - v_reserved, 0)
            USING ERRCODE = '23514';
        END IF;
      END LOOP;
    END IF;

    v_calculated_lines := v_calculated_lines || jsonb_build_array(
      v_line || jsonb_build_object(
        'unit_price', v_unit_price,
        'subtotal', v_subtotal,
        'promosi_katalog_id', v_catalog_promo_id,
        'harga_normal_snapshot', round(v_tariff_nominal, 2),
        'diskon_persen_snapshot', coalesce(v_catalog_discount_percent, 0),
        'nominal_diskon_snapshot', coalesce(v_catalog_discount_amount, 0),
        'durasi_unit_snapshot', v_tariff_duration_unit,
        'durasi_nilai_snapshot', v_tariff_duration_value
      )
    );
    v_total := v_total + v_subtotal;
  END LOOP;

  PERFORM app_private.validate_direct_rental_capacity(
    p_usaha_id,
    p_jadwal_mulai,
    p_jadwal_kembali,
    p_lines
  );

  v_number := app_private.next_business_number(
    p_usaha_id,
    'RNT',
    to_char(p_jadwal_mulai AT TIME ZONE v_timezone, 'YYYY')
  );
  v_rental_number := 'RNT-' || to_char(p_jadwal_mulai AT TIME ZONE v_timezone, 'YYYY') || '-' || lpad(v_number::text, 3, '0');
  v_tolerance_deadline := p_jadwal_kembali + pg_catalog.make_interval(secs => v_default_tolerance_hours::double precision * 3600);

  INSERT INTO public.penyewaan (
    penyewaan_id,
    usaha_id,
    reservasi_id,
    penyewa_id,
    nomor_penyewaan,
    jadwal_mulai,
    jadwal_kembali,
    tolerance_deadline,
    status,
    total_amount,
    currency_code,
    catatan
  )
  VALUES (
    v_rental_id,
    p_usaha_id,
    NULL,
    p_penyewa_id,
    v_rental_number,
    p_jadwal_mulai,
    p_jadwal_kembali,
    v_tolerance_deadline,
    'draft',
    v_total,
    v_currency,
    nullif(btrim(coalesce(p_catatan, '')), '')
  );

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_calculated_lines)
  LOOP
    v_detail_id := gen_random_uuid();
    v_barang_id := nullif(v_line->>'barang_id', '')::uuid;
    v_parent_barang_id := null;
    v_varian_id := nullif(v_line->>'varian_barang_id', '')::uuid;
    v_paket_id := nullif(v_line->>'paket_sewa_id', '')::uuid;
    v_qty := (v_line->>'jumlah')::numeric;
    v_unit_price := (v_line->>'unit_price')::numeric;
    v_subtotal := (v_line->>'subtotal')::numeric;
    v_line_currency := coalesce(v_line->>'currency_code', 'IDR');
    v_tariff_id := nullif(v_line->>'tarif_sewa_id', '')::uuid;
    v_promosi_paket_id := NULL;
    IF v_paket_id IS NOT NULL THEN
      SELECT rp.promosi_paket_id INTO v_promosi_paket_id
      FROM app_private.resolve_package_promo_price(p_usaha_id, v_paket_id, v_tariff_id, now()) rp;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: snapshot harga promo paket tidak dapat diselesaikan' USING ERRCODE = '23514';
      END IF;
    END IF;

    INSERT INTO public.detail_penyewaan (
      detail_penyewaan_id, usaha_id, penyewaan_id,
      barang_id, varian_barang_id, paket_sewa_id,
      jumlah, unit_price, currency_code, subtotal, catatan,
      tarif_sewa_id, promosi_paket_id,
      promosi_katalog_id, harga_normal_snapshot,
      diskon_persen_snapshot, nominal_diskon_snapshot,
      durasi_unit_snapshot, durasi_nilai_snapshot
    )
    VALUES (
      v_detail_id, p_usaha_id, v_rental_id,
      v_barang_id, v_varian_id, v_paket_id,
      v_qty, v_unit_price, v_line_currency, v_subtotal,
      nullif(btrim(coalesce(v_line->>'catatan', '')), ''),
      v_tariff_id, v_promosi_paket_id,
      nullif(v_line->>'promosi_katalog_id', '')::uuid,
      nullif(v_line->>'harga_normal_snapshot', '')::numeric,
      coalesce(nullif(v_line->>'diskon_persen_snapshot', '')::numeric, 0),
      coalesce(nullif(v_line->>'nominal_diskon_snapshot', '')::numeric, 0),
      nullif(v_line->>'durasi_unit_snapshot', ''),
      nullif(v_line->>'durasi_nilai_snapshot', '')::numeric
    );

    IF v_paket_id IS NOT NULL THEN
      INSERT INTO public.komponen_penyewaan (
        komponen_penyewaan_id,
        usaha_id,
        detail_penyewaan_id,
        barang_id,
        varian_barang_id,
        unit_barang_id,
        jumlah,
        catatan,
        paket_sewa_id,
        komponen_paket_id
      )
      SELECT
        gen_random_uuid(),
        p_usaha_id,
        v_detail_id,
        cp.barang_id,
        cp.varian_barang_id,
        NULL,
        v_qty * cp.jumlah,
        cp.catatan,
        v_paket_id,
        cp.komponen_paket_id
      FROM public.komponen_paket cp
      WHERE cp.usaha_id = p_usaha_id
        AND cp.paket_sewa_id = v_paket_id;
    END IF;
  END LOOP;

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, request_id, change_summary
  )
  VALUES (
    p_usaha_id, v_auth_user_id, v_admin_id, 'create_direct',
    'penyewaan', v_rental_id, 'admin-command', p_request_id,
    jsonb_build_object(
      'nomor_penyewaan', v_rental_number,
      'reservasi_id', null,
      'penyewa_id', p_penyewa_id,
      'status', 'draft',
      'detail_count', v_target_count,
      'total_amount', v_total,
      'currency_code', v_currency
    )
  );

  INSERT INTO public.outbox_event (
    usaha_id, event_type, aggregate_type, aggregate_id, payload
  )
  VALUES (
    p_usaha_id, 'rental.direct_created', 'penyewaan', v_rental_id,
    jsonb_build_object(
      'rental_id', v_rental_id,
      'rental_number', v_rental_number,
      'renter_id', p_penyewa_id
    )
  );

  v_response := jsonb_build_object(
    'penyewaan_id', v_rental_id,
    'reservasi_id', null,
    'penyewa_id', p_penyewa_id,
    'nomor_penyewaan', v_rental_number,
    'status', 'draft',
    'jadwal_mulai', p_jadwal_mulai,
    'jadwal_kembali', p_jadwal_kembali,
    'tolerance_deadline', v_tolerance_deadline,
    'total_amount', v_total,
    'currency_code', v_currency
  );

  UPDATE public.idempotency_key
  SET response_status = 200,
      response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$
;



-- The private POS command resolves sale promos using catalog prices; inventory/HPP/payment logic remains intact.
-- Override from the latest HPP-aware sale command; promotion pricing does not alter HPP.
CREATE OR REPLACE FUNCTION app_private.command_create_sale_unchecked_20261105(
  p_usaha_id uuid,
  p_source text,
  p_nama_pelanggan text,
  p_nomor_telepon text,
  p_catatan text,
  p_lines jsonb,
  p_akun_keuangan_id uuid,
  p_metode text,
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
  v_timezone text;
  v_account public.akun_keuangan%ROWTYPE;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_sale_id uuid := gen_random_uuid();
  v_checkout_id uuid := gen_random_uuid();
  v_payment_id uuid := gen_random_uuid();
  v_transaction_id uuid := gen_random_uuid();
  v_sale_number text;
  v_checkout_number text;
  v_payment_number text;
  v_payment_number_seq bigint;
  v_transaction_number bigint;
  v_sale_number_seq bigint;
  v_checkout_number_seq bigint;
  v_now timestamptz := now();
  v_year text;
  v_line jsonb;
  v_barang_id uuid;
  v_variant_id uuid;
  v_parent_id uuid;
  v_barang_name text;
  v_variant_name text;
  v_sellable boolean;
  v_price numeric(14,2);
  v_harga_normal numeric(14,2);
  v_promosi_katalog_id uuid;
  v_diskon_persen numeric(5,2) := 0;
  v_nominal_diskon numeric(14,2) := 0;
  v_cost numeric(14,2);
  v_line_hpp numeric(14,2);
  v_unit_hpp_total numeric(14,2) := 0;
  v_unit_hpp_complete boolean := true;
  v_total_hpp numeric(14,2) := 0;
  v_hpp_complete boolean := true;
  v_mode text;
  v_qty integer;
  v_subtotal numeric(14,2);
  v_total numeric(14,2) := 0;
  v_available integer;
  v_reserved numeric := 0;
  v_reservation record;
  v_unit record;
  v_detail_id uuid;
  v_selected integer;
  v_stock public.stok_barang%ROWTYPE;
  v_response jsonb;
  v_method text := lower(btrim(coalesce(p_metode,'')));
BEGIN
  v_admin_id := app_private.assert_finance_admin(p_usaha_id);
  IF p_source NOT IN ('pos','mixed') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: sumber penjualan tidak valid' USING ERRCODE='22023';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines)=0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: minimal satu barang penjualan wajib dipilih' USING ERRCODE='22023';
  END IF;
  IF p_akun_keuangan_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: akun penerima pembayaran wajib dipilih' USING ERRCODE='22023';
  END IF;
  IF v_method NOT IN ('cash','bank_transfer','qris_manual','other') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: metode pembayaran tidak didukung' USING ERRCODE='22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi' USING ERRCODE='22023';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'source',p_source,'nama_pelanggan',nullif(btrim(p_nama_pelanggan),''),
    'nomor_telepon',nullif(btrim(p_nomor_telepon),''),'catatan',nullif(btrim(p_catatan),''),
    'lines',p_lines,'akun',p_akun_keuangan_id,'metode',v_method
  )::text);

  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'create_sale',v_request_hash)
  ON CONFLICT(usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body,request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id AND actor_auth_user_id=v_auth_user_id
      AND command_name='create_sale' AND key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: status penjualan belum dapat dipastikan' USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text,0));

  SELECT timezone INTO v_timezone
  FROM public.usaha WHERE usaha_id=p_usaha_id AND status='active';
  IF v_timezone IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002'; END IF;

  SELECT * INTO v_account
  FROM public.akun_keuangan
  WHERE usaha_id=p_usaha_id AND akun_keuangan_id=p_akun_keuangan_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: akun penerima tidak ditemukan' USING ERRCODE='P0002'; END IF;
  IF v_account.status <> 'active' OR v_account.mata_uang <> 'IDR' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: akun penerima tidak aktif atau bukan akun IDR' USING ERRCODE='23514';
  END IF;

  -- Resolve all prices and validate item eligibility from database truth, never from client-supplied prices.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_barang_id := nullif(v_line->>'barang_id','')::uuid;
    v_variant_id := nullif(v_line->>'varian_barang_id','')::uuid;
    v_qty := coalesce(nullif(v_line->>'jumlah','')::integer,0);
    IF num_nonnulls(v_barang_id,v_variant_id) <> 1 OR v_qty <= 0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: setiap baris harus berisi tepat satu produk/varian dan jumlah bulat positif' USING ERRCODE='22023';
    END IF;

    IF v_variant_id IS NOT NULL THEN
      SELECT b.barang_id,b.nama,v.nama,
        coalesce(v.is_sellable,b.is_sellable),
        coalesce(v.harga_jual,b.harga_jual),
        coalesce(v.harga_beli,b.harga_beli),
        coalesce(v.inventory_mode,b.inventory_mode)
      INTO v_parent_id,v_barang_name,v_variant_name,v_sellable,v_price,v_cost,v_mode
      FROM public.varian_barang v
      JOIN public.barang b ON b.usaha_id=v.usaha_id AND b.barang_id=v.barang_id
      WHERE v.usaha_id=p_usaha_id AND v.varian_barang_id=v_variant_id
        AND v.status='active' AND b.status='active';
    ELSE
      SELECT b.barang_id,b.nama,NULL::text,b.is_sellable,b.harga_jual,b.harga_beli,b.inventory_mode
      INTO v_parent_id,v_barang_name,v_variant_name,v_sellable,v_price,v_cost,v_mode
      FROM public.barang b
      WHERE b.usaha_id=p_usaha_id AND b.barang_id=v_barang_id AND b.status='active';
    END IF;

    IF v_parent_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: produk atau varian aktif tidak ditemukan' USING ERRCODE='P0002'; END IF;
    IF v_sellable IS DISTINCT FROM true THEN RAISE EXCEPTION 'BUSINESS_CONFLICT: produk/varian ini belum diizinkan untuk dijual' USING ERRCODE='23514'; END IF;
    IF v_price IS NULL OR v_price <= 0 THEN RAISE EXCEPTION 'PRICE_REQUIRED: harga jual produk/varian belum ditentukan' USING ERRCODE='23514'; END IF;
    IF v_mode NOT IN ('serialized','quantity','untracked') THEN RAISE EXCEPTION 'VALIDATION_ERROR: mode inventaris produk tidak valid' USING ERRCODE='22023'; END IF;
    IF v_cost IS NOT NULL AND v_cost < 0 THEN RAISE EXCEPTION 'VALIDATION_ERROR: harga beli tidak boleh negatif' USING ERRCODE='22023'; END IF;

    v_harga_normal := v_price;
    v_promosi_katalog_id := NULL;
    v_diskon_persen := 0;
    SELECT rp.promosi_katalog_id, rp.diskon_persen
      INTO v_promosi_katalog_id, v_diskon_persen
    FROM app_private.resolve_catalog_promo_price(
      p_usaha_id,
      CASE WHEN v_variant_id IS NULL THEN v_parent_id ELSE NULL::uuid END,
      v_variant_id,
      'sale',
      v_now
    ) rp;
    IF FOUND THEN
      v_price := round(v_harga_normal * (100 - v_diskon_persen) / 100, 2);
      IF v_price <= 0 THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: promo sale tidak boleh menjadikan harga retail Rp0; gunakan bonus retail pada checkout gabungan' USING ERRCODE='23514';
      END IF;
    END IF;
    v_subtotal := round(v_qty * v_price,2);
    v_total := v_total + v_subtotal;
  END LOOP;

  IF v_total <= 0 THEN RAISE EXCEPTION 'VALIDATION_ERROR: total penjualan harus lebih dari nol' USING ERRCODE='22023'; END IF;

  v_year := to_char(v_now AT TIME ZONE v_timezone,'YYYY');
  v_sale_number_seq := app_private.next_business_number(p_usaha_id,'POS',v_year);
  v_checkout_number_seq := app_private.next_business_number(p_usaha_id,'CKO',v_year);
  v_payment_number_seq := app_private.next_business_number(p_usaha_id,'SP',v_year);
  v_transaction_number := app_private.next_business_number(p_usaha_id,'TRX',v_year);
  v_sale_number := 'POS-' || v_year || '-' || lpad(v_sale_number_seq::text,4,'0');
  v_checkout_number := 'CK-' || v_year || '-' || lpad(v_checkout_number_seq::text,4,'0');
  v_payment_number := 'SP-' || v_year || '-' || lpad(v_payment_number_seq::text,4,'0');

  INSERT INTO public.penjualan(
    penjualan_id,usaha_id,nomor_penjualan,source,nama_pelanggan,nomor_telepon,status,
    payment_status,total_amount,currency_code,catatan,created_by_admin_id
  ) VALUES (
    v_sale_id,p_usaha_id,v_sale_number,p_source,
    nullif(btrim(coalesce(p_nama_pelanggan,'')),''),
    nullif(btrim(coalesce(p_nomor_telepon,'')),''),
    'completed','paid',v_total,'IDR',
    nullif(btrim(coalesce(p_catatan,'')),''),v_admin_id
  );

  -- Re-read each line under the tenant stock lock, then consume exactly the stock class assigned to that product/variant.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_barang_id := nullif(v_line->>'barang_id','')::uuid;
    v_variant_id := nullif(v_line->>'varian_barang_id','')::uuid;
    v_qty := (v_line->>'jumlah')::integer;

    IF v_variant_id IS NOT NULL THEN
      SELECT b.barang_id,b.nama,v.nama,
        coalesce(v.is_sellable,b.is_sellable),
        coalesce(v.harga_jual,b.harga_jual),
        coalesce(v.harga_beli,b.harga_beli),
        coalesce(v.inventory_mode,b.inventory_mode)
      INTO v_parent_id,v_barang_name,v_variant_name,v_sellable,v_price,v_cost,v_mode
      FROM public.varian_barang v
      JOIN public.barang b ON b.usaha_id=v.usaha_id AND b.barang_id=v.barang_id
      WHERE v.usaha_id=p_usaha_id AND v.varian_barang_id=v_variant_id
        AND v.status='active' AND b.status='active';
    ELSE
      SELECT b.barang_id,b.nama,NULL::text,b.is_sellable,b.harga_jual,b.harga_beli,b.inventory_mode
      INTO v_parent_id,v_barang_name,v_variant_name,v_sellable,v_price,v_cost,v_mode
      FROM public.barang b
      WHERE b.usaha_id=p_usaha_id AND b.barang_id=v_barang_id AND b.status='active';
    END IF;

    v_harga_normal := v_price;
    v_promosi_katalog_id := NULL;
    v_diskon_persen := 0;
    SELECT rp.promosi_katalog_id, rp.diskon_persen
      INTO v_promosi_katalog_id, v_diskon_persen
    FROM app_private.resolve_catalog_promo_price(
      p_usaha_id,
      CASE WHEN v_variant_id IS NULL THEN v_parent_id ELSE NULL::uuid END,
      v_variant_id,
      'sale',
      v_now
    ) rp;
    IF FOUND THEN
      v_price := round(v_harga_normal * (100 - v_diskon_persen) / 100, 2);
    END IF;
    v_subtotal := round(v_qty * v_price,2);
    v_nominal_diskon := round((v_harga_normal - v_price) * v_qty, 2);
    v_detail_id := gen_random_uuid();
    v_unit_hpp_total := 0;
    v_unit_hpp_complete := true;
    v_selected := 0;

    INSERT INTO public.detail_penjualan(
      detail_penjualan_id,usaha_id,penjualan_id,barang_id,varian_barang_id,
      nama_barang_snapshot,nama_varian_snapshot,inventory_mode,jumlah,unit_price,subtotal,currency_code,
      harga_beli_satuan,hpp_total,
      promosi_katalog_id,harga_normal_snapshot,diskon_persen_snapshot,nominal_diskon_snapshot
    ) VALUES (
      v_detail_id,p_usaha_id,v_sale_id,v_parent_id,v_variant_id,
      v_barang_name,v_variant_name,v_mode,v_qty,v_price,v_subtotal,'IDR',
      v_cost,CASE WHEN v_cost IS NULL THEN NULL ELSE round(v_qty*v_cost,2) END,
      v_promosi_katalog_id,v_harga_normal,coalesce(v_diskon_persen,0),v_nominal_diskon
    );

    IF v_mode='untracked' THEN
      NULL; -- Consumables without stock tracking: sale does not mutate stock.
    ELSIF v_mode='quantity' THEN
      SELECT * INTO v_stock
      FROM public.stok_barang
      WHERE usaha_id=p_usaha_id AND barang_id=v_parent_id
        AND varian_barang_id IS NOT DISTINCT FROM v_variant_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'STOCK_NOT_CONFIGURED: saldo stok kuantitas belum diatur untuk %',coalesce(v_variant_name,v_barang_name) USING ERRCODE='23514';
      END IF;
      IF v_stock.jumlah < v_qty THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: stok % tersedia %, diminta %',coalesce(v_variant_name,v_barang_name),v_stock.jumlah,v_qty USING ERRCODE='23514';
      END IF;

      UPDATE public.stok_barang
      SET jumlah=jumlah-v_qty,updated_at=now()
      WHERE stok_barang_id=v_stock.stok_barang_id;

      INSERT INTO public.pergerakan_stok(
        usaha_id,stok_barang_id,barang_id,varian_barang_id,jenis_pergerakan,
        quantity_delta,source_type,source_id,actor_akun_admin_id,request_id,catatan,metadata
      ) VALUES (
        p_usaha_id,v_stock.stok_barang_id,v_parent_id,v_variant_id,'sale',
        -v_qty,'sale',v_sale_id,v_admin_id,p_request_id,
        'Penjualan '||v_sale_number,
        jsonb_build_object('penjualan_id',v_sale_id,'detail_penjualan_id',v_detail_id)
      );
    ELSE
      SELECT count(*) INTO v_available
      FROM public.unit_barang u
      WHERE u.usaha_id=p_usaha_id AND u.status='ready'
        AND (
          (v_variant_id IS NOT NULL AND u.varian_barang_id=v_variant_id)
          OR (v_variant_id IS NULL AND u.barang_id=v_parent_id AND u.varian_barang_id IS NULL)
        );

      v_reserved := 0;
      FOR v_reservation IN
        SELECT r.mulai_reservasi,r.selesai_reservasi
        FROM public.reservasi r
        WHERE r.usaha_id=p_usaha_id AND r.status='confirmed' AND r.stock_lock_status='locked'
      LOOP
        v_reserved := greatest(v_reserved,app_private.reservation_locked_component_requirement(
          p_usaha_id,v_reservation.mulai_reservasi,v_reservation.selesai_reservasi,
          CASE WHEN v_variant_id IS NULL THEN v_parent_id ELSE NULL::uuid END,
          v_variant_id,NULL
        ));
      END LOOP;

      IF v_available - v_reserved < v_qty THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: unit % tidak dapat dijual karena stok dibutuhkan untuk rental/reservasi; tersedia %, sudah dikomitmen %',
          coalesce(v_variant_name,v_barang_name),v_available,v_reserved USING ERRCODE='23514';
      END IF;

      v_selected := 0;
      FOR v_unit IN
        SELECT u.unit_barang_id,u.kode_unit,u.lokasi_id,u.harga_perolehan
        FROM public.unit_barang u
        WHERE u.usaha_id=p_usaha_id AND u.status='ready'
          AND (
            (v_variant_id IS NOT NULL AND u.varian_barang_id=v_variant_id)
            OR (v_variant_id IS NULL AND u.barang_id=v_parent_id AND u.varian_barang_id IS NULL)
          )
        ORDER BY u.created_at,u.unit_barang_id
        LIMIT v_qty
        FOR UPDATE
      LOOP
        UPDATE public.unit_barang
        SET status='sold',updated_at=now()
        WHERE usaha_id=p_usaha_id AND unit_barang_id=v_unit.unit_barang_id AND status='ready';
        IF NOT FOUND THEN
          RAISE EXCEPTION 'BUSINESS_CONFLICT: unit berubah saat proses penjualan, ulangi setelah memuat stok terbaru' USING ERRCODE='40001';
        END IF;
        INSERT INTO public.detail_penjualan_unit(
          usaha_id,detail_penjualan_id,penjualan_id,unit_barang_id
        ) VALUES (p_usaha_id,v_detail_id,v_sale_id,v_unit.unit_barang_id);
        INSERT INTO public.riwayat_unit(
          usaha_id,unit_barang_id,jenis_kejadian,terjadi_at,status_sebelum,status_sesudah,
          lokasi_sebelum_id,lokasi_sesudah_id,sumber_type,sumber_id,actor_akun_admin_id,catatan,metadata
        ) VALUES (
          p_usaha_id,v_unit.unit_barang_id,'unit_sold',v_now,'ready','sold',
          v_unit.lokasi_id,v_unit.lokasi_id,'sale',v_sale_id,v_admin_id,
          'Dijual melalui transaksi '||v_sale_number,
          jsonb_build_object('penjualan_id',v_sale_id,'nomor_penjualan',v_sale_number,'kode_unit',v_unit.kode_unit)
        );
        IF v_unit.harga_perolehan IS NULL THEN
          v_unit_hpp_complete := false;
        ELSE
          v_unit_hpp_total := v_unit_hpp_total + v_unit.harga_perolehan;
        END IF;
        v_selected := v_selected + 1;
      END LOOP;

      IF v_selected <> v_qty THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: jumlah unit siap berubah ketika penjualan diproses' USING ERRCODE='40001';
      END IF;
    END IF;

    IF v_mode='serialized' AND v_selected=v_qty AND v_unit_hpp_complete THEN
      v_line_hpp := v_unit_hpp_total;
      UPDATE public.detail_penjualan
      SET harga_beli_satuan=round(v_line_hpp/v_qty,2),hpp_total=v_line_hpp
      WHERE usaha_id=p_usaha_id AND detail_penjualan_id=v_detail_id;
    ELSE
      v_line_hpp := CASE WHEN v_cost IS NULL THEN NULL ELSE round(v_qty*v_cost,2) END;
    END IF;

    IF v_line_hpp IS NULL THEN
      v_hpp_complete := false;
    ELSE
      v_total_hpp := v_total_hpp + v_line_hpp;
    END IF;
  END LOOP;

  UPDATE public.penjualan
  SET total_hpp=CASE WHEN v_hpp_complete THEN v_total_hpp ELSE NULL END,
      gross_profit=CASE WHEN v_hpp_complete THEN v_total-v_total_hpp ELSE NULL END
  WHERE usaha_id=p_usaha_id AND penjualan_id=v_sale_id;

  INSERT INTO public.transaksi_keuangan(
    transaksi_keuangan_id,usaha_id,nomor_transaksi,jenis,arah,tanggal_transaksi,
    amount,currency_code,sumber_type,sumber_id,status,catatan
  ) VALUES (
    v_transaction_id,p_usaha_id,v_transaction_number::text,'sales_payment','income',v_now,
    v_total,'IDR','sale',v_sale_id,'recorded',
    'Pembayaran penjualan '||v_sale_number
  );

  INSERT INTO public.penjualan_pembayaran(
    penjualan_pembayaran_id,usaha_id,penjualan_id,transaksi_keuangan_id,akun_keuangan_id,
    nomor_pembayaran,jenis,metode,amount,currency_code,dibayar_at,dicatat_by_admin_id,
    reference_text,catatan,status
  ) VALUES (
    v_payment_id,p_usaha_id,v_sale_id,v_transaction_id,p_akun_keuangan_id,
    v_payment_number,'pembayaran_penjualan',v_method,v_total,'IDR',v_now,v_admin_id,
    null,nullif(btrim(coalesce(p_catatan,'')),''),'recorded'
  );

  INSERT INTO public.pergerakan_akun_keuangan(
    usaha_id,akun_keuangan_id,transaksi_keuangan_id,arah,amount,mata_uang,terjadi_at,
    sumber_type,sumber_id,status,dicatat_by_admin_id,request_id,catatan
  ) VALUES (
    p_usaha_id,p_akun_keuangan_id,v_transaction_id,'masuk',v_total,'IDR',v_now,
    'payment',v_payment_id,'recorded',v_admin_id,p_request_id,
    'Pembayaran penjualan '||v_sale_number
  );

  INSERT INTO public.checkout(
    checkout_id,usaha_id,nomor_checkout,source,penyewaan_id,penjualan_id,
    subtotal_rental,subtotal_penjualan,total_amount,amount_paid,payment_status,
    status,created_by_admin_id
  ) VALUES (
    v_checkout_id,p_usaha_id,v_checkout_number,p_source,NULL,v_sale_id,
    0,v_total,v_total,v_total,'paid','completed',v_admin_id
  );

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  ) VALUES (
    p_usaha_id,v_auth_user_id,v_admin_id,'create_sale','penjualan',v_sale_id,
    'admin-command',p_request_id,
    jsonb_build_object('nomor_penjualan',v_sale_number,'checkout_id',v_checkout_id,
      'total_amount',v_total,'total_hpp',CASE WHEN v_hpp_complete THEN v_total_hpp ELSE NULL END,
      'gross_profit',CASE WHEN v_hpp_complete THEN v_total-v_total_hpp ELSE NULL END,
      'line_count',jsonb_array_length(p_lines),'source',p_source)
  );

  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES (
    p_usaha_id,'sale.completed','penjualan',v_sale_id,
    jsonb_build_object('penjualan_id',v_sale_id,'nomor_penjualan',v_sale_number,
      'checkout_id',v_checkout_id,'total_amount',v_total)
  );

  v_response := jsonb_build_object(
    'checkout_id',v_checkout_id,'nomor_checkout',v_checkout_number,
    'penjualan_id',v_sale_id,'nomor_penjualan',v_sale_number,
    'total_amount',v_total,'total_hpp',CASE WHEN v_hpp_complete THEN v_total_hpp ELSE NULL END,
    'gross_profit',CASE WHEN v_hpp_complete THEN v_total-v_total_hpp ELSE NULL END,
    'amount_paid',v_total,'payment_status','paid',
    'penjualan_pembayaran_id',v_payment_id,'transaksi_keuangan_id',v_transaction_id,
    'status','completed'
  );
  UPDATE public.idempotency_key
  SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$;



-- Admin-created reservation snapshots resolve the catalog promo once.
CREATE OR REPLACE FUNCTION app_private.command_create_reservation_from_request(p_usaha_id uuid, p_permintaan_sewa_id uuid, p_lines jsonb, p_idempotency_key text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_request public.permintaan_sewa%ROWTYPE;
  v_existing public.reservasi%ROWTYPE;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_reservation public.reservasi%ROWTYPE;
  v_detail_count integer;
  v_line_count integer;
  v_number bigint;
  v_detail public.detail_permintaan%ROWTYPE;
  v_unit_price numeric;
  v_subtotal numeric;
  v_currency_code text;
  v_detail_catatan text;
  v_tarif_sewa_id uuid;
  v_promosi_paket_id uuid;
  v_promosi_katalog_id uuid;
  v_harga_normal numeric(14,2);
  v_diskon_persen numeric(5,2) := 0;
  v_nominal_diskon numeric(14,2) := 0;
  v_durasi_unit_snapshot text;
  v_durasi_nilai_snapshot numeric(12,4);
  v_response jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;
  IF p_usaha_id IS NULL OR p_permintaan_sewa_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id dan permintaan_sewa_id wajib diisi' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: pricing snapshot lines wajib berupa array tidak kosong' USING ERRCODE = '22023';
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
    AND ku.usaha_id = p_usaha_id;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE = '42501';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'permintaan_sewa_id', p_permintaan_sewa_id,
    'lines', p_lines
  )::text);

  INSERT INTO public.idempotency_key (
    usaha_id, actor_auth_user_id, key, command_name, request_hash
  )
  VALUES (
    p_usaha_id, v_auth_user_id, btrim(p_idempotency_key),
    'create_reservation_from_request', v_request_hash
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
      AND ik.command_name = 'create_reservation_from_request'
      AND ik.key = btrim(p_idempotency_key);

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE = '23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE = '40001';
  END IF;

  SELECT *
  INTO v_request
  FROM public.permintaan_sewa
  WHERE usaha_id = p_usaha_id
    AND permintaan_sewa_id = p_permintaan_sewa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: permintaan sewa tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  IF v_request.status NOT IN ('submitted', 'under_review') THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: permintaan hanya dapat dikonversi dari status submitted/under_review; status sekarang %', v_request.status USING ERRCODE = '23514';
  END IF;

  SELECT r.*
  INTO v_existing
  FROM public.reservasi r
  WHERE r.usaha_id = p_usaha_id
    AND r.permintaan_sewa_id = p_permintaan_sewa_id
  FOR UPDATE;

  IF FOUND THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: permintaan ini sudah memiliki reservasi %', v_existing.nomor_reservasi USING ERRCODE = '23505';
  END IF;

  SELECT count(*)
  INTO v_detail_count
  FROM public.detail_permintaan d
  WHERE d.usaha_id = p_usaha_id
    AND d.permintaan_sewa_id = p_permintaan_sewa_id;

  SELECT count(*)
  INTO v_line_count
  FROM jsonb_array_elements(p_lines);

  IF v_detail_count = 0 OR v_line_count <> v_detail_count THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: jumlah pricing snapshot harus sama dengan jumlah detail permintaan' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_lines) x
    WHERE (x->>'detail_permintaan_id') IS NULL
       OR (x->>'unit_price') IS NULL
       OR (x->>'subtotal') IS NULL
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: setiap pricing snapshot membutuhkan detail_permintaan_id, unit_price, dan subtotal' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_lines) x
    GROUP BY x->>'detail_permintaan_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: detail_permintaan_id tidak boleh duplikat' USING ERRCODE = '22023';
  END IF;

  SELECT app_private.next_business_number(p_usaha_id, 'RSV', to_char(current_date, 'YYYY'))
  INTO v_number;

  INSERT INTO public.reservasi (
    usaha_id, permintaan_sewa_id, penyewa_id, nomor_reservasi,
    mulai_reservasi, selesai_reservasi, status, stock_lock_status, catatan
  )
  VALUES (
    p_usaha_id, p_permintaan_sewa_id, v_request.penyewa_id,
    'RSV-' || to_char(current_date, 'YYYY') || '-' || lpad(v_number::text, 3, '0'),
    v_request.mulai_rencana, v_request.selesai_rencana,
    'draft', 'not_locked', v_request.catatan
  )
  RETURNING * INTO v_reservation;

  FOR v_detail IN
    SELECT d.*
    FROM public.detail_permintaan d
    WHERE d.usaha_id = p_usaha_id
      AND d.permintaan_sewa_id = p_permintaan_sewa_id
    ORDER BY d.created_at, d.detail_permintaan_id
  LOOP
    SELECT (x->>'unit_price')::numeric,
           (x->>'subtotal')::numeric,
           coalesce(x->>'currency_code', 'IDR'),
           x->>'catatan',
           nullif(x->>'tarif_sewa_id', '')::uuid,
           nullif(x->>'promosi_paket_id', '')::uuid
    INTO v_unit_price, v_subtotal, v_currency_code, v_detail_catatan,
         v_tarif_sewa_id, v_promosi_paket_id
    FROM jsonb_array_elements(p_lines) x
    WHERE (x->>'detail_permintaan_id')::uuid = v_detail.detail_permintaan_id;

    IF v_unit_price IS NULL OR v_subtotal IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: pricing snapshot tidak lengkap untuk detail %', v_detail.detail_permintaan_id USING ERRCODE = '22023';
    END IF;

    v_harga_normal := NULL;
    v_durasi_unit_snapshot := NULL;
    v_durasi_nilai_snapshot := NULL;
    IF v_tarif_sewa_id IS NOT NULL THEN
      SELECT t.nominal, t.durasi_unit, t.durasi_nilai
        INTO v_harga_normal, v_durasi_unit_snapshot, v_durasi_nilai_snapshot
      FROM public.tarif_sewa t
      WHERE t.usaha_id = p_usaha_id
        AND t.tarif_sewa_id = v_tarif_sewa_id
        AND t.status = 'active'
        AND t.berlaku_mulai <= now()
        AND (t.berlaku_sampai IS NULL OR t.berlaku_sampai > now())
        AND (
          (v_detail.paket_sewa_id IS NOT NULL AND t.paket_sewa_id = v_detail.paket_sewa_id)
          OR (v_detail.varian_barang_id IS NOT NULL AND (
            t.varian_barang_id = v_detail.varian_barang_id
            OR (t.varian_barang_id IS NULL AND t.barang_id = v_detail.barang_id)
          ))
          OR (v_detail.varian_barang_id IS NULL AND v_detail.barang_id IS NOT NULL
            AND t.barang_id = v_detail.barang_id AND t.varian_barang_id IS NULL)
        );
      IF v_durasi_unit_snapshot IS NULL OR v_durasi_nilai_snapshot IS NULL
         OR v_durasi_nilai_snapshot <= 0 THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: tarif dan basis durasi reservasi tidak valid'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    IF v_unit_price < 0 OR v_subtotal < 0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: unit_price dan subtotal tidak boleh negatif' USING ERRCODE = '22023';
    END IF;
    IF v_subtotal IS DISTINCT FROM round(v_detail.jumlah * v_unit_price, 2) THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: subtotal harus sama dengan jumlah x unit_price pada detail %', v_detail.detail_permintaan_id USING ERRCODE = '22023';
    END IF;
    IF v_currency_code <> 'IDR' THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: currency fase awal adalah IDR' USING ERRCODE = '22023';
    END IF;
    IF num_nonnulls(v_detail.barang_id, v_detail.varian_barang_id, v_detail.paket_sewa_id) <> 1 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: setiap detail permintaan harus memiliki tepat satu target katalog' USING ERRCODE = '22023';
    END IF;

    IF v_promosi_paket_id IS NOT NULL AND (v_tarif_sewa_id IS NULL OR v_detail.paket_sewa_id IS NULL) THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: referensi promo hanya dapat digunakan untuk detail paket dengan tarif yang jelas' USING ERRCODE = '22023';
    END IF;

    IF v_promosi_paket_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.promosi_paket_sewa pp
      JOIN public.tarif_sewa t ON t.tarif_sewa_id = pp.tarif_sewa_id AND t.usaha_id = pp.usaha_id
      WHERE pp.usaha_id = p_usaha_id
        AND pp.promosi_paket_id = v_promosi_paket_id
        AND pp.tarif_sewa_id = v_tarif_sewa_id
        AND pp.paket_sewa_id = v_detail.paket_sewa_id
        AND pp.status = 'active'
        AND pp.started_at <= now()
        AND (pp.valid_until IS NULL OR now() < pp.valid_until)
        AND pp.ended_at IS NULL
        AND t.paket_sewa_id = v_detail.paket_sewa_id
        AND t.status = 'active'
        AND t.berlaku_mulai <= now()
        AND (t.berlaku_sampai IS NULL OR t.berlaku_sampai > now())
        AND pp.harga_promo < t.nominal
        AND pp.harga_promo = round(v_unit_price, 2)
    ) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: referensi promo tidak cocok dengan paket dan snapshot harga' USING ERRCODE = '23514';
    END IF;

    IF v_detail.paket_sewa_id IS NOT NULL AND v_promosi_paket_id IS NULL AND EXISTS (
      SELECT 1
      FROM public.promosi_paket_sewa pp
      JOIN public.tarif_sewa t ON t.tarif_sewa_id = pp.tarif_sewa_id AND t.usaha_id = pp.usaha_id
      WHERE pp.usaha_id = p_usaha_id
        AND pp.paket_sewa_id = v_detail.paket_sewa_id
        AND (v_tarif_sewa_id IS NULL OR pp.tarif_sewa_id = v_tarif_sewa_id)
        AND pp.status = 'active' AND pp.started_at <= now()
        AND (pp.valid_until IS NULL OR now() < pp.valid_until) AND pp.ended_at IS NULL
        AND t.status = 'active' AND t.berlaku_mulai <= now()
        AND (t.berlaku_sampai IS NULL OR t.berlaku_sampai > now())
        AND pp.harga_promo < t.nominal
    ) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: harga paket promo aktif wajib menggunakan referensi promo dan harga efektif dari server' USING ERRCODE = '23514';
    END IF;

    v_promosi_katalog_id := NULL;
    v_diskon_persen := 0;
    v_nominal_diskon := 0;
    IF v_detail.paket_sewa_id IS NULL AND v_tarif_sewa_id IS NOT NULL THEN
      SELECT t.nominal
        INTO v_harga_normal
      FROM public.tarif_sewa t
      WHERE t.usaha_id = p_usaha_id
        AND t.tarif_sewa_id = v_tarif_sewa_id
        AND t.status = 'active'
        AND t.berlaku_mulai <= now()
        AND (t.berlaku_sampai IS NULL OR t.berlaku_sampai > now())
        AND (
          (v_detail.varian_barang_id IS NOT NULL AND (
            t.varian_barang_id = v_detail.varian_barang_id
            OR (t.varian_barang_id IS NULL AND t.barang_id = v_detail.barang_id)
          ))
          OR (v_detail.varian_barang_id IS NULL AND t.barang_id = v_detail.barang_id AND t.varian_barang_id IS NULL)
        );
      IF v_harga_normal IS NULL THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: tarif tidak cocok dengan target dan tanggal reservasi'
          USING ERRCODE = '23514';
      END IF;

      SELECT rp.promosi_katalog_id, rp.diskon_persen
        INTO v_promosi_katalog_id, v_diskon_persen
      FROM app_private.resolve_catalog_promo_price(
        p_usaha_id, v_detail.barang_id, v_detail.varian_barang_id,
        'rental', now()
      ) rp;
      IF FOUND THEN
        v_unit_price := round(v_harga_normal * (100 - v_diskon_persen) / 100, 2);
        v_subtotal := round(v_detail.jumlah * v_unit_price, 2);
        v_nominal_diskon := round((v_harga_normal - v_unit_price) * v_detail.jumlah, 2);
      END IF;
    END IF;

    IF v_tarif_sewa_id IS NOT NULL AND v_promosi_paket_id IS NULL AND v_promosi_katalog_id IS NULL AND NOT EXISTS (
      SELECT 1
      FROM public.tarif_sewa t
      WHERE t.usaha_id = p_usaha_id
        AND t.tarif_sewa_id = v_tarif_sewa_id
        AND t.status = 'active'
        AND t.berlaku_mulai <= now()
        AND (t.berlaku_sampai IS NULL OR t.berlaku_sampai > now())
        AND t.nominal = round(v_unit_price, 2)
        AND (
          (v_detail.paket_sewa_id IS NOT NULL AND t.paket_sewa_id = v_detail.paket_sewa_id)
          OR (v_detail.varian_barang_id IS NOT NULL AND t.varian_barang_id = v_detail.varian_barang_id)
          OR (v_detail.barang_id IS NOT NULL AND t.barang_id = v_detail.barang_id AND t.varian_barang_id IS NULL)
        )
    ) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: tarif tidak cocok dengan target dan snapshot harga' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.detail_reservasi (
      usaha_id, reservasi_id, barang_id, varian_barang_id, paket_sewa_id,
      jumlah, unit_price, currency_code, subtotal, catatan,
      tarif_sewa_id, promosi_paket_id, promosi_katalog_id,
      harga_normal_snapshot, diskon_persen_snapshot, nominal_diskon_snapshot,
      durasi_unit_snapshot, durasi_nilai_snapshot
    )
    VALUES (
      p_usaha_id, v_reservation.reservasi_id, v_detail.barang_id, v_detail.varian_barang_id, v_detail.paket_sewa_id,
      v_detail.jumlah, v_unit_price, v_currency_code, v_subtotal,
      coalesce(v_detail_catatan, v_detail.catatan), v_tarif_sewa_id, v_promosi_paket_id,
      v_promosi_katalog_id, v_harga_normal, coalesce(v_diskon_persen, 0), coalesce(v_nominal_diskon, 0),
      v_durasi_unit_snapshot, v_durasi_nilai_snapshot
    );
  END LOOP;

  UPDATE public.permintaan_sewa
  SET status = 'converted',
      processed_at = now(),
      processed_by_admin_id = v_admin_id
  WHERE usaha_id = p_usaha_id
    AND permintaan_sewa_id = p_permintaan_sewa_id;

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, request_id, change_summary
  )
  VALUES
    (p_usaha_id, v_auth_user_id, v_admin_id, 'convert', 'permintaan_sewa', p_permintaan_sewa_id,
     'admin-command', p_request_id,
     jsonb_build_object('status_before', v_request.status, 'status_after', 'converted', 'reservasi_id', v_reservation.reservasi_id)),
    (p_usaha_id, v_auth_user_id, v_admin_id, 'create', 'reservasi', v_reservation.reservasi_id,
     'admin-command', p_request_id,
     jsonb_build_object('nomor_reservasi', v_reservation.nomor_reservasi, 'permintaan_sewa_id', p_permintaan_sewa_id));

  INSERT INTO public.outbox_event (
    usaha_id, event_type, aggregate_type, aggregate_id, payload
  )
  VALUES
    (p_usaha_id, 'reservation.created', 'reservasi', v_reservation.reservasi_id,
     jsonb_build_object('reservation_id', v_reservation.reservasi_id, 'request_id', p_permintaan_sewa_id)),
    (p_usaha_id, 'request.converted', 'permintaan_sewa', p_permintaan_sewa_id,
     jsonb_build_object('request_id', p_permintaan_sewa_id, 'reservation_id', v_reservation.reservasi_id));

  v_response := jsonb_build_object(
    'reservasi_id', v_reservation.reservasi_id,
    'permintaan_sewa_id', p_permintaan_sewa_id,
    'nomor_reservasi', v_reservation.nomor_reservasi,
    'status', v_reservation.status,
    'stock_lock_status', v_reservation.stock_lock_status
  );

  UPDATE public.idempotency_key
  SET response_status = 200, response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$
;

-- Reservation conversion copies the original line-price and promotion snapshot without re-resolving.
CREATE OR REPLACE FUNCTION app_private.command_create_rental_from_reservation(p_usaha_id uuid, p_reservasi_id uuid, p_jadwal_mulai timestamp with time zone, p_jadwal_kembali timestamp with time zone, p_idempotency_key text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_timezone text;
  v_reservation public.reservasi%ROWTYPE;
  v_existing public.penyewaan%ROWTYPE;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_rental_id uuid := gen_random_uuid();
  v_number bigint;
  v_rental_number text;
  v_tolerance_deadline timestamptz;
  v_total_amount numeric(14,2) := 0;
  v_currency text;
  v_currency_count integer;
  v_duration_unit text;
  v_duration_value numeric;
  v_period_seconds numeric;
  v_periods integer;
  v_line_subtotal numeric(14,2);
  v_line_discount numeric(14,2);
  v_detail public.detail_reservasi%ROWTYPE;
  v_component public.komponen_paket%ROWTYPE;
  v_detail_penyewaan_id uuid;
  v_response jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;

  IF p_usaha_id IS NULL OR p_reservasi_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id dan reservasi_id wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF p_jadwal_mulai IS NULL OR p_jadwal_kembali IS NULL OR p_jadwal_kembali <= p_jadwal_mulai THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: jadwal rental tidak valid' USING ERRCODE = '22023';
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
    'reservasi_id', p_reservasi_id,
    'jadwal_mulai', p_jadwal_mulai,
    'jadwal_kembali', p_jadwal_kembali
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
    'create_rental_from_reservation',
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
      AND ik.command_name = 'create_rental_from_reservation'
      AND ik.key = btrim(p_idempotency_key);

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE = '23505';
    END IF;

    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;

    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE = '40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text || ':reservation:' || p_reservasi_id::text, 0));

  SELECT *
  INTO v_reservation
  FROM public.reservasi
  WHERE usaha_id = p_usaha_id
    AND reservasi_id = p_reservasi_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: reservasi tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  IF v_reservation.status <> 'confirmed' OR v_reservation.stock_lock_status <> 'locked' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: rental hanya dapat dibuat dari reservasi confirmed dengan stock lock locked' USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.penyewaan
  WHERE usaha_id = p_usaha_id
    AND reservasi_id = p_reservasi_id
  FOR UPDATE;

  IF FOUND THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: reservasi ini sudah memiliki penyewaan %', v_existing.nomor_penyewaan USING ERRCODE = '23505';
  END IF;

  IF (p_jadwal_mulai AT TIME ZONE v_timezone)::date <> v_reservation.mulai_reservasi
     OR (p_jadwal_kembali AT TIME ZONE v_timezone)::date <> v_reservation.selesai_reservasi THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tanggal jadwal rental harus mengikuti tanggal reservasi dalam timezone Usaha %', v_timezone USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT d.currency_code)::integer, min(d.currency_code)
  INTO v_currency_count, v_currency
  FROM public.detail_reservasi d
  WHERE d.usaha_id = p_usaha_id
    AND d.reservasi_id = p_reservasi_id;

  IF v_currency IS NULL OR v_currency_count <> 1 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: reservasi harus memiliki detail dengan satu currency yang konsisten' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.detail_reservasi d
    WHERE d.usaha_id = p_usaha_id
      AND d.reservasi_id = p_reservasi_id
      AND (
        num_nonnulls(d.barang_id, d.varian_barang_id, d.paket_sewa_id) <> 1
        OR d.jumlah <= 0
        OR d.unit_price IS NULL
        OR d.subtotal IS NULL
        OR d.subtotal < 0
        OR d.unit_price < 0
        OR d.subtotal IS DISTINCT FROM round(d.jumlah * d.unit_price, 2)
      )
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: detail reservasi tidak valid untuk pembuatan rental' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.detail_reservasi d
    WHERE d.usaha_id = p_usaha_id
      AND d.reservasi_id = p_reservasi_id
    GROUP BY d.reservasi_id
    HAVING count(DISTINCT d.currency_code) <> 1
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: semua detail rental harus menggunakan currency yang sama' USING ERRCODE = '22023';
  END IF;

  -- Header is inserted first for FK/trigger consistency; total is rebuilt from the locked unit-price snapshots below.
  v_total_amount := 0;

  v_number := app_private.next_business_number(
    p_usaha_id,
    'RNT',
    to_char(p_jadwal_mulai AT TIME ZONE v_timezone, 'YYYY')
  );
  v_rental_number := 'RNT-' || to_char(p_jadwal_mulai AT TIME ZONE v_timezone, 'YYYY') || '-' || lpad(v_number::text, 3, '0');
  v_tolerance_deadline := p_jadwal_kembali + pg_catalog.make_interval(secs => coalesce((SELECT u.default_tolerance_hours FROM public.usaha u WHERE u.usaha_id = p_usaha_id), 10)::double precision * 3600);

  INSERT INTO public.penyewaan (
    penyewaan_id,
    usaha_id,
    reservasi_id,
    penyewa_id,
    nomor_penyewaan,
    jadwal_mulai,
    jadwal_kembali,
    tolerance_deadline,
    status,
    total_amount,
    currency_code,
    catatan
  )
  VALUES (
    v_rental_id,
    p_usaha_id,
    p_reservasi_id,
    v_reservation.penyewa_id,
    v_rental_number,
    p_jadwal_mulai,
    p_jadwal_kembali,
    v_tolerance_deadline,
    'draft',
    v_total_amount,
    v_currency,
    v_reservation.catatan
  );

  FOR v_detail IN
    SELECT d.*
    FROM public.detail_reservasi d
    WHERE d.usaha_id = p_usaha_id
      AND d.reservasi_id = p_reservasi_id
    ORDER BY d.created_at, d.detail_reservasi_id
  LOOP
    v_detail_penyewaan_id := gen_random_uuid();

    IF v_detail.tarif_sewa_id IS NULL THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: detail reservasi tidak menyimpan referensi tarif yang dapat dikonversi'
        USING ERRCODE = '23514';
    END IF;

    SELECT
      coalesce(v_detail.durasi_unit_snapshot, t.durasi_unit),
      coalesce(v_detail.durasi_nilai_snapshot, t.durasi_nilai)
    INTO v_duration_unit, v_duration_value
    FROM public.tarif_sewa t
    WHERE t.usaha_id = p_usaha_id
      AND t.tarif_sewa_id = v_detail.tarif_sewa_id
      AND (
        (v_detail.paket_sewa_id IS NOT NULL AND t.paket_sewa_id = v_detail.paket_sewa_id)
        OR (v_detail.varian_barang_id IS NOT NULL AND (
          t.varian_barang_id = v_detail.varian_barang_id
          OR (t.varian_barang_id IS NULL AND t.barang_id = v_detail.barang_id)
        ))
        OR (v_detail.varian_barang_id IS NULL AND v_detail.paket_sewa_id IS NULL
          AND t.barang_id = v_detail.barang_id AND t.varian_barang_id IS NULL)
      )
      AND (
        (v_detail.durasi_unit_snapshot IS NOT NULL AND v_detail.durasi_nilai_snapshot IS NOT NULL)
        OR (t.status = 'active' AND t.berlaku_mulai <= p_jadwal_mulai
            AND (t.berlaku_sampai IS NULL OR t.berlaku_sampai > p_jadwal_mulai))
      );
    IF v_duration_unit IS NULL OR v_duration_value IS NULL OR v_duration_value <= 0 THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: basis durasi tarif pada snapshot reservasi tidak valid'
        USING ERRCODE = '23514';
    END IF;

    v_period_seconds := CASE lower(btrim(v_duration_unit))
      WHEN 'jam' THEN v_duration_value * 3600
      WHEN 'hari' THEN v_duration_value * 86400
      WHEN 'minggu' THEN v_duration_value * 604800
      ELSE NULL
    END;
    IF v_period_seconds IS NULL THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: satuan durasi tarif pada snapshot reservasi tidak didukung'
        USING ERRCODE = '23514';
    END IF;

    v_periods := greatest(1, ceil(
      extract(epoch FROM (p_jadwal_kembali - p_jadwal_mulai)) / v_period_seconds
    )::integer);
    v_line_subtotal := round(v_detail.jumlah * v_detail.unit_price * v_periods, 2);
    v_line_discount := round(coalesce(v_detail.nominal_diskon_snapshot, 0) * v_periods, 2);
    v_total_amount := v_total_amount + v_line_subtotal;

    INSERT INTO public.detail_penyewaan (
      detail_penyewaan_id,
      usaha_id,
      penyewaan_id,
      barang_id,
      varian_barang_id,
      paket_sewa_id,
      jumlah,
      unit_price,
      currency_code,
      subtotal,
      catatan,
      tarif_sewa_id,
      promosi_paket_id,
      promosi_katalog_id,
      harga_normal_snapshot,
      diskon_persen_snapshot,
      nominal_diskon_snapshot,
      durasi_unit_snapshot,
      durasi_nilai_snapshot
    )
    VALUES (
      v_detail_penyewaan_id,
      p_usaha_id,
      v_rental_id,
      v_detail.barang_id,
      v_detail.varian_barang_id,
      v_detail.paket_sewa_id,
      v_detail.jumlah,
      v_detail.unit_price,
      v_detail.currency_code,
      v_line_subtotal,
      v_detail.catatan,
      v_detail.tarif_sewa_id,
      v_detail.promosi_paket_id,
      v_detail.promosi_katalog_id,
      v_detail.harga_normal_snapshot,
      v_detail.diskon_persen_snapshot,
      v_line_discount,
      v_duration_unit,
      v_duration_value
    );

    IF v_detail.paket_sewa_id IS NOT NULL THEN
      FOR v_component IN
        SELECT cp.*
        FROM public.komponen_paket cp
        WHERE cp.usaha_id = p_usaha_id
          AND cp.paket_sewa_id = v_detail.paket_sewa_id
        ORDER BY cp.created_at, cp.komponen_paket_id
      LOOP
        INSERT INTO public.komponen_penyewaan (
          komponen_penyewaan_id,
          usaha_id,
          detail_penyewaan_id,
          barang_id,
          varian_barang_id,
          unit_barang_id,
          jumlah,
          catatan,
          paket_sewa_id,
          komponen_paket_id
        )
        VALUES (
          gen_random_uuid(),
          p_usaha_id,
          v_detail_penyewaan_id,
          v_component.barang_id,
          v_component.varian_barang_id,
          NULL,
          v_detail.jumlah * v_component.jumlah,
          v_component.catatan,
          v_detail.paket_sewa_id,
          v_component.komponen_paket_id
        );
      END LOOP;
    END IF;
  END LOOP;

  UPDATE public.penyewaan
  SET total_amount = v_total_amount,
      updated_at = now()
  WHERE usaha_id = p_usaha_id
    AND penyewaan_id = v_rental_id;

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
    'penyewaan',
    v_rental_id,
    'admin-command',
    p_request_id,
    jsonb_build_object(
      'nomor_penyewaan', v_rental_number,
      'reservasi_id', p_reservasi_id,
      'status', 'draft',
      'jadwal_mulai', p_jadwal_mulai,
      'jadwal_kembali', p_jadwal_kembali,
      'tolerance_deadline', v_tolerance_deadline,
      'total_amount', v_total_amount,
      'currency_code', v_currency
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
    'rental.created',
    'penyewaan',
    v_rental_id,
    jsonb_build_object(
      'rental_id', v_rental_id,
      'rental_number', v_rental_number,
      'reservation_id', p_reservasi_id
    )
  );

  v_response := jsonb_build_object(
    'penyewaan_id', v_rental_id,
    'reservasi_id', p_reservasi_id,
    'nomor_penyewaan', v_rental_number,
    'status', 'draft',
    'jadwal_mulai', p_jadwal_mulai,
    'jadwal_kembali', p_jadwal_kembali,
    'tolerance_deadline', v_tolerance_deadline,
    'total_amount', v_total_amount,
    'currency_code', v_currency
  );

  UPDATE public.idempotency_key
  SET response_status = 200,
      response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$
;



-- Package promo mutation requires the same explicit promotion capability.
CREATE OR REPLACE FUNCTION app_private.command_set_paket_promo(
  p_usaha_id uuid, p_paket_sewa_id uuid, p_tarif_sewa_id uuid, p_enabled boolean,
  p_harga_promo numeric DEFAULT NULL, p_expected_updated_at timestamptz DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL, p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.require_usaha_permission(p_usaha_id, 'event_promotion.manage');
  v_tariff public.tarif_sewa%ROWTYPE;
  v_current public.promosi_paket_sewa%ROWTYPE;
  v_promo_id uuid;
  v_idempotency_id uuid;
  v_claim jsonb;
  v_hash text;
  v_response jsonb;
  v_changed boolean := false;
  v_previous jsonb;
BEGIN
  IF p_usaha_id IS NULL OR p_paket_sewa_id IS NULL OR p_tarif_sewa_id IS NULL OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tenant, package, tariff, dan status promo wajib diisi' USING ERRCODE='22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi' USING ERRCODE='22023';
  END IF;
  IF p_enabled AND (p_harga_promo IS NULL OR p_harga_promo < 0 OR p_harga_promo <> round(p_harga_promo,2)) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: harga promo wajib diisi, tidak negatif, dan maksimal dua desimal' USING ERRCODE='22023';
  END IF;

  v_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'paket_sewa_id',p_paket_sewa_id,'tarif_sewa_id',p_tarif_sewa_id,
    'enabled',p_enabled,'harga_promo',p_harga_promo,'expected_updated_at',p_expected_updated_at
  )::text);
  v_claim := app_private.catalog_idempotency_claim(
    p_usaha_id, 'set_paket_promo', p_idempotency_key, v_hash
  );
  IF v_claim->>'state' = 'committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state' = 'unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: perubahan promo paket belum dapat dipastikan' USING ERRCODE='40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_usaha_id::text || ':package-promo:' || p_tarif_sewa_id::text, 0)
  );
  SELECT * INTO v_tariff
  FROM public.tarif_sewa t
  WHERE t.usaha_id=p_usaha_id AND t.tarif_sewa_id=p_tarif_sewa_id
    AND t.paket_sewa_id=p_paket_sewa_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: tarif paket tidak ditemukan dalam usaha ini' USING ERRCODE='P0002';
  END IF;

  SELECT * INTO v_current
  FROM public.promosi_paket_sewa p
  WHERE p.usaha_id=p_usaha_id AND p.tarif_sewa_id=p_tarif_sewa_id AND p.status='active'
  FOR UPDATE;

  IF p_expected_updated_at IS NOT NULL
     AND (v_current.promosi_paket_id IS NULL OR v_current.updated_at IS DISTINCT FROM p_expected_updated_at) THEN
    RAISE EXCEPTION 'STALE_DATA: status promo berubah; muat ulang sebelum menyimpan' USING ERRCODE='40001';
  END IF;

  IF p_enabled THEN
    IF v_tariff.status <> 'active' OR v_tariff.berlaku_mulai > now()
       OR (v_tariff.berlaku_sampai IS NOT NULL AND v_tariff.berlaku_sampai <= now()) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: hanya tarif paket aktif yang dapat dipromosikan' USING ERRCODE='23514';
    END IF;
    IF v_tariff.nominal <= 0 OR p_harga_promo >= v_tariff.nominal THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: harga promo harus lebih rendah dari tarif normal' USING ERRCODE='22023';
    END IF;

    IF v_current.promosi_paket_id IS NOT NULL
       AND v_current.harga_promo=round(p_harga_promo,2)
       AND v_current.harga_normal=v_tariff.nominal THEN
      v_promo_id := v_current.promosi_paket_id;
    ELSE
      IF v_current.promosi_paket_id IS NOT NULL THEN
        v_previous := to_jsonb(v_current);
        UPDATE public.promosi_paket_sewa
        SET status='ended', ended_at=now(), ended_by_auth_user_id=auth.uid(),
            ended_by_akun_admin_id=v_admin_id, updated_at=now()
        WHERE promosi_paket_id=v_current.promosi_paket_id;
      END IF;
      INSERT INTO public.promosi_paket_sewa (
        usaha_id,paket_sewa_id,tarif_sewa_id,harga_normal,harga_promo,status,started_at,
        created_by_auth_user_id,created_by_akun_admin_id
      )
      VALUES (
        p_usaha_id,p_paket_sewa_id,p_tarif_sewa_id,v_tariff.nominal,round(p_harga_promo,2),
        'active',now(),auth.uid(),v_admin_id
      )
      RETURNING promosi_paket_id INTO v_promo_id;
      v_changed := true;
    END IF;
  ELSE
    IF v_current.promosi_paket_id IS NOT NULL THEN
      v_previous := to_jsonb(v_current);
      UPDATE public.promosi_paket_sewa
      SET status='ended', ended_at=now(), ended_by_auth_user_id=auth.uid(),
          ended_by_akun_admin_id=v_admin_id, updated_at=now()
      WHERE promosi_paket_id=v_current.promosi_paket_id;
      v_promo_id := v_current.promosi_paket_id;
      v_changed := true;
    END IF;
  END IF;

  SELECT * INTO v_current
  FROM public.promosi_paket_sewa p
  WHERE p.promosi_paket_id=v_promo_id;

  v_response := jsonb_build_object(
    'usaha_id',p_usaha_id,
    'paket_sewa_id',p_paket_sewa_id,
    'tarif_sewa_id',p_tarif_sewa_id,
    'enabled',p_enabled,
    'promosi_paket_id',CASE WHEN p_enabled THEN v_promo_id ELSE NULL END,
    'harga_normal',CASE WHEN p_enabled THEN v_current.harga_normal ELSE v_tariff.nominal END,
    'harga_promo',CASE WHEN p_enabled THEN v_current.harga_promo ELSE NULL END,
    'updated_at',CASE WHEN p_enabled THEN v_current.updated_at ELSE now() END
  );

  IF v_changed THEN
    INSERT INTO public.audit_log (
      usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
      source_application,request_id,change_summary
    )
    VALUES (
      p_usaha_id,auth.uid(),v_admin_id,
      CASE WHEN p_enabled AND v_previous IS NULL THEN 'create'
           WHEN p_enabled THEN 'update' ELSE 'status_change' END,
      'promosi_paket_sewa',coalesce(v_promo_id,v_current.promosi_paket_id),
      'admin-command',p_request_id,
      jsonb_build_object('enabled',p_enabled,'tarif_sewa_id',p_tarif_sewa_id,
        'previous',v_previous,'harga_normal',v_tariff.nominal,
        'harga_promo',CASE WHEN p_enabled THEN p_harga_promo ELSE NULL END)
    );
  END IF;

  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id,200,v_response);
  RETURN v_response;
END;
$function$;



CREATE OR REPLACE FUNCTION app_private.command_set_katalog_promo_status(
  p_usaha_id uuid,
  p_promosi_katalog_id uuid,
  p_status text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.require_usaha_permission(p_usaha_id, 'event_promotion.manage');
  v_row public.promosi_katalog%ROWTYPE;
  v_claim jsonb;
  v_idempotency_id uuid;
  v_hash text;
  v_response jsonb;
BEGIN
  IF p_promosi_katalog_id IS NULL
     OR p_status IS NULL OR p_status IS NULL OR p_status NOT IN ('active', 'cancelled')
     OR p_expected_updated_at IS NULL
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = ''
     OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: status promo, expected_updated_at dan idempotency wajib valid'
      USING ERRCODE = '22023';
  END IF;

  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'promosi_katalog_id', p_promosi_katalog_id,
    'status', p_status,
    'expected_updated_at', p_expected_updated_at
  )::text);
  v_claim := app_private.catalog_idempotency_claim(
    p_usaha_id, 'set_katalog_promo_status', p_idempotency_key, v_hash
  );
  IF v_claim->>'state' = 'committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state' = 'unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: perubahan status promo katalog belum dapat dipastikan'
      USING ERRCODE = '40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text, 0));
  SELECT * INTO v_row
  FROM public.promosi_katalog
  WHERE usaha_id = p_usaha_id AND promosi_katalog_id = p_promosi_katalog_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: promo katalog tidak ditemukan'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_DATA: promo berubah; muat ulang sebelum mengubah status'
      USING ERRCODE = '40001';
  END IF;

  IF p_status = 'active' THEN
    IF v_row.status <> 'draft' THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: hanya promo draft yang dapat diaktifkan'
        USING ERRCODE = '23514';
    END IF;
    IF v_row.valid_until IS NOT NULL AND v_row.valid_until <= now() THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: jadwal promo sudah berakhir'
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.promosi_katalog p
      WHERE p.usaha_id = p_usaha_id
        AND p.channel = v_row.channel
        AND p.status = 'active'
        AND p.ended_at IS NULL
        AND (
          (v_row.barang_id IS NOT NULL AND p.barang_id = v_row.barang_id AND p.varian_barang_id IS NULL)
          OR (v_row.varian_barang_id IS NOT NULL AND p.varian_barang_id = v_row.varian_barang_id)
        )
        AND tstzrange(p.started_at, coalesce(p.valid_until, 'infinity'::timestamptz), '[)')
            && tstzrange(v_row.started_at, coalesce(v_row.valid_until, 'infinity'::timestamptz), '[)')
    ) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: jadwal promo bertabrakan dengan promo aktif/terjadwal'
        USING ERRCODE = '23505';
    END IF;
  ELSIF v_row.status <> 'draft' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: hanya promo draft yang dapat dibatalkan'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.promosi_katalog
  SET status = p_status, updated_at = now()
  WHERE usaha_id = p_usaha_id AND promosi_katalog_id = p_promosi_katalog_id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, request_id, change_summary
  )
  VALUES (
    p_usaha_id, auth.uid(), v_admin_id,
    CASE WHEN p_status = 'active' THEN 'activate' ELSE 'cancel' END,
    'promosi_katalog', p_promosi_katalog_id, 'admin-command', p_request_id,
    jsonb_build_object('status_before', 'draft', 'status_after', p_status)
  );

  v_response := jsonb_build_object(
    'promosi_katalog_id', v_row.promosi_katalog_id,
    'status', v_row.status,
    'updated_at', v_row.updated_at
  );
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id, 200, v_response);
  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_set_katalog_promo_status(uuid, uuid, text, timestamptz, text, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_set_katalog_promo_status(uuid, uuid, text, timestamptz, text, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.command_set_katalog_promo_status(
  p_usaha_id uuid,
  p_promosi_katalog_id uuid,
  p_status text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_set_katalog_promo_status(
    p_usaha_id, p_promosi_katalog_id, p_status, p_expected_updated_at,
    p_idempotency_key, p_request_id
  );
$function$;

REVOKE ALL ON FUNCTION public.command_set_katalog_promo_status(uuid, uuid, text, timestamptz, text, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_set_katalog_promo_status(uuid, uuid, text, timestamptz, text, uuid)
  TO authenticated;

-- Draft-only edits are versioned; once active, a promotion is immutable and can only be ended.
CREATE OR REPLACE FUNCTION app_private.command_update_katalog_promo_draft(
  p_usaha_id uuid,
  p_promosi_katalog_id uuid,
  p_barang_id uuid,
  p_varian_barang_id uuid,
  p_channel text,
  p_diskon_persen numeric,
  p_started_at timestamptz,
  p_valid_until timestamptz,
  p_is_public boolean,
  p_expected_updated_at timestamptz,
  p_idempotency_key text,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.require_usaha_permission(p_usaha_id, 'event_promotion.manage');
  v_row public.promosi_katalog%ROWTYPE;
  v_before public.promosi_katalog%ROWTYPE;
  v_target_barang_id uuid;
  v_target_enabled boolean;
  v_sale_price numeric(14,2);
  v_claim jsonb;
  v_idempotency_id uuid;
  v_hash text;
  v_response jsonb;
BEGIN
  IF p_promosi_katalog_id IS NULL
     OR num_nonnulls(p_barang_id, p_varian_barang_id) <> 1
     OR p_channel IS NULL OR p_channel NOT IN ('rental', 'sale')
     OR p_diskon_persen IS NULL OR p_diskon_persen <= 0
     OR (p_channel = 'rental' AND p_diskon_persen > 100)
     OR (p_channel = 'sale' AND p_diskon_persen >= 100)
     OR p_started_at IS NULL
     OR (p_valid_until IS NOT NULL AND p_valid_until <= p_started_at)
     OR p_is_public IS NULL
     OR p_expected_updated_at IS NULL
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = ''
     OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: perubahan promo draft tidak valid'
      USING ERRCODE = '22023';
  END IF;

  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'promosi_katalog_id', p_promosi_katalog_id,
    'barang_id', p_barang_id,
    'varian_barang_id', p_varian_barang_id,
    'channel', p_channel,
    'diskon_persen', p_diskon_persen,
    'started_at', p_started_at,
    'valid_until', p_valid_until,
    'is_public', p_is_public,
    'expected_updated_at', p_expected_updated_at
  )::text);
  v_claim := app_private.catalog_idempotency_claim(
    p_usaha_id, 'update_katalog_promo_draft', p_idempotency_key, v_hash
  );
  IF v_claim->>'state' = 'committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state' = 'unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: status perubahan promo draft belum dapat dipastikan'
      USING ERRCODE = '40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text, 0));
  SELECT * INTO v_row
  FROM public.promosi_katalog
  WHERE usaha_id = p_usaha_id AND promosi_katalog_id = p_promosi_katalog_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: promo katalog tidak ditemukan'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_DATA: promo draft berubah; muat ulang sebelum menyimpan'
      USING ERRCODE = '40001';
  END IF;
  IF v_row.status <> 'draft' OR v_row.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: hanya promo draft yang dapat diedit; promo aktif bersifat immutable'
      USING ERRCODE = '23514';
  END IF;
  v_before := v_row;

  IF p_varian_barang_id IS NOT NULL THEN
    SELECT b.barang_id,
      CASE p_channel
        WHEN 'rental' THEN coalesce(v.is_rentable, b.is_rentable)
        ELSE coalesce(v.is_sellable, b.is_sellable)
      END,
      coalesce(v.harga_jual, b.harga_jual)
    INTO v_target_barang_id, v_target_enabled, v_sale_price
    FROM public.varian_barang v
    JOIN public.barang b ON b.usaha_id = v.usaha_id AND b.barang_id = v.barang_id
    WHERE v.usaha_id = p_usaha_id
      AND v.varian_barang_id = p_varian_barang_id
      AND v.status = 'active' AND b.status = 'active';
  ELSE
    SELECT b.barang_id,
      CASE p_channel WHEN 'rental' THEN b.is_rentable ELSE b.is_sellable END,
      b.harga_jual
    INTO v_target_barang_id, v_target_enabled, v_sale_price
    FROM public.barang b
    WHERE b.usaha_id = p_usaha_id AND b.barang_id = p_barang_id AND b.status = 'active';
  END IF;

  IF v_target_barang_id IS NULL OR v_target_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: target tidak ditemukan atau tidak aktif untuk channel promo'
      USING ERRCODE = '23514';
  END IF;
  IF p_channel = 'sale' AND (v_sale_price IS NULL OR v_sale_price <= 0) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: target belum memiliki harga jual yang valid'
      USING ERRCODE = '23514';
  END IF;
  IF p_channel = 'rental' AND NOT EXISTS (
    SELECT 1 FROM public.tarif_sewa t
    WHERE t.usaha_id = p_usaha_id AND t.status = 'active'
      AND (
        (p_varian_barang_id IS NOT NULL AND (
          t.varian_barang_id = p_varian_barang_id
          OR (t.varian_barang_id IS NULL AND t.barang_id = v_target_barang_id)
        ))
        OR (p_barang_id IS NOT NULL AND t.barang_id = p_barang_id AND t.varian_barang_id IS NULL)
      )
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: target belum memiliki tarif rental aktif'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.promosi_katalog
  SET barang_id = p_barang_id,
      varian_barang_id = p_varian_barang_id,
      channel = p_channel,
      diskon_persen = round(p_diskon_persen, 2),
      started_at = p_started_at,
      valid_until = p_valid_until,
      is_public = p_is_public,
      updated_at = now()
  WHERE usaha_id = p_usaha_id AND promosi_katalog_id = p_promosi_katalog_id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, request_id, change_summary
  )
  VALUES (
    p_usaha_id, auth.uid(), v_admin_id, 'update_draft',
    'promosi_katalog', p_promosi_katalog_id, 'admin-command', p_request_id,
    jsonb_build_object(
      'before', jsonb_build_object(
        'barang_id', v_before.barang_id,
        'varian_barang_id', v_before.varian_barang_id,
        'channel', v_before.channel,
        'diskon_persen', v_before.diskon_persen,
        'started_at', v_before.started_at,
        'valid_until', v_before.valid_until,
        'is_public', v_before.is_public
      ),
      'after', jsonb_build_object(
        'barang_id', v_row.barang_id,
        'varian_barang_id', v_row.varian_barang_id,
        'channel', v_row.channel,
        'diskon_persen', v_row.diskon_persen,
        'started_at', v_row.started_at,
        'valid_until', v_row.valid_until,
        'is_public', v_row.is_public
      )
    )
  );

  v_response := jsonb_build_object(
    'promosi_katalog_id', v_row.promosi_katalog_id,
    'barang_id', v_row.barang_id,
    'varian_barang_id', v_row.varian_barang_id,
    'channel', v_row.channel,
    'diskon_persen', v_row.diskon_persen,
    'started_at', v_row.started_at,
    'valid_until', v_row.valid_until,
    'is_public', v_row.is_public,
    'status', v_row.status,
    'updated_at', v_row.updated_at
  );
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id, 200, v_response);
  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_update_katalog_promo_draft(
  uuid, uuid, uuid, uuid, text, numeric, timestamptz, timestamptz, boolean,
  timestamptz, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_update_katalog_promo_draft(
  uuid, uuid, uuid, uuid, text, numeric, timestamptz, timestamptz, boolean,
  timestamptz, text, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.command_update_katalog_promo_draft(
  p_usaha_id uuid,
  p_promosi_katalog_id uuid,
  p_barang_id uuid,
  p_varian_barang_id uuid,
  p_channel text,
  p_diskon_persen numeric,
  p_started_at timestamptz,
  p_valid_until timestamptz,
  p_is_public boolean,
  p_expected_updated_at timestamptz,
  p_idempotency_key text,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_update_katalog_promo_draft(
    p_usaha_id, p_promosi_katalog_id, p_barang_id, p_varian_barang_id,
    p_channel, p_diskon_persen, p_started_at, p_valid_until, p_is_public,
    p_expected_updated_at, p_idempotency_key, p_request_id
  );
$function$;

REVOKE ALL ON FUNCTION public.command_update_katalog_promo_draft(
  uuid, uuid, uuid, uuid, text, numeric, timestamptz, timestamptz, boolean,
  timestamptz, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_update_katalog_promo_draft(
  uuid, uuid, uuid, uuid, text, numeric, timestamptz, timestamptz, boolean,
  timestamptz, text, uuid
) TO authenticated;

-- This core POS command is only reachable through the trusted sale/mixed-checkout command boundary.
REVOKE ALL ON FUNCTION app_private.command_create_sale_unchecked_20261105(
  uuid, text, text, text, text, jsonb, uuid, text, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
