-- Customer portal credentials must be independent of customer names and dates.
-- New credentials use 8 cryptographically random characters (40 bits).
-- Existing credentials remain valid: their stored HMAC is not rewritten.
CREATE OR REPLACE FUNCTION app_private.akasha_smart_booking_issue_access_code(
  p_smart_booking_id uuid,
  p_credential_version integer
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_random bytea;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text := '';
  v_index integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app_private.akasha_smart_booking_customer_access a
    WHERE a.smart_booking_id = p_smart_booking_id
      AND a.credential_version = p_credential_version
      AND a.revoked_at IS NULL
      AND a.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: active booking access credential not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_random := extensions.gen_random_bytes(8);

  FOR v_index IN 0..7 LOOP
    v_code := v_code || substr(
      v_alphabet,
      (get_byte(v_random, v_index) % 32) + 1,
      1
    );
  END LOOP;

  RETURN v_code;
END;
$function$;

-- A credential is returned only on first issue. An idempotent replay does not
-- regenerate a different code and never pretends the regenerated value matches
-- the stored HMAC. The customer/admin must use the supported rotation process.
DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_replacement_count integer;
BEGIN
  SELECT pg_get_functiondef(
    'app_private.command_create_akasha_smart_booking(text,jsonb,text)'::regprocedure
  ) INTO v_definition;

  v_old := $old$
      v_access_code := app_private.akasha_smart_booking_issue_access_code(v_booking_id, v_count);
      RETURN v_existing_response || jsonb_build_object('access_code', v_access_code);
$old$;
  v_new := $new$
      RETURN v_existing_response || jsonb_build_object(
        'access_code', null,
        'credential_requires_rotation', true
      );
$new$;

  v_replacement_count :=
    (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  IF v_replacement_count <> 1 THEN
    RAISE EXCEPTION 'Smart Booking create idempotency code block changed; expected one match, found %', v_replacement_count;
  END IF;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$
  v_prefix := substring(
    regexp_replace(lower(split_part(v_name, ' ', 1)), '[^a-z0-9]', '', 'g')
    FROM 1 FOR 12
  );
  IF length(coalesce(v_prefix, '')) < 2 THEN
    v_prefix := 'customer';
  END IF;
$old$;
  v_new := $new$
  -- Legacy schema columns remain populated, but are no longer part of the
  -- customer access credential or its entropy.
  v_prefix := 'AK';
$new$;

  v_replacement_count :=
    (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  IF v_replacement_count <> 1 THEN
    RAISE EXCEPTION 'Smart Booking create legacy name-prefix block changed; expected one match, found %', v_replacement_count;
  END IF;
  v_definition := replace(v_definition, v_old, v_new);

  EXECUTE v_definition;
END;
$migration$;

DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_replacement_count integer;
BEGIN
  SELECT pg_get_functiondef(
    'app_private.admin_rotate_akasha_smart_booking_access(uuid,text)'::regprocedure
  ) INTO v_definition;

  v_old := $old$
    v_version := (v_existing_response->>'credential_version')::integer;
    v_code := app_private.akasha_smart_booking_issue_access_code(p_smart_booking_id, v_version);
    RETURN v_existing_response || jsonb_build_object('access_code', v_code);
$old$;
  v_new := $new$
    RETURN v_existing_response || jsonb_build_object(
      'access_code', null,
      'credential_requires_rotation', true
    );
$new$;

  v_replacement_count :=
    (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  IF v_replacement_count <> 1 THEN
    RAISE EXCEPTION 'Smart Booking access rotation replay block changed; expected one match, found %', v_replacement_count;
  END IF;

  EXECUTE replace(v_definition, v_old, v_new);
END;
$migration$;

-- Expose only the catalog target IDs of the customer's own requested lines.
-- No unit IDs, internal renter data, or inventory records are returned.
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
        'line_id', l.smart_booking_line_id,
        'kind', l.line_kind,
$old$;
  v_new := $new$
        'line_id', l.smart_booking_line_id,
        'kind', l.line_kind,
        'barang_id', l.barang_id,
        'varian_barang_id', l.varian_barang_id,
        'paket_sewa_id', l.paket_sewa_id,
$new$;

  v_replacement_count :=
    (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  IF v_replacement_count <> 1 THEN
    RAISE EXCEPTION 'Smart Booking customer portal line DTO changed; expected one match, found %', v_replacement_count;
  END IF;

  EXECUTE replace(v_definition, v_old, v_new);
END;
$migration$;

COMMENT ON FUNCTION app_private.akasha_smart_booking_issue_access_code(uuid, integer)
IS 'Issues an 8-character cryptographically random customer access code; only its HMAC is persisted.';

