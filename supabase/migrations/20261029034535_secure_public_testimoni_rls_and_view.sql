DROP FUNCTION IF EXISTS public.submit_public_testimoni(text, text, text, smallint, text);

DROP POLICY IF EXISTS testimoni_public_select ON public.testimoni;
CREATE POLICY testimoni_public_select
  ON public.testimoni FOR SELECT TO anon
  USING (
    status = 'published' AND published_at IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.usaha AS u
      WHERE u.usaha_id = testimoni.usaha_id AND u.status = 'active'
    )
  );

DROP POLICY IF EXISTS testimoni_public_insert_pending ON public.testimoni;
CREATE POLICY testimoni_public_insert_pending
  ON public.testimoni FOR INSERT TO anon
  WITH CHECK (
    status = 'pending' AND sumber = 'pengunjung'
    AND created_by_admin_id IS NULL
    AND verified_by_admin_id IS NULL AND verified_at IS NULL AND published_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.usaha AS u
      WHERE u.usaha_id = testimoni.usaha_id AND u.status = 'active'
    )
  );

REVOKE ALL ON public.testimoni FROM anon;
GRANT SELECT (testimoni_id, usaha_id, nama_tampilan, konteks, rating, isi, published_at, status)
  ON public.testimoni TO anon;
GRANT INSERT (usaha_id, nama_tampilan, konteks, rating, isi)
  ON public.testimoni TO anon;
GRANT SELECT (usaha_id, slug, status) ON public.usaha TO anon;

CREATE OR REPLACE VIEW public.v_public_testimoni
WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  t.testimoni_id, u.slug AS usaha_slug, t.nama_tampilan, t.konteks,
  t.rating, t.isi, t.published_at
FROM public.testimoni AS t
JOIN public.usaha AS u ON u.usaha_id = t.usaha_id
WHERE t.status = 'published'
  AND t.published_at IS NOT NULL
  AND u.status = 'active';

GRANT SELECT ON public.v_public_testimoni TO anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_testimoni_created_by_admin
  ON public.testimoni (created_by_admin_id) WHERE created_by_admin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_testimoni_verified_by_admin
  ON public.testimoni (verified_by_admin_id) WHERE verified_by_admin_id IS NOT NULL;
