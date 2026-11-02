-- Package promotion backend. Regular tariff values and existing financial snapshots remain intact.
-- Existing triggers are not dropped/recreated; only validate_rental_line_math() is extended.

CREATE TABLE IF NOT EXISTS public.promosi_paket_sewa (
  promosi_paket_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL REFERENCES public.usaha(usaha_id) ON DELETE RESTRICT,
  paket_sewa_id uuid NOT NULL REFERENCES public.paket_sewa(paket_sewa_id) ON DELETE RESTRICT,
  tarif_sewa_id uuid NOT NULL REFERENCES public.tarif_sewa(tarif_sewa_id) ON DELETE RESTRICT,
  harga_normal numeric(14,2) NOT NULL,
  harga_promo numeric(14,2) NOT NULL,
  status text NOT NULL DEFAULT 'active',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_by_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_akun_admin_id uuid REFERENCES public.akun_admin(akun_admin_id) ON DELETE SET NULL,
  ended_by_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ended_by_akun_admin_id uuid REFERENCES public.akun_admin(akun_admin_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promosi_paket_sewa_status_valid CHECK (status IN ('active','ended')),
  CONSTRAINT promosi_paket_sewa_price_valid
    CHECK (harga_normal > 0 AND harga_promo >= 0 AND harga_promo < harga_normal),
  CONSTRAINT promosi_paket_sewa_period_valid
    CHECK ((status = 'active' AND ended_at IS NULL) OR (status = 'ended' AND ended_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS promosi_paket_sewa_one_active_per_tariff
  ON public.promosi_paket_sewa (usaha_id, tarif_sewa_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS promosi_paket_sewa_package_history_idx
  ON public.promosi_paket_sewa (usaha_id, paket_sewa_id, started_at DESC);

ALTER TABLE public.promosi_paket_sewa ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.promosi_paket_sewa FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.promosi_paket_sewa TO authenticated;
GRANT SELECT (usaha_id,paket_sewa_id,tarif_sewa_id,promosi_paket_id,harga_promo,status,started_at,ended_at)
  ON TABLE public.promosi_paket_sewa TO anon;

DROP POLICY IF EXISTS promosi_paket_sewa_admin_read ON public.promosi_paket_sewa;
CREATE POLICY promosi_paket_sewa_admin_read ON public.promosi_paket_sewa
  FOR SELECT TO authenticated USING (app_private.has_usaha_access(usaha_id));

CREATE OR REPLACE FUNCTION app_private.can_read_public_package_promo(
  p_usaha_id uuid,p_paket_sewa_id uuid,p_tarif_sewa_id uuid,p_status text,
  p_started_at timestamptz,p_ended_at timestamptz
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT p_status='active'
    AND p_started_at <= now()
    AND p_ended_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.tarif_sewa t
      WHERE t.usaha_id=p_usaha_id
        AND t.tarif_sewa_id=p_tarif_sewa_id
        AND t.paket_sewa_id=p_paket_sewa_id
        AND t.status='active'
        AND t.berlaku_mulai <= now()
        AND (t.berlaku_sampai IS NULL OR t.berlaku_sampai > now())
        AND app_private.is_public_catalog_target(t.usaha_id,NULL::uuid,NULL::uuid,t.paket_sewa_id)
    );
$function$;
REVOKE ALL ON FUNCTION app_private.can_read_public_package_promo(uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone)
  FROM PUBLIC,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.can_read_public_package_promo(uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone)
  TO anon,authenticated;

DROP POLICY IF EXISTS promosi_paket_sewa_public_read ON public.promosi_paket_sewa;
CREATE POLICY promosi_paket_sewa_public_read ON public.promosi_paket_sewa
  FOR SELECT TO anon
  USING (app_private.can_read_public_package_promo(usaha_id,paket_sewa_id,tarif_sewa_id,status,started_at,ended_at));

ALTER TABLE public.detail_reservasi
  ADD COLUMN IF NOT EXISTS tarif_sewa_id uuid,
  ADD COLUMN IF NOT EXISTS promosi_paket_id uuid;
ALTER TABLE public.detail_penyewaan
  ADD COLUMN IF NOT EXISTS tarif_sewa_id uuid,
  ADD COLUMN IF NOT EXISTS promosi_paket_id uuid;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.detail_reservasi'::regclass AND conname='detail_reservasi_tarif_sewa_id_fkey') THEN
    ALTER TABLE public.detail_reservasi ADD CONSTRAINT detail_reservasi_tarif_sewa_id_fkey
      FOREIGN KEY (tarif_sewa_id) REFERENCES public.tarif_sewa(tarif_sewa_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.detail_reservasi'::regclass AND conname='detail_reservasi_promosi_paket_id_fkey') THEN
    ALTER TABLE public.detail_reservasi ADD CONSTRAINT detail_reservasi_promosi_paket_id_fkey
      FOREIGN KEY (promosi_paket_id) REFERENCES public.promosi_paket_sewa(promosi_paket_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.detail_reservasi'::regclass AND conname='detail_reservasi_promo_requires_tariff_check') THEN
    ALTER TABLE public.detail_reservasi ADD CONSTRAINT detail_reservasi_promo_requires_tariff_check
      CHECK (promosi_paket_id IS NULL OR (tarif_sewa_id IS NOT NULL AND paket_sewa_id IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.detail_penyewaan'::regclass AND conname='detail_penyewaan_tarif_sewa_id_fkey') THEN
    ALTER TABLE public.detail_penyewaan ADD CONSTRAINT detail_penyewaan_tarif_sewa_id_fkey
      FOREIGN KEY (tarif_sewa_id) REFERENCES public.tarif_sewa(tarif_sewa_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.detail_penyewaan'::regclass AND conname='detail_penyewaan_promosi_paket_id_fkey') THEN
    ALTER TABLE public.detail_penyewaan ADD CONSTRAINT detail_penyewaan_promosi_paket_id_fkey
      FOREIGN KEY (promosi_paket_id) REFERENCES public.promosi_paket_sewa(promosi_paket_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.detail_penyewaan'::regclass AND conname='detail_penyewaan_promo_requires_tariff_check') THEN
    ALTER TABLE public.detail_penyewaan ADD CONSTRAINT detail_penyewaan_promo_requires_tariff_check
      CHECK (promosi_paket_id IS NULL OR (tarif_sewa_id IS NOT NULL AND paket_sewa_id IS NOT NULL));
  END IF;
END;
$migration$;

CREATE INDEX IF NOT EXISTS detail_reservasi_promosi_paket_idx
  ON public.detail_reservasi (usaha_id, promosi_paket_id) WHERE promosi_paket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS detail_penyewaan_promosi_paket_idx
  ON public.detail_penyewaan (usaha_id, promosi_paket_id) WHERE promosi_paket_id IS NOT NULL;

CREATE OR REPLACE FUNCTION app_private.resolve_package_promo_price(
  p_usaha_id uuid, p_paket_sewa_id uuid, p_tarif_sewa_id uuid, p_as_of timestamptz DEFAULT now()
)
RETURNS TABLE (
  tarif_sewa_id uuid, harga_normal numeric(14,2), harga_efektif numeric(14,2), promosi_paket_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_at timestamptz := coalesce(p_as_of, now());
BEGIN
  IF p_usaha_id IS NULL OR p_paket_sewa_id IS NULL OR p_tarif_sewa_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tenant, package, dan tariff wajib diisi' USING ERRCODE='22023';
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
    WHERE p.usaha_id=t.usaha_id AND p.tarif_sewa_id=t.tarif_sewa_id
      AND p.paket_sewa_id=t.paket_sewa_id AND p.status='active'
      AND p.started_at <= v_at AND p.ended_at IS NULL
      AND p.harga_promo < t.nominal
    ORDER BY p.started_at DESC, p.created_at DESC
    LIMIT 1
  ) pp ON true
  WHERE t.usaha_id=p_usaha_id AND t.paket_sewa_id=p_paket_sewa_id
    AND t.tarif_sewa_id=p_tarif_sewa_id;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.resolve_package_promo_price(uuid,uuid,uuid,timestamp with time zone)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.command_set_paket_promo(
  p_usaha_id uuid, p_paket_sewa_id uuid, p_tarif_sewa_id uuid, p_enabled boolean,
  p_harga_promo numeric DEFAULT NULL, p_expected_updated_at timestamptz DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL, p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.catalog_require_admin(p_usaha_id);
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

REVOKE ALL ON FUNCTION app_private.command_set_paket_promo(uuid,uuid,uuid,boolean,numeric,timestamp with time zone,text,uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_set_paket_promo(uuid,uuid,uuid,boolean,numeric,timestamp with time zone,text,uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.command_set_paket_promo(
  p_usaha_id uuid,p_paket_sewa_id uuid,p_tarif_sewa_id uuid,p_enabled boolean,
  p_harga_promo numeric DEFAULT NULL,p_expected_updated_at timestamptz DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$
  SELECT app_private.command_set_paket_promo(
    p_usaha_id,p_paket_sewa_id,p_tarif_sewa_id,p_enabled,
    p_harga_promo,p_expected_updated_at,p_idempotency_key,p_request_id
  );
$function$;

REVOKE ALL ON FUNCTION public.command_set_paket_promo(uuid,uuid,uuid,boolean,numeric,timestamp with time zone,text,uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_set_paket_promo(uuid,uuid,uuid,boolean,numeric,timestamp with time zone,text,uuid)
  TO authenticated;

CREATE OR REPLACE VIEW public.v_public_paket_promo
WITH (security_invoker = true)
AS
SELECT p.usaha_id,p.paket_sewa_id,p.tarif_sewa_id,p.promosi_paket_id,
       t.nominal AS harga_normal,p.harga_promo,t.currency_code,p.started_at
FROM public.promosi_paket_sewa p
JOIN public.v_public_tarif_sewa t
  ON t.usaha_id=p.usaha_id AND t.tarif_sewa_id=p.tarif_sewa_id AND t.paket_sewa_id=p.paket_sewa_id
WHERE p.harga_promo < t.nominal;

GRANT SELECT ON public.v_public_paket_promo TO anon, authenticated;

COMMENT ON TABLE public.promosi_paket_sewa IS
  'History of package tariff promotions. Regular tarif_sewa.nominal is never overwritten.';
COMMENT ON VIEW public.v_public_paket_promo IS
  'Security-invoker read model joined to the public tariff view; the promo table exposes only approved columns under public-row RLS.';
COMMENT ON FUNCTION app_private.can_read_public_package_promo(uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone) IS
  'Security-definer RLS predicate that exposes only currently active promotions for public catalog packages.';
COMMENT ON FUNCTION app_private.resolve_package_promo_price(uuid,uuid,uuid,timestamp with time zone) IS
  'Resolves the normal/effective price for a package tariff under a per-tariff advisory lock.';


-- Existing direct rental command: same validation, stock, finance, audit and idempotency flow.
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

    IF v_unit_price IS DISTINCT FROM round(v_effective_nominal, 2) THEN
      RAISE EXCEPTION
        'BUSINESS_CONFLICT: harga tarif berubah; expected=%, received=%',
        round(v_effective_nominal, 2), v_unit_price
        USING ERRCODE = '23514';
    END IF;

    v_expected_subtotal := round(v_qty * v_effective_nominal * v_duration_periods, 2);

    IF v_subtotal IS DISTINCT FROM v_expected_subtotal THEN
      RAISE EXCEPTION
        'VALIDATION_ERROR: subtotal tidak sesuai durasi tarif; expected=%, received=%',
        v_expected_subtotal, v_subtotal
        USING ERRCODE = '22023';
    END IF;

    v_unit_price := round(v_effective_nominal, 2);
    v_subtotal := v_expected_subtotal;

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

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
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
      tarif_sewa_id, promosi_paket_id
    )
    VALUES (
      v_detail_id, p_usaha_id, v_rental_id,
      v_barang_id, v_varian_id, v_paket_id,
      v_qty, v_unit_price, v_line_currency, v_subtotal,
      nullif(btrim(coalesce(v_line->>'catatan', '')), ''),
      v_tariff_id, v_promosi_paket_id
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

-- Website booking now snapshots the effective package price when the reservation is created.
CREATE OR REPLACE FUNCTION app_private.command_create_website_booking(p_slug text, p_booking jsonb, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_usaha public.usaha%ROWTYPE;
  v_key text;
  v_hash text;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;

  v_nama text;
  v_phone_norm text;
  v_catatan text;
  v_mulai date;
  v_selesai date;
  v_lines jsonb;
  v_line jsonb;

  v_penyewa_id uuid;
  v_number bigint;
  v_permintaan_id uuid;
  v_permintaan_no text;
  v_reservasi_no text;
  v_reservasi_id uuid;

  v_barang_id uuid;
  v_varian_barang_id uuid;
  v_paket_sewa_id uuid;
  v_jumlah numeric;
  v_valid boolean;
  v_tarif record;
  v_unit_price numeric;
  v_promosi_paket_id uuid;
  v_subtotal_sum numeric := 0;
  v_target_label text;
  v_token text;
  v_note text;
  v_response jsonb;
BEGIN
  -- tenant disetel server-side dari slug, bukan dari client
  SELECT * INTO v_usaha
  FROM public.usaha
  WHERE slug = btrim(coalesce(p_slug, ''))
    AND status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha tidak ditemukan atau tidak aktif' USING ERRCODE = 'P0002';
  END IF;

  v_key := btrim(coalesce(p_idempotency_key, ''));
  IF v_key = '' OR length(v_key) > 100 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi (maks 100 karakter)' USING ERRCODE = '22023';
  END IF;

  v_hash := md5(jsonb_build_object('slug', p_slug, 'booking', p_booking)::text);

  INSERT INTO public.idempotency_key (
    usaha_id, actor_auth_user_id, key, command_name, request_hash
  )
  VALUES (
    v_usaha.usaha_id, NULL, v_key, 'create_website_booking', v_hash
  )
  ON CONFLICT (usaha_id, command_name, key) WHERE actor_auth_user_id IS NULL
  DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.request_hash, ik.response_body
    INTO v_existing_hash, v_existing_response
    FROM public.idempotency_key ik
    WHERE ik.usaha_id = v_usaha.usaha_id
      AND ik.actor_auth_user_id IS NULL
      AND ik.command_name = 'create_website_booking'
      AND ik.key = v_key;

    IF v_existing_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE = '23505';
    END IF;

    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;

    RAISE EXCEPTION 'UNKNOWN_OUTCOME: idempotency record exists without response' USING ERRCODE = '40001';
  END IF;

  -- ---- validasi payload ----------------------------------------------------
  IF jsonb_typeof(p_booking) <> 'object' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: booking harus berupa objek' USING ERRCODE = '22023';
  END IF;

  v_nama := btrim(coalesce(p_booking->>'nama', ''));
  IF length(v_nama) < 2 OR length(v_nama) > 120 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: nama wajib diisi (2-120 karakter)' USING ERRCODE = '22023';
  END IF;

  v_phone_norm := regexp_replace(coalesce(p_booking->>'telepon', ''), '[^0-9]', '', 'g');
  IF length(v_phone_norm) < 8 OR length(v_phone_norm) > 16 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: nomor telepon tidak valid' USING ERRCODE = '22023';
  END IF;

  v_catatan := btrim(coalesce(p_booking->>'catatan', ''));
  IF length(v_catatan) > 500 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: catatan maksimum 500 karakter' USING ERRCODE = '22023';
  END IF;

  v_note := nullif(v_catatan, '');

  v_mulai := (p_booking->>'mulai_rencana')::date;
  v_selesai := (p_booking->>'selesai_rencana')::date;
  IF v_mulai IS NULL OR v_selesai IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: periode sewa wajib diisi' USING ERRCODE = '22023';
  END IF;
  IF v_mulai < current_date THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tanggal mulai tidak boleh di masa lalu' USING ERRCODE = '22023';
  END IF;
  IF v_selesai < v_mulai THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tanggal selesai tidak boleh sebelum tanggal mulai' USING ERRCODE = '22023';
  END IF;

  v_lines := p_booking->'lines';
  IF jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 OR jsonb_array_length(v_lines) > 10 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: booking harus memiliki 1-10 item sewa' USING ERRCODE = '22023';
  END IF;

  -- penyewa upsert tenant-scoped tanpa data sensitif
  SELECT penyewa_id INTO v_penyewa_id
  FROM public.penyewa
  WHERE usaha_id = v_usaha.usaha_id
    AND nomor_telepon_normalized = v_phone_norm
  ORDER BY created_at
  LIMIT 1;

  IF v_penyewa_id IS NULL THEN
    INSERT INTO public.penyewa (
      usaha_id, nama_lengkap, nomor_telepon, nomor_telepon_normalized, status
    )
    VALUES (
      v_usaha.usaha_id, v_nama, p_booking->>'telepon', v_phone_norm, 'active'
    )
    RETURNING penyewa_id INTO v_penyewa_id;
  END IF;

  -- staging harga (snapshot server-side) untuk detail_reservasi setelah header dibuat
  CREATE TEMP TABLE booking_lines_stage ON COMMIT DROP AS
    SELECT NULL::uuid AS barang_id, NULL::uuid AS varian_barang_id, NULL::uuid AS paket_sewa_id,
           NULL::numeric AS jumlah, NULL::numeric AS unit_price, NULL::numeric AS subtotal,
           NULL::uuid AS tarif_sewa_id, NULL::uuid AS promosi_paket_id,
           'IDR'::text AS currency_code
    WHERE false;

  -- ---- permintaan sewa -----------------------------------------------------
  SELECT app_private.next_business_number(v_usaha.usaha_id, 'REQ', to_char(current_date, 'YYYY'))
  INTO v_number;

  v_permintaan_no := 'REQ-' || to_char(current_date, 'YYYY') || '-' || lpad(v_number::text, 3, '0');

  INSERT INTO public.permintaan_sewa (
    usaha_id, penyewa_id, nomor_permintaan, sumber,
    mulai_rencana, selesai_rencana, status, catatan, submitted_at
  )
  VALUES (
    v_usaha.usaha_id, v_penyewa_id, v_permintaan_no, 'website',
    v_mulai, v_selesai, 'submitted', v_note, now()
  )
  RETURNING permintaan_sewa_id INTO v_permintaan_id;

  -- ---- detail permintaan + validasi target + snapshot harga ----------------
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines)
  LOOP
    v_barang_id := (v_line->>'barang_id')::uuid;
    v_varian_barang_id := (v_line->>'varian_barang_id')::uuid;
    v_paket_sewa_id := (v_line->>'paket_sewa_id')::uuid;

    IF num_nonnulls(v_barang_id, v_varian_barang_id, v_paket_sewa_id) <> 1 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: setiap item harus tepat satu target katalog' USING ERRCODE = '22023';
    END IF;

    IF (v_line->>'jumlah') IS NULL OR (v_line->>'jumlah') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: jumlah harus berupa angka bulat positif' USING ERRCODE = '22023';
    END IF;
    v_jumlah := (v_line->>'jumlah')::numeric;
    IF v_jumlah < 1 OR v_jumlah > 20 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: jumlah per item adalah 1-20' USING ERRCODE = '22023';
    END IF;

    -- target harus milik usaha ini, publik, dan aktif
    v_valid := NULL;
    IF v_barang_id IS NOT NULL THEN
      SELECT true INTO v_valid FROM public.barang b
      WHERE b.usaha_id = v_usaha.usaha_id AND b.barang_id = v_barang_id
        AND b.is_public = true AND b.status = 'active';
    ELSIF v_varian_barang_id IS NOT NULL THEN
      SELECT true INTO v_valid
      FROM public.varian_barang vb
      JOIN public.barang b2 ON b2.barang_id = vb.barang_id
      WHERE vb.usaha_id = v_usaha.usaha_id AND vb.varian_barang_id = v_varian_barang_id
        AND b2.is_public = true AND b2.status = 'active' AND vb.status = 'active';
    ELSE
      SELECT true INTO v_valid FROM public.paket_sewa ps
      WHERE ps.usaha_id = v_usaha.usaha_id AND ps.paket_sewa_id = v_paket_sewa_id
        AND ps.is_public = true AND ps.status = 'active';
    END IF;

    IF NOT COALESCE(v_valid, false) THEN
      RAISE EXCEPTION 'NOT_FOUND: salah satu item booking tidak tersedia' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.detail_permintaan (
      usaha_id, permintaan_sewa_id, barang_id, varian_barang_id, paket_sewa_id, jumlah
    )
    VALUES (
      v_usaha.usaha_id, v_permintaan_id, v_barang_id, v_varian_barang_id, v_paket_sewa_id, v_jumlah
    );

    -- snapshot harga dari tarif aktif (server-side authority)
    SELECT * INTO v_tarif
    FROM public.tarif_sewa t
    WHERE t.usaha_id = v_usaha.usaha_id
      AND t.status = 'active'
      AND t.berlaku_mulai <= now()
      AND (t.berlaku_sampai IS NULL OR t.berlaku_sampai > now())
      AND (
        (t.barang_id = v_barang_id)
        OR (t.varian_barang_id = v_varian_barang_id)
        OR (t.paket_sewa_id = v_paket_sewa_id)
      )
    ORDER BY t.durasi_nilai ASC, t.nominal ASC
    LIMIT 1;

    IF NOT FOUND THEN
      SELECT coalesce(
        (SELECT nama FROM public.barang WHERE barang_id = v_barang_id),
        (SELECT nama FROM public.varian_barang WHERE varian_barang_id = v_varian_barang_id),
        (SELECT nama FROM public.paket_sewa WHERE paket_sewa_id = v_paket_sewa_id)
      ) INTO v_target_label;
      RAISE EXCEPTION 'BUSINESS_CONFLICT: tarif aktif belum tersedia untuk %', v_target_label USING ERRCODE = '23514';
    END IF;

    v_unit_price := v_tarif.nominal;
    v_promosi_paket_id := NULL;
    IF v_paket_sewa_id IS NOT NULL THEN
      SELECT rp.harga_efektif, rp.promosi_paket_id
        INTO v_unit_price, v_promosi_paket_id
      FROM app_private.resolve_package_promo_price(
        v_usaha.usaha_id, v_paket_sewa_id, v_tarif.tarif_sewa_id, now()
      ) rp;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: harga paket tidak dapat diselesaikan' USING ERRCODE = '23514';
      END IF;
    END IF;

    INSERT INTO pg_temp.booking_lines_stage (
      barang_id, varian_barang_id, paket_sewa_id, jumlah, unit_price, subtotal,
      tarif_sewa_id, promosi_paket_id, currency_code
    )
    VALUES (
      v_barang_id, v_varian_barang_id, v_paket_sewa_id, v_jumlah,
      v_unit_price, round(v_jumlah * v_unit_price, 2),
      v_tarif.tarif_sewa_id, v_promosi_paket_id, 'IDR'
    );

    v_subtotal_sum := v_subtotal_sum + round(v_jumlah * v_unit_price, 2);
  END LOOP;

  -- ---- reservasi draft (permintaan tidak mengunci stok) --------------------
  SELECT app_private.next_business_number(v_usaha.usaha_id, 'RSV', to_char(current_date, 'YYYY'))
  INTO v_number;

  v_reservasi_no := 'RSV-' || to_char(current_date, 'YYYY') || '-' || lpad(v_number::text, 3, '0');

  INSERT INTO public.reservasi (
    usaha_id, permintaan_sewa_id, penyewa_id, nomor_reservasi,
    mulai_reservasi, selesai_reservasi, status, stock_lock_status, catatan
  )
  VALUES (
    v_usaha.usaha_id, v_permintaan_id, v_penyewa_id, v_reservasi_no,
    v_mulai, v_selesai, 'draft', 'not_locked', v_note
  )
  RETURNING reservasi_id INTO v_reservasi_id;

  INSERT INTO public.detail_reservasi (
    usaha_id, reservasi_id, barang_id, varian_barang_id, paket_sewa_id,
    jumlah, unit_price, currency_code, subtotal, tarif_sewa_id, promosi_paket_id
  )
  SELECT
    v_usaha.usaha_id, v_reservasi_id, barang_id, varian_barang_id, paket_sewa_id,
    jumlah, unit_price, currency_code, subtotal, tarif_sewa_id, promosi_paket_id
  FROM pg_temp.booking_lines_stage;

  -- request dikonversi oleh website (self-conversion, tanpa aktor admin)
  UPDATE public.permintaan_sewa
  SET status = 'converted', processed_at = now(), processed_by_admin_id = NULL
  WHERE usaha_id = v_usaha.usaha_id AND permintaan_sewa_id = v_permintaan_id;

  -- audit tanpa aktor admin; kamera: aplikasi publik
  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, change_summary
  )
  VALUES
    (v_usaha.usaha_id, NULL, NULL, 'create', 'permintaan_sewa', v_permintaan_id,
     'website-booking',
     jsonb_build_object('nomor_permintaan', v_permintaan_no, 'sumber', 'website', 'status', 'converted')),
    (v_usaha.usaha_id, NULL, NULL, 'create', 'reservasi', v_reservasi_id,
     'website-booking',
     jsonb_build_object('nomor_reservasi', v_reservasi_no, 'status', 'draft', 'stock_lock_status', 'not_locked'));

  INSERT INTO public.outbox_event (
    usaha_id, event_type, aggregate_type, aggregate_id, payload
  )
  VALUES
    (v_usaha.usaha_id, 'request.converted', 'permintaan_sewa', v_permintaan_id,
     jsonb_build_object('request_id', v_permintaan_id, 'reservasi_id', v_reservasi_id, 'source', 'website')),
    (v_usaha.usaha_id, 'reservation.created', 'reservasi', v_reservasi_id,
     jsonb_build_object('reservasi_id', v_reservasi_id, 'nomor_reservasi', v_reservasi_no, 'status', 'draft'));

  -- token QR dibuat trigger trg_buat_qr_reservasi
  SELECT token_qr INTO v_token
  FROM public.qr_reservasi
  WHERE usaha_id = v_usaha.usaha_id AND reservasi_id = v_reservasi_id;

  v_response := jsonb_build_object(
    'usaha_id', v_usaha.usaha_id,
    'permintaan_sewa_id', v_permintaan_id,
    'nomor_permintaan', v_permintaan_no,
    'reservasi_id', v_reservasi_id,
    'nomor_reservasi', v_reservasi_no,
    'status', 'draft',
    'stock_lock_status', 'not_locked',
    'token_qr', v_token,
    'total_harga', v_subtotal_sum,
    'currency_code', 'IDR'
  );

  UPDATE public.idempotency_key
  SET response_status = 200, response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$
;

-- Request conversion accepts optional server-issued tariff/promotion references.
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
        AND pp.status = 'active' AND pp.started_at <= now() AND pp.ended_at IS NULL
        AND t.status = 'active' AND t.berlaku_mulai <= now()
        AND (t.berlaku_sampai IS NULL OR t.berlaku_sampai > now())
        AND pp.harga_promo < t.nominal
    ) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: harga paket promo aktif wajib menggunakan referensi promo dan harga efektif dari server' USING ERRCODE = '23514';
    END IF;

    IF v_tarif_sewa_id IS NOT NULL AND v_promosi_paket_id IS NULL AND NOT EXISTS (
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
      tarif_sewa_id, promosi_paket_id
    )
    VALUES (
      p_usaha_id, v_reservation.reservasi_id, v_detail.barang_id, v_detail.varian_barang_id, v_detail.paket_sewa_id,
      v_detail.jumlah, v_unit_price, v_currency_code, v_subtotal,
      coalesce(v_detail_catatan, v_detail.catatan), v_tarif_sewa_id, v_promosi_paket_id
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

-- Reservation to rental carries the captured tariff and promotion references.
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
  v_total_amount numeric(14,2);
  v_currency text;
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

  SELECT count(DISTINCT d.currency_code), min(d.currency_code)
  INTO v_currency, v_currency
  FROM public.detail_reservasi d
  WHERE d.usaha_id = p_usaha_id
    AND d.reservasi_id = p_reservasi_id;

  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: reservasi belum memiliki detail' USING ERRCODE = '22023';
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

  SELECT coalesce(sum(d.subtotal), 0)
  INTO v_total_amount
  FROM public.detail_reservasi d
  WHERE d.usaha_id = p_usaha_id
    AND d.reservasi_id = p_reservasi_id;

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
      promosi_paket_id
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
      v_detail.subtotal,
      v_detail.catatan,
      v_detail.tarif_sewa_id,
      v_detail.promosi_paket_id
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

-- The existing trigger remains attached; only its current validator implementation is extended.
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

    SELECT t.durasi_unit, t.durasi_nilai, pp.harga_promo
      INTO v_duration_unit, v_duration_value, v_tariff_nominal
    FROM public.promosi_paket_sewa pp
    JOIN public.tarif_sewa t
      ON t.tarif_sewa_id = pp.tarif_sewa_id
     AND t.usaha_id = pp.usaha_id
    WHERE pp.usaha_id = NEW.usaha_id
      AND pp.promosi_paket_id = NEW.promosi_paket_id
      AND pp.tarif_sewa_id = NEW.tarif_sewa_id
      AND pp.paket_sewa_id = NEW.paket_sewa_id
      AND t.paket_sewa_id = NEW.paket_sewa_id
      AND t.berlaku_mulai <= v_jadwal_mulai
      AND (t.berlaku_sampai IS NULL OR t.berlaku_sampai > v_jadwal_mulai)
    LIMIT 1;

  ELSIF NEW.tarif_sewa_id IS NOT NULL THEN
    SELECT t.durasi_unit, t.durasi_nilai, t.nominal
      INTO v_duration_unit, v_duration_value, v_tariff_nominal
    FROM public.tarif_sewa t
    WHERE t.usaha_id = NEW.usaha_id
      AND t.tarif_sewa_id = NEW.tarif_sewa_id
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
