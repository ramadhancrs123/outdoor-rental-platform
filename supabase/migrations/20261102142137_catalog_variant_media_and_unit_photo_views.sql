-- Variant-owned catalog images are shared by all physical units of that variant.
-- Unit media remains optional and continues to document the real physical unit.
-- Published variant media is readable through the public catalog; writes remain
-- tenant-scoped trusted commands.

CREATE UNIQUE INDEX IF NOT EXISTS varian_barang_usaha_variant_unique
  ON public.varian_barang(usaha_id, varian_barang_id);

CREATE TABLE IF NOT EXISTS public.varian_barang_media (
  varian_barang_media_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  varian_barang_id uuid NOT NULL,
  storage_bucket text NOT NULL,
  storage_path text NOT NULL,
  media_type text NOT NULL DEFAULT 'image',
  urutan integer NOT NULL DEFAULT 1 CHECK (urutan >= 1),
  is_cover boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT varian_barang_media_usaha_fk
    FOREIGN KEY (usaha_id) REFERENCES public.usaha(usaha_id) ON DELETE RESTRICT,
  CONSTRAINT varian_barang_media_variant_tenant_fk
    FOREIGN KEY (usaha_id, varian_barang_id)
    REFERENCES public.varian_barang(usaha_id, varian_barang_id) ON DELETE RESTRICT,
  CONSTRAINT varian_barang_media_storage_path_unique
    UNIQUE (storage_bucket, storage_path)
);

CREATE INDEX IF NOT EXISTS varian_barang_media_tenant_variant_idx
  ON public.varian_barang_media(usaha_id, varian_barang_id, status, is_cover DESC, urutan);

CREATE UNIQUE INDEX IF NOT EXISTS varian_barang_media_one_cover_idx
  ON public.varian_barang_media(usaha_id, varian_barang_id)
  WHERE status = 'valid' AND is_cover = true;

ALTER TABLE public.varian_barang_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS varian_barang_media_select_member ON public.varian_barang_media;
CREATE POLICY varian_barang_media_select_member
ON public.varian_barang_media
FOR SELECT TO authenticated
USING (app_private.has_usaha_access(usaha_id));

DROP POLICY IF EXISTS varian_barang_media_public_catalog ON public.varian_barang_media;
CREATE POLICY varian_barang_media_public_catalog
ON public.varian_barang_media
FOR SELECT TO anon
USING (
  status = 'valid'
  AND EXISTS (
    SELECT 1
    FROM public.varian_barang AS variant
    WHERE variant.usaha_id = varian_barang_media.usaha_id
      AND variant.varian_barang_id = varian_barang_media.varian_barang_id
      AND variant.status = 'active'
  )
  AND app_private.is_public_catalog_target(
    usaha_id, NULL::uuid, varian_barang_id, NULL::uuid
  )
);

-- New public tables are not automatically exposed to the Data API. Grant only
-- SELECT; all mutations are executed by the authenticated trusted RPC wrappers.
REVOKE ALL ON TABLE public.varian_barang_media FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.varian_barang_media TO anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.command_add_varian_barang_media(
  p_usaha_id uuid,
  p_varian_barang_id uuid,
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
  v_row public.varian_barang_media%ROWTYPE;
  v_hash text;
BEGIN
  IF p_varian_barang_id IS NULL
     OR p_storage_bucket IS DISTINCT FROM 'rental-public-media'
     OR nullif(btrim(coalesce(p_storage_path,'')),'') IS NULL
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = ''
     OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: varian, bucket, path, request_id, dan idempotency_key wajib diisi'
      USING ERRCODE='22023';
  END IF;

  IF coalesce(p_media_type,'') !~* '^image/'
     OR p_urutan IS NULL OR p_urutan < 1
  THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tipe dan urutan media varian tidak valid'
      USING ERRCODE='22023';
  END IF;

  IF split_part(p_storage_path, '/', 1) <> p_usaha_id::text
     OR split_part(p_storage_path, '/', 2) <> 'varian'
     OR split_part(p_storage_path, '/', 3) <> p_varian_barang_id::text
  THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: path media tidak sesuai dengan Usaha dan varian'
      USING ERRCODE='42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.varian_barang
    WHERE usaha_id = p_usaha_id
      AND varian_barang_id = p_varian_barang_id
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: varian tidak ditemukan dalam Usaha aktif'
      USING ERRCODE='P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_usaha_id::text || ':variant-media:' || p_varian_barang_id::text, 0
  ));

  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'varian_barang_id', p_varian_barang_id,
    'storage_bucket', p_storage_bucket,
    'storage_path', btrim(p_storage_path),
    'media_type', p_media_type,
    'urutan', p_urutan,
    'is_cover', coalesce(p_is_cover,false)
  )::text);

  v_claim := app_private.catalog_idempotency_claim(
    p_usaha_id, 'add_varian_barang_media', p_idempotency_key, v_hash
  );
  IF v_claim->>'state' = 'committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state' = 'unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: penambahan foto varian belum dapat dipastikan'
      USING ERRCODE='40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects
    WHERE bucket_id = 'rental-public-media'
      AND name = btrim(p_storage_path)
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: objek foto varian belum tersedia di storage'
      USING ERRCODE='P0002';
  END IF;

  IF coalesce(p_is_cover,false) THEN
    UPDATE public.varian_barang_media
       SET is_cover = false, updated_at = now()
     WHERE usaha_id = p_usaha_id
       AND varian_barang_id = p_varian_barang_id
       AND status = 'valid';
  END IF;

  INSERT INTO public.varian_barang_media(
    usaha_id, varian_barang_id, storage_bucket, storage_path,
    media_type, urutan, is_cover, status
  ) VALUES (
    p_usaha_id, p_varian_barang_id, p_storage_bucket, btrim(p_storage_path),
    p_media_type, p_urutan, coalesce(p_is_cover,false), 'valid'
  )
  RETURNING * INTO v_row;

  INSERT INTO public.audit_log(
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, request_id, change_summary
  ) VALUES (
    p_usaha_id, auth.uid(), v_admin_id, 'create', 'varian_barang_media',
    v_row.varian_barang_media_id, 'admin-command', p_request_id,
    jsonb_build_object(
      'varian_barang_id', p_varian_barang_id,
      'storage_path', v_row.storage_path,
      'is_cover', v_row.is_cover
    )
  );

  v_claim := to_jsonb(v_row);
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id, 200, v_claim);
  RETURN v_claim;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_remove_varian_barang_media(
  p_usaha_id uuid,
  p_varian_barang_media_id uuid,
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
  v_variant_id uuid;
  v_row public.varian_barang_media%ROWTYPE;
  v_hash text;
BEGIN
  IF p_varian_barang_media_id IS NULL OR p_idempotency_key IS NULL
     OR btrim(p_idempotency_key) = '' OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: media, request_id, dan idempotency_key wajib diisi'
      USING ERRCODE='22023';
  END IF;

  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'varian_barang_media_id', p_varian_barang_media_id
  )::text);
  v_claim := app_private.catalog_idempotency_claim(
    p_usaha_id, 'remove_varian_barang_media', p_idempotency_key, v_hash
  );
  IF v_claim->>'state' = 'committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state' = 'unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: penghapusan foto varian belum dapat dipastikan'
      USING ERRCODE='40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  SELECT varian_barang_id INTO v_variant_id
  FROM public.varian_barang_media
  WHERE usaha_id = p_usaha_id
    AND varian_barang_media_id = p_varian_barang_media_id
    AND status = 'valid';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: foto varian tidak ditemukan'
      USING ERRCODE='P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_usaha_id::text || ':variant-media:' || v_variant_id::text, 0
  ));

  SELECT * INTO v_row
  FROM public.varian_barang_media
  WHERE usaha_id = p_usaha_id
    AND varian_barang_media_id = p_varian_barang_media_id
    AND status = 'valid'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: foto varian tidak ditemukan'
      USING ERRCODE='P0002';
  END IF;

  UPDATE public.varian_barang_media
     SET status = 'deleted', is_cover = false, updated_at = now()
   WHERE usaha_id = p_usaha_id
     AND varian_barang_media_id = p_varian_barang_media_id;

  IF v_row.is_cover THEN
    UPDATE public.varian_barang_media AS next_media
       SET is_cover = true, updated_at = now()
     WHERE next_media.varian_barang_media_id = (
       SELECT candidate.varian_barang_media_id
       FROM public.varian_barang_media AS candidate
       WHERE candidate.usaha_id = p_usaha_id
         AND candidate.varian_barang_id = v_row.varian_barang_id
         AND candidate.status = 'valid'
       ORDER BY candidate.urutan ASC, candidate.created_at ASC, candidate.varian_barang_media_id ASC
       LIMIT 1
     );
  END IF;

  INSERT INTO public.audit_log(
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, request_id, change_summary
  ) VALUES (
    p_usaha_id, auth.uid(), v_admin_id, 'delete', 'varian_barang_media',
    v_row.varian_barang_media_id, 'admin-command', p_request_id,
    jsonb_build_object(
      'varian_barang_id', v_row.varian_barang_id,
      'storage_path', v_row.storage_path
    )
  );

  v_claim := jsonb_build_object(
    'removed', true,
    'varian_barang_media_id', v_row.varian_barang_media_id
  );
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id, 200, v_claim);
  RETURN v_claim;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_set_varian_barang_media_cover(
  p_usaha_id uuid,
  p_varian_barang_media_id uuid,
  p_is_cover boolean DEFAULT true,
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
  v_variant_id uuid;
  v_row public.varian_barang_media%ROWTYPE;
  v_hash text;
BEGIN
  IF p_varian_barang_media_id IS NULL OR p_is_cover IS NULL
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = ''
     OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: media, status cover, request_id, dan idempotency_key wajib diisi'
      USING ERRCODE='22023';
  END IF;

  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'varian_barang_media_id', p_varian_barang_media_id,
    'is_cover', p_is_cover
  )::text);
  v_claim := app_private.catalog_idempotency_claim(
    p_usaha_id, 'set_varian_barang_media_cover', p_idempotency_key, v_hash
  );
  IF v_claim->>'state' = 'committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state' = 'unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: perubahan cover foto varian belum dapat dipastikan'
      USING ERRCODE='40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  SELECT varian_barang_id INTO v_variant_id
  FROM public.varian_barang_media
  WHERE usaha_id = p_usaha_id
    AND varian_barang_media_id = p_varian_barang_media_id
    AND status = 'valid';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: foto varian tidak ditemukan'
      USING ERRCODE='P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_usaha_id::text || ':variant-media:' || v_variant_id::text, 0
  ));

  SELECT * INTO v_row
  FROM public.varian_barang_media
  WHERE usaha_id = p_usaha_id
    AND varian_barang_media_id = p_varian_barang_media_id
    AND status = 'valid'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: foto varian tidak ditemukan'
      USING ERRCODE='P0002';
  END IF;

  IF p_is_cover THEN
    UPDATE public.varian_barang_media
       SET is_cover = false, updated_at = now()
     WHERE usaha_id = p_usaha_id
       AND varian_barang_id = v_row.varian_barang_id
       AND status = 'valid';
  END IF;

  UPDATE public.varian_barang_media
     SET is_cover = p_is_cover, updated_at = now()
   WHERE usaha_id = p_usaha_id
     AND varian_barang_media_id = p_varian_barang_media_id
     AND status = 'valid'
  RETURNING * INTO v_row;

  INSERT INTO public.audit_log(
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, request_id, change_summary
  ) VALUES (
    p_usaha_id, auth.uid(), v_admin_id, 'update', 'varian_barang_media',
    v_row.varian_barang_media_id, 'admin-command', p_request_id,
    jsonb_build_object('varian_barang_id', v_row.varian_barang_id, 'is_cover', v_row.is_cover)
  );

  v_claim := to_jsonb(v_row);
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id, 200, v_claim);
  RETURN v_claim;
END;
$function$;

-- Trusted function ACLs and public PostgREST wrappers.
REVOKE ALL ON FUNCTION app_private.command_add_varian_barang_media(uuid,uuid,text,text,text,integer,boolean,text,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION app_private.command_remove_varian_barang_media(uuid,uuid,text,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION app_private.command_set_varian_barang_media_cover(uuid,uuid,boolean,text,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_add_varian_barang_media(uuid,uuid,text,text,text,integer,boolean,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_remove_varian_barang_media(uuid,uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.command_set_varian_barang_media_cover(uuid,uuid,boolean,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.command_add_varian_barang_media(
  p_usaha_id uuid,
  p_varian_barang_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_media_type text DEFAULT 'image',
  p_urutan integer DEFAULT 1,
  p_is_cover boolean DEFAULT false,
  p_idempotency_key text DEFAULT NULL,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_add_varian_barang_media($1,$2,$3,$4,$5,$6,$7,$8,$9);
$function$;

CREATE OR REPLACE FUNCTION public.command_remove_varian_barang_media(
  p_usaha_id uuid,
  p_varian_barang_media_id uuid,
  p_idempotency_key text DEFAULT NULL,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_remove_varian_barang_media($1,$2,$3,$4);
$function$;

CREATE OR REPLACE FUNCTION public.command_set_varian_barang_media_cover(
  p_usaha_id uuid,
  p_varian_barang_media_id uuid,
  p_is_cover boolean DEFAULT true,
  p_idempotency_key text DEFAULT NULL,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_set_varian_barang_media_cover($1,$2,$3,$4,$5);
$function$;

REVOKE ALL ON FUNCTION public.command_add_varian_barang_media(uuid,uuid,text,text,text,integer,boolean,text,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.command_remove_varian_barang_media(uuid,uuid,text,uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.command_set_varian_barang_media_cover(uuid,uuid,boolean,text,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_add_varian_barang_media(uuid,uuid,text,text,text,integer,boolean,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_remove_varian_barang_media(uuid,uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.command_set_varian_barang_media_cover(uuid,uuid,boolean,text,uuid) TO authenticated;
