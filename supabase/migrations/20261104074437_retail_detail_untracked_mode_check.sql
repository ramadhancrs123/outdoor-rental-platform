-- Allow the sale-detail snapshot to persist the newly supported untracked inventory mode.
ALTER TABLE public.detail_penjualan DROP CONSTRAINT IF EXISTS detail_penjualan_inventory_mode_check;
ALTER TABLE public.detail_penjualan ADD CONSTRAINT detail_penjualan_inventory_mode_check
  CHECK (inventory_mode IN ('serialized','quantity','untracked'));
