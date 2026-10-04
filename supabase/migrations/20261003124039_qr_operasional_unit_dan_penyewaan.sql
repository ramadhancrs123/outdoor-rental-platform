-- QR Operasional: identity QR untuk Unit Inventaris dan Penyewaan.
-- Tidak menyimpan data sensitif di dalam QR; token hanya locator acak.
-- Frontend belum diubah dalam migration ini.

CREATE TABLE IF NOT EXISTS public.qr_unit (
  qr_unit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  unit_barang_id uuid NOT NULL,
  token_qr text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  status_qr text NOT NULL DEFAULT 'aktif',
  dibuat_at timestamptz NOT NULL DEFAULT now(),
  diperbarui_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qr_unit_status_qr_check CHECK (status_qr IN ('aktif', 'dicabut')),
  CONSTRAINT qr_unit_usaha_unit_unik UNIQUE (usaha_id, unit_barang_id),
  CONSTRAINT qr_unit_token_unik UNIQUE (token_qr),
  CONSTRAINT qr_unit_usaha_fk
    FOREIGN KEY (usaha_id) REFERENCES public.usaha(usaha_id),
  CONSTRAINT qr_unit_unit_tenant_fk
    FOREIGN KEY (usaha_id, unit_barang_id)
    REFERENCES public.unit_barang(usaha_id, unit_barang_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_qr_unit_token_qr
  ON public.qr_unit(token_qr);

CREATE INDEX IF NOT EXISTS idx_qr_unit_unit_barang
  ON public.qr_unit(usaha_id, unit_barang_id);

CREATE TABLE IF NOT EXISTS public.qr_penyewaan (
  qr_penyewaan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  penyewaan_id uuid NOT NULL,
  token_qr text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  status_qr text NOT NULL DEFAULT 'aktif',
  dibuat_at timestamptz NOT NULL DEFAULT now(),
  diperbarui_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qr_penyewaan_status_qr_check CHECK (status_qr IN ('aktif', 'dicabut')),
  CONSTRAINT qr_penyewaan_usaha_rental_unik UNIQUE (usaha_id, penyewaan_id),
  CONSTRAINT qr_penyewaan_token_unik UNIQUE (token_qr),
  CONSTRAINT qr_penyewaan_usaha_fk
    FOREIGN KEY (usaha_id) REFERENCES public.usaha(usaha_id),
  CONSTRAINT qr_penyewaan_rental_tenant_fk
    FOREIGN KEY (usaha_id, penyewaan_id)
    REFERENCES public.penyewaan(usaha_id, penyewaan_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_qr_penyewaan_token_qr
  ON public.qr_penyewaan(token_qr);

CREATE INDEX IF NOT EXISTS idx_qr_penyewaan_penyewaan
  ON public.qr_penyewaan(usaha_id, penyewaan_id);

CREATE OR REPLACE FUNCTION app_private.buat_qr_unit_otomatis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.qr_unit (usaha_id, unit_barang_id)
  VALUES (NEW.usaha_id, NEW.unit_barang_id)
  ON CONFLICT (usaha_id, unit_barang_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.buat_qr_penyewaan_otomatis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.qr_penyewaan (usaha_id, penyewaan_id)
  VALUES (NEW.usaha_id, NEW.penyewaan_id)
  ON CONFLICT (usaha_id, penyewaan_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_unit_barang_buat_qr_otomatis ON public.unit_barang;
CREATE TRIGGER trg_unit_barang_buat_qr_otomatis
AFTER INSERT ON public.unit_barang
FOR EACH ROW
EXECUTE FUNCTION app_private.buat_qr_unit_otomatis();

DROP TRIGGER IF EXISTS trg_penyewaan_buat_qr_otomatis ON public.penyewaan;
CREATE TRIGGER trg_penyewaan_buat_qr_otomatis
AFTER INSERT ON public.penyewaan
FOR EACH ROW
EXECUTE FUNCTION app_private.buat_qr_penyewaan_otomatis();

-- Backfill identity QR untuk seluruh data existing.
INSERT INTO public.qr_unit (usaha_id, unit_barang_id)
SELECT ub.usaha_id, ub.unit_barang_id
FROM public.unit_barang ub
LEFT JOIN public.qr_unit q
  ON q.usaha_id = ub.usaha_id
 AND q.unit_barang_id = ub.unit_barang_id
WHERE q.qr_unit_id IS NULL
ON CONFLICT (usaha_id, unit_barang_id) DO NOTHING;

INSERT INTO public.qr_penyewaan (usaha_id, penyewaan_id)
SELECT p.usaha_id, p.penyewaan_id
FROM public.penyewaan p
LEFT JOIN public.qr_penyewaan q
  ON q.usaha_id = p.usaha_id
 AND q.penyewaan_id = p.penyewaan_id
WHERE q.qr_penyewaan_id IS NULL
ON CONFLICT (usaha_id, penyewaan_id) DO NOTHING;

CREATE OR REPLACE FUNCTION app_private.resolve_qr_unit(
  p_token_qr text
)
RETURNS TABLE (
  usaha_id uuid,
  unit_barang_id uuid,
  kode_unit text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required'
      USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  SELECT
    q.usaha_id,
    q.unit_barang_id,
    ub.kode_unit
  FROM public.qr_unit q
  JOIN public.unit_barang ub
    ON ub.usaha_id = q.usaha_id
   AND ub.unit_barang_id = q.unit_barang_id
  JOIN public.akun_admin aa
    ON aa.auth_user_id = v_auth_user_id
   AND aa.status = 'active'
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id = aa.akun_admin_id
   AND ku.usaha_id = q.usaha_id
   AND ku.status = 'active'
   AND ku.revoked_at IS NULL
  WHERE q.token_qr = btrim(p_token_qr)
    AND q.status_qr = 'aktif';
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.resolve_qr_penyewaan(
  p_token_qr text
)
RETURNS TABLE (
  usaha_id uuid,
  penyewaan_id uuid,
  nomor_penyewaan text,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required'
      USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  SELECT
    q.usaha_id,
    q.penyewaan_id,
    p.nomor_penyewaan,
    p.status
  FROM public.qr_penyewaan q
  JOIN public.penyewaan p
    ON p.usaha_id = q.usaha_id
   AND p.penyewaan_id = q.penyewaan_id
  JOIN public.akun_admin aa
    ON aa.auth_user_id = v_auth_user_id
   AND aa.status = 'active'
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id = aa.akun_admin_id
   AND ku.usaha_id = q.usaha_id
   AND ku.status = 'active'
   AND ku.revoked_at IS NULL
  WHERE q.token_qr = btrim(p_token_qr)
    AND q.status_qr = 'aktif';
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_qr_unit(
  p_token_qr text
)
RETURNS TABLE (
  usaha_id uuid,
  unit_barang_id uuid,
  kode_unit text
)
LANGUAGE sql
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT * FROM app_private.resolve_qr_unit($1);
$function$;

CREATE OR REPLACE FUNCTION public.resolve_qr_penyewaan(
  p_token_qr text
)
RETURNS TABLE (
  usaha_id uuid,
  penyewaan_id uuid,
  nomor_penyewaan text,
  status text
)
LANGUAGE sql
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT * FROM app_private.resolve_qr_penyewaan($1);
$function$;

REVOKE ALL ON TABLE public.qr_unit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.qr_penyewaan FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.resolve_qr_unit(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_qr_penyewaan(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.resolve_qr_unit(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_qr_penyewaan(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
