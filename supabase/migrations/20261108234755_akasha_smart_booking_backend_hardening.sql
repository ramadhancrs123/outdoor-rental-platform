-- ============================================================================
-- AKASHA SMART BOOKING hardening after production verification.
-- Corrects the line counter in the create response and keeps the legacy
-- reservation/request records in sync when admins approve time or cancellation.
-- ============================================================================

DO $migration$
DECLARE
  v_definition text;
  v_patched text;
  v_signature regprocedure;
BEGIN
  -- The create command reuses v_count as its random-reference retry loop.
  -- Count persisted request lines instead of returning that loop variable.
  v_signature := 'app_private.command_create_akasha_smart_booking(text,jsonb,text)'::regprocedure;
  v_definition := pg_get_functiondef(v_signature);
  v_patched := replace(
    v_definition,
    '''line_count'', v_count,',
    '''line_count'', (SELECT count(*)::integer FROM app_private.akasha_smart_booking_line l WHERE l.smart_booking_id = v_booking_id),'
  );

  IF v_patched = v_definition THEN
    IF position(
      '''line_count'', (SELECT count(*)::integer FROM app_private.akasha_smart_booking_line'
      IN v_definition
    ) = 0 THEN
      RAISE EXCEPTION 'EXPECTED_PATCH_MISSING: create command line_count expression';
    END IF;
  ELSE
    EXECUTE v_patched;
  END IF;
END;
$migration$;

DO $migration$
DECLARE
  v_definition text;
  v_patched text;
  v_signature regprocedure;
  v_old text;
  v_new text;
BEGIN
  v_signature := 'app_private.admin_resolve_akasha_smart_booking_change(uuid,text,integer,text,text,jsonb)'::regprocedure;
  v_definition := pg_get_functiondef(v_signature);

  -- Customer-approved date requests must update the legacy reservation and
  -- request read models too; otherwise the existing reservation admin screens
  -- would show different dates from the Smart Booking portal.
  v_old := $old$
      requested_return_at = CASE
        WHEN v_payload ? 'requested_return_at'
        THEN nullif(v_payload->>'requested_return_at', '')::timestamptz
        ELSE requested_return_at
      END,
      workflow_status = v_change.previous_workflow_status,
      revision = revision + 1
    WHERE smart_booking_id = v_booking.smart_booking_id;
    v_status := 'applied';
  ELSIF p_decision = 'approved' AND v_change.request_type = 'cancellation' THEN
$old$;

  v_new := $new$
      requested_return_at = CASE
        WHEN v_payload ? 'requested_return_at'
        THEN nullif(v_payload->>'requested_return_at', '')::timestamptz
        ELSE requested_return_at
      END,
      workflow_status = v_change.previous_workflow_status,
      revision = revision + 1
    WHERE smart_booking_id = v_booking.smart_booking_id;

    IF v_booking.reservasi_id IS NOT NULL THEN
      UPDATE public.reservasi
      SET mulai_reservasi = coalesce(
            nullif(v_payload->>'requested_pickup_date', '')::date,
            v_booking.requested_pickup_date
          ),
          selesai_reservasi = coalesce(
            nullif(v_payload->>'requested_return_date', '')::date,
            v_booking.requested_return_date
          ),
          updated_at = now()
      WHERE usaha_id = v_booking.usaha_id
        AND reservasi_id = v_booking.reservasi_id;

      IF v_booking.permintaan_sewa_id IS NOT NULL THEN
        UPDATE public.permintaan_sewa
        SET mulai_rencana = coalesce(
              nullif(v_payload->>'requested_pickup_date', '')::date,
              v_booking.requested_pickup_date
            ),
            selesai_rencana = coalesce(
              nullif(v_payload->>'requested_return_date', '')::date,
              v_booking.requested_return_date
            ),
            updated_at = now()
        WHERE usaha_id = v_booking.usaha_id
          AND permintaan_sewa_id = v_booking.permintaan_sewa_id;
      END IF;
    END IF;

    v_status := 'applied';
  ELSIF p_decision = 'approved' AND v_change.request_type = 'cancellation' THEN
$new$;

  v_patched := replace(v_definition, v_old, v_new);
  IF v_patched = v_definition THEN
    IF position('UPDATE public.reservasi' IN v_definition) = 0 THEN
      RAISE EXCEPTION 'EXPECTED_PATCH_MISSING: date approval legacy synchronization';
    END IF;
  END IF;

  v_definition := v_patched;

  -- A customer cancellation approval must also cancel the linked legacy
  -- reservation so old admin screens and the Smart Booking workspace agree.
  v_old := $old$
  ELSIF p_decision = 'approved' AND v_change.request_type = 'cancellation' THEN
    UPDATE app_private.akasha_smart_booking
    SET workflow_status = 'cancelled', closed_at = now(), revision = revision + 1
    WHERE smart_booking_id = v_booking.smart_booking_id;
$old$;

  v_new := $new$
  ELSIF p_decision = 'approved' AND v_change.request_type = 'cancellation' THEN
    IF v_booking.reservasi_id IS NOT NULL THEN
      PERFORM public.command_cancel_reservation(
        v_booking.usaha_id,
        v_booking.reservasi_id,
        coalesce(nullif(btrim(p_resolution_note), ''), 'Dibatalkan sesuai permintaan customer'),
        'smart-booking-cancel-' || p_change_request_id::text,
        extensions.gen_random_uuid()
      );
    END IF;

    UPDATE app_private.akasha_smart_booking
    SET workflow_status = 'cancelled', closed_at = now(), revision = revision + 1
    WHERE smart_booking_id = v_booking.smart_booking_id;
$new$;

  v_patched := replace(v_definition, v_old, v_new);
  IF v_patched = v_definition
     AND position('smart-booking-cancel-' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'EXPECTED_PATCH_MISSING: cancellation approval legacy synchronization';
  END IF;

  IF v_patched <> v_definition THEN
    EXECUTE v_patched;
  END IF;
END;
$migration$;

DO $migration$
DECLARE
  v_definition text;
  v_patched text;
  v_signature regprocedure;
  v_marker text;
  v_insert text;
BEGIN
  v_signature := 'app_private.admin_set_akasha_smart_booking_status(uuid,text,integer,text)'::regprocedure;
  v_definition := pg_get_functiondef(v_signature);

  v_marker := $marker$
  IF p_target_status = 'acknowledged' AND v_booking.reviewed_at IS NULL THEN
$marker$;

  v_insert := $insert$
  IF p_target_status IN ('cancelled', 'expired')
     AND v_booking.reservasi_id IS NOT NULL THEN
    PERFORM public.command_cancel_reservation(
      v_booking.usaha_id,
      v_booking.reservasi_id,
      coalesce(nullif(btrim(p_note), ''), 'Booking ditutup oleh pengelola Akasha'),
      'smart-booking-status-' || p_smart_booking_id::text || '-' || p_target_status,
      extensions.gen_random_uuid()
    );
  END IF;

  IF p_target_status = 'acknowledged' AND v_booking.reviewed_at IS NULL THEN
$insert$;

  v_patched := replace(v_definition, v_marker, v_insert);
  IF v_patched = v_definition
     AND position('smart-booking-status-' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'EXPECTED_PATCH_MISSING: admin status legacy synchronization';
  END IF;

  IF v_patched <> v_definition THEN
    EXECUTE v_patched;
  END IF;
END;
$migration$;

COMMENT ON FUNCTION public.command_create_akasha_smart_booking(text,jsonb,text) IS
  'Creates an AKASHA SMART BOOKING request and memorable customer access code. Does not reserve inventory or create a rental/sale transaction.';
COMMENT ON FUNCTION public.exchange_akasha_smart_booking_access(text,text,text,text) IS
  'Exchanges the booking reference plus memorable customer access code for a seven-day HttpOnly portal session. Service-role/server-only.';
COMMENT ON FUNCTION public.get_akasha_smart_booking_portal(text) IS
  'Returns the sanitized customer portal projection for a valid server-held session token. Service-role/server-only.';
COMMENT ON FUNCTION public.submit_akasha_smart_booking_change(text,text,jsonb,text,integer,text) IS
  'Records a customer change request without directly changing item lines, inventory, or checkout state.';
