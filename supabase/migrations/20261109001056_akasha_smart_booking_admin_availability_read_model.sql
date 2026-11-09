-- ============================================================================
-- Admin read model for AKASHA SMART BOOKING availability.
-- This complements the customer portal projection with the same stock facts
-- and no unit-level disclosure. Read-only; no capacity or inventory mutation.
-- ============================================================================

CREATE OR REPLACE FUNCTION app_private.admin_get_akasha_smart_booking_availability(
  p_smart_booking_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_booking app_private.akasha_smart_booking%ROWTYPE;
  v_tolerance numeric := 10;
  v_pickup_target timestamptz;
  v_lines jsonb := '[]'::jsonb;
  v_line record;
  v_component record;
  v_components jsonb;
  v_component_count integer;
  v_component_ready integer;
  v_component_review integer;
  v_overall_status text;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: sesi admin tidak ditemukan'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_booking
  FROM app_private.akasha_smart_booking b
  WHERE b.smart_booking_id = p_smart_booking_id;

  IF NOT FOUND OR NOT app_private.has_usaha_access(v_booking.usaha_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: booking tidak ditemukan'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(u.default_tolerance_hours, 10)
    INTO v_tolerance
  FROM public.usaha u
  WHERE u.usaha_id = v_booking.usaha_id;

  v_pickup_target := coalesce(
    v_booking.requested_pickup_at,
    v_booking.requested_pickup_date::timestamp AT TIME ZONE v_booking.business_timezone
  );

  FOR v_line IN
    SELECT l.*
    FROM app_private.akasha_smart_booking_line l
    WHERE l.usaha_id = v_booking.usaha_id
      AND l.smart_booking_id = v_booking.smart_booking_id
    ORDER BY l.line_position, l.created_at
  LOOP
    IF v_line.line_kind = 'sale' THEN
      v_components := jsonb_build_array(
        app_private.akasha_smart_booking_sale_availability(
          v_booking.usaha_id, v_line.barang_id, v_line.varian_barang_id
        )
      );
      v_overall_status := CASE
        WHEN coalesce((v_components->0->>'available_now_requested_variant')::numeric, 0) >= v_line.quantity
          THEN 'available_now'
        WHEN coalesce((v_components->0->>'available_now_requested_variant')::numeric, 0) > 0
          THEN 'insufficient_quantity'
        ELSE 'currently_unavailable'
      END;
    ELSIF v_line.paket_sewa_id IS NOT NULL THEN
      v_components := '[]'::jsonb;
      v_component_count := 0;
      v_component_ready := 0;
      v_component_review := 0;

      FOR v_component IN
        SELECT
          cp.barang_id,
          cp.varian_barang_id,
          cp.jumlah,
          coalesce(vb.nama, b.nama, 'Komponen paket') AS component_name,
          vb.nama AS variant_name
        FROM public.komponen_paket cp
        LEFT JOIN public.barang b
          ON b.usaha_id = cp.usaha_id AND b.barang_id = cp.barang_id
        LEFT JOIN public.varian_barang vb
          ON vb.usaha_id = cp.usaha_id
         AND vb.varian_barang_id = cp.varian_barang_id
        WHERE cp.usaha_id = v_booking.usaha_id
          AND cp.paket_sewa_id = v_line.paket_sewa_id
        ORDER BY b.nama, vb.nama
      LOOP
        v_components := v_components || jsonb_build_array(
          jsonb_build_object(
            'component_name', v_component.component_name,
            'requested_variant', v_component.variant_name,
            'required_quantity', v_line.quantity * v_component.jumlah,
            'availability', app_private.akasha_smart_booking_component_availability(
              v_booking.usaha_id,
              v_component.barang_id,
              v_component.varian_barang_id,
              v_line.quantity * v_component.jumlah,
              v_pickup_target,
              v_tolerance
            )
          )
        );
        v_component_count := v_component_count + 1;
        IF v_components->(v_component_count - 1)->'availability'->>'status' = 'ready_now' THEN
          v_component_ready := v_component_ready + 1;
        ELSIF v_components->(v_component_count - 1)->'availability'->>'status'
          IN ('potential_return_may_help', 'other_variants_available', 'potential_returns_may_help') THEN
          v_component_review := v_component_review + 1;
        END IF;
      END LOOP;

      v_overall_status := CASE
        WHEN v_component_count = 0 THEN 'package_components_unavailable'
        WHEN v_component_ready = v_component_count THEN 'all_components_ready_now'
        WHEN v_component_ready + v_component_review = v_component_count THEN 'one_or_more_components_need_review'
        ELSE 'one_or_more_components_short'
      END;
    ELSE
      v_components := jsonb_build_array(
        app_private.akasha_smart_booking_component_availability(
          v_booking.usaha_id,
          v_line.barang_id,
          v_line.varian_barang_id,
          v_line.quantity,
          v_pickup_target,
          v_tolerance
        )
      );
      v_overall_status := coalesce(v_components->0->>'status', 'unknown');
    END IF;

    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'line_id', v_line.smart_booking_line_id,
        'kind', v_line.line_kind,
        'barang_id', v_line.barang_id,
        'varian_barang_id', v_line.varian_barang_id,
        'paket_sewa_id', v_line.paket_sewa_id,
        'item_name', v_line.item_name_snapshot,
        'variant_name', v_line.variant_label_snapshot,
        'requested_quantity', v_line.quantity,
        'inventory_mode', v_line.inventory_mode_snapshot,
        'status', v_overall_status,
        'components', v_components
      )
    );
  END LOOP;

  v_result := jsonb_build_object(
    'smart_booking_id', v_booking.smart_booking_id,
    'reference_code', v_booking.reference_code,
    'checked_at', now(),
    'requested_pickup_date', v_booking.requested_pickup_date,
    'requested_pickup_at', v_booking.requested_pickup_at,
    'business_timezone', v_booking.business_timezone,
    'pickup_forecast_boundary', v_pickup_target,
    'return_tolerance_hours', v_tolerance,
    'inventory_is_reserved', false,
    'availability_is_guaranteed', false,
    'lines', v_lines
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.admin_get_akasha_smart_booking_availability(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_akasha_smart_booking_availability(
  p_smart_booking_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.admin_get_akasha_smart_booking_availability($1);
$function$;

REVOKE ALL ON FUNCTION public.admin_get_akasha_smart_booking_availability(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_akasha_smart_booking_availability(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.admin_get_akasha_smart_booking_availability(uuid) IS
  'Admin-only tenant-scoped stock projection for one Smart Booking. No units are allocated or reserved; final checkout revalidates stock.';
