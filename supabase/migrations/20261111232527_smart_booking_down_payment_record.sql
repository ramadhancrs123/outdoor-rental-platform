-- Track down-payment information as booking metadata only.
-- This does not create a finance transaction, alter cash balances, or reserve inventory.

ALTER TABLE app_private.akasha_smart_booking
  ADD COLUMN dp_amount numeric(14,0);

ALTER TABLE app_private.akasha_smart_booking
  ADD CONSTRAINT akasha_smart_booking_dp_amount_nonnegative
  CHECK (dp_amount IS NULL OR dp_amount >= 0);

CREATE OR REPLACE FUNCTION app_private.admin_confirm_akasha_smart_booking(
  p_smart_booking_id uuid,
  p_expected_revision integer,
  p_dp_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_booking app_private.akasha_smart_booking%ROWTYPE;
  v_admin_id uuid;
  v_result jsonb;
  v_revision integer;
  v_dp_percent numeric(7,2);
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

  IF p_dp_amount IS NULL
     OR p_dp_amount < 0
     OR p_dp_amount <> trunc(p_dp_amount)
     OR p_dp_amount > v_booking.quote_total THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: nominal DP harus berupa rupiah bulat antara 0 dan total booking'
      USING ERRCODE = '22023';
  END IF;

  v_admin_id := app_private.require_usaha_permission(
    v_booking.usaha_id,
    'reservation.amend'
  );

  IF p_expected_revision IS DISTINCT FROM v_booking.revision THEN
    RAISE EXCEPTION 'STALE_REVISION: reservasi telah berubah. Muat ulang sebelum melanjutkan.'
      USING ERRCODE = '40001';
  END IF;

  -- Reuse the existing canonical confirmation rules. Status + DP are atomic.
  v_result := app_private.admin_set_akasha_smart_booking_status(
    p_smart_booking_id,
    'ready_for_checkout',
    p_expected_revision,
    NULL
  );

  UPDATE app_private.akasha_smart_booking
  SET dp_amount = p_dp_amount,
      updated_at = now()
  WHERE smart_booking_id = p_smart_booking_id
  RETURNING revision INTO v_revision;

  v_dp_percent := CASE
    WHEN v_booking.quote_total > 0
      THEN round((p_dp_amount / v_booking.quote_total) * 100, 2)
    ELSE 0
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
    'booking.down_payment.recorded',
    'admin',
    v_admin_id,
    false,
    CASE
      WHEN p_dp_amount > 0
        THEN 'Informasi DP booking sudah dicatat oleh admin.'
      ELSE 'Booking dikonfirmasi tanpa DP.'
    END,
    jsonb_build_object(
      'dp_amount', p_dp_amount,
      'booking_total', v_booking.quote_total,
      'dp_percent', v_dp_percent,
      'recorded_at', now()
    )
  );

  RETURN v_result || jsonb_build_object(
    'dp_amount', p_dp_amount,
    'dp_percent', v_dp_percent,
    'revision', v_revision
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.admin_confirm_akasha_smart_booking(uuid, integer, numeric)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_confirm_akasha_smart_booking(
  p_smart_booking_id uuid,
  p_expected_revision integer,
  p_dp_amount numeric
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.admin_confirm_akasha_smart_booking($1, $2, $3);
$function$;

REVOKE ALL ON FUNCTION public.admin_confirm_akasha_smart_booking(uuid, integer, numeric)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_confirm_akasha_smart_booking(uuid, integer, numeric)
  TO authenticated;

-- Keep the current detail contract and expose the new, nullable DP amount.
CREATE OR REPLACE FUNCTION public.admin_get_akasha_smart_booking(
  p_smart_booking_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT jsonb_set(
    app_private.admin_get_akasha_smart_booking(p_smart_booking_id),
    '{dp_amount}',
    coalesce(
      (
        SELECT to_jsonb(b.dp_amount)
        FROM app_private.akasha_smart_booking b
        WHERE b.smart_booking_id = p_smart_booking_id
      ),
      'null'::jsonb
    ),
    true
  );
$function$;

-- Preserve the existing authenticated and service-role access contract.
-- CREATE OR REPLACE retains the prior ACL; explicitly keep both intended callers.
REVOKE ALL ON FUNCTION public.admin_get_akasha_smart_booking(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_akasha_smart_booking(uuid)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
