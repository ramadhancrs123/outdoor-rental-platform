-- ADR-007: make inspection-context trigger aware of acquisition vs return.
CREATE OR REPLACE FUNCTION app_private.validate_inspection_context()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'app_private', 'pg_temp'
AS $function$
BEGIN
  IF NEW.jenis_pemeriksaan = 'return' THEN
    IF NEW.detail_pengembalian_id IS NULL THEN
      RAISE EXCEPTION 'Return inspection requires a return detail' USING ERRCODE='23514';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.detail_pengembalian dr
      WHERE dr.usaha_id = NEW.usaha_id
        AND dr.detail_pengembalian_id = NEW.detail_pengembalian_id
        AND dr.unit_barang_id = NEW.unit_barang_id
    ) THEN
      RAISE EXCEPTION 'Inspection unit must match the returned unit';
    END IF;
  ELSIF NEW.jenis_pemeriksaan = 'acquisition' THEN
    IF NEW.detail_pengembalian_id IS NOT NULL THEN
      RAISE EXCEPTION 'Acquisition inspection must not reference a return detail' USING ERRCODE='23514';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.unit_barang ub
      WHERE ub.usaha_id = NEW.usaha_id
        AND ub.unit_barang_id = NEW.unit_barang_id
    ) THEN
      RAISE EXCEPTION 'Acquisition inspection unit not found in tenant' USING ERRCODE='23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported inspection type: %', NEW.jenis_pemeriksaan USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END;
$function$;
