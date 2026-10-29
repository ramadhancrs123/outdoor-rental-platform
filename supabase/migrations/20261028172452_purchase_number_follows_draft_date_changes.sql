-- Keep date-based purchase identifiers consistent when an editable draft date changes.
CREATE OR REPLACE FUNCTION app_private.normalize_purchase_number_by_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_base text;
  v_existing bigint := 0;
BEGIN
  IF NEW.usaha_id IS NULL OR NEW.tanggal_pembelian IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha dan tanggal pembelian wajib diisi' USING ERRCODE='22023';
  END IF;

  -- Draft edits may touch multiple columns. Do not renumber if the date itself stayed the same.
  IF TG_OP = 'UPDATE' AND NEW.tanggal_pembelian IS NOT DISTINCT FROM OLD.tanggal_pembelian THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.usaha_id::text || ':purchase-date:' || NEW.tanggal_pembelian::text, 0
  ));
  v_base := 'PB-' || to_char(NEW.tanggal_pembelian, 'YYYY-MM-DD');

  SELECT coalesce(max(
    CASE
      WHEN p.nomor_pembelian = v_base THEN 1
      WHEN p.nomor_pembelian ~ ('^' || v_base || '-[0-9]+$')
        THEN substring(p.nomor_pembelian FROM ('^' || v_base || '-([0-9]+)$'))::bigint
      ELSE 0
    END
  ), 0)
  INTO v_existing
  FROM public.pembelian p
  WHERE p.usaha_id = NEW.usaha_id
    AND (p.nomor_pembelian = v_base OR p.nomor_pembelian ~ ('^' || v_base || '-[0-9]+$'));

  NEW.nomor_pembelian := CASE
    WHEN v_existing = 0 THEN v_base
    ELSE v_base || '-' || lpad((v_existing + 1)::text, 3, '0')
  END;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_pembelian_normalize_date_number ON public.pembelian;
CREATE TRIGGER trg_pembelian_normalize_date_number
BEFORE INSERT OR UPDATE ON public.pembelian
FOR EACH ROW EXECUTE FUNCTION app_private.normalize_purchase_number_by_date();
