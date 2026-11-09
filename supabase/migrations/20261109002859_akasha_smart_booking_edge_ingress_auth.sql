-- Server-to-server ingress authentication for the Smart Booking Edge Function.
-- The shared secret is provisioned separately in Supabase Vault and as a
-- sensitive server-only Vercel environment variable; it is never stored in Git.
CREATE OR REPLACE FUNCTION app_private.verify_akasha_smart_booking_ingress(
  p_candidate text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_secret text;
  v_expected bytea;
  v_actual bytea;
  v_difference integer := 0;
  v_index integer;
BEGIN
  IF p_candidate IS NULL
     OR length(p_candidate) <> 64
     OR p_candidate !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;

  SELECT ds.decrypted_secret
    INTO v_secret
  FROM vault.decrypted_secrets ds
  WHERE ds.name = 'akasha_smart_booking_ingress_secret'
  LIMIT 1;

  IF v_secret IS NULL
     OR length(v_secret) <> 64
     OR v_secret !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;

  v_expected := extensions.digest(convert_to(v_secret, 'UTF8'), 'sha256');
  v_actual := extensions.digest(convert_to(p_candidate, 'UTF8'), 'sha256');

  -- Fixed-length comparison avoids early exit on the first mismatching byte.
  FOR v_index IN 0..31 LOOP
    v_difference := v_difference | (
      get_byte(v_expected, v_index) # get_byte(v_actual, v_index)
    );
  END LOOP;

  RETURN v_difference = 0;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.verify_akasha_smart_booking_ingress(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.verify_akasha_smart_booking_ingress(
  p_candidate text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.verify_akasha_smart_booking_ingress($1);
$function$;

REVOKE ALL ON FUNCTION public.verify_akasha_smart_booking_ingress(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_akasha_smart_booking_ingress(text)
  TO service_role;

COMMENT ON FUNCTION public.verify_akasha_smart_booking_ingress(text) IS
  'Internal Edge Function ingress check. EXECUTE is restricted to service_role; the shared credential remains in Supabase Vault and Vercel sensitive environment configuration.';
