-- Return the normalized Smart Booking quote, not the pre-promotion legacy
-- subtotal, in both the first response and all idempotent replays.
-- The internal command keeps creating only request/draft records. This wrapper
-- reads the quote after its line-snapshot trigger has reconciled all prices.

CREATE OR REPLACE FUNCTION public.command_create_akasha_smart_booking(
  p_slug text,
  p_booking jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_response jsonb;
  v_booking_id uuid;
  v_usaha_id uuid;
  v_quote_total numeric(14,2);
  v_currency_code text;
BEGIN
  v_response := app_private.command_create_akasha_smart_booking(
    p_slug,
    p_booking,
    p_idempotency_key
  );

  v_booking_id := nullif(v_response->>'smart_booking_id', '')::uuid;
  IF v_booking_id IS NULL THEN
    RETURN v_response;
  END IF;

  SELECT
    b.usaha_id,
    b.quote_total,
    b.currency_code
  INTO
    v_usaha_id,
    v_quote_total,
    v_currency_code
  FROM app_private.akasha_smart_booking b
  WHERE b.smart_booking_id = v_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_SNAPSHOT_MISSING: quote booking tidak ditemukan'
      USING ERRCODE = 'P0002';
  END IF;

  -- Keep the idempotency response body authoritative as well. A retry that
  -- resolves to the same booking will therefore not return an obsolete total.
  UPDATE public.idempotency_key
  SET response_body = jsonb_set(
      jsonb_set(
        coalesce(response_body, '{}'::jsonb),
        '{total_estimate}',
        to_jsonb(v_quote_total),
        true
      ),
      '{quote_total}',
      to_jsonb(v_quote_total),
      true
    )
  WHERE usaha_id = v_usaha_id
    AND actor_auth_user_id IS NULL
    AND command_name = 'create_akasha_smart_booking'
    AND key = btrim(coalesce(p_idempotency_key, ''));

  RETURN jsonb_set(
    jsonb_set(
      v_response,
      '{total_estimate}',
      to_jsonb(v_quote_total),
      true
    ),
    '{quote_total}',
    to_jsonb(v_quote_total),
    true
  ) || jsonb_build_object('currency_code', v_currency_code);
END;
$function$;

REVOKE ALL ON FUNCTION public.command_create_akasha_smart_booking(text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.command_create_akasha_smart_booking(text, jsonb, text)
  TO service_role;

COMMENT ON FUNCTION public.command_create_akasha_smart_booking(text, jsonb, text) IS
  'Creates an observational Smart Booking request and returns the normalized quote total after server-side rental/sale line snapshots are reconciled. Never reserves stock or creates sales/payment transactions.';

NOTIFY pgrst, 'reload schema';
