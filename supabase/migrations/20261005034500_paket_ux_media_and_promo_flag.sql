-- Package UX foundation:
-- - first-class catalog media for Paket Sewa (cover + gallery)
-- - presentation-only promo flag stored in existing paket metadata
-- Pricing/discounters are intentionally NOT implemented here; Katalog policy still forbids
-- calculating or inventing discounts without an approved pricing policy.

CREATE TABLE IF NOT EXISTS public.paket_media (
  paket_media_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  paket_sewa_id uuid NOT NULL,
  storage_bucket text NOT NULL,
  storage_path text NOT NULL,
  media_type text NOT NULL DEFAULT 'image',
  urutan integer NOT NULL DEFAULT 1,
  is_cover boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'valid',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT paket_media_usaha_id_fkey
    FOREIGN KEY (usaha_id) REFERENCES public.usaha(usaha_id),
  CONSTRAINT paket_media_paket_id_fkey
    FOREIGN KEY (paket_sewa_id) REFERENCES public.paket_sewa(paket_sewa_id),
  CONSTRAINT paket_media_order_positive CHECK (urutan >= 1),
  CONSTRAINT paket_media_status_valid CHECK (status IN ('valid','deleted'))
);

CREATE INDEX IF NOT EXISTS paket_media_paket_order_idx
  ON public.paket_media (usaha_id, paket_sewa_id, status, urutan);

CREATE UNIQUE INDEX IF NOT EXISTS paket_media_single_cover_idx
  ON public.paket_media (usaha_id, paket_sewa_id)
  WHERE status = 'valid' AND is_cover = true;

ALTER TABLE public.paket_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS paket_media_insert_member ON public.paket_media;
DROP POLICY IF EXISTS paket_media_select_member ON public.paket_media;
DROP POLICY IF EXISTS paket_media_update_member ON public.paket_media;
DROP POLICY IF EXISTS paket_media_public_catalog ON public.paket_media;

CREATE POLICY paket_media_insert_member
  ON public.paket_media
  FOR INSERT TO authenticated
  WITH CHECK (app_private.has_usaha_access(usaha_id));

CREATE POLICY paket_media_select_member
  ON public.paket_media
  FOR SELECT TO authenticated
  USING (app_private.has_usaha_access(usaha_id));

CREATE POLICY paket_media_update_member
  ON public.paket_media
  FOR UPDATE TO authenticated
  USING (app_private.has_usaha_access(usaha_id))
  WITH CHECK (app_private.has_usaha_access(usaha_id));

CREATE POLICY paket_media_public_catalog
  ON public.paket_media
  FOR SELECT TO anon
  USING (
    status = 'valid'
    AND app_private.is_public_catalog_target(usaha_id, NULL::uuid, NULL::uuid, paket_sewa_id)
  );

GRANT SELECT ON public.paket_media TO anon, authenticated;
GRANT INSERT, UPDATE ON public.paket_media TO authenticated;
REVOKE DELETE ON public.paket_media FROM anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.command_add_paket_media(
  p_usaha_id uuid,
  p_paket_sewa_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_media_type text DEFAULT 'image',
  p_urutan integer DEFAULT 1,
  p_is_cover boolean DEFAULT false,
  p_idempotency_key text DEFAULT NULL,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb;
  v_idempotency_id uuid;
  v_row public.paket_media%ROWTYPE;
  v_hash text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.paket_sewa
    WHERE usaha_id = p_usaha_id AND paket_sewa_id = p_paket_sewa_id
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: paket media tidak ditemukan dalam Usaha ini' USING ERRCODE='22023';
  END IF;
  IF p_storage_bucket IS NULL OR btrim(p_storage_bucket) = ''
     OR p_storage_path IS NULL OR btrim(p_storage_path) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: storage bucket dan path wajib diisi' USING ERRCODE='22023';
  END IF;
  IF p_urutan < 1 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: urutan media harus >= 1' USING ERRCODE='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_usaha_id::text || ':package-media:' || p_paket_sewa_id::text, 0)
  );

  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'paket_sewa_id', p_paket_sewa_id,
    'bucket', p_storage_bucket,
    'path', p_storage_path,
    'media_type', p_media_type,
    'urutan', p_urutan,
    'is_cover', p_is_cover
  )::text);

  v_claim := app_private.catalog_idempotency_claim(
    p_usaha_id, 'add_paket_media', p_idempotency_key, v_hash
  );
  IF v_claim->>'state' = 'committed' THEN
    RETURN v_claim->'response';
  END IF;
  IF v_claim->>'state' = 'unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: penambahan media paket belum dapat dipastikan'
      USING ERRCODE='40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  IF p_is_cover THEN
    UPDATE public.paket_media
       SET is_cover = false, updated_at = now()
     WHERE usaha_id = p_usaha_id
       AND paket_sewa_id = p_paket_sewa_id
       AND status = 'valid';
  END IF;

  INSERT INTO public.paket_media (
    usaha_id, paket_sewa_id, storage_bucket, storage_path,
    media_type, urutan, is_cover, status
  )
  VALUES (
    p_usaha_id, p_paket_sewa_id, btrim(p_storage_bucket), btrim(p_storage_path),
    p_media_type, p_urutan, p_is_cover, 'valid'
  )
  RETURNING * INTO v_row;

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action, entity_type,
    entity_id, source_application, request_id, change_summary
  )
  VALUES (
    p_usaha_id, auth.uid(), v_admin_id, 'create', 'paket_media',
    v_row.paket_media_id, 'admin-command', p_request_id,
    jsonb_build_object(
      'paket_sewa_id', v_row.paket_sewa_id,
      'storage_path', v_row.storage_path,
      'is_cover', v_row.is_cover
    )
  );

  v_claim := to_jsonb(v_row);
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id, 200, v_claim);
  RETURN v_claim;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_remove_paket_media(
  p_usaha_id uuid,
  p_paket_media_id uuid,
  p_idempotency_key text DEFAULT NULL,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb;
  v_idempotency_id uuid;
  v_row public.paket_media%ROWTYPE;
  v_hash text;
BEGIN
  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id, 'id', p_paket_media_id
  )::text);
  v_claim := app_private.catalog_idempotency_claim(
    p_usaha_id, 'remove_paket_media', p_idempotency_key, v_hash
  );
  IF v_claim->>'state' = 'committed' THEN
    RETURN v_claim->'response';
  END IF;
  IF v_claim->>'state' = 'unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: penghapusan media paket belum dapat dipastikan'
      USING ERRCODE='40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  SELECT * INTO v_row
  FROM public.paket_media
  WHERE usaha_id = p_usaha_id
    AND paket_media_id = p_paket_media_id
    AND status = 'valid';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: media paket valid tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  UPDATE public.paket_media
     SET status = 'deleted', is_cover = false, updated_at = now()
   WHERE usaha_id = p_usaha_id
     AND paket_media_id = p_paket_media_id;

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action, entity_type,
    entity_id, source_application, request_id, change_summary
  )
  VALUES (
    p_usaha_id, auth.uid(), v_admin_id, 'delete', 'paket_media',
    v_row.paket_media_id, 'admin-command', p_request_id,
    jsonb_build_object(
      'paket_sewa_id', v_row.paket_sewa_id,
      'storage_path', v_row.storage_path
    )
  );

  v_claim := jsonb_build_object(
    'removed', true, 'paket_media_id', v_row.paket_media_id
  );
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id, 200, v_claim);
  RETURN v_claim;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_set_paket_media_cover(
  p_usaha_id uuid,
  p_paket_media_id uuid,
  p_is_cover boolean,
  p_idempotency_key text DEFAULT NULL,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb;
  v_idempotency_id uuid;
  v_row public.paket_media%ROWTYPE;
  v_hash text;
BEGIN
  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id, 'id', p_paket_media_id, 'is_cover', p_is_cover
  )::text);
  v_claim := app_private.catalog_idempotency_claim(
    p_usaha_id, 'set_paket_media_cover', p_idempotency_key, v_hash
  );
  IF v_claim->>'state' = 'committed' THEN
    RETURN v_claim->'response';
  END IF;
  IF v_claim->>'state' = 'unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: perubahan cover media paket belum dapat dipastikan'
      USING ERRCODE='40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  SELECT * INTO v_row
  FROM public.paket_media
  WHERE usaha_id = p_usaha_id
    AND paket_media_id = p_paket_media_id
    AND status = 'valid';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: media paket valid tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  IF p_is_cover THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_usaha_id::text || ':package-media:' || v_row.paket_sewa_id::text, 0)
    );
    UPDATE public.paket_media
       SET is_cover = false, updated_at = now()
     WHERE usaha_id = p_usaha_id
       AND paket_sewa_id = v_row.paket_sewa_id
       AND status = 'valid';
  END IF;

  UPDATE public.paket_media
     SET is_cover = p_is_cover, updated_at = now()
   WHERE usaha_id = p_usaha_id
     AND paket_media_id = p_paket_media_id
     AND status = 'valid'
  RETURNING * INTO v_row;

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action, entity_type,
    entity_id, source_application, request_id, change_summary
  )
  VALUES (
    p_usaha_id, auth.uid(), v_admin_id, 'update', 'paket_media',
    v_row.paket_media_id, 'admin-command', p_request_id,
    jsonb_build_object('is_cover', v_row.is_cover)
  );

  v_claim := to_jsonb(v_row);
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id, 200, v_claim);
  RETURN v_claim;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_reorder_paket_media(
  p_usaha_id uuid,
  p_paket_sewa_id uuid,
  p_orders jsonb,
  p_idempotency_key text DEFAULT NULL,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.catalog_require_admin(p_usaha_id);
  v_claim jsonb;
  v_idempotency_id uuid;
  v_hash text;
  v_item jsonb;
  v_count integer;
BEGIN
  IF p_orders IS NULL OR jsonb_typeof(p_orders) <> 'array'
     OR jsonb_array_length(p_orders) = 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: daftar urutan media wajib berupa array non-empty'
      USING ERRCODE='22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.paket_sewa
    WHERE usaha_id = p_usaha_id AND paket_sewa_id = p_paket_sewa_id
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: paket tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_usaha_id::text || ':package-media:' || p_paket_sewa_id::text, 0)
  );

  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id, 'paket_sewa_id', p_paket_sewa_id, 'orders', p_orders
  )::text);

  v_claim := app_private.catalog_idempotency_claim(
    p_usaha_id, 'reorder_paket_media', p_idempotency_key, v_hash
  );
  IF v_claim->>'state' = 'committed' THEN
    RETURN v_claim->'response';
  END IF;
  IF v_claim->>'state' = 'unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: reorder media paket belum dapat dipastikan'
      USING ERRCODE='40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_orders) LOOP
    IF (v_item->>'paket_media_id') IS NULL
       OR (v_item->>'urutan') IS NULL
       OR (v_item->>'urutan')::int < 1 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: setiap media paket harus memiliki id dan urutan valid'
        USING ERRCODE='22023';
    END IF;

    UPDATE public.paket_media
       SET urutan = (v_item->>'urutan')::int, updated_at = now()
     WHERE usaha_id = p_usaha_id
       AND paket_sewa_id = p_paket_sewa_id
       AND paket_media_id = (v_item->>'paket_media_id')::uuid
       AND status = 'valid';

    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count = 0 THEN
      RAISE EXCEPTION 'NOT_FOUND: salah satu media tidak berada pada paket ini' USING ERRCODE='P0002';
    END IF;
  END LOOP;

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action, entity_type,
    entity_id, source_application, request_id, change_summary
  )
  VALUES (
    p_usaha_id, auth.uid(), v_admin_id, 'reorder', 'paket_media',
    p_paket_sewa_id, 'admin-command', p_request_id,
    jsonb_build_object('orders', p_orders)
  );

  v_claim := jsonb_build_object(
    'paket_sewa_id', p_paket_sewa_id, 'orders', p_orders
  );
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id, 200, v_claim);
  RETURN v_claim;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_add_paket_media(uuid,uuid,text,text,text,integer,boolean,text,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_add_paket_media(uuid,uuid,text,text,text,integer,boolean,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_remove_paket_media(uuid,uuid,text,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_remove_paket_media(uuid,uuid,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_set_paket_media_cover(uuid,uuid,boolean,text,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_set_paket_media_cover(uuid,uuid,boolean,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_reorder_paket_media(uuid,uuid,jsonb,text,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_reorder_paket_media(uuid,uuid,jsonb,text,uuid) TO authenticated;
