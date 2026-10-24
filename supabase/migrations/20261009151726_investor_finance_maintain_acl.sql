-- Remove PostgreSQL MAINTAIN from client roles on finance account ledgers.
-- Existing authenticated SELECT access remains available for authorized screens.
REVOKE MAINTAIN ON TABLE public.akun_keuangan FROM anon, authenticated;
REVOKE MAINTAIN ON TABLE public.pergerakan_akun_keuangan FROM anon, authenticated;
