-- ============================================================================
-- Include legacy confirmed capacity locks in Smart Booking read-only stock
-- projections. Legacy confirmed reservations retain their capacity commitment;
-- Smart Bookings themselves remain observational and do not lock stock.
-- ============================================================================

DO $migration$
DECLARE
  v_signature regprocedure :=
    'app_private.akasha_smart_booking_component_availability(uuid,uuid,uuid,numeric,timestamptz,numeric)'::regprocedure;
  v_definition text;
  v_patched text;
  v_old text;
  v_new text;
BEGIN
  v_definition := pg_get_functiondef(v_signature);

  -- Add the requested rental date range to the helper signature.
  v_old := 'p_pickup_target timestamp with time zone, p_tolerance_hours numeric)';
  v_new := 'p_pickup_target timestamp with time zone, p_pickup_date date, p_return_date date, p_tolerance_hours numeric)';
  v_patched := replace(v_definition, v_old, v_new);

  IF v_patched = v_definition
     AND position('p_pickup_date date' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'EXPECTED_PATCH_MISSING: availability helper signature';
  END IF;

  v_definition := v_patched;

  -- Track locked legacy capacity separately from raw unit counts.
  v_old := '  v_variant_returns integer := 0;' || E'\n' ||
           '  v_state text;';
  v_new := '  v_variant_returns integer := 0;' || E'\n' ||
           '  v_global_capacity_reserved numeric := 0;' || E'\n' ||
           '  v_variant_capacity_reserved numeric := 0;' || E'\n' ||
           '  v_state text;';
  v_patched := replace(v_definition, v_old, v_new);

  IF v_patched = v_definition
     AND position('v_global_capacity_reserved numeric' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'EXPECTED_PATCH_MISSING: availability helper capacity reservation variables';
  END IF;

  v_definition := v_patched;

  -- Use the existing capacity-lock resolver, which already expands legacy
  -- package components and respects overlapping locked reservations.
  v_old := '  v_state := CASE';
  v_new := $replacement$
  IF p_pickup_date IS NOT NULL AND p_return_date IS NOT NULL THEN
    v_global_capacity_reserved :=
      app_private.reservation_locked_component_requirement(
        p_usaha_id,
        p_pickup_date,
        p_return_date,
        v_product_id,
        NULL,
        NULL
      );

    IF p_varian_barang_id IS NOT NULL THEN
      v_variant_capacity_reserved :=
        app_private.reservation_locked_component_requirement(
          p_usaha_id,
          p_pickup_date,
          p_return_date,
          NULL,
          p_varian_barang_id,
          NULL
        );
    ELSE
      v_variant_capacity_reserved := v_global_capacity_reserved;
    END IF;
  END IF;

  -- Capacity locks are aggregate quantities, not unit assignments. Apply
  -- them conservatively to ready stock first, then to the forecast-only
  -- return count. A potential return is never promoted into guaranteed stock.
  v_global_returns := greatest(
    v_global_returns - greatest(ceil(v_global_capacity_reserved) - v_global_ready, 0),
    0
  );
  v_variant_returns := greatest(
    v_variant_returns - greatest(ceil(v_variant_capacity_reserved) - v_variant_ready, 0),
    0
  );
  v_global_ready := greatest(v_global_ready - ceil(v_global_capacity_reserved), 0);
  v_variant_ready := greatest(v_variant_ready - ceil(v_variant_capacity_reserved), 0);

  v_state := CASE
$replacement$;
  v_patched := replace(v_definition, v_old, v_new);

  IF v_patched = v_definition
     AND position('reservation_locked_component_requirement(' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'EXPECTED_PATCH_MISSING: availability helper legacy capacity-lock projection';
  END IF;

  v_definition := v_patched;

  -- Expose only aggregate locked-capacity quantities, never the reservations
  -- or customers that own them.
  v_old := '    ''ready_now_requested_variant'', v_variant_ready,' || E'\n' ||
           '    ''potential_returns_before_pickup_across_variants'', v_global_returns,';
  v_new := '    ''ready_now_requested_variant'', v_variant_ready,' || E'\n' ||
           '    ''legacy_capacity_reserved_across_variants'', ceil(v_global_capacity_reserved),' || E'\n' ||
           '    ''legacy_capacity_reserved_requested_variant'', ceil(v_variant_capacity_reserved),' || E'\n' ||
           '    ''potential_returns_before_pickup_across_variants'', v_global_returns,';
  v_patched := replace(v_definition, v_old, v_new);

  IF v_patched = v_definition
     AND position('legacy_capacity_reserved_across_variants' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'EXPECTED_PATCH_MISSING: aggregate legacy capacity fields';
  END IF;

  IF v_patched <> v_definition THEN
    EXECUTE v_patched;
  END IF;
END;
$migration$;

REVOKE ALL ON FUNCTION app_private.akasha_smart_booking_component_availability(
  uuid, uuid, uuid, numeric, timestamptz, date, date, numeric
) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION app_private.akasha_smart_booking_component_availability(
  uuid, uuid, uuid, numeric, timestamptz, date, date, numeric
) IS
  'Read-only aggregate rental availability projection. Subtracts legacy confirmed capacity locks for the requested rental date range. Future returns remain potential only; this function does not reserve inventory.';

DO $migration$
DECLARE
  v_signature regprocedure :=
    'app_private.get_akasha_smart_booking_availability(text)'::regprocedure;
  v_definition text;
  v_patched text;
  v_old_package text;
  v_new_package text;
  v_old_direct text;
  v_new_direct text;
BEGIN
  v_definition := pg_get_functiondef(v_signature);

  v_old_package := 'v_pickup_target,' || E'\n' ||
                   '              v_tolerance';
  v_new_package := 'v_pickup_target,' || E'\n' ||
                   '              v_booking.requested_pickup_date,' || E'\n' ||
                   '              v_booking.requested_return_date,' || E'\n' ||
                   '              v_tolerance';

  v_old_direct := 'v_pickup_target,' || E'\n' ||
                  '          v_tolerance';
  v_new_direct := 'v_pickup_target,' || E'\n' ||
                  '          v_booking.requested_pickup_date,' || E'\n' ||
                  '          v_booking.requested_return_date,' || E'\n' ||
                  '          v_tolerance';

  v_patched := replace(replace(v_definition, v_old_package, v_new_package),
                       v_old_direct, v_new_direct);

  IF v_patched = v_definition
     AND position('v_booking.requested_return_date' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'EXPECTED_PATCH_MISSING: customer availability date-range arguments';
  END IF;

  IF v_patched <> v_definition THEN
    EXECUTE v_patched;
  END IF;
END;
$migration$;

DO $migration$
DECLARE
  v_signature regprocedure :=
    'app_private.admin_get_akasha_smart_booking_availability(uuid)'::regprocedure;
  v_definition text;
  v_patched text;
  v_old_package text;
  v_new_package text;
  v_old_direct text;
  v_new_direct text;
BEGIN
  v_definition := pg_get_functiondef(v_signature);

  v_old_package := 'v_pickup_target,' || E'\n' ||
                   '              v_tolerance';
  v_new_package := 'v_pickup_target,' || E'\n' ||
                   '              v_booking.requested_pickup_date,' || E'\n' ||
                   '              v_booking.requested_return_date,' || E'\n' ||
                   '              v_tolerance';

  v_old_direct := 'v_pickup_target,' || E'\n' ||
                  '          v_tolerance';
  v_new_direct := 'v_pickup_target,' || E'\n' ||
                  '          v_booking.requested_pickup_date,' || E'\n' ||
                  '          v_booking.requested_return_date,' || E'\n' ||
                  '          v_tolerance';

  v_patched := replace(replace(v_definition, v_old_package, v_new_package),
                       v_old_direct, v_new_direct);

  IF v_patched = v_definition
     AND position('v_booking.requested_return_date' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'EXPECTED_PATCH_MISSING: admin availability date-range arguments';
  END IF;

  IF v_patched <> v_definition THEN
    EXECUTE v_patched;
  END IF;
END;
$migration$;
