-- Cover the receipt actor foreign key for lookups and safe administrator deactivation checks.
CREATE INDEX IF NOT EXISTS penerimaan_pembelian_actor_idx
  ON public.penerimaan_pembelian(received_by_admin_id);
