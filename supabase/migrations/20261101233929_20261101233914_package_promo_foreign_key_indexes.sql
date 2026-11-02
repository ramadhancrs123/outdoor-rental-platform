-- Cover the newly introduced foreign-key lookups without changing existing data.
CREATE INDEX IF NOT EXISTS promosi_paket_sewa_package_fk_idx
  ON public.promosi_paket_sewa (paket_sewa_id);
CREATE INDEX IF NOT EXISTS promosi_paket_sewa_tariff_fk_idx
  ON public.promosi_paket_sewa (tarif_sewa_id);
CREATE INDEX IF NOT EXISTS promosi_paket_sewa_created_auth_fk_idx
  ON public.promosi_paket_sewa (created_by_auth_user_id)
  WHERE created_by_auth_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS promosi_paket_sewa_created_admin_fk_idx
  ON public.promosi_paket_sewa (created_by_akun_admin_id)
  WHERE created_by_akun_admin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS promosi_paket_sewa_ended_auth_fk_idx
  ON public.promosi_paket_sewa (ended_by_auth_user_id)
  WHERE ended_by_auth_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS promosi_paket_sewa_ended_admin_fk_idx
  ON public.promosi_paket_sewa (ended_by_akun_admin_id)
  WHERE ended_by_akun_admin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS detail_reservasi_promosi_fk_idx
  ON public.detail_reservasi (promosi_paket_id)
  WHERE promosi_paket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS detail_penyewaan_promosi_fk_idx
  ON public.detail_penyewaan (promosi_paket_id)
  WHERE promosi_paket_id IS NOT NULL;
