-- Correct parent rental-promotion eligibility for variant-owned tariffs, whose
-- tarif_sewa.barang_id is intentionally NULL and ownership is derived via varian_barang.
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
        OR (
          p_barang_id IS NOT NULL
          AND (
            (t.barang_id = p_barang_id AND t.varian_barang_id IS NULL)
            OR EXISTS (
              SELECT 1
              FROM public.varian_barang tv
              JOIN public.barang parent
                ON parent.usaha_id = tv.usaha_id
               AND parent.barang_id = tv.barang_id
              WHERE tv.usaha_id = p_usaha_id
                AND tv.varian_barang_id = t.varian_barang_id
                AND tv.barang_id = p_barang_id
                AND tv.status = 'active'
                AND parent.status = 'active'
                AND coalesce(tv.is_rentable, parent.is_rentable) = true
            )
          )
        )
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
