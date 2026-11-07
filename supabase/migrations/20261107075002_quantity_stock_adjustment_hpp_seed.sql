-- When a quantity-stock balance is opened through a stocktake adjustment,
-- carry forward the configured product/variant HPP if the balance has no
-- moving-average cost yet. This keeps quantity POS COGS complete without
-- changing serialized or untracked stock behavior.

DO $migration$
DECLARE
  v_definition text;
  v_fixed text;
  v_anchor text;
BEGIN
  v_definition := pg_get_functiondef(
    'app_private.command_adjust_sale_stock(uuid,uuid,uuid,integer,text,timestamptz,text,uuid)'::regprocedure
  );
  v_fixed := v_definition;
  v_anchor := $anchor$    UPDATE public.stok_barang
    SET jumlah=p_jumlah_baru,updated_at=now()
    WHERE stok_barang_id=v_stock.stok_barang_id
    RETURNING * INTO v_stock;$anchor$;

  IF position(v_anchor in v_fixed)=0 THEN
    RAISE EXCEPTION 'Quantity stock adjustment HPP seed anchor not found';
  END IF;

  v_fixed := replace(v_fixed,v_anchor,
    $anchor$    UPDATE public.stok_barang
    SET jumlah=p_jumlah_baru,
        average_unit_cost=CASE
          WHEN v_old=0 AND p_jumlah_baru>0 THEN
            coalesce(v_stock.average_unit_cost,v_variant.harga_beli,v_product.harga_beli)
          ELSE v_stock.average_unit_cost
        END,
        updated_at=now()
    WHERE stok_barang_id=v_stock.stok_barang_id
    RETURNING * INTO v_stock;$anchor$);

  IF v_fixed=v_definition
    OR position('coalesce(v_stock.average_unit_cost,v_variant.harga_beli,v_product.harga_beli)' in v_fixed)=0 THEN
    RAISE EXCEPTION 'Quantity stock adjustment HPP seed migration did not apply';
  END IF;

  EXECUTE v_fixed;
END
$migration$;
