-- Capture per-unit acquisition cost during the canonical Rental Cepat onboarding
-- for untracked sale items. This keeps HPP on the product/variant master record
-- and lets POS/finance compute margin without creating physical stock units.
DO $migration$
DECLARE
  v_definition text;
  v_fixed text;
BEGIN
  v_definition := pg_get_functiondef(
    'app_private.command_quick_sale_item_onboarding(uuid,jsonb,text,uuid)'::regprocedure
  );
  v_fixed := v_definition;

  IF position('  v_price numeric(14,2);' in v_fixed) = 0 THEN
    RAISE EXCEPTION 'Quick sale onboarding declaration anchor not found';
  END IF;
  v_fixed := replace(
    v_fixed,
    '  v_price numeric(14,2);',
    '  v_price numeric(14,2);' || E'\n' ||
    '  v_cost numeric(14,2);' || E'\n' ||
    '  v_variant_cost numeric(14,2);'
  );

  IF position('  IF v_mode=''untracked'' THEN' in v_fixed) = 0 THEN
    RAISE EXCEPTION 'Quick sale onboarding price validation anchor not found';
  END IF;
  v_fixed := replace(
    v_fixed,
    '  IF v_mode=''untracked'' THEN',
    E'  v_cost := nullif(p_payload->>''harga_beli'','''')::numeric;\n' ||
    E'  IF v_mode=''untracked'' AND NOT v_variant_mode AND (v_cost IS NULL OR v_cost < 0) THEN\n' ||
    E'    RAISE EXCEPTION ''VALIDATION_ERROR: HPP per unit wajib diisi nol atau lebih untuk barang tanpa stok'' USING ERRCODE=''22023'';\n' ||
    E'  END IF;\n' ||
    E'  IF v_cost IS NOT NULL AND v_cost < 0 THEN\n' ||
    E'    RAISE EXCEPTION ''VALIDATION_ERROR: HPP tidak boleh negatif'' USING ERRCODE=''22023'';\n' ||
    E'  END IF;\n\n' ||
    '  IF v_mode=''untracked'' THEN'
  );

  IF position('  v_product_id := (v_stock_result->>''barang_id'')::uuid;' in v_fixed) = 0 THEN
    RAISE EXCEPTION 'Quick sale onboarding product result anchor not found';
  END IF;
  v_fixed := replace(
    v_fixed,
    '  v_product_id := (v_stock_result->>''barang_id'')::uuid;',
    '  v_product_id := (v_stock_result->>''barang_id'')::uuid;' || E'\n\n' ||
    E'  IF v_mode=''untracked'' AND NOT v_variant_mode THEN\n' ||
    E'    UPDATE public.barang SET harga_beli=v_cost,updated_at=now()\n' ||
    E'    WHERE usaha_id=p_usaha_id AND barang_id=v_product_id;\n' ||
    E'  END IF;'
  );

  IF position('      v_variant_quantity := CASE WHEN v_mode=''untracked''' in v_fixed) = 0 THEN
    RAISE EXCEPTION 'Quick sale onboarding variant validation anchor not found';
  END IF;
  v_fixed := replace(
    v_fixed,
    '      v_variant_quantity := CASE WHEN v_mode=''untracked'' THEN 0 ELSE coalesce(nullif(v_variant->>''jumlah'','''')::integer,0) END;',
    E'      v_variant_cost := nullif(v_variant->>''harga_beli'','''')::numeric;\n' ||
    E'      IF v_mode=''untracked'' AND (v_variant_cost IS NULL OR v_variant_cost < 0) THEN\n' ||
    E'        RAISE EXCEPTION ''VALIDATION_ERROR: setiap varian tanpa stok wajib memiliki HPP nol atau lebih'' USING ERRCODE=''22023'';\n' ||
    E'      END IF;\n' ||
    E'      IF v_variant_cost IS NOT NULL AND v_variant_cost < 0 THEN\n' ||
    E'        RAISE EXCEPTION ''VALIDATION_ERROR: HPP varian tidak boleh negatif'' USING ERRCODE=''22023'';\n' ||
    E'      END IF;\n' ||
    '      v_variant_quantity := CASE WHEN v_mode=''untracked'' THEN 0 ELSE coalesce(nullif(v_variant->>''jumlah'','''')::integer,0) END;'
  );

  IF position('      IF v_mode=''serialized'' AND v_variant_quantity>0 THEN' in v_fixed) = 0 THEN
    RAISE EXCEPTION 'Quick sale onboarding variant config anchor not found';
  END IF;
  v_fixed := replace(
    v_fixed,
    '      );' || E'\n\n      IF v_mode=''serialized'' AND v_variant_quantity>0 THEN',
    '      );' || E'\n' ||
    E'      IF v_mode=''untracked'' THEN\n' ||
    E'        UPDATE public.varian_barang SET harga_beli=v_variant_cost,updated_at=now()\n' ||
    E'        WHERE usaha_id=p_usaha_id AND varian_barang_id=v_variant_id;\n' ||
    E'      END IF;\n\n' ||
    '      IF v_mode=''serialized'' AND v_variant_quantity>0 THEN'
  );

  IF v_fixed = v_definition
     OR position('v_cost := nullif(p_payload->>''harga_beli''' in v_fixed) = 0
     OR position('v_variant_cost := nullif(v_variant->>''harga_beli''' in v_fixed) = 0
     OR position('UPDATE public.barang SET harga_beli=v_cost' in v_fixed) = 0
     OR position('UPDATE public.varian_barang SET harga_beli=v_variant_cost' in v_fixed) = 0 THEN
    RAISE EXCEPTION 'Quick sale onboarding HPP replacements incomplete';
  END IF;

  EXECUTE v_fixed;
END
$migration$;
