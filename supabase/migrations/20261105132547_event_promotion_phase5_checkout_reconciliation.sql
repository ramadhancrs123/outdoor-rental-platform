-- Reconciliation endpoint for the Phase-3 event-promotion checkout wrappers.
-- It only reads the authenticated actor's own idempotency record.
CREATE OR REPLACE FUNCTION app_private.command_reconcile_event_promotion_checkout(
  p_usaha_id uuid,
  p_command_name text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_row public.idempotency_key%ROWTYPE;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required'
      USING ERRCODE = '28000';
  END IF;

  PERFORM app_private.catalog_require_admin(p_usaha_id);

  IF p_command_name NOT IN (
    'create_direct_rental_with_discount',
    'create_direct_rental_and_activate_with_discount',
    'create_rental_from_reservation_with_discount',
    'create_rental_from_reservation_and_activate_with_discount',
    'create_mixed_checkout_with_discount',
    'create_mixed_checkout_and_activate_with_discount'
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: command checkout promosi tidak dikenal'
      USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi'
      USING ERRCODE = '22023';
  END IF;

  SELECT ik.*
    INTO v_row
  FROM public.idempotency_key ik
  WHERE ik.usaha_id = p_usaha_id
    AND ik.actor_auth_user_id = v_auth_user_id
    AND ik.command_name = p_command_name
    AND ik.key = btrim(p_idempotency_key);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found', 'response', NULL);
  END IF;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_row.response_body IS NULL THEN 'unknown' ELSE 'committed' END,
    'response', v_row.response_body
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_reconcile_event_promotion_checkout(uuid,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_reconcile_event_promotion_checkout(uuid,text,text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.command_reconcile_event_promotion_checkout(
  p_usaha_id uuid,
  p_command_name text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.command_reconcile_event_promotion_checkout($1,$2,$3);
$function$;

REVOKE ALL ON FUNCTION public.command_reconcile_event_promotion_checkout(uuid,text,text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_reconcile_event_promotion_checkout(uuid,text,text)
  TO authenticated;

COMMENT ON FUNCTION public.command_reconcile_event_promotion_checkout(uuid,text,text) IS
  'Safely reconciles authenticated actor-owned idempotency records for rental, reservation conversion, and mixed checkout discount commands.';
