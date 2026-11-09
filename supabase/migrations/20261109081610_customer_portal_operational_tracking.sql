-- Customer-scoped tracking of the real operational transactions created from
-- a Smart Booking. The projection deliberately omits unit IDs, serial numbers,
-- staff data, internal notes, and any other customer's information.

DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_replacement_count integer;
BEGIN
  SELECT pg_get_functiondef(
    'app_private.get_akasha_smart_booking_portal(text)'::regprocedure
  ) INTO v_definition;

  v_old := $old$
    'timeline', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'type', e.event_type,
        'message', e.public_message,
        'occurred_at', e.created_at
      ) ORDER BY e.created_at)
      FROM app_private.akasha_smart_booking_activity_event e
      WHERE e.smart_booking_id = v_booking.smart_booking_id
        AND e.customer_visible = true
    ), '[]'::jsonb)
  )
$old$;

  v_new := $new$
    'timeline', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'type', e.event_type,
        'message', e.public_message,
        'occurred_at', e.created_at
      ) ORDER BY e.created_at)
      FROM app_private.akasha_smart_booking_activity_event e
      WHERE e.smart_booking_id = v_booking.smart_booking_id
        AND e.customer_visible = true
    ), '[]'::jsonb),
    'transaction_tracking', (
      SELECT jsonb_build_object(
        'converted_at', c.created_at,
        'checkout_number', (
          SELECT ch.nomor_checkout
          FROM public.checkout ch
          WHERE ch.checkout_id = c.checkout_id
        ),
        'rental', CASE
          WHEN c.penyewaan_id IS NULL THEN NULL
          ELSE (
            SELECT jsonb_build_object(
              'rental_number', r.nomor_penyewaan,
              'status', r.status,
              'scheduled_pickup_at', r.jadwal_mulai,
              'scheduled_return_at', r.jadwal_kembali,
              'actual_pickup_at', r.actual_pickup_at,
              'actual_return_started_at', r.actual_return_started_at,
              'actual_return_completed_at', r.actual_return_completed_at,
              'tolerance_deadline', r.tolerance_deadline,
              'total_amount', r.total_amount,
              'currency_code', r.currency_code,
              'lines', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                  'name', coalesce(ps.nama, b.nama, 'Perlengkapan rental'),
                  'variant', vb.nama,
                  'quantity', dp.jumlah,
                  'assigned_unit_count', coalesce(assignments.assigned_unit_count, 0),
                  'progress_status', CASE
                    WHEN r.actual_return_completed_at IS NOT NULL THEN 'returned'
                    WHEN r.actual_return_started_at IS NOT NULL THEN 'return_in_progress'
                    WHEN r.actual_pickup_at IS NOT NULL OR r.status = 'active' THEN 'handed_over'
                    WHEN r.status = 'ready_for_pickup' THEN 'ready_for_pickup'
                    WHEN coalesce(assignments.assigned_unit_count, 0) >= ceil(dp.jumlah)
                         AND coalesce(assignments.assigned_unit_count, 0) > 0 THEN 'prepared'
                    ELSE 'preparing'
                  END
                ) ORDER BY dp.created_at)
                FROM public.detail_penyewaan dp
                LEFT JOIN public.barang b
                  ON b.usaha_id = dp.usaha_id
                 AND b.barang_id = dp.barang_id
                LEFT JOIN public.varian_barang vb
                  ON vb.usaha_id = dp.usaha_id
                 AND vb.varian_barang_id = dp.varian_barang_id
                LEFT JOIN public.paket_sewa ps
                  ON ps.usaha_id = dp.usaha_id
                 AND ps.paket_sewa_id = dp.paket_sewa_id
                LEFT JOIN LATERAL (
                  SELECT count(*) FILTER (WHERE pu.status = 'assigned')::integer AS assigned_unit_count
                  FROM public.penetapan_unit pu
                  WHERE pu.usaha_id = dp.usaha_id
                    AND pu.detail_penyewaan_id = dp.detail_penyewaan_id
                ) assignments ON true
                WHERE dp.usaha_id = r.usaha_id
                  AND dp.penyewaan_id = r.penyewaan_id
              ), '[]'::jsonb)
            )
            FROM public.penyewaan r
            WHERE r.usaha_id = c.usaha_id
              AND r.penyewaan_id = c.penyewaan_id
          )
        END,
        'sale', CASE
          WHEN c.penjualan_id IS NULL THEN NULL
          ELSE (
            SELECT jsonb_build_object(
              'sale_number', s.nomor_penjualan,
              'status', s.status,
              'payment_status', s.payment_status,
              'created_at', s.created_at,
              'total_amount', s.total_amount,
              'currency_code', s.currency_code,
              'lines', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                  'name', dps.nama_barang_snapshot,
                  'variant', dps.nama_varian_snapshot,
                  'quantity', dps.jumlah,
                  'subtotal', dps.subtotal,
                  'is_bonus', dps.is_bonus_rental
                ) ORDER BY dps.created_at)
                FROM public.detail_penjualan dps
                WHERE dps.usaha_id = s.usaha_id
                  AND dps.penjualan_id = s.penjualan_id
              ), '[]'::jsonb)
            )
            FROM public.penjualan s
            WHERE s.usaha_id = c.usaha_id
              AND s.penjualan_id = c.penjualan_id
          )
        END
      )
      FROM app_private.akasha_smart_booking_conversion c
      WHERE c.usaha_id = v_booking.usaha_id
        AND c.smart_booking_id = v_booking.smart_booking_id
    )
  )
$new$;

  v_replacement_count :=
    (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);

  IF v_replacement_count <> 1 THEN
    RAISE EXCEPTION
      'Smart Booking customer portal projection changed; expected one tracking insertion point, found %',
      v_replacement_count;
  END IF;

  EXECUTE replace(v_definition, v_old, v_new);
END;
$migration$;

COMMENT ON FUNCTION app_private.get_akasha_smart_booking_portal(text)
  IS 'Booking-scoped customer portal projection with sanitized operational transaction tracking. No physical unit identifiers or internal operational notes are returned.';
