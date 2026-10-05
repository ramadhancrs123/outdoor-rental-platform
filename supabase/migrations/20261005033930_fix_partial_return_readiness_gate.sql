-- Partial-return readiness: READY is unit-scoped, not rental-global.
-- A unit that has an actual return record for the same rental is no longer
-- considered under active possession, even if other units of that rental remain out.

CREATE OR REPLACE FUNCTION app_private.validate_unit_ready_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'app_private', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status = 'ready' AND OLD.status <> 'ready' THEN
    IF EXISTS (
      SELECT 1
      FROM public.perawatan p
      WHERE p.usaha_id = NEW.usaha_id
        AND p.unit_barang_id = NEW.unit_barang_id
        AND p.status IN ('planned', 'in_progress')
    ) THEN
      RAISE EXCEPTION 'Unit cannot become ready while maintenance is still open';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.pemeriksaan pi
      WHERE pi.usaha_id = NEW.usaha_id
        AND pi.unit_barang_id = NEW.unit_barang_id
        AND pi.hasil = 'pending'
    ) THEN
      RAISE EXCEPTION 'Unit cannot become ready while inspection remains pending';
    END IF;

    -- A unit may be READY while its rental remains in return_in_progress
    -- when that specific physical unit has already been received back.
    -- Rental-level completion remains separate from unit-level readiness.
    IF EXISTS (
      SELECT 1
      FROM public.penetapan_unit pu
      JOIN public.detail_penyewaan dp
        ON dp.usaha_id = pu.usaha_id
       AND dp.detail_penyewaan_id = pu.detail_penyewaan_id
      JOIN public.penyewaan p
        ON p.usaha_id = dp.usaha_id
       AND p.penyewaan_id = dp.penyewaan_id
      WHERE pu.usaha_id = NEW.usaha_id
        AND pu.unit_barang_id = NEW.unit_barang_id
        AND pu.status = 'assigned'
        AND p.status IN ('active', 'due', 'late_within_tolerance', 'tolerance_expired', 'return_in_progress')
        AND NOT EXISTS (
          SELECT 1
          FROM public.detail_pengembalian dr
          JOIN public.pengembalian r
            ON r.usaha_id = dr.usaha_id
           AND r.pengembalian_id = dr.pengembalian_id
          WHERE dr.usaha_id = pu.usaha_id
            AND dr.unit_barang_id = pu.unit_barang_id
            AND r.penyewaan_id = p.penyewaan_id
            AND dr.diterima_at IS NOT NULL
        )
    ) THEN
      RAISE EXCEPTION 'Unit cannot become ready while it remains under active rental possession';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
