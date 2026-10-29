-- Purchase identifiers are system-managed. Re-saving a draft without changing
-- its date must preserve its current identifier rather than accept manual edits.
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

  IF TG_OP = 'UPDATE' AND NEW.tanggal_pembelian IS NOT DISTINCT FROM OLD.tanggal_pembelian THEN
    NEW.nomor_pembelian := OLD.nomor_pembelian;
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

REVOKE ALL ON FUNCTION app_private.normalize_purchase_number_by_date() FROM PUBLIC, anon, authenticated;
