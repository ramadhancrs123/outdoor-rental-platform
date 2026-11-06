-- Cover the retail foreign-key lookup paths with tenant-aware indexes.
CREATE INDEX IF NOT EXISTS checkout_rental_fk_idx
  ON public.checkout (usaha_id, penyewaan_id)
  WHERE penyewaan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS checkout_actor_fk_idx
  ON public.checkout (created_by_admin_id);

CREATE INDEX IF NOT EXISTS detail_penjualan_unit_sale_fk_idx
  ON public.detail_penjualan_unit (usaha_id, penjualan_id);

CREATE INDEX IF NOT EXISTS penjualan_actor_fk_idx
  ON public.penjualan (created_by_admin_id);

CREATE INDEX IF NOT EXISTS penjualan_pembayaran_account_fk_idx
  ON public.penjualan_pembayaran (usaha_id, akun_keuangan_id);
CREATE INDEX IF NOT EXISTS penjualan_pembayaran_actor_fk_idx
  ON public.penjualan_pembayaran (dicatat_by_admin_id);
CREATE INDEX IF NOT EXISTS penjualan_pembayaran_transaction_fk_idx
  ON public.penjualan_pembayaran (transaksi_keuangan_id);

CREATE INDEX IF NOT EXISTS pergerakan_stok_actor_fk_idx
  ON public.pergerakan_stok (actor_akun_admin_id);
CREATE INDEX IF NOT EXISTS pergerakan_stok_stock_fk_idx
  ON public.pergerakan_stok (stok_barang_id);
