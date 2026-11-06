-- Phase 1: per-business capabilities and immutable catalog promotion foundation.
-- No public/website read model is enabled in this phase. All writes go through trusted commands.

CREATE TABLE IF NOT EXISTS public.keanggotaan_usaha_permission (
  usaha_id uuid NOT NULL,
  akun_admin_id uuid NOT NULL,
  permission_key text NOT NULL,
  granted boolean NOT NULL DEFAULT true,
  granted_by_akun_admin_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT keanggotaan_usaha_permission_pk
    PRIMARY KEY (usaha_id, akun_admin_id, permission_key),
  CONSTRAINT keanggotaan_usaha_permission_member_fk
    FOREIGN KEY (usaha_id, akun_admin_id)
    REFERENCES public.keanggotaan_usaha (usaha_id, akun_admin_id) ON DELETE CASCADE,
  CONSTRAINT keanggotaan_usaha_permission_grantor_fk
    FOREIGN KEY (usaha_id, granted_by_akun_admin_id)
    REFERENCES public.keanggotaan_usaha (usaha_id, akun_admin_id) ON DELETE RESTRICT,
  CONSTRAINT keanggotaan_usaha_permission_key_check
    CHECK (permission_key IN (
      'event_promotion.manage',
      'checkout_discount.apply',
      'checkout_discount.override',
      'retail_bonus.apply',
      'access_control.manage',
      'reservation.amend'
    ))
);

CREATE INDEX IF NOT EXISTS keanggotaan_usaha_permission_lookup_idx
  ON public.keanggotaan_usaha_permission (usaha_id, permission_key, akun_admin_id)
  WHERE granted = true;

ALTER TABLE public.keanggotaan_usaha_permission ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.keanggotaan_usaha_permission FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.keanggotaan_usaha_permission TO authenticated;

DROP POLICY IF EXISTS keanggotaan_usaha_permission_member_read
  ON public.keanggotaan_usaha_permission;
CREATE POLICY keanggotaan_usaha_permission_member_read
  ON public.keanggotaan_usaha_permission
  FOR SELECT TO authenticated
  USING (app_private.has_usaha_access(usaha_id));

-- Existing super-admin memberships receive explicit grants. Authorization does not
-- rely on the global role at runtime; every capability is represented by a row.
INSERT INTO public.keanggotaan_usaha_permission (
  usaha_id, akun_admin_id, permission_key, granted, granted_by_akun_admin_id
)
SELECT ku.usaha_id, ku.akun_admin_id, capability.permission_key, true, ku.akun_admin_id
FROM public.keanggotaan_usaha ku
JOIN public.akun_admin aa ON aa.akun_admin_id = ku.akun_admin_id
CROSS JOIN (
  VALUES
    ('event_promotion.manage'),
    ('checkout_discount.apply'),
    ('checkout_discount.override'),
    ('retail_bonus.apply'),
    ('access_control.manage'),
    ('reservation.amend')
) AS capability(permission_key)
WHERE aa.role = 'super_admin'
  AND aa.status = 'active'
  AND ku.status = 'active'
  AND ku.revoked_at IS NULL
ON CONFLICT (usaha_id, akun_admin_id, permission_key)
DO UPDATE SET granted = true, updated_at = now();

CREATE OR REPLACE FUNCTION app_private.has_usaha_permission(
  p_usaha_id uuid,
  p_permission_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.akun_admin aa
      JOIN public.keanggotaan_usaha ku
        ON ku.akun_admin_id = aa.akun_admin_id
       AND ku.usaha_id = p_usaha_id
       AND ku.status = 'active'
       AND ku.revoked_at IS NULL
      JOIN public.keanggotaan_usaha_permission kp
        ON kp.usaha_id = ku.usaha_id
       AND kp.akun_admin_id = ku.akun_admin_id
       AND kp.permission_key = p_permission_key
       AND kp.granted = true
      WHERE aa.auth_user_id = auth.uid()
        AND aa.status = 'active'
    );
$function$;

REVOKE ALL ON FUNCTION app_private.has_usaha_permission(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.require_usaha_permission(
  p_usaha_id uuid,
  p_permission_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.catalog_require_admin(p_usaha_id);
BEGIN
  IF p_permission_key IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.keanggotaan_usaha_permission kp
    WHERE kp.usaha_id = p_usaha_id
      AND kp.akun_admin_id = v_admin_id
      AND kp.permission_key = p_permission_key
      AND kp.granted = true
  ) THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: capability % tidak diberikan pada keanggotaan usaha ini',
      coalesce(p_permission_key, '(null)') USING ERRCODE = '42501';
  END IF;
  RETURN v_admin_id;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.require_usaha_permission(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.command_set_membership_permission(
  p_usaha_id uuid,
  p_target_akun_admin_id uuid,
  p_permission_key text,
  p_granted boolean,
  p_idempotency_key text,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor_admin_id uuid;
  v_claim jsonb;
  v_idempotency_id uuid;
  v_hash text;
  v_response jsonb;
BEGIN
  v_actor_admin_id := app_private.require_usaha_permission(p_usaha_id, 'access_control.manage');

  IF p_target_akun_admin_id IS NULL
     OR p_permission_key IS NULL
     OR p_granted IS NULL
     OR p_permission_key NOT IN (
       'event_promotion.manage',
       'checkout_discount.apply',
       'checkout_discount.override',
       'retail_bonus.apply',
       'access_control.manage',
       'reservation.amend'
     )
     OR p_idempotency_key IS NULL
     OR btrim(p_idempotency_key) = ''
     OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: target, capability, status, idempotency_key dan request_id wajib valid'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.keanggotaan_usaha ku
    JOIN public.akun_admin aa ON aa.akun_admin_id = ku.akun_admin_id
    WHERE ku.usaha_id = p_usaha_id
      AND ku.akun_admin_id = p_target_akun_admin_id
      AND ku.status = 'active'
      AND ku.revoked_at IS NULL
      AND aa.status = 'active'
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: anggota aktif tidak ditemukan dalam Usaha ini'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_permission_key = 'access_control.manage' AND NOT p_granted
     AND NOT EXISTS (
       SELECT 1
       FROM public.keanggotaan_usaha_permission kp
       JOIN public.keanggotaan_usaha ku
         ON ku.usaha_id = kp.usaha_id AND ku.akun_admin_id = kp.akun_admin_id
       JOIN public.akun_admin aa ON aa.akun_admin_id = ku.akun_admin_id
       WHERE kp.usaha_id = p_usaha_id
         AND kp.permission_key = 'access_control.manage'
         AND kp.granted = true
         AND kp.akun_admin_id <> p_target_akun_admin_id
         AND ku.status = 'active' AND ku.revoked_at IS NULL
         AND aa.status = 'active'
     ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: minimal satu admin aktif harus tetap memiliki hak pengelolaan akses'
      USING ERRCODE = '23514';
  END IF;

  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'target_akun_admin_id', p_target_akun_admin_id,
    'permission_key', p_permission_key,
    'granted', p_granted
  )::text);

  v_claim := app_private.catalog_idempotency_claim(
    p_usaha_id, 'set_membership_permission', p_idempotency_key, v_hash
  );
  IF v_claim->>'state' = 'committed' THEN
    RETURN v_claim->'response';
  END IF;
  IF v_claim->>'state' = 'unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: status perubahan hak anggota belum dapat dipastikan'
      USING ERRCODE = '40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  INSERT INTO public.keanggotaan_usaha_permission (
    usaha_id, akun_admin_id, permission_key, granted, granted_by_akun_admin_id
  )
  VALUES (
    p_usaha_id, p_target_akun_admin_id, p_permission_key, p_granted, v_actor_admin_id
  )
  ON CONFLICT (usaha_id, akun_admin_id, permission_key)
  DO UPDATE SET
    granted = EXCLUDED.granted,
    granted_by_akun_admin_id = EXCLUDED.granted_by_akun_admin_id,
    updated_at = now();

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, request_id, change_summary
  )
  VALUES (
    p_usaha_id, auth.uid(), v_actor_admin_id,
    CASE WHEN p_granted THEN 'grant' ELSE 'revoke' END,
    'keanggotaan_usaha_permission', p_target_akun_admin_id,
    'admin-command', p_request_id,
    jsonb_build_object(
      'permission_key', p_permission_key,
      'granted', p_granted
    )
  );

  v_response := jsonb_build_object(
    'usaha_id', p_usaha_id,
    'akun_admin_id', p_target_akun_admin_id,
    'permission_key', p_permission_key,
    'granted', p_granted
  );
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id, 200, v_response);
  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_set_membership_permission(
  uuid, uuid, text, boolean, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_set_membership_permission(
  uuid, uuid, text, boolean, text, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.command_set_membership_permission(
  p_usaha_id uuid,
  p_target_akun_admin_id uuid,
  p_permission_key text,
  p_granted boolean,
  p_idempotency_key text,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_set_membership_permission(
    p_usaha_id, p_target_akun_admin_id, p_permission_key,
    p_granted, p_idempotency_key, p_request_id
  );
$function$;

REVOKE ALL ON FUNCTION public.command_set_membership_permission(
  uuid, uuid, text, boolean, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_set_membership_permission(
  uuid, uuid, text, boolean, text, uuid
) TO authenticated;

CREATE TABLE IF NOT EXISTS public.promosi_katalog (
  promosi_katalog_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  barang_id uuid,
  varian_barang_id uuid,
  channel text NOT NULL,
  diskon_persen numeric(5,2) NOT NULL,
  is_public boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft',
  started_at timestamptz NOT NULL,
  valid_until timestamptz,
  ended_at timestamptz,
  created_by_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_akun_admin_id uuid,
  ended_by_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ended_by_akun_admin_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promosi_katalog_tenant_unique UNIQUE (usaha_id, promosi_katalog_id),
  CONSTRAINT promosi_katalog_usaha_fk
    FOREIGN KEY (usaha_id) REFERENCES public.usaha(usaha_id) ON DELETE RESTRICT,
  CONSTRAINT promosi_katalog_barang_fk
    FOREIGN KEY (usaha_id, barang_id)
    REFERENCES public.barang(usaha_id, barang_id) ON DELETE RESTRICT,
  CONSTRAINT promosi_katalog_variant_fk
    FOREIGN KEY (usaha_id, varian_barang_id)
    REFERENCES public.varian_barang(usaha_id, varian_barang_id) ON DELETE RESTRICT,
  CONSTRAINT promosi_katalog_creator_membership_fk
    FOREIGN KEY (usaha_id, created_by_akun_admin_id)
    REFERENCES public.keanggotaan_usaha(usaha_id, akun_admin_id) ON DELETE RESTRICT,
  CONSTRAINT promosi_katalog_ender_membership_fk
    FOREIGN KEY (usaha_id, ended_by_akun_admin_id)
    REFERENCES public.keanggotaan_usaha(usaha_id, akun_admin_id) ON DELETE RESTRICT,
  CONSTRAINT promosi_katalog_one_target_check
    CHECK (num_nonnulls(barang_id, varian_barang_id) = 1),
  CONSTRAINT promosi_katalog_channel_check
    CHECK (channel IN ('rental', 'sale')),
  CONSTRAINT promosi_katalog_discount_check
    CHECK (
      (channel = 'rental' AND diskon_persen > 0 AND diskon_persen <= 100)
      OR
      (channel = 'sale' AND diskon_persen > 0 AND diskon_persen < 100)
    ),
  CONSTRAINT promosi_katalog_period_check
    CHECK (valid_until IS NULL OR valid_until > started_at),
  CONSTRAINT promosi_katalog_status_check
    CHECK (status IN ('draft', 'active', 'ended', 'cancelled')),
  CONSTRAINT promosi_katalog_lifecycle_check
    CHECK (
      (status = 'ended' AND ended_at IS NOT NULL)
      OR (status <> 'ended' AND ended_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS promosi_katalog_target_channel_idx
  ON public.promosi_katalog (usaha_id, barang_id, channel, started_at DESC)
  WHERE barang_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS promosi_katalog_variant_channel_idx
  ON public.promosi_katalog (usaha_id, varian_barang_id, channel, started_at DESC)
  WHERE varian_barang_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS promosi_katalog_active_period_idx
  ON public.promosi_katalog (usaha_id, channel, started_at, valid_until)
  WHERE status = 'active' AND ended_at IS NULL;

ALTER TABLE public.promosi_katalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.promosi_katalog FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.promosi_katalog TO authenticated;

DROP POLICY IF EXISTS promosi_katalog_member_read ON public.promosi_katalog;
CREATE POLICY promosi_katalog_member_read
  ON public.promosi_katalog
  FOR SELECT TO authenticated
  USING (app_private.has_usaha_access(usaha_id));

ALTER TABLE public.detail_penyewaan
  ADD COLUMN IF NOT EXISTS promosi_katalog_id uuid,
  ADD COLUMN IF NOT EXISTS harga_normal_snapshot numeric(14,2),
  ADD COLUMN IF NOT EXISTS diskon_persen_snapshot numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nominal_diskon_snapshot numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS durasi_unit_snapshot text,
  ADD COLUMN IF NOT EXISTS durasi_nilai_snapshot numeric(12,4);

ALTER TABLE public.detail_reservasi
  ADD COLUMN IF NOT EXISTS promosi_katalog_id uuid,
  ADD COLUMN IF NOT EXISTS harga_normal_snapshot numeric(14,2),
  ADD COLUMN IF NOT EXISTS diskon_persen_snapshot numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nominal_diskon_snapshot numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS durasi_unit_snapshot text,
  ADD COLUMN IF NOT EXISTS durasi_nilai_snapshot numeric(12,4);

ALTER TABLE public.detail_penjualan
  ADD COLUMN IF NOT EXISTS promosi_katalog_id uuid,
  ADD COLUMN IF NOT EXISTS harga_normal_snapshot numeric(14,2),
  ADD COLUMN IF NOT EXISTS diskon_persen_snapshot numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nominal_diskon_snapshot numeric(14,2) NOT NULL DEFAULT 0;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.detail_penyewaan'::regclass
      AND conname = 'detail_penyewaan_promosi_katalog_fk'
  ) THEN
    ALTER TABLE public.detail_penyewaan
      ADD CONSTRAINT detail_penyewaan_promosi_katalog_fk
      FOREIGN KEY (usaha_id, promosi_katalog_id)
      REFERENCES public.promosi_katalog (usaha_id, promosi_katalog_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.detail_reservasi'::regclass
      AND conname = 'detail_reservasi_promosi_katalog_fk'
  ) THEN
    ALTER TABLE public.detail_reservasi
      ADD CONSTRAINT detail_reservasi_promosi_katalog_fk
      FOREIGN KEY (usaha_id, promosi_katalog_id)
      REFERENCES public.promosi_katalog (usaha_id, promosi_katalog_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.detail_penjualan'::regclass
      AND conname = 'detail_penjualan_promosi_katalog_fk'
  ) THEN
    ALTER TABLE public.detail_penjualan
      ADD CONSTRAINT detail_penjualan_promosi_katalog_fk
      FOREIGN KEY (usaha_id, promosi_katalog_id)
      REFERENCES public.promosi_katalog (usaha_id, promosi_katalog_id) ON DELETE RESTRICT;
  END IF;
END;
$migration$;

CREATE INDEX IF NOT EXISTS detail_penyewaan_promosi_katalog_idx
  ON public.detail_penyewaan (usaha_id, promosi_katalog_id)
  WHERE promosi_katalog_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS detail_reservasi_promosi_katalog_idx
  ON public.detail_reservasi (usaha_id, promosi_katalog_id)
  WHERE promosi_katalog_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS detail_penjualan_promosi_katalog_idx
  ON public.detail_penjualan (usaha_id, promosi_katalog_id)
  WHERE promosi_katalog_id IS NOT NULL;

ALTER TABLE public.promosi_paket_sewa
  ADD COLUMN IF NOT EXISTS valid_until timestamptz;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.promosi_paket_sewa'::regclass
      AND conname = 'promosi_paket_sewa_valid_until_check'
  ) THEN
    ALTER TABLE public.promosi_paket_sewa
      ADD CONSTRAINT promosi_paket_sewa_valid_until_check
      CHECK (valid_until IS NULL OR valid_until > started_at);
  END IF;
END;
$migration$;

COMMENT ON TABLE public.keanggotaan_usaha_permission IS
  'Explicit per-business capability grants. Missing rows and granted=false are default-deny.';
COMMENT ON TABLE public.promosi_katalog IS
  'Immutable catalog promotion versions by target and channel. Rental and retail pricing remain separate.';
COMMENT ON COLUMN public.promosi_katalog.is_public IS
  'Explicit future public/internal visibility flag. Public read models are intentionally deferred.';
COMMENT ON COLUMN public.promosi_katalog.valid_until IS
  'Scheduled exclusive end timestamp. Active interval is [started_at, valid_until); NULL is unbounded.';



-- Read only the caller's explicit capabilities for a single tenant.
CREATE OR REPLACE FUNCTION public.get_my_usaha_permissions(p_usaha_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid;
  v_permissions text[];
BEGIN
  IF auth.uid() IS NULL OR p_usaha_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user and tenant are required'
      USING ERRCODE = '28000';
  END IF;

  SELECT aa.akun_admin_id
  INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id = aa.akun_admin_id
   AND ku.usaha_id = p_usaha_id
   AND ku.status = 'active'
   AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id = auth.uid()
    AND aa.status = 'active';

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki keanggotaan aktif pada Usaha ini'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(array_agg(kp.permission_key ORDER BY kp.permission_key), ARRAY[]::text[])
  INTO v_permissions
  FROM public.keanggotaan_usaha_permission kp
  WHERE kp.usaha_id = p_usaha_id
    AND kp.akun_admin_id = v_admin_id
    AND kp.granted = true;

  RETURN v_permissions;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_usaha_permissions(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_usaha_permissions(uuid)
  TO authenticated;

-- Provision explicit membership grants for future super-admin memberships.
-- Runtime authorization still reads capability rows only; the global role is used solely here.
CREATE OR REPLACE FUNCTION app_private.bootstrap_super_admin_membership_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.status = 'active' AND NEW.revoked_at IS NULL AND EXISTS (
    SELECT 1
    FROM public.akun_admin aa
    WHERE aa.akun_admin_id = NEW.akun_admin_id
      AND aa.role = 'super_admin'
      AND aa.status = 'active'
  ) THEN
    INSERT INTO public.keanggotaan_usaha_permission (
      usaha_id, akun_admin_id, permission_key, granted, granted_by_akun_admin_id
    )
    VALUES
      (NEW.usaha_id, NEW.akun_admin_id, 'event_promotion.manage', true, NEW.akun_admin_id),
      (NEW.usaha_id, NEW.akun_admin_id, 'checkout_discount.apply', true, NEW.akun_admin_id),
      (NEW.usaha_id, NEW.akun_admin_id, 'checkout_discount.override', true, NEW.akun_admin_id),
      (NEW.usaha_id, NEW.akun_admin_id, 'retail_bonus.apply', true, NEW.akun_admin_id),
      (NEW.usaha_id, NEW.akun_admin_id, 'access_control.manage', true, NEW.akun_admin_id),
      (NEW.usaha_id, NEW.akun_admin_id, 'reservation.amend', true, NEW.akun_admin_id)
    ON CONFLICT (usaha_id, akun_admin_id, permission_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.bootstrap_super_admin_membership_permissions()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_bootstrap_super_admin_membership_permissions
  ON public.keanggotaan_usaha;
CREATE TRIGGER trg_bootstrap_super_admin_membership_permissions
AFTER INSERT OR UPDATE OF status, revoked_at
ON public.keanggotaan_usaha
FOR EACH ROW
EXECUTE FUNCTION app_private.bootstrap_super_admin_membership_permissions();
