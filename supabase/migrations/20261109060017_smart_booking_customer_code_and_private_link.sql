-- Customer login supports either the short access code or a private bearer link.
-- Link tokens are 256-bit random secrets; only their keyed HMAC is stored.
-- The private URL carries the secret in the URL fragment so it is not sent in
-- the HTTP request target, server access log, or Referer header.

ALTER TABLE app_private.akasha_smart_booking_customer_access
  ADD COLUMN IF NOT EXISTS portal_link_hash bytea,
  ADD COLUMN IF NOT EXISTS portal_link_expires_at timestamptz;

-- Code-only login needs an unambiguous lookup within a tenant. Do not reuse
-- historical access codes, even after their credential has been revoked.
CREATE UNIQUE INDEX IF NOT EXISTS akasha_smart_booking_access_code_hash_unique
  ON app_private.akasha_smart_booking_customer_access (usaha_id, access_code_hash)
  WHERE access_code_hash <> decode(repeat('00', 32), 'hex');

CREATE UNIQUE INDEX IF NOT EXISTS akasha_smart_booking_portal_link_hash_unique
  ON app_private.akasha_smart_booking_customer_access (usaha_id, portal_link_hash)
  WHERE portal_link_hash IS NOT NULL;

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
  v_code text;
  v_hash bytea;
  v_index integer;
  v_attempt integer;
  v_usaha_id uuid;
BEGIN
  SELECT a.usaha_id INTO v_usaha_id
  FROM app_private.akasha_smart_booking_customer_access a
  WHERE a.smart_booking_id = p_smart_booking_id
    AND a.credential_version = p_credential_version
    AND a.revoked_at IS NULL
    AND a.expires_at > now()
  FOR UPDATE;

  IF v_usaha_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: active booking access credential not found'
      USING ERRCODE = 'P0002';
  END IF;

  FOR v_attempt IN 1..16 LOOP
    v_random := extensions.gen_random_bytes(8);
    v_code := '';

    FOR v_index IN 0..7 LOOP
      v_code := v_code || substr(
        v_alphabet,
        (get_byte(v_random, v_index) % 32) + 1,
        1
      );
    END LOOP;

    v_hash := app_private.akasha_smart_booking_hmac(
      'customer-access-code',
      lower(v_code)
    );

    IF NOT EXISTS (
      SELECT 1
      FROM app_private.akasha_smart_booking_customer_access a
      WHERE a.usaha_id = v_usaha_id
        AND a.access_code_hash = v_hash
    ) THEN
      RETURN v_code;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'CREDENTIAL_COLLISION: unable to issue a unique customer access code'
    USING ERRCODE = '40001';
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.issue_akasha_smart_booking_portal_link(
  p_smart_booking_id uuid
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_access app_private.akasha_smart_booking_customer_access%ROWTYPE;
  v_token text;
  v_hash bytea;
  v_attempt integer;
BEGIN
  SELECT * INTO v_access
  FROM app_private.akasha_smart_booking_customer_access a
  WHERE a.smart_booking_id = p_smart_booking_id
    AND a.revoked_at IS NULL
    AND a.expires_at > now()
  ORDER BY a.credential_version DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: active booking access credential not found'
      USING ERRCODE = 'P0002';
  END IF;

  FOR v_attempt IN 1..4 LOOP
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_hash := app_private.akasha_smart_booking_hmac(
      'customer-portal-link',
      lower(v_token)
    );

    IF NOT EXISTS (
      SELECT 1
      FROM app_private.akasha_smart_booking_customer_access a
      WHERE a.usaha_id = v_access.usaha_id
        AND a.portal_link_hash = v_hash
    ) THEN
      UPDATE app_private.akasha_smart_booking_customer_access
      SET
        portal_link_hash = v_hash,
        portal_link_expires_at = v_access.expires_at
      WHERE smart_booking_access_id = v_access.smart_booking_access_id;

      RETURN v_token;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'CREDENTIAL_COLLISION: unable to issue a unique private portal link'
    USING ERRCODE = '40001';
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.exchange_akasha_smart_booking_customer_credential(
  p_slug text,
  p_credential text,
  p_credential_type text,
  p_client_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_usaha_id uuid;
  v_credential text := btrim(coalesce(p_credential, ''));
  v_fingerprint_hash bytea;
  v_expected_hash bytea;
  v_access app_private.akasha_smart_booking_customer_access%ROWTYPE;
  v_booking app_private.akasha_smart_booking%ROWTYPE;
  v_throttle app_private.akasha_smart_booking_access_throttle%ROWTYPE;
  v_session_token text;
  v_session_expiry timestamptz;
  v_fail_count integer;
  v_valid boolean := false;
BEGIN
  SELECT u.usaha_id INTO v_usaha_id
  FROM public.usaha u
  WHERE u.slug = btrim(coalesce(p_slug, ''))
    AND u.status = 'active'
  LIMIT 1;

  IF v_usaha_id IS NULL
     OR p_credential_type IS NULL
     OR p_credential_type NOT IN ('code', 'link')
     OR length(v_credential) < 4
     OR length(v_credential) > 128
     OR length(coalesce(p_client_fingerprint, '')) < 8
     OR length(coalesce(p_client_fingerprint, '')) > 500 THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  IF p_credential_type = 'link'
     AND v_credential !~* '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  IF p_credential_type = 'code' AND length(v_credential) > 40 THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  v_fingerprint_hash := app_private.akasha_smart_booking_hmac(
    'client-fingerprint',
    p_client_fingerprint
  );

  DELETE FROM app_private.akasha_smart_booking_access_throttle
  WHERE usaha_id = v_usaha_id
    AND last_attempt_at < now() - interval '30 days';

  SELECT * INTO v_throttle
  FROM app_private.akasha_smart_booking_access_throttle t
  WHERE t.usaha_id = v_usaha_id
    AND t.client_fingerprint_hash = v_fingerprint_hash
  FOR UPDATE;

  IF FOUND
     AND v_throttle.blocked_until IS NOT NULL
     AND v_throttle.blocked_until > now() THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  v_expected_hash := app_private.akasha_smart_booking_hmac(
    CASE
      WHEN p_credential_type = 'code' THEN 'customer-access-code'
      ELSE 'customer-portal-link'
    END,
    lower(v_credential)
  );

  IF p_credential_type = 'code' THEN
    SELECT * INTO v_access
    FROM app_private.akasha_smart_booking_customer_access a
    WHERE a.usaha_id = v_usaha_id
      AND a.access_code_hash = v_expected_hash
      AND a.revoked_at IS NULL
    LIMIT 1
    FOR UPDATE;
  ELSE
    SELECT * INTO v_access
    FROM app_private.akasha_smart_booking_customer_access a
    WHERE a.usaha_id = v_usaha_id
      AND a.portal_link_hash = v_expected_hash
      AND a.revoked_at IS NULL
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_access.smart_booking_access_id IS NOT NULL THEN
    SELECT * INTO v_booking
    FROM app_private.akasha_smart_booking b
    WHERE b.smart_booking_id = v_access.smart_booking_id
      AND b.usaha_id = v_access.usaha_id;

    v_valid := FOUND
      AND v_access.expires_at > now()
      AND (v_access.locked_until IS NULL OR v_access.locked_until <= now());

    IF p_credential_type = 'link' THEN
      v_valid := v_valid
        AND v_access.portal_link_expires_at IS NOT NULL
        AND v_access.portal_link_expires_at > now()
        AND v_access.portal_link_hash = v_expected_hash;
    ELSE
      v_valid := v_valid AND v_access.access_code_hash = v_expected_hash;
    END IF;
  END IF;

  IF NOT v_valid THEN
    INSERT INTO app_private.akasha_smart_booking_access_throttle (
      usaha_id, client_fingerprint_hash, window_started_at,
      failure_count, last_attempt_at
    )
    VALUES (v_usaha_id, v_fingerprint_hash, now(), 1, now())
    ON CONFLICT (usaha_id, client_fingerprint_hash)
    DO UPDATE SET
      failure_count = CASE
        WHEN app_private.akasha_smart_booking_access_throttle.window_started_at
          < now() - interval '15 minutes'
        THEN 1
        ELSE app_private.akasha_smart_booking_access_throttle.failure_count + 1
      END,
      window_started_at = CASE
        WHEN app_private.akasha_smart_booking_access_throttle.window_started_at
          < now() - interval '15 minutes'
        THEN now()
        ELSE app_private.akasha_smart_booking_access_throttle.window_started_at
      END,
      blocked_until = CASE
        WHEN (
          CASE
            WHEN app_private.akasha_smart_booking_access_throttle.window_started_at
              < now() - interval '15 minutes'
            THEN 1
            ELSE app_private.akasha_smart_booking_access_throttle.failure_count + 1
          END
        ) >= 5
        THEN now() + interval '15 minutes'
        ELSE app_private.akasha_smart_booking_access_throttle.blocked_until
      END,
      last_attempt_at = now()
    RETURNING failure_count INTO v_fail_count;

    IF v_access.smart_booking_access_id IS NOT NULL THEN
      UPDATE app_private.akasha_smart_booking_customer_access
      SET
        failed_attempt_count = failed_attempt_count + 1,
        locked_until = CASE
          WHEN failed_attempt_count + 1 >= 5 THEN now() + interval '15 minutes'
          ELSE locked_until
        END
      WHERE smart_booking_access_id = v_access.smart_booking_access_id;
    END IF;

    RETURN jsonb_build_object('ok', false);
  END IF;

  v_session_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_session_expiry := now() + interval '7 days';

  INSERT INTO app_private.akasha_smart_booking_customer_session (
    usaha_id, smart_booking_id, smart_booking_access_id,
    session_token_hash, expires_at, client_fingerprint_hash
  )
  VALUES (
    v_usaha_id,
    v_booking.smart_booking_id,
    v_access.smart_booking_access_id,
    app_private.akasha_smart_booking_hmac('portal-session', v_session_token),
    v_session_expiry,
    v_fingerprint_hash
  );

  UPDATE app_private.akasha_smart_booking_customer_access
  SET last_used_at = now(), failed_attempt_count = 0, locked_until = NULL
  WHERE smart_booking_access_id = v_access.smart_booking_access_id;

  DELETE FROM app_private.akasha_smart_booking_access_throttle
  WHERE usaha_id = v_usaha_id
    AND client_fingerprint_hash = v_fingerprint_hash;

  RETURN jsonb_build_object(
    'ok', true,
    'session_token', v_session_token,
    'expires_at', v_session_expiry
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.exchange_akasha_smart_booking_customer_credential(
  p_slug text,
  p_credential text,
  p_credential_type text,
  p_client_fingerprint text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.exchange_akasha_smart_booking_customer_credential($1, $2, $3, $4);
$function$;

-- Return the private link only on the first successful create response.
-- It is deliberately not written to public.idempotency_key.response_body.
CREATE OR REPLACE FUNCTION public.command_create_akasha_smart_booking(
  p_slug text,
  p_booking jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_response jsonb;
  v_booking_id uuid;
  v_usaha_id uuid;
  v_quote_total numeric(14,2);
  v_currency_code text;
  v_portal_link_token text;
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

  SELECT b.usaha_id, b.quote_total, b.currency_code
  INTO v_usaha_id, v_quote_total, v_currency_code
  FROM app_private.akasha_smart_booking b
  WHERE b.smart_booking_id = v_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_SNAPSHOT_MISSING: quote booking tidak ditemukan'
      USING ERRCODE = 'P0002';
  END IF;

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

  v_response := jsonb_set(
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

  IF nullif(v_response->>'access_code', '') IS NOT NULL THEN
    v_portal_link_token := app_private.issue_akasha_smart_booking_portal_link(v_booking_id);
    v_response := v_response || jsonb_build_object('portal_link_token', v_portal_link_token);
  END IF;

  RETURN v_response;
END;
$function$;

-- The admin's existing access-rotation flow now rotates both credentials:
-- a fresh code and a fresh private link. Replayed idempotency keys disclose
-- neither secret a second time.
CREATE OR REPLACE FUNCTION public.admin_rotate_akasha_smart_booking_access(
  p_smart_booking_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_response jsonb;
  v_portal_link_token text;
BEGIN
  v_response := app_private.admin_rotate_akasha_smart_booking_access(
    p_smart_booking_id,
    p_idempotency_key
  );

  IF nullif(v_response->>'access_code', '') IS NOT NULL THEN
    v_portal_link_token := app_private.issue_akasha_smart_booking_portal_link(p_smart_booking_id);
    v_response := v_response || jsonb_build_object('portal_link_token', v_portal_link_token);
  END IF;

  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.issue_akasha_smart_booking_portal_link(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.exchange_akasha_smart_booking_customer_credential(text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.exchange_akasha_smart_booking_customer_credential(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exchange_akasha_smart_booking_customer_credential(text, text, text, text) TO service_role;

COMMENT ON COLUMN app_private.akasha_smart_booking_customer_access.portal_link_hash
  IS 'HMAC of the 256-bit private customer portal link token. The clear token is returned only once.';

COMMENT ON COLUMN app_private.akasha_smart_booking_customer_access.portal_link_expires_at
  IS 'Private portal-link expiry; constrained to the underlying customer credential expiry.';
