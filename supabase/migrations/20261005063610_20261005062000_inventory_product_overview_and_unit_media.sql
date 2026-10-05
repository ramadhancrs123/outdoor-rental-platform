-- Inventory UX foundation: product-first overview and per-unit operational photos.
-- Photos are unit metadata, separate from inspection condition evidence.
-- Additive only; no historical inventory facts are deleted or rewritten.

CREATE TABLE IF NOT EXISTS public.unit_media (
  unit_media_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  unit_barang_id uuid NOT NULL,
  storage_bucket text NOT NULL,
  storage_path text NOT NULL,
  media_type text NOT NULL DEFAULT 'image',
  urutan integer NOT NULL DEFAULT 1 CHECK (urutan >= 1),
  is_cover boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_media_usaha_fk
    FOREIGN KEY (usaha_id) REFERENCES public.usaha(usaha_id),
  CONSTRAINT unit_media_unit_fk
    FOREIGN KEY (unit_barang_id) REFERENCES public.unit_barang(unit_barang_id)
);

CREATE INDEX IF NOT EXISTS unit_media_tenant_unit_idx
  ON public.unit_media(usaha_id, unit_barang_id, status, urutan);

CREATE UNIQUE INDEX IF NOT EXISTS unit_media_one_cover_idx
  ON public.unit_media(usaha_id, unit_barang_id)
  WHERE status = 'valid' AND is_cover = true;

ALTER TABLE public.unit_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS unit_media_select_member ON public.unit_media;
CREATE POLICY unit_media_select_member
ON public.unit_media
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id = aa.akun_admin_id
     AND ku.usaha_id = unit_media.usaha_id
     AND ku.status = 'active'
     AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id = auth.uid()
      AND aa.status = 'active'
  )
  AND EXISTS (
    SELECT 1
    FROM public.unit_barang ub
    WHERE ub.unit_barang_id = unit_media.unit_barang_id
      AND ub.usaha_id = unit_media.usaha_id
  )
);

DROP POLICY IF EXISTS unit_media_insert_member ON public.unit_media;
CREATE POLICY unit_media_insert_member
ON public.unit_media
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id = aa.akun_admin_id
     AND ku.usaha_id = unit_media.usaha_id
     AND ku.status = 'active'
     AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id = auth.uid()
      AND aa.status = 'active'
  )
);

DROP POLICY IF EXISTS unit_media_update_member ON public.unit_media;
CREATE POLICY unit_media_update_member
ON public.unit_media
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id = aa.akun_admin_id
     AND ku.usaha_id = unit_media.usaha_id
     AND ku.status = 'active'
     AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id = auth.uid()
      AND aa.status = 'active'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id = aa.akun_admin_id
     AND ku.usaha_id = unit_media.usaha_id
     AND ku.status = 'active'
     AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id = auth.uid()
      AND aa.status = 'active'
  )
);

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false
);

INSERT INTO storage.buckets(id, name, public)
VALUES ('rental-private-inventory', 'rental-private-inventory', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS inventory_private_read ON storage.objects;
CREATE POLICY inventory_private_read
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'rental-private-inventory'
  AND app_private.storage_path_has_usaha_access(name)
);

DROP POLICY IF EXISTS inventory_private_insert ON storage.objects;
CREATE POLICY inventory_private_insert
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'rental-private-inventory'
  AND app_private.storage_path_has_usaha_access(name)
);

DROP POLICY IF EXISTS inventory_private_update ON storage.objects;
CREATE POLICY inventory_private_update
ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'rental-private-inventory'
  AND app_private.storage_path_has_usaha_access(name)
)
WITH CHECK (
  bucket_id = 'rental-private-inventory'
  AND app_private.storage_path_has_usaha_access(name)
);

DROP POLICY IF EXISTS inventory_private_delete ON storage.objects;
CREATE POLICY inventory_private_delete
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'rental-private-inventory'
  AND app_private.storage_path_has_usaha_access(name)
);

CREATE OR REPLACE FUNCTION app_private.command_add_unit_media(
  p_usaha_id uuid,
  p_unit_barang_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_media_type text,
  p_urutan integer,
  p_is_cover boolean,
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
  v_media_id uuid := gen_random_uuid();
  v_idempotency_id uuid;
  v_request_hash text;
  v_response jsonb;
  v_row public.unit_media%ROWTYPE;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;

  IF p_usaha_id IS NULL OR p_unit_barang_id IS NULL
     OR nullif(btrim(coalesce(p_storage_bucket,'')),'') IS NULL
     OR nullif(btrim(coalesce(p_storage_path,'')),'') IS NULL
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key)=''
     OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: unit, bucket, path, request_id, dan idempotency_key wajib diisi' USING ERRCODE='22023';
  END IF;

  IF p_storage_bucket <> 'rental-private-inventory' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: bucket media unit tidak valid' USING ERRCODE='22023';
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
    AND aa.status = 'active';

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.unit_barang
    WHERE usaha_id = p_usaha_id AND unit_barang_id = p_unit_barang_id
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: unit tidak ditemukan dalam Usaha aktif' USING ERRCODE='P0002';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,
    'unit_barang_id',p_unit_barang_id,
    'storage_bucket',btrim(p_storage_bucket),
    'storage_path',btrim(p_storage_path),
    'media_type',coalesce(nullif(btrim(p_media_type),''),'image'),
    'urutan',greatest(coalesce(p_urutan,1),1),
    'is_cover',coalesce(p_is_cover,false)
  )::text);

  INSERT INTO public.idempotency_key(
    usaha_id,actor_auth_user_id,key,command_name,request_hash
  ) VALUES (
    p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'add_unit_media',v_request_hash
  )
  ON CONFLICT (usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body,request_hash
    INTO v_response,v_request_hash
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id
      AND actor_auth_user_id=v_auth_user_id
      AND command_name='add_unit_media'
      AND key=btrim(p_idempotency_key);

    IF v_request_hash IS DISTINCT FROM md5(jsonb_build_object(
      'usaha_id',p_usaha_id,
      'unit_barang_id',p_unit_barang_id,
      'storage_bucket',btrim(p_storage_bucket),
      'storage_path',btrim(p_storage_path),
      'media_type',coalesce(nullif(btrim(p_media_type),''),'image'),
      'urutan',greatest(coalesce(p_urutan,1),1),
      'is_cover',coalesce(p_is_cover,false)
    )::text) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_response IS NOT NULL THEN RETURN v_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: upload media unit memiliki idempotency record tanpa response' USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_usaha_id::text||':unit-media:'||p_unit_barang_id::text,0
  ));

  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id='rental-private-inventory'
      AND name=btrim(p_storage_path)
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: objek foto unit belum tersedia di storage' USING ERRCODE='P0002';
  END IF;

  IF coalesce(p_is_cover,false) THEN
    UPDATE public.unit_media
    SET is_cover=false, updated_at=now()
    WHERE usaha_id=p_usaha_id
      AND unit_barang_id=p_unit_barang_id
      AND status='valid';
  END IF;

  INSERT INTO public.unit_media(
    unit_media_id,usaha_id,unit_barang_id,storage_bucket,storage_path,
    media_type,urutan,is_cover,status
  ) VALUES (
    v_media_id,p_usaha_id,p_unit_barang_id,btrim(p_storage_bucket),btrim(p_storage_path),
    coalesce(nullif(btrim(p_media_type),''),'image'),greatest(coalesce(p_urutan,1),1),
    coalesce(p_is_cover,false),'valid'
  )
  RETURNING * INTO v_row;

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,
    entity_type,entity_id,source_application,request_id,change_summary
  ) VALUES (
    p_usaha_id,v_auth_user_id,v_admin_id,'create','unit_media',v_media_id,'admin-command',p_request_id,
    jsonb_build_object('unit_barang_id',p_unit_barang_id,'storage_path',v_row.storage_path,'is_cover',v_row.is_cover)
  );

  v_response := jsonb_build_object(
    'unit_media_id',v_row.unit_media_id,
    'unit_barang_id',v_row.unit_barang_id,
    'storage_bucket',v_row.storage_bucket,
    'storage_path',v_row.storage_path,
    'media_type',v_row.media_type,
    'urutan',v_row.urutan,
    'is_cover',v_row.is_cover,
    'status',v_row.status
  );

  UPDATE public.idempotency_key
  SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_remove_unit_media(
  p_usaha_id uuid,
  p_unit_media_id uuid,
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
  v_row public.unit_media%ROWTYPE;
  v_idempotency_id uuid;
  v_request_hash text;
  v_response jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;

  SELECT aa.akun_admin_id INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id=aa.akun_admin_id
   AND ku.usaha_id=p_usaha_id
   AND ku.status='active'
   AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id=v_auth_user_id
    AND aa.status='active';

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501';
  END IF;

  v_request_hash:=md5(jsonb_build_object('usaha_id',p_usaha_id,'unit_media_id',p_unit_media_id)::text);

  INSERT INTO public.idempotency_key(
    usaha_id,actor_auth_user_id,key,command_name,request_hash
  ) VALUES (
    p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'remove_unit_media',v_request_hash
  )
  ON CONFLICT (usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body,request_hash INTO v_response,v_request_hash
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id AND actor_auth_user_id=v_auth_user_id
      AND command_name='remove_unit_media' AND key=btrim(p_idempotency_key);
    IF v_request_hash IS DISTINCT FROM md5(jsonb_build_object('usaha_id',p_usaha_id,'unit_media_id',p_unit_media_id)::text) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_response IS NOT NULL THEN RETURN v_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: penghapusan media unit memiliki idempotency record tanpa response' USING ERRCODE='40001';
  END IF;

  SELECT * INTO v_row
  FROM public.unit_media
  WHERE usaha_id=p_usaha_id AND unit_media_id=p_unit_media_id AND status='valid'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: media unit tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  UPDATE public.unit_media
  SET status='deleted',is_cover=false,updated_at=now()
  WHERE usaha_id=p_usaha_id AND unit_media_id=p_unit_media_id;

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,
    entity_type,entity_id,source_application,request_id,change_summary
  ) VALUES (
    p_usaha_id,v_auth_user_id,v_admin_id,'delete','unit_media',v_row.unit_media_id,'admin-command',p_request_id,
    jsonb_build_object('unit_barang_id',v_row.unit_barang_id,'storage_path',v_row.storage_path)
  );

  v_response:=jsonb_build_object('removed',true,'unit_media_id',v_row.unit_media_id);

  UPDATE public.idempotency_key
  SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.command_set_unit_media_cover(
  p_usaha_id uuid,
  p_unit_media_id uuid,
  p_is_cover boolean,
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
  v_row public.unit_media%ROWTYPE;
  v_idempotency_id uuid;
  v_request_hash text;
  v_response jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;

  SELECT aa.akun_admin_id INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id=aa.akun_admin_id
   AND ku.usaha_id=p_usaha_id
   AND ku.status='active'
   AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id=v_auth_user_id
    AND aa.status='active';

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501';
  END IF;

  v_request_hash:=md5(jsonb_build_object('usaha_id',p_usaha_id,'unit_media_id',p_unit_media_id,'is_cover',p_is_cover)::text);

  INSERT INTO public.idempotency_key(
    usaha_id,actor_auth_user_id,key,command_name,request_hash
  ) VALUES (
    p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'set_unit_media_cover',v_request_hash
  )
  ON CONFLICT (usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body,request_hash INTO v_response,v_request_hash
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id AND actor_auth_user_id=v_auth_user_id
      AND command_name='set_unit_media_cover' AND key=btrim(p_idempotency_key);
    IF v_request_hash IS DISTINCT FROM md5(jsonb_build_object('usaha_id',p_usaha_id,'unit_media_id',p_unit_media_id,'is_cover',p_is_cover)::text) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_response IS NOT NULL THEN RETURN v_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: perubahan cover media unit memiliki idempotency record tanpa response' USING ERRCODE='40001';
  END IF;

  SELECT * INTO v_row
  FROM public.unit_media
  WHERE usaha_id=p_usaha_id AND unit_media_id=p_unit_media_id AND status='valid'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: media unit tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_usaha_id::text||':unit-media:'||v_row.unit_barang_id::text,0
  ));

  UPDATE public.unit_media
  SET is_cover=false,updated_at=now()
  WHERE usaha_id=p_usaha_id AND unit_barang_id=v_row.unit_barang_id AND status='valid';

  UPDATE public.unit_media
  SET is_cover=coalesce(p_is_cover,false),updated_at=now()
  WHERE usaha_id=p_usaha_id AND unit_media_id=p_unit_media_id AND status='valid';

  v_response:=jsonb_build_object(
    'unit_media_id',v_row.unit_media_id,
    'unit_barang_id',v_row.unit_barang_id,
    'is_cover',coalesce(p_is_cover,false)
  );

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,
    entity_type,entity_id,source_application,request_id,change_summary
  ) VALUES (
    p_usaha_id,v_auth_user_id,v_admin_id,'update','unit_media',v_row.unit_media_id,'admin-command',p_request_id,
    jsonb_build_object('is_cover',coalesce(p_is_cover,false),'unit_barang_id',v_row.unit_barang_id)
  );

  UPDATE public.idempotency_key
  SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;

  RETURN v_response;
END;
$function$;

DROP FUNCTION IF EXISTS public.inventory_product_overview(uuid);
CREATE OR REPLACE FUNCTION public.inventory_product_overview(p_usaha_id uuid)
RETURNS TABLE(
  barang_id uuid,
  nama text,
  slug text,
  status text,
  kategori_nama text,
  total_unit bigint,
  ready_unit bigint,
  rented_unit bigint,
  attention_unit bigint,
  inspection_pending_unit bigint,
  maintenance_unit bigint,
  damaged_unit bigint,
  lost_unit bigint,
  inactive_unit bigint,
  variant_count bigint,
  cover_bucket text,
  cover_path text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE='28000';
  END IF;

  SELECT aa.akun_admin_id INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id=aa.akun_admin_id
   AND ku.usaha_id=p_usaha_id
   AND ku.status='active'
   AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id=v_auth_user_id
    AND aa.status='active';

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki akses ke usaha' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  SELECT
    b.barang_id,
    b.nama,
    b.slug,
    b.status,
    k.nama AS kategori_nama,
    count(u.unit_barang_id)::bigint AS total_unit,
    count(u.unit_barang_id) FILTER (WHERE u.status='ready')::bigint AS ready_unit,
    count(u.unit_barang_id) FILTER (WHERE u.status='rented')::bigint AS rented_unit,
    count(u.unit_barang_id) FILTER (WHERE u.status IN ('inspection_pending','maintenance','damaged','lost'))::bigint AS attention_unit,
    count(u.unit_barang_id) FILTER (WHERE u.status='inspection_pending')::bigint AS inspection_pending_unit,
    count(u.unit_barang_id) FILTER (WHERE u.status='maintenance')::bigint AS maintenance_unit,
    count(u.unit_barang_id) FILTER (WHERE u.status='damaged')::bigint AS damaged_unit,
    count(u.unit_barang_id) FILTER (WHERE u.status='lost')::bigint AS lost_unit,
    count(u.unit_barang_id) FILTER (WHERE u.status='inactive')::bigint AS inactive_unit,
    count(DISTINCT v.varian_barang_id)::bigint AS variant_count,
    media.storage_bucket,
    media.storage_path
  FROM public.barang b
  LEFT JOIN public.kategori_barang k
    ON k.usaha_id=b.usaha_id
   AND k.kategori_barang_id=b.kategori_barang_id
  LEFT JOIN public.unit_barang u
    ON u.usaha_id=b.usaha_id
   AND u.barang_id=b.barang_id
  LEFT JOIN public.varian_barang v
    ON v.usaha_id=b.usaha_id
   AND v.barang_id=b.barang_id
  LEFT JOIN LATERAL (
    SELECT bm.storage_bucket,bm.storage_path
    FROM public.barang_media bm
    WHERE bm.usaha_id=b.usaha_id
      AND bm.barang_id=b.barang_id
      AND bm.status IN ('valid','active')
    ORDER BY bm.is_cover DESC,bm.urutan ASC
    LIMIT 1
  ) media ON true
  WHERE b.usaha_id=p_usaha_id
  GROUP BY b.barang_id,b.nama,b.slug,b.status,k.nama,media.storage_bucket,media.storage_path
  ORDER BY b.nama ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.inventory_product_overview(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_product_overview(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.inventory_product_overview(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.inventory_product_overview(uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_add_unit_media(uuid,uuid,text,text,text,integer,boolean,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_add_unit_media(uuid,uuid,text,text,text,integer,boolean,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_add_unit_media(uuid,uuid,text,text,text,integer,boolean,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_add_unit_media(uuid,uuid,text,text,text,integer,boolean,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_remove_unit_media(uuid,uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_remove_unit_media(uuid,uuid,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_remove_unit_media(uuid,uuid,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_remove_unit_media(uuid,uuid,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION app_private.command_set_unit_media_cover(uuid,uuid,boolean,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.command_set_unit_media_cover(uuid,uuid,boolean,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION app_private.command_set_unit_media_cover(uuid,uuid,boolean,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION app_private.command_set_unit_media_cover(uuid,uuid,boolean,text,uuid) TO authenticated;
