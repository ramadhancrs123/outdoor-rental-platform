-- Server-side summary for the Smart Booking admin queue.
-- Counts use business-local dates and only the current Smart Booking workflow;
-- no reservation stock locks or inventory state are changed.

CREATE OR REPLACE FUNCTION app_private.admin_get_akasha_smart_booking_summary(
  p_usaha_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_timezone text;
  v_today date;
  v_summary jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_usaha_id IS NULL
     OR NOT app_private.has_usaha_access(p_usaha_id) THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: akses booking tidak diberikan'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(nullif(u.timezone, ''), 'Asia/Jakarta')
    INTO v_timezone
  FROM public.usaha u
  WHERE u.usaha_id = p_usaha_id
    AND u.status = 'active';

  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan'
      USING ERRCODE = 'P0002';
  END IF;

  v_today := (now() AT TIME ZONE v_timezone)::date;

  SELECT jsonb_build_object(
    'total', count(*)::integer,
    'received', count(*) FILTER (WHERE b.workflow_status = 'received')::integer,
    'reviewing', count(*) FILTER (WHERE b.workflow_status = 'reviewing')::integer,
    'acknowledged', count(*) FILTER (WHERE b.workflow_status = 'acknowledged')::integer,
    'customer_action_required', count(*) FILTER (WHERE b.workflow_status = 'customer_action_required')::integer,
    'change_requested', count(*) FILTER (WHERE b.workflow_status = 'change_requested')::integer,
    'cancellation_pending', count(*) FILTER (WHERE b.workflow_status = 'cancellation_pending')::integer,
    'ready_for_checkout', count(*) FILTER (WHERE b.workflow_status = 'ready_for_checkout')::integer,
    'closed', count(*) FILTER (WHERE b.workflow_status IN ('cancelled', 'expired', 'fulfilled'))::integer,
    'pending_change_requests', (
      SELECT count(*)::integer
      FROM app_private.akasha_smart_booking_change_request c
      JOIN app_private.akasha_smart_booking cb
        ON cb.usaha_id = c.usaha_id
       AND cb.smart_booking_id = c.smart_booking_id
      WHERE c.usaha_id = p_usaha_id
        AND c.request_status = 'pending'
        AND cb.workflow_status NOT IN ('cancelled', 'expired', 'fulfilled')
    ),
    'pickup_today', count(*) FILTER (
      WHERE b.requested_pickup_date = v_today
        AND b.workflow_status NOT IN ('cancelled', 'expired', 'fulfilled')
    )::integer,
    'pickup_tomorrow', count(*) FILTER (
      WHERE b.requested_pickup_date = v_today + 1
        AND b.workflow_status NOT IN ('cancelled', 'expired', 'fulfilled')
    )::integer,
    'today_business_date', v_today,
    'business_timezone', v_timezone,
    'inventory_is_reserved', false
  )
  INTO v_summary
  FROM app_private.akasha_smart_booking b
  WHERE b.usaha_id = p_usaha_id;

  RETURN coalesce(v_summary, jsonb_build_object(
    'total', 0,
    'received', 0,
    'reviewing', 0,
    'acknowledged', 0,
    'customer_action_required', 0,
    'change_requested', 0,
    'cancellation_pending', 0,
    'ready_for_checkout', 0,
    'closed', 0,
    'pending_change_requests', 0,
    'pickup_today', 0,
    'pickup_tomorrow', 0,
    'today_business_date', v_today,
    'business_timezone', v_timezone,
    'inventory_is_reserved', false
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_akasha_smart_booking_summary(
  p_usaha_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.admin_get_akasha_smart_booking_summary($1);
$function$;

REVOKE ALL ON FUNCTION app_private.admin_get_akasha_smart_booking_summary(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_get_akasha_smart_booking_summary(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_akasha_smart_booking_summary(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_get_akasha_smart_booking_summary(uuid)
  IS 'Tenant-authorized summary for the Smart Booking queue, including upcoming pickup counts in business-local dates. Read-only; does not project or mutate stock.';
