-- Purchase details are an informational/reconciliation source, not a hard cap on physical inventory.
-- Keep tenant and product/variant integrity checks when a source is provided, but never
-- reject a real inventory unit just because more units exist than the purchase line records.
CREATE OR REPLACE FUNCTION app_private.validate_unit_purchase_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_barang uuid;
  v_varian uuid;
BEGIN
  IF NEW.sumber_pembelian_detail_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT d.barang_id, d.varian_barang_id
  INTO v_barang, v_varian
  FROM public.detail_pembelian d
  WHERE d.usaha_id = NEW.usaha_id
    AND d.detail_pembelian_id = NEW.sumber_pembelian_detail_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: sumber item pembelian tidak ditemukan'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_barang IS NOT NULL AND NEW.barang_id IS DISTINCT FROM v_barang THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: barang unit tidak sesuai dengan item pembelian'
      USING ERRCODE = '23514';
  END IF;

  IF v_varian IS NOT NULL AND NEW.varian_barang_id IS DISTINCT FROM v_varian THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: varian unit tidak sesuai dengan item pembelian'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION app_private.validate_unit_purchase_source() IS
  'Validates tenant and product/variant consistency for an optional purchase source; purchase quantity is advisory and never caps physical inventory registration.';
