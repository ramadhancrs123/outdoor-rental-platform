-- Align the detail-persistence invariant with the trusted rental pricing contract.
-- The old trigger required subtotal = quantity * unit_price and therefore rejected
-- multi-period rentals. The trigger now resolves the effective tariff and derives
-- tariff periods from the rental schedule before validating subtotal.

CREATE OR REPLACE FUNCTION app_private.validate_rental_line_math()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'app_private', 'pg_temp'
AS $function$
DECLARE
  v_status text;
  v_timezone text;
  v_jadwal_mulai timestamptz;
  v_jadwal_kembali timestamptz;
  v_duration_unit text;
  v_duration_value numeric;
  v_tariff_nominal numeric(14,2);
  v_period_seconds numeric;
  v_periods integer;
  v_expected_subtotal numeric(14,2);
BEGIN
  SELECT p.status, p.jadwal_mulai, p.jadwal_kembali, u.timezone
    INTO v_status, v_jadwal_mulai, v_jadwal_kembali, v_timezone
  FROM public.penyewaan p
  JOIN public.usaha u
    ON u.usaha_id = p.usaha_id
  WHERE p.usaha_id = COALESCE(NEW.usaha_id, OLD.usaha_id)
    AND p.penyewaan_id = COALESCE(NEW.penyewaan_id, OLD.penyewaan_id);

  IF v_status IS NOT NULL AND v_status NOT IN ('draft', 'prepared', 'ready_for_pickup') THEN
    RAISE EXCEPTION 'Operational rental detail is immutable; use a domain amendment/correction workflow';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF v_status IS NOT NULL AND v_status NOT IN ('draft', 'prepared', 'ready_for_pickup') THEN
      RAISE EXCEPTION 'Operational rental detail cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF v_jadwal_mulai IS NULL OR v_jadwal_kembali IS NULL OR v_jadwal_kembali <= v_jadwal_mulai THEN
    RAISE EXCEPTION 'Rental line schedule is invalid';
  END IF;

  SELECT
    t.durasi_unit,
    t.durasi_nilai,
    t.nominal
    INTO v_duration_unit, v_duration_value, v_tariff_nominal
  FROM public.tarif_sewa t
  WHERE t.usaha_id = NEW.usaha_id
    AND t.status = 'active'
    AND t.berlaku_mulai <= v_jadwal_mulai
    AND (t.berlaku_sampai IS NULL OR t.berlaku_sampai > v_jadwal_mulai)
    AND (
      (NEW.paket_sewa_id IS NOT NULL AND t.paket_sewa_id = NEW.paket_sewa_id)
      OR (
        NEW.paket_sewa_id IS NULL
        AND NEW.barang_id IS NOT NULL
        AND (
          (NEW.varian_barang_id IS NOT NULL AND (
            t.varian_barang_id = NEW.varian_barang_id
            OR (t.varian_barang_id IS NULL AND t.barang_id = NEW.barang_id)
          ))
          OR (NEW.varian_barang_id IS NULL AND t.barang_id = NEW.barang_id AND t.varian_barang_id IS NULL)
        )
      )
    )
  ORDER BY
    CASE
      WHEN NEW.varian_barang_id IS NOT NULL AND t.varian_barang_id = NEW.varian_barang_id THEN 0
      ELSE 1
    END,
    t.berlaku_mulai DESC,
    t.updated_at DESC
  LIMIT 1;

  IF v_duration_unit IS NULL OR v_duration_value IS NULL OR v_duration_value <= 0 THEN
    RAISE EXCEPTION 'Active rental tariff could not be resolved for rental line';
  END IF;

  v_period_seconds := CASE lower(btrim(v_duration_unit))
    WHEN 'jam' THEN v_duration_value * 3600
    WHEN 'hari' THEN v_duration_value * 86400
    WHEN 'minggu' THEN v_duration_value * 604800
    ELSE NULL
  END;

  IF v_period_seconds IS NULL THEN
    RAISE EXCEPTION 'Unsupported rental tariff duration unit: %', v_duration_unit;
  END IF;

  v_periods := GREATEST(
    1,
    ceil(
      extract(epoch FROM (v_jadwal_kembali - v_jadwal_mulai))
      / v_period_seconds
    )::integer
  );

  IF NEW.unit_price IS DISTINCT FROM round(v_tariff_nominal, 2) THEN
    RAISE EXCEPTION 'Rental line unit price must equal active tariff nominal';
  END IF;

  v_expected_subtotal := round(NEW.jumlah * v_tariff_nominal * v_periods, 2);

  IF NEW.subtotal IS DISTINCT FROM v_expected_subtotal THEN
    RAISE EXCEPTION
      'Rental line subtotal must equal quantity multiplied by tariff nominal and tariff periods';
  END IF;

  RETURN NEW;
END;
$function$;
