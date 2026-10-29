CREATE TABLE IF NOT EXISTS public.testimoni (
  testimoni_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL REFERENCES public.usaha(usaha_id) ON DELETE CASCADE,
  nama_tampilan text NOT NULL,
  konteks text,
  rating smallint NOT NULL DEFAULT 5,
  isi text NOT NULL,
  sumber text NOT NULL DEFAULT 'pengunjung',
  status text NOT NULL DEFAULT 'pending',
  created_by_admin_id uuid REFERENCES public.akun_admin(akun_admin_id) ON DELETE SET NULL,
  verified_by_admin_id uuid REFERENCES public.akun_admin(akun_admin_id) ON DELETE SET NULL,
  verified_at timestamptz,
  published_at timestamptz,
  moderation_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT testimoni_nama_tampilan_length CHECK (char_length(btrim(nama_tampilan)) BETWEEN 2 AND 80),
  CONSTRAINT testimoni_konteks_length CHECK (konteks IS NULL OR char_length(btrim(konteks)) <= 120),
  CONSTRAINT testimoni_rating_range CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT testimoni_isi_length CHECK (char_length(btrim(isi)) BETWEEN 12 AND 1200),
  CONSTRAINT testimoni_sumber_allowed CHECK (sumber IN ('pengunjung', 'admin')),
  CONSTRAINT testimoni_status_allowed CHECK (status IN ('draft', 'pending', 'published', 'rejected', 'archived')),
  CONSTRAINT testimoni_published_verified CHECK (
    status <> 'published'
    OR (published_at IS NOT NULL AND verified_at IS NOT NULL AND verified_by_admin_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_testimoni_usaha_status_created
  ON public.testimoni (usaha_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_testimoni_publication
  ON public.testimoni (usaha_id, published_at DESC)
  WHERE status = 'published';

ALTER TABLE public.testimoni ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS testimoni_admin_select ON public.testimoni;
CREATE POLICY testimoni_admin_select
  ON public.testimoni FOR SELECT TO authenticated
  USING (
    app_private.has_usaha_access(usaha_id)
    AND EXISTS (
      SELECT 1 FROM public.akun_admin aa
      WHERE aa.auth_user_id = (SELECT auth.uid())
        AND aa.status = 'active' AND aa.role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS testimoni_admin_insert_draft ON public.testimoni;
CREATE POLICY testimoni_admin_insert_draft
  ON public.testimoni FOR INSERT TO authenticated
  WITH CHECK (
    app_private.has_usaha_access(usaha_id)
    AND sumber = 'admin' AND status = 'draft'
    AND created_by_admin_id = (
      SELECT aa.akun_admin_id FROM public.akun_admin aa
      WHERE aa.auth_user_id = (SELECT auth.uid())
        AND aa.status = 'active' AND aa.role = 'super_admin'
      LIMIT 1
    )
    AND verified_by_admin_id IS NULL AND verified_at IS NULL AND published_at IS NULL
  );

DROP POLICY IF EXISTS testimoni_admin_update ON public.testimoni;
CREATE POLICY testimoni_admin_update
  ON public.testimoni FOR UPDATE TO authenticated
  USING (
    app_private.has_usaha_access(usaha_id)
    AND EXISTS (
      SELECT 1 FROM public.akun_admin aa
      WHERE aa.auth_user_id = (SELECT auth.uid())
        AND aa.status = 'active' AND aa.role = 'super_admin'
    )
  )
  WITH CHECK (
    app_private.has_usaha_access(usaha_id)
    AND EXISTS (
      SELECT 1 FROM public.akun_admin aa
      WHERE aa.auth_user_id = (SELECT auth.uid())
        AND aa.status = 'active' AND aa.role = 'super_admin'
    )
    AND (
      status <> 'published'
      OR (
        verified_by_admin_id = (
          SELECT aa.akun_admin_id FROM public.akun_admin aa
          WHERE aa.auth_user_id = (SELECT auth.uid())
            AND aa.status = 'active' AND aa.role = 'super_admin'
          LIMIT 1
        )
        AND verified_at IS NOT NULL AND published_at IS NOT NULL
      )
    )
  );

DROP POLICY IF EXISTS testimoni_admin_delete ON public.testimoni;
CREATE POLICY testimoni_admin_delete
  ON public.testimoni FOR DELETE TO authenticated
  USING (
    app_private.has_usaha_access(usaha_id)
    AND EXISTS (
      SELECT 1 FROM public.akun_admin aa
      WHERE aa.auth_user_id = (SELECT auth.uid())
        AND aa.status = 'active' AND aa.role = 'super_admin'
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.testimoni TO authenticated;
REVOKE ALL ON public.testimoni FROM anon;

CREATE OR REPLACE FUNCTION public.guard_testimoni_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.usaha_id IS DISTINCT FROM OLD.usaha_id
       OR NEW.sumber IS DISTINCT FROM OLD.sumber
       OR NEW.created_by_admin_id IS DISTINCT FROM OLD.created_by_admin_id THEN
      RAISE EXCEPTION 'Tenant, source, and author identity cannot be changed after creation.'
        USING ERRCODE = '42501';
    END IF;
    NEW.updated_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_testimoni_integrity ON public.testimoni;
CREATE TRIGGER trg_guard_testimoni_integrity
  BEFORE UPDATE ON public.testimoni
  FOR EACH ROW EXECUTE FUNCTION public.guard_testimoni_integrity();

COMMENT ON TABLE public.testimoni IS
  'Public customer testimonial submissions. Public submissions start pending; only active super admins can moderate and publish them.';
COMMENT ON COLUMN public.testimoni.status IS
  'draft=persisted by admin but not submitted, pending=awaiting moderation, published=public, rejected=not public, archived=hidden.';
COMMENT ON COLUMN public.testimoni.sumber IS
  'Immutable origin of the testimonial: pengunjung or admin.';

CREATE OR REPLACE VIEW public.v_public_testimoni
WITH (security_barrier = true)
AS
SELECT
  t.testimoni_id, u.slug AS usaha_slug, t.nama_tampilan, t.konteks,
  t.rating, t.isi, t.published_at
FROM public.testimoni AS t
JOIN public.usaha AS u ON u.usaha_id = t.usaha_id
WHERE t.status = 'published'
  AND t.published_at IS NOT NULL
  AND u.status = 'active';

COMMENT ON VIEW public.v_public_testimoni IS
  'Public projection for published testimonials only.';
GRANT SELECT ON public.v_public_testimoni TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_public_testimoni(
  p_slug text, p_nama_tampilan text, p_konteks text, p_rating smallint, p_isi text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_usaha_id uuid;
  v_testimoni_id uuid;
  v_nama text;
  v_konteks text;
  v_isi text;
BEGIN
  v_nama := pg_catalog.btrim(COALESCE(p_nama_tampilan, ''));
  v_konteks := NULLIF(pg_catalog.btrim(COALESCE(p_konteks, '')), '');
  v_isi := pg_catalog.btrim(COALESCE(p_isi, ''));

  IF p_slug IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_slug)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Nama bisnis tidak valid.' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.char_length(v_nama) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'Nama tampilan harus terdiri dari 2 sampai 80 karakter.' USING ERRCODE = '22023';
  END IF;
  IF v_konteks IS NOT NULL AND pg_catalog.char_length(v_konteks) > 120 THEN
    RAISE EXCEPTION 'Konteks maksimal 120 karakter.' USING ERRCODE = '22023';
  END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'Rating harus berada pada rentang 1 sampai 5.' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.char_length(v_isi) NOT BETWEEN 12 AND 1200 THEN
    RAISE EXCEPTION 'Cerita harus terdiri dari 12 sampai 1200 karakter.' USING ERRCODE = '22023';
  END IF;

  SELECT u.usaha_id INTO v_usaha_id
  FROM public.usaha AS u
  WHERE u.slug = pg_catalog.lower(pg_catalog.btrim(p_slug))
    AND u.status = 'active'
  LIMIT 1;

  IF v_usaha_id IS NULL THEN
    RAISE EXCEPTION 'Bisnis tidak ditemukan atau sedang tidak aktif.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.testimoni (usaha_id, nama_tampilan, konteks, rating, isi, sumber, status)
  VALUES (v_usaha_id, v_nama, v_konteks, p_rating, v_isi, 'pengunjung', 'pending')
  RETURNING testimoni_id INTO v_testimoni_id;
  RETURN v_testimoni_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_public_testimoni(text, text, text, smallint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_public_testimoni(text, text, text, smallint, text) FROM anon;
REVOKE ALL ON FUNCTION public.submit_public_testimoni(text, text, text, smallint, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.submit_public_testimoni(text, text, text, smallint, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_testimoni_integrity() FROM PUBLIC;
