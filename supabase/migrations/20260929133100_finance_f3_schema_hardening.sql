-- Finance F3 canonical post-function schema hardening.
CREATE UNIQUE INDEX IF NOT EXISTS keuangan_koreksi_target_unik ON public.keuangan_koreksi (usaha_id,target_type,target_id);
CREATE INDEX IF NOT EXISTS keuangan_koreksi_usaha_effective_idx ON public.keuangan_koreksi (usaha_id,effective_at DESC);
ALTER TABLE public.keuangan_koreksi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS finance_correction_select_member ON public.keuangan_koreksi;
CREATE POLICY finance_correction_select_member ON public.keuangan_koreksi FOR SELECT TO authenticated USING (app_private.has_usaha_access(usaha_id));
REVOKE ALL ON TABLE public.keuangan_koreksi FROM anon, authenticated;
GRANT SELECT ON TABLE public.keuangan_koreksi TO authenticated;
DROP TRIGGER IF EXISTS trg_expense_validate_transition ON public.pengeluaran;
CREATE TRIGGER trg_expense_validate_transition BEFORE UPDATE ON public.pengeluaran FOR EACH ROW EXECUTE FUNCTION app_private.validate_expense_transition();
