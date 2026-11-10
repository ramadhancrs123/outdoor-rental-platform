-- Simplify the admin reservation flow to one confirmation action.
-- The confirmation goes directly to ready_for_checkout; intermediate review
-- states remain readable for old records but cannot be set by this command.

CREATE OR REPLACE FUNCTION app_private.admin_set_akasha_smart_booking_status(
  p_smart_booking_id uuid,
  p_target_status text,
  p_expected_revision integer,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_booking app_private.akasha_smart_booking%ROWTYPE;
  v_admin_id uuid;
  v_message text;
BEGIN
  SELECT *
  INTO v_booking
  FROM app_private.akasha_smart_booking b
  WHERE b.smart_booking_id = p_smart_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: reservasi tidak ditemukan'
      USING ERRCODE = 'P0002';
  END IF;

  v_admin_id := app_private.require_usaha_permission(
    v_booking.usaha_id,
    'reservation.amend'
  );

  IF p_expected_revision IS DISTINCT FROM v_booking.revision THEN
    RAISE EXCEPTION 'STALE_REVISION: reservasi telah berubah. Muat ulang sebelum melanjutkan.'
      USING ERRCODE = '40001';
  END IF;

  -- Only the final confirmation and closure targets are available to admins.
  IF p_target_status NOT IN ('ready_for_checkout', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: gunakan konfirmasi reservasi untuk menyiapkan transaksi'
      USING ERRCODE = '22023';
  END IF;

  IF v_booking.workflow_status IN ('cancelled', 'expired', 'fulfilled') THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: reservasi sudah ditutup'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (
      v_booking.workflow_status IN (
        'received',
        'reviewing',
        'acknowledged',
        'change_requested'
      )
      AND p_target_status = 'ready_for_checkout'
    )
    OR (
      v_booking.workflow_status IN (
        'received',
        'reviewing',
        'acknowledged',
        'customer_action_required',
        'change_requested',
        'cancellation_pending',
        'ready_for_checkout'
      )
      AND p_target_status = 'cancelled'
    )
    OR (
      v_booking.workflow_status IN (
        'received',
        'reviewing',
        'acknowledged',
        'change_requested',
        'ready_for_checkout'
      )
      AND p_target_status = 'expired'
    )
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: reservasi belum dapat dikonfirmasi dari status saat ini'
      USING ERRCODE = '23514';
  END IF;

  -- Customer changes must be resolved before the one-click confirmation.
  IF p_target_status = 'ready_for_checkout'
     AND EXISTS (
       SELECT 1
       FROM app_private.akasha_smart_booking_change_request c
       WHERE c.usaha_id = v_booking.usaha_id
         AND c.smart_booking_id = v_booking.smart_booking_id
         AND c.request_status = 'pending'
     ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: masih ada perubahan dari pelanggan yang perlu diselesaikan'
      USING ERRCODE = '23514';
  END IF;

  IF p_target_status IN ('cancelled', 'expired')
     AND v_booking.reservasi_id IS NOT NULL THEN
    PERFORM set_config(
      'app.akasha_smart_booking_cancel_context',
      v_booking.reservasi_id::text,
      true
    );

    PERFORM public.command_cancel_reservation(
      v_booking.usaha_id,
      v_booking.reservasi_id,
      coalesce(nullif(btrim(p_note), ''), 'Reservasi ditutup oleh pengelola Akasha'),
      'smart-booking-status-' || p_smart_booking_id::text || '-' || p_target_status,
      extensions.gen_random_uuid()
    );
  END IF;

  IF p_target_status = 'ready_for_checkout'
     AND v_booking.reviewed_at IS NULL THEN
    UPDATE app_private.akasha_smart_booking
    SET workflow_status = p_target_status,
        reviewed_at = now(),
        reviewed_by = v_admin_id,
        revision = revision + 1
    WHERE smart_booking_id = p_smart_booking_id;
  ELSE
    UPDATE app_private.akasha_smart_booking
    SET workflow_status = p_target_status,
        closed_at = CASE
          WHEN p_target_status IN ('cancelled', 'expired') THEN now()
          ELSE closed_at
        END,
        revision = revision + 1
    WHERE smart_booking_id = p_smart_booking_id;
  END IF;

  v_message := CASE p_target_status
    WHEN 'ready_for_checkout' THEN
      'Reservasi Anda sudah dikonfirmasi dan siap diproses saat kedatangan. Ketersediaan barang diperiksa kembali saat transaksi.'
    WHEN 'cancelled' THEN
      coalesce(nullif(btrim(p_note), ''), 'Reservasi Anda telah dibatalkan oleh tim Akasha.')
    WHEN 'expired' THEN
      coalesce(nullif(btrim(p_note), ''), 'Masa berlaku reservasi telah berakhir.')
    ELSE 'Status reservasi diperbarui.'
  END;

  INSERT INTO app_private.akasha_smart_booking_activity_event (
    usaha_id,
    smart_booking_id,
    event_type,
    actor_type,
    actor_admin_id,
    customer_visible,
    public_message,
    internal_metadata
  )
  VALUES (
    v_booking.usaha_id,
    p_smart_booking_id,
    'booking.status.' || p_target_status,
    'admin',
    v_admin_id,
    true,
    v_message,
    jsonb_build_object(
      'from', v_booking.workflow_status,
      'to', p_target_status,
      'note', p_note
    )
  );

  INSERT INTO public.audit_log (
    usaha_id,
    actor_auth_user_id,
    actor_akun_admin_id,
    action,
    entity_type,
    entity_id,
    source_application,
    change_summary
  )
  VALUES (
    v_booking.usaha_id,
    auth.uid(),
    v_admin_id,
    'update_status',
    'akasha_smart_booking',
    p_smart_booking_id,
    'rental-admin',
    jsonb_build_object(
      'from', v_booking.workflow_status,
      'to', p_target_status,
      'revision', v_booking.revision + 1
    )
  );

  INSERT INTO public.outbox_event (
    usaha_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload
  )
  VALUES (
    v_booking.usaha_id,
    'akasha_smart_booking.status_changed',
    'akasha_smart_booking',
    p_smart_booking_id,
    jsonb_build_object(
      'from', v_booking.workflow_status,
      'to', p_target_status
    )
  );

  RETURN jsonb_build_object(
    'smart_booking_id', p_smart_booking_id,
    'workflow_status', p_target_status,
    'revision', v_booking.revision + 1
  );
END;
$function$;

-- The public wrapper remains unchanged; CREATE OR REPLACE preserves its grants.
NOTIFY pgrst, 'reload schema';
