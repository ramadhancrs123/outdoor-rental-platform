-- Keep draft-update rental eligibility aligned with catalog promo creation.
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
    SELECT 1
    FROM public.tarif_sewa t
    WHERE t.usaha_id = p_usaha_id
      AND t.status = 'active'
      AND (
        (p_varian_barang_id IS NOT NULL AND (
          t.varian_barang_id = p_varian_barang_id
          OR (t.varian_barang_id IS NULL AND t.barang_id = v_target_barang_id)
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
