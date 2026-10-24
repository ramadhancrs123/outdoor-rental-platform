-- Wave 1 table ACL hardening.
-- Investor tables are read-only for authenticated clients. All mutations go
-- through trusted command RPCs; RLS remains the tenant/investor boundary.

REVOKE ALL ON TABLE public.investor FROM authenticated;
REVOKE ALL ON TABLE public.investor_participation FROM authenticated;

GRANT SELECT ON TABLE public.investor TO authenticated;
GRANT SELECT ON TABLE public.investor_participation TO authenticated;
