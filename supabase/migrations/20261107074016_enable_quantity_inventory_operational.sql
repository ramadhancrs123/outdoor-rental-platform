-- Activate aggregate quantity stock end-to-end without changing serialized rental inventory.
-- Quantity stock uses one numeric balance per product/variant and moving-average HPP.

DO $migration$
DECLARE
  v_definition text;
  v_fixed text;
  v_anchor text;
BEGIN
  -- Quick Item: initial quantity stock must have an explicit cost basis when opening
  -- quantity is positive. Store that cost on stok_barang.average_unit_cost, not on
  -- the product master, because subsequent receiving updates the moving average.
  v_definition := pg_get_functiondef(
    'app_private.command_quick_sale_item_onboarding(uuid,jsonb,text,uuid)'::regprocedure
  );
  v_fixed := v_definition;

  v_anchor := $anchor$  IF v_mode='untracked' THEN
    v_quantity := 0;
  ELSE
    v_quantity := coalesce(nullif(p_payload->>'jumlah','')::integer,0);
    IF v_quantity<0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: stok awal tidak boleh negatif' USING ERRCODE='22023';
    END IF;
  END IF;$anchor$;
  IF position(v_anchor in v_fixed)=0 THEN
    RAISE EXCEPTION 'Quantity onboarding product validation anchor not found';
  END IF;
  v_fixed := replace(v_fixed,v_anchor,v_anchor || E'\n' ||
    $anchor$  IF v_mode='quantity' AND NOT v_variant_mode AND v_quantity>0 AND v_cost IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: HPP per unit wajib diisi untuk stok awal kuantitas' USING ERRCODE='22023';
  END IF;$anchor$);

  v_anchor := $anchor$      IF v_variant_quantity<0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: stok awal varian tidak boleh negatif' USING ERRCODE='22023';
      END IF;$anchor$;
  IF position(v_anchor in v_fixed)=0 THEN
    RAISE EXCEPTION 'Quantity onboarding variant validation anchor not found';
  END IF;
  v_fixed := replace(v_fixed,v_anchor,v_anchor || E'\n' ||
    $anchor$      IF v_mode='quantity' AND v_variant_quantity>0 AND v_variant_cost IS NULL THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: HPP per unit wajib diisi untuk stok awal varian kuantitas' USING ERRCODE='22023';
      END IF;$anchor$);

  v_anchor := $anchor$UPDATE public.stok_barang SET jumlah=jumlah+v_variant_quantity,updated_at=now()
        WHERE usaha_id=p_usaha_id AND stok_barang_id=v_stock.stok_barang_id;$anchor$;
  IF position(v_anchor in v_fixed)=0 THEN
    RAISE EXCEPTION 'Quantity onboarding variant stock update anchor not found';
  END IF;
  v_fixed := replace(v_fixed,v_anchor,
    $anchor$UPDATE public.stok_barang
        SET jumlah=jumlah+v_variant_quantity,
            average_unit_cost=CASE WHEN jumlah=0 THEN v_variant_cost ELSE average_unit_cost END,
            updated_at=now()
        WHERE usaha_id=p_usaha_id AND stok_barang_id=v_stock.stok_barang_id;$anchor$);

  v_anchor := $anchor$UPDATE public.stok_barang SET jumlah=jumlah+v_quantity,updated_at=now()
      WHERE usaha_id=p_usaha_id AND stok_barang_id=v_stock.stok_barang_id;$anchor$;
  IF position(v_anchor in v_fixed)=0 THEN
    RAISE EXCEPTION 'Quantity onboarding product stock update anchor not found';
  END IF;
  v_fixed := replace(v_fixed,v_anchor,
    $anchor$UPDATE public.stok_barang
      SET jumlah=jumlah+v_quantity,
          average_unit_cost=CASE WHEN jumlah=0 THEN v_cost ELSE average_unit_cost END,
          updated_at=now()
      WHERE usaha_id=p_usaha_id AND stok_barang_id=v_stock.stok_barang_id;$anchor$);

  IF v_fixed=v_definition
    OR position('HPP per unit wajib diisi untuk stok awal kuantitas' in v_fixed)=0
    OR position('HPP per unit wajib diisi untuk stok awal varian kuantitas' in v_fixed)=0
    OR position('average_unit_cost=CASE WHEN jumlah=0 THEN v_variant_cost' in v_fixed)=0
    OR position('average_unit_cost=CASE WHEN jumlah=0 THEN v_cost' in v_fixed)=0 THEN
    RAISE EXCEPTION 'Quantity onboarding migration did not apply all expected replacements';
  END IF;
  EXECUTE v_fixed;

  -- Standard POS: snapshot quantity HPP from the stock row under the same row lock
  -- used for balance validation and decrement. A NULL moving average deliberately
  -- stays unknown; it must never fall back to a stale master harga_beli value.
  v_definition := pg_get_functiondef(
    'app_private.command_create_sale_unchecked_20261105(uuid,text,text,text,text,jsonb,uuid,text,text,uuid)'::regprocedure
  );
  v_fixed := v_definition;
  v_anchor := $anchor$      IF v_stock.jumlah < v_qty THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: stok % tersedia %, diminta %',coalesce(v_variant_name,v_barang_name),v_stock.jumlah,v_qty USING ERRCODE='23514';
      END IF;

      UPDATE public.stok_barang$anchor$;
  IF position(v_anchor in v_fixed)=0 THEN
    RAISE EXCEPTION 'Standard sale quantity HPP anchor not found';
  END IF;
  v_fixed := replace(v_fixed,v_anchor,
    $anchor$      IF v_stock.jumlah < v_qty THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: stok % tersedia %, diminta %',coalesce(v_variant_name,v_barang_name),v_stock.jumlah,v_qty USING ERRCODE='23514';
      END IF;

      v_cost := v_stock.average_unit_cost;
      UPDATE public.detail_penjualan
      SET harga_beli_satuan=v_cost,
          hpp_total=CASE WHEN v_cost IS NULL THEN NULL ELSE round(v_qty*v_cost,2) END
      WHERE usaha_id=p_usaha_id AND detail_penjualan_id=v_detail_id;

      UPDATE public.stok_barang$anchor$);
  IF v_fixed=v_definition OR position('v_cost := v_stock.average_unit_cost;' in v_fixed)=0 THEN
    RAISE EXCEPTION 'Standard sale quantity HPP migration did not apply';
  END IF;
  EXECUTE v_fixed;

  -- Walk-in/mixed checkout uses a separate sale command. Apply the identical
  -- cost snapshot to paid retail lines and eligible zero-price retail bonuses.
  v_definition := pg_get_functiondef(
    'app_private.command_create_sale_mixed_bonus_internal(uuid,text,text,text,text,jsonb,uuid,text,text,uuid,boolean)'::regprocedure
  );
  v_fixed := v_definition;
  IF position(v_anchor in v_fixed)=0 THEN
    RAISE EXCEPTION 'Mixed checkout quantity HPP anchor not found';
  END IF;
  v_fixed := replace(v_fixed,v_anchor,
    $anchor$      IF v_stock.jumlah < v_qty THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: stok % tersedia %, diminta %',coalesce(v_variant_name,v_barang_name),v_stock.jumlah,v_qty USING ERRCODE='23514';
      END IF;

      v_cost := v_stock.average_unit_cost;
      UPDATE public.detail_penjualan
      SET harga_beli_satuan=v_cost,
          hpp_total=CASE WHEN v_cost IS NULL THEN NULL ELSE round(v_qty*v_cost,2) END
      WHERE usaha_id=p_usaha_id AND detail_penjualan_id=v_detail_id;

      UPDATE public.stok_barang$anchor$);
  IF v_fixed=v_definition OR position('v_cost := v_stock.average_unit_cost;' in v_fixed)=0 THEN
    RAISE EXCEPTION 'Mixed checkout quantity HPP migration did not apply';
  END IF;
  EXECUTE v_fixed;
END
$migration$;
