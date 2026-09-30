-- Remove redundant indexes that were created by the initial local draft
-- while equivalent canonical indexes already exist in the baseline schema.
DROP INDEX IF EXISTS public.penyewaan_reservasi_unique;
DROP INDEX IF EXISTS public.serah_terima_penyewaan_unique;
