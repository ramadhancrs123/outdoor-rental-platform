-- ============================================================================
-- Protect observational Smart Bookings from legacy capacity-confirmation and
-- cancellation entry points.
--
-- Legacy non-SmartBooking reservations retain their existing confirm/lock and
-- cancellation behavior. A linked Smart Booking can only be cancelled through
-- the permission-checked Smart Booking admin commands, which set a transaction
-- local reservation-scoped context before calling the legacy cancellation
-- command.
-- ============================================================================

DO $migration$
DECLARE
  v_signature regprocedure :=
    'app_private.command_confirm_reservation(uuid,uuid,text,uuid)'::regprocedure;
  v_definition text;
  v_patched text;
  v_old text;
  v_new text;
BEGIN
  v_definition := pg_get_functiondef(v_signature);

  v_old := $old$
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: reservasi tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  IF v_reservation.status = 'confirmed' AND v_reservation.stock_lock_status = 'locked' THEN
$old$;

  v_new := $new$
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: reservasi tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM app_private.akasha_smart_booking sb
    WHERE sb.usaha_id = p_usaha_id
      AND sb.reservasi_id = p_reservasi_id
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: booking online bersifat non-lock dan tidak dapat dikonfirmasi melalui alur reservasi lama'
      USING ERRCODE = '23514';
  END IF;

  IF v_reservation.status = 'confirmed' AND v_reservation.stock_lock_status = 'locked' THEN
$new$;

  v_patched := replace(v_definition, v_old, v_new);

  IF v_patched = v_definition
     AND position('booking online bersifat non-lock' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'EXPECTED_PATCH_MISSING: legacy reservation confirmation guard';
  END IF;

  IF v_patched <> v_definition THEN
    EXECUTE v_patched;
  END IF;
END;
$migration$;

DO $migration$
DECLARE
  v_signature regprocedure :=
    'app_private.command_cancel_reservation(uuid,uuid,text,text,uuid)'::regprocedure;
  v_definition text;
  v_patched text;
  v_old text;
  v_new text;
BEGIN
  v_definition := pg_get_functiondef(v_signature);

  v_old := $old$
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: reservasi tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  IF v_reservation.status = 'cancelled' THEN
$old$;

  v_new := $new$
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: reservasi tidak ditemukan dalam usaha aktif' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM app_private.akasha_smart_booking sb
    WHERE sb.usaha_id = p_usaha_id
      AND sb.reservasi_id = p_reservasi_id
  )
  AND coalesce(
    current_setting('app.akasha_smart_booking_cancel_context', true),
    ''
  ) IS DISTINCT FROM p_reservasi_id::text THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: booking online harus dibatalkan melalui AKASHA SMART BOOKING'
      USING ERRCODE = '23514';
  END IF;

  IF v_reservation.status = 'cancelled' THEN
$new$;

  v_patched := replace(v_definition, v_old, v_new);

  IF v_patched = v_definition
     AND position('booking online harus dibatalkan melalui AKASHA SMART BOOKING' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'EXPECTED_PATCH_MISSING: legacy reservation cancellation guard';
  END IF;

  IF v_patched <> v_definition THEN
    EXECUTE v_patched;
  END IF;
END;
$migration$;

DO $migration$
DECLARE
  v_signature regprocedure :=
    'app_private.admin_set_akasha_smart_booking_status(uuid,text,integer,text)'::regprocedure;
  v_definition text;
  v_patched text;
  v_old text;
  v_new text;
BEGIN
  v_definition := pg_get_functiondef(v_signature);

  v_old := $old$
    PERFORM public.command_cancel_reservation(
      v_booking.usaha_id,
      v_booking.reservasi_id,
$old$;

  v_new := $new$
    PERFORM set_config(
      'app.akasha_smart_booking_cancel_context',
      v_booking.reservasi_id::text,
      true
    );
    PERFORM public.command_cancel_reservation(
      v_booking.usaha_id,
      v_booking.reservasi_id,
$new$;

  v_patched := replace(v_definition, v_old, v_new);

  IF v_patched = v_definition
     AND position('app.akasha_smart_booking_cancel_context' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'EXPECTED_PATCH_MISSING: Smart Booking admin status cancellation context';
  END IF;

  IF v_patched <> v_definition THEN
    EXECUTE v_patched;
  END IF;
END;
$migration$;

DO $migration$
DECLARE
  v_signature regprocedure :=
    'app_private.admin_resolve_akasha_smart_booking_change(uuid,text,integer,text,text,jsonb)'::regprocedure;
  v_definition text;
  v_patched text;
  v_old text;
  v_new text;
BEGIN
  v_definition := pg_get_functiondef(v_signature);

  v_old := $old$
      PERFORM public.command_cancel_reservation(
        v_booking.usaha_id,
        v_booking.reservasi_id,
$old$;

  v_new := $new$
      PERFORM set_config(
        'app.akasha_smart_booking_cancel_context',
        v_booking.reservasi_id::text,
        true
      );
      PERFORM public.command_cancel_reservation(
        v_booking.usaha_id,
        v_booking.reservasi_id,
$new$;

  v_patched := replace(v_definition, v_old, v_new);

  IF v_patched = v_definition
     AND position('app.akasha_smart_booking_cancel_context' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'EXPECTED_PATCH_MISSING: Smart Booking customer cancellation resolution context';
  END IF;

  IF v_patched <> v_definition THEN
    EXECUTE v_patched;
  END IF;
END;
$migration$;

COMMENT ON FUNCTION app_private.command_confirm_reservation(uuid,uuid,text,uuid) IS
  'Legacy capacity-confirmation command. Reservations linked to AKASHA SMART BOOKING are intentionally excluded; online acknowledgement does not lock stock.';
COMMENT ON FUNCTION app_private.command_cancel_reservation(uuid,uuid,text,text,uuid) IS
  'Legacy reservation cancellation command. A reservation linked to AKASHA SMART BOOKING must be cancelled through the permission-checked Smart Booking admin workflow.';
