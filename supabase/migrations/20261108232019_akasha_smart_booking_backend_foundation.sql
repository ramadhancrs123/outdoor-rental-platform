-- ============================================================================
-- AKASHA SMART BOOKING — isolated backend foundation
-- Additive only. Existing rental, inventory, catalog, sales and checkout
-- functions/tables/triggers are intentionally not redefined by this migration.
-- Booking records customer intent only; there is no stock hold, stock mutation,
-- unit assignment, inventory history, or sales/rental transaction creation.
-- ============================================================================

-- Vault pepper is generated once and remains encrypted at rest.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.secrets
    WHERE name = 'akasha_smart_booking_access_pepper'
  ) THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'akasha_smart_booking_access_pepper',
      'HMAC pepper for AKASHA SMART BOOKING customer access codes and portal sessions'
    );
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS app_private.akasha_smart_booking (
  smart_booking_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL REFERENCES public.usaha(usaha_id) ON DELETE RESTRICT,
  reservasi_id uuid REFERENCES public.reservasi(reservasi_id) ON DELETE RESTRICT,
  permintaan_sewa_id uuid REFERENCES public.permintaan_sewa(permintaan_sewa_id) ON DELETE RESTRICT,
  penyewa_id uuid REFERENCES public.penyewa(penyewa_id) ON DELETE RESTRICT,
  reference_code varchar(8) NOT NULL,
  workflow_status text NOT NULL DEFAULT 'received'
    CHECK (workflow_status IN (
      'received',
      'reviewing',
      'acknowledged',
      'customer_action_required',
      'change_requested',
      'cancellation_pending',
      'ready_for_checkout',
      'cancelled',
      'expired',
      'fulfilled'
    )),
  customer_name text NOT NULL CHECK (length(btrim(customer_name)) BETWEEN 2 AND 120),
  customer_phone text NOT NULL CHECK (length(customer_phone) BETWEEN 8 AND 32),
  customer_phone_normalized text NOT NULL CHECK (customer_phone_normalized ~ '^[0-9]{8,16}$'),
  customer_note text CHECK (customer_note IS NULL OR length(customer_note) <= 500),
  requested_pickup_date date,
  requested_return_date date,
  requested_pickup_at timestamptz,
  requested_return_at timestamptz,
  business_timezone text NOT NULL DEFAULT 'Asia/Jakarta',
  quote_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (quote_total >= 0),
  currency_code char(3) NOT NULL DEFAULT 'IDR' CHECK (currency_code = 'IDR'),
  quote_expires_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.akun_admin(akun_admin_id) ON DELETE SET NULL,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT akasha_smart_booking_reference_format
    CHECK (reference_code ~ '^AK[A-HJ-NP-Z2-9]{6}$'),
  CONSTRAINT akasha_smart_booking_date_order
    CHECK (
      requested_pickup_date IS NULL
      OR requested_return_date IS NULL
      OR requested_return_date >= requested_pickup_date
    ),
  CONSTRAINT akasha_smart_booking_timestamp_order
    CHECK (
      requested_pickup_at IS NULL
      OR requested_return_at IS NULL
      OR requested_return_at > requested_pickup_at
    ),
  CONSTRAINT akasha_smart_booking_has_rental_period
    CHECK (
      reservasi_id IS NULL
      OR (
        requested_pickup_date IS NOT NULL
        AND requested_return_date IS NOT NULL
      )
    ),
  CONSTRAINT akasha_smart_booking_reservation_unique UNIQUE (reservasi_id),
  CONSTRAINT akasha_smart_booking_tenant_id_unique UNIQUE (usaha_id, smart_booking_id),
  CONSTRAINT akasha_smart_booking_reference_unique UNIQUE (usaha_id, reference_code)
);

CREATE INDEX IF NOT EXISTS akasha_smart_booking_queue_idx
  ON app_private.akasha_smart_booking (usaha_id, workflow_status, created_at DESC);
CREATE INDEX IF NOT EXISTS akasha_smart_booking_pickup_idx
  ON app_private.akasha_smart_booking (usaha_id, requested_pickup_date, workflow_status)
  WHERE requested_pickup_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS akasha_smart_booking_customer_search_idx
  ON app_private.akasha_smart_booking (usaha_id, customer_phone_normalized, created_at DESC);
CREATE INDEX IF NOT EXISTS akasha_smart_booking_name_search_idx
  ON app_private.akasha_smart_booking USING gin (to_tsvector('simple', customer_name));

CREATE TABLE IF NOT EXISTS app_private.akasha_smart_booking_line (
  smart_booking_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  smart_booking_id uuid NOT NULL,
  line_kind text NOT NULL CHECK (line_kind IN ('rental', 'sale')),
  barang_id uuid,
  varian_barang_id uuid,
  paket_sewa_id uuid,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  item_name_snapshot text NOT NULL,
  variant_label_snapshot text,
  inventory_mode_snapshot text,
  unit_price_snapshot numeric(14,2) NOT NULL CHECK (unit_price_snapshot >= 0),
  normal_price_snapshot numeric(14,2) NOT NULL CHECK (normal_price_snapshot >= 0),
  discount_percent_snapshot numeric(5,2) NOT NULL DEFAULT 0
    CHECK (discount_percent_snapshot BETWEEN 0 AND 100),
  discount_amount_snapshot numeric(14,2) NOT NULL DEFAULT 0
    CHECK (discount_amount_snapshot >= 0),
  subtotal_snapshot numeric(14,2) NOT NULL CHECK (subtotal_snapshot >= 0),
  currency_code char(3) NOT NULL DEFAULT 'IDR' CHECK (currency_code = 'IDR'),
  tarif_sewa_id uuid,
  promosi_katalog_id uuid,
  promosi_paket_id uuid,
  line_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  line_position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT akasha_smart_booking_line_booking_fk
    FOREIGN KEY (usaha_id, smart_booking_id)
    REFERENCES app_private.akasha_smart_booking(usaha_id, smart_booking_id)
    ON DELETE CASCADE,
  CONSTRAINT akasha_smart_booking_line_target_check
    CHECK (num_nonnulls(barang_id, varian_barang_id, paket_sewa_id) = 1),
  CONSTRAINT akasha_smart_booking_line_kind_check
    CHECK (
      (line_kind = 'rental' AND (tarif_sewa_id IS NOT NULL OR paket_sewa_id IS NOT NULL))
      OR
      (line_kind = 'sale' AND paket_sewa_id IS NULL AND tarif_sewa_id IS NULL)
    ),
  CONSTRAINT akasha_smart_booking_line_discount_math
    CHECK (discount_amount_snapshot <= normal_price_snapshot * quantity + 0.01)
);

CREATE INDEX IF NOT EXISTS akasha_smart_booking_line_booking_idx
  ON app_private.akasha_smart_booking_line (usaha_id, smart_booking_id, line_position);
CREATE INDEX IF NOT EXISTS akasha_smart_booking_line_product_idx
  ON app_private.akasha_smart_booking_line (usaha_id, barang_id)
  WHERE barang_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS akasha_smart_booking_line_variant_idx
  ON app_private.akasha_smart_booking_line (usaha_id, varian_barang_id)
  WHERE varian_barang_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_private.akasha_smart_booking_customer_access (
  smart_booking_access_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  smart_booking_id uuid NOT NULL,
  access_code_prefix varchar(12) NOT NULL
    CHECK (access_code_prefix ~ '^[a-z0-9]{2,12}$'),
  access_code_year char(4) NOT NULL CHECK (access_code_year ~ '^[0-9]{4}$'),
  access_code_hash bytea NOT NULL,
  credential_version integer NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  failed_attempt_count integer NOT NULL DEFAULT 0 CHECK (failed_attempt_count >= 0),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT akasha_smart_booking_access_booking_fk
    FOREIGN KEY (usaha_id, smart_booking_id)
    REFERENCES app_private.akasha_smart_booking(usaha_id, smart_booking_id)
    ON DELETE CASCADE,
  CONSTRAINT akasha_smart_booking_access_version_unique
    UNIQUE (smart_booking_id, credential_version)
);

CREATE UNIQUE INDEX IF NOT EXISTS akasha_smart_booking_access_one_active_idx
  ON app_private.akasha_smart_booking_customer_access (smart_booking_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS akasha_smart_booking_access_expiry_idx
  ON app_private.akasha_smart_booking_customer_access (expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS app_private.akasha_smart_booking_customer_session (
  smart_booking_session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  smart_booking_id uuid NOT NULL,
  smart_booking_access_id uuid NOT NULL,
  session_token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  client_fingerprint_hash bytea,
  CONSTRAINT akasha_smart_booking_session_booking_fk
    FOREIGN KEY (usaha_id, smart_booking_id)
    REFERENCES app_private.akasha_smart_booking(usaha_id, smart_booking_id)
    ON DELETE CASCADE,
  CONSTRAINT akasha_smart_booking_session_access_fk
    FOREIGN KEY (smart_booking_access_id)
    REFERENCES app_private.akasha_smart_booking_customer_access(smart_booking_access_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS akasha_smart_booking_session_active_idx
  ON app_private.akasha_smart_booking_customer_session (smart_booking_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS app_private.akasha_smart_booking_access_throttle (
  usaha_id uuid NOT NULL REFERENCES public.usaha(usaha_id) ON DELETE CASCADE,
  client_fingerprint_hash bytea NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  blocked_until timestamptz,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usaha_id, client_fingerprint_hash)
);

CREATE TABLE IF NOT EXISTS app_private.akasha_smart_booking_change_request (
  smart_booking_change_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  smart_booking_id uuid NOT NULL,
  request_type text NOT NULL CHECK (request_type IN (
    'item_change',
    'variant_change',
    'quantity_change',
    'schedule_change',
    'cancellation',
    'alternative_interest',
    'other',
    'alternative_offer'
  )),
  requested_by_type text NOT NULL CHECK (requested_by_type IN ('customer', 'admin')),
  requested_by_admin_id uuid REFERENCES public.akun_admin(akun_admin_id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text CHECK (reason IS NULL OR length(reason) <= 500),
  request_status text NOT NULL DEFAULT 'pending'
    CHECK (request_status IN ('pending', 'approved', 'rejected', 'withdrawn', 'applied')),
  previous_workflow_status text NOT NULL,
  resolved_by_admin_id uuid REFERENCES public.akun_admin(akun_admin_id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolution_note text CHECK (resolution_note IS NULL OR length(resolution_note) <= 1000),
  public_resolution_note text CHECK (
    public_resolution_note IS NULL OR length(public_resolution_note) <= 500
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT akasha_smart_booking_change_booking_fk
    FOREIGN KEY (usaha_id, smart_booking_id)
    REFERENCES app_private.akasha_smart_booking(usaha_id, smart_booking_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS akasha_smart_booking_change_queue_idx
  ON app_private.akasha_smart_booking_change_request (usaha_id, request_status, created_at DESC);
CREATE INDEX IF NOT EXISTS akasha_smart_booking_change_booking_idx
  ON app_private.akasha_smart_booking_change_request (smart_booking_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app_private.akasha_smart_booking_activity_event (
  smart_booking_activity_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  smart_booking_id uuid NOT NULL,
  event_type text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('customer', 'admin', 'system')),
  actor_admin_id uuid REFERENCES public.akun_admin(akun_admin_id) ON DELETE SET NULL,
  customer_visible boolean NOT NULL DEFAULT false,
  public_message text CHECK (public_message IS NULL OR length(public_message) <= 500),
  internal_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT akasha_smart_booking_event_booking_fk
    FOREIGN KEY (usaha_id, smart_booking_id)
    REFERENCES app_private.akasha_smart_booking(usaha_id, smart_booking_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS akasha_smart_booking_event_timeline_idx
  ON app_private.akasha_smart_booking_activity_event (smart_booking_id, created_at);

-- These tables are intentionally private. All access is through the RPC boundary.
ALTER TABLE app_private.akasha_smart_booking ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.akasha_smart_booking FORCE ROW LEVEL SECURITY;
ALTER TABLE app_private.akasha_smart_booking_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.akasha_smart_booking_line FORCE ROW LEVEL SECURITY;
ALTER TABLE app_private.akasha_smart_booking_customer_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.akasha_smart_booking_customer_access FORCE ROW LEVEL SECURITY;
ALTER TABLE app_private.akasha_smart_booking_customer_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.akasha_smart_booking_customer_session FORCE ROW LEVEL SECURITY;
ALTER TABLE app_private.akasha_smart_booking_access_throttle ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.akasha_smart_booking_access_throttle FORCE ROW LEVEL SECURITY;
ALTER TABLE app_private.akasha_smart_booking_change_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.akasha_smart_booking_change_request FORCE ROW LEVEL SECURITY;
ALTER TABLE app_private.akasha_smart_booking_activity_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.akasha_smart_booking_activity_event FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  app_private.akasha_smart_booking,
  app_private.akasha_smart_booking_line,
  app_private.akasha_smart_booking_customer_access,
  app_private.akasha_smart_booking_customer_session,
  app_private.akasha_smart_booking_access_throttle,
  app_private.akasha_smart_booking_change_request,
  app_private.akasha_smart_booking_activity_event
FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE app_private.akasha_smart_booking IS
  'AKASHA SMART BOOKING aggregate; intent/request only, never a stock allocation or operational transaction.';
COMMENT ON TABLE app_private.akasha_smart_booking_line IS
  'Customer-requested rental/sale lines and price snapshots; no stock movement or transaction.';
COMMENT ON TABLE app_private.akasha_smart_booking_customer_access IS
  'HMAC-only memorable customer access credential; plaintext code is deterministically re-derived for one-time delivery.';
COMMENT ON TABLE app_private.akasha_smart_booking_customer_session IS
  'HMAC-only short-lived customer portal sessions.';
COMMENT ON TABLE app_private.akasha_smart_booking_change_request IS
  'Customer/admin booking change requests; requests do not directly mutate operational domains.';
COMMENT ON TABLE app_private.akasha_smart_booking_activity_event IS
  'Booking workflow timeline only; deliberately excludes inventory availability history.';

CREATE OR REPLACE FUNCTION app_private.akasha_smart_booking_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_akasha_smart_booking_touch_updated_at
  ON app_private.akasha_smart_booking;
CREATE TRIGGER trg_akasha_smart_booking_touch_updated_at
  BEFORE UPDATE ON app_private.akasha_smart_booking
  FOR EACH ROW EXECUTE FUNCTION app_private.akasha_smart_booking_touch_updated_at();

DROP TRIGGER IF EXISTS trg_akasha_smart_booking_line_touch_updated_at
  ON app_private.akasha_smart_booking_line;
CREATE TRIGGER trg_akasha_smart_booking_line_touch_updated_at
  BEFORE UPDATE ON app_private.akasha_smart_booking_line
  FOR EACH ROW EXECUTE FUNCTION app_private.akasha_smart_booking_touch_updated_at();

CREATE OR REPLACE FUNCTION app_private.akasha_smart_booking_hmac(
  p_domain text,
  p_value text
)
RETURNS bytea
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_pepper text;
BEGIN
  SELECT ds.decrypted_secret
  INTO v_pepper
  FROM vault.decrypted_secrets ds
  WHERE ds.name = 'akasha_smart_booking_access_pepper'
  LIMIT 1;

  IF v_pepper IS NULL OR length(v_pepper) < 32 THEN
    RAISE EXCEPTION 'CONFIGURATION_ERROR: booking credential secret is unavailable'
      USING ERRCODE = '55000';
  END IF;

  RETURN extensions.hmac(
    convert_to(coalesce(p_domain, '') || ':' || coalesce(p_value, ''), 'UTF8'),
    decode(v_pepper, 'hex'),
    'sha256'
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.akasha_smart_booking_hmac(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.akasha_smart_booking_new_reference()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_random bytea;
  v_result text;
  v_i integer;
BEGIN
  v_random := extensions.gen_random_bytes(8);
  v_result := 'AK';
  FOR v_i IN 0..5 LOOP
    v_result := v_result || substr(
      v_alphabet,
      (get_byte(v_random, v_i) % 32) + 1,
      1
    );
  END LOOP;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.akasha_smart_booking_new_reference()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.akasha_smart_booking_issue_access_code(
  p_smart_booking_id uuid,
  p_credential_version integer
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_prefix text;
  v_year text;
  v_digest bytea;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_suffix text := '';
  v_i integer;
BEGIN
  SELECT a.access_code_prefix, a.access_code_year
  INTO v_prefix, v_year
  FROM app_private.akasha_smart_booking_customer_access a
  WHERE a.smart_booking_id = p_smart_booking_id
    AND a.credential_version = p_credential_version
    AND a.revoked_at IS NULL
  LIMIT 1;

  IF v_prefix IS NULL OR v_year IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: active booking access credential not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_digest := app_private.akasha_smart_booking_hmac(
    'issued-access-code',
    p_smart_booking_id::text || ':' || p_credential_version::text
  );

  FOR v_i IN 0..2 LOOP
    v_suffix := v_suffix || substr(
      v_alphabet,
      (get_byte(v_digest, v_i) % 32) + 1,
      1
    );
  END LOOP;

  RETURN v_prefix || v_year || v_suffix;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.akasha_smart_booking_issue_access_code(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Atomic public booking creation. The legacy rental command is reused only
-- for rental intent; purchase intent stays in the new booking bounded context.
-- The legacy command's semantics and operational code are not modified.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.command_create_akasha_smart_booking(
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
  v_usaha public.usaha%ROWTYPE;
  v_key text;
  v_legacy_key text;
  v_request_hash text;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_response jsonb;
  v_legacy_response jsonb;
  v_booking_id uuid;
  v_reservasi_id uuid;
  v_permintaan_id uuid;
  v_penyewa_id uuid;
  v_reference text;
  v_name text;
  v_phone text;
  v_phone_normalized text;
  v_note text;
  v_timezone text;
  v_pickup_date date;
  v_return_date date;
  v_pickup_at timestamptz;
  v_return_at timestamptz;
  v_rental_lines jsonb;
  v_sale_lines jsonb;
  v_line jsonb;
  v_count integer;
  v_ref_attempt integer;
  v_total_rental numeric(14,2) := 0;
  v_total_sale numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_prefix text;
  v_access_year text;
  v_access_code text;
  v_access_hash bytea;
  v_access_expiry timestamptz;
  v_revoked_at timestamptz;
  v_item_id uuid;
  v_variant_id uuid;
  v_resolved_product_id uuid;
  v_item_name text;
  v_variant_name text;
  v_inventory_mode text;
  v_normal_price numeric(14,2);
  v_discount_percent numeric(5,2);
  v_discount_amount numeric(14,2);
  v_effective_price numeric(14,2);
  v_quantity numeric(12,3);
  v_promo_id uuid;
BEGIN
  SELECT * INTO v_usaha
  FROM public.usaha u
  WHERE u.slug = btrim(coalesce(p_slug, ''))
    AND u.status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha tidak ditemukan atau tidak aktif'
      USING ERRCODE = 'P0002';
  END IF;

  v_key := btrim(coalesce(p_idempotency_key, ''));
  IF v_key = '' OR length(v_key) > 80 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key wajib diisi (maks 80 karakter)'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_booking) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: booking harus berupa objek'
      USING ERRCODE = '22023';
  END IF;

  v_name := btrim(coalesce(p_booking->>'nama', ''));
  IF length(v_name) < 2 OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: nama wajib diisi (2-120 karakter)'
      USING ERRCODE = '22023';
  END IF;

  v_phone := btrim(coalesce(p_booking->>'telepon', ''));
  v_phone_normalized := regexp_replace(v_phone, '[^0-9]', '', 'g');
  IF length(v_phone_normalized) < 8 OR length(v_phone_normalized) > 16 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: nomor WhatsApp tidak valid'
      USING ERRCODE = '22023';
  END IF;

  v_note := nullif(btrim(coalesce(p_booking->>'catatan', '')), '');
  IF length(coalesce(v_note, '')) > 500 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: catatan maksimum 500 karakter'
      USING ERRCODE = '22023';
  END IF;

  v_timezone := coalesce(nullif(v_usaha.timezone, ''), 'Asia/Jakarta');
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names tz WHERE tz.name = v_timezone
  ) THEN
    RAISE EXCEPTION 'CONFIGURATION_ERROR: timezone usaha tidak valid'
      USING ERRCODE = '22023';
  END IF;

  v_rental_lines := coalesce(p_booking->'lines', '[]'::jsonb);
  v_sale_lines := coalesce(p_booking->'purchase_lines', '[]'::jsonb);
  IF jsonb_typeof(v_rental_lines) IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_sale_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: lines dan purchase_lines harus berupa array'
      USING ERRCODE = '22023';
  END IF;

  v_count := jsonb_array_length(v_rental_lines) + jsonb_array_length(v_sale_lines);
  IF v_count < 1 OR v_count > 10 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: booking harus memiliki 1-10 item'
      USING ERRCODE = '22023';
  END IF;

  v_pickup_at := nullif(p_booking->>'requested_pickup_at', '')::timestamptz;
  v_return_at := nullif(p_booking->>'requested_return_at', '')::timestamptz;
  v_pickup_date := coalesce(
    nullif(p_booking->>'mulai_rencana', '')::date,
    (v_pickup_at AT TIME ZONE v_timezone)::date
  );
  v_return_date := coalesce(
    nullif(p_booking->>'selesai_rencana', '')::date,
    (v_return_at AT TIME ZONE v_timezone)::date
  );

  IF jsonb_array_length(v_rental_lines) > 0 THEN
    IF v_pickup_date IS NULL OR v_return_date IS NULL
       OR v_pickup_date < (now() AT TIME ZONE v_timezone)::date
       OR v_return_date < v_pickup_date THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: periode rental tidak valid'
        USING ERRCODE = '22023';
    END IF;
    IF v_pickup_at IS NOT NULL AND v_return_at IS NOT NULL
       AND v_return_at <= v_pickup_at THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: waktu pengembalian harus setelah waktu pengambilan'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_request_hash := encode(
    extensions.digest(
      convert_to(jsonb_build_object('slug', p_slug, 'booking', p_booking)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.idempotency_key (
    usaha_id, actor_auth_user_id, key, command_name, request_hash
  )
  VALUES (
    v_usaha.usaha_id, NULL, v_key, 'create_akasha_smart_booking', v_request_hash
  )
  ON CONFLICT (usaha_id, command_name, key) WHERE actor_auth_user_id IS NULL
  DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT ik.request_hash, ik.response_body
      INTO v_existing_hash, v_existing_response
    FROM public.idempotency_key ik
    WHERE ik.usaha_id = v_usaha.usaha_id
      AND ik.actor_auth_user_id IS NULL
      AND ik.command_name = 'create_akasha_smart_booking'
      AND ik.key = v_key;

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah dipakai untuk payload berbeda'
        USING ERRCODE = '23505';
    END IF;
    IF v_existing_response IS NULL THEN
      RAISE EXCEPTION 'UNKNOWN_OUTCOME: booking sedang diproses, periksa kembali statusnya'
        USING ERRCODE = '40001';
    END IF;

    v_booking_id := (v_existing_response->>'smart_booking_id')::uuid;
    SELECT a.credential_version, a.expires_at, a.revoked_at
      INTO v_count, v_access_expiry, v_revoked_at
    FROM app_private.akasha_smart_booking_customer_access a
    WHERE a.smart_booking_id = v_booking_id
    ORDER BY a.credential_version DESC
    LIMIT 1;

    IF v_count IS NOT NULL AND v_revoked_at IS NULL
       AND v_access_expiry > now() THEN
      v_access_code := app_private.akasha_smart_booking_issue_access_code(v_booking_id, v_count);
      RETURN v_existing_response || jsonb_build_object('access_code', v_access_code);
    END IF;

    RETURN v_existing_response || jsonb_build_object('access_code', null, 'credential_requires_rotation', true);
  END IF;

  -- Rental intent uses the existing non-lock booking command. Its implementation
  -- is deliberately not changed by this migration.
  IF jsonb_array_length(v_rental_lines) > 0 THEN
    v_legacy_key := 'akasha-smart:' || v_key;
    v_legacy_response := public.command_create_website_booking(
      v_usaha.slug,
      jsonb_set(p_booking, '{lines}', v_rental_lines, true),
      v_legacy_key
    );
    v_reservasi_id := (v_legacy_response->>'reservasi_id')::uuid;
    v_permintaan_id := (v_legacy_response->>'permintaan_sewa_id')::uuid;
    SELECT r.penyewa_id INTO v_penyewa_id
    FROM public.reservasi r
    WHERE r.usaha_id = v_usaha.usaha_id
      AND r.reservasi_id = v_reservasi_id;
    v_total_rental := coalesce((v_legacy_response->>'total_harga')::numeric, 0);
  END IF;

  -- Customer reference is independent from the legacy reservation number and
  -- is not used as a credential. Unique constraint + retry protects collisions.
  FOR v_ref_attempt IN 1..8 LOOP
    v_reference := app_private.akasha_smart_booking_new_reference();
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM app_private.akasha_smart_booking b
      WHERE b.usaha_id = v_usaha.usaha_id AND b.reference_code = v_reference
    );
  END LOOP;
  IF v_reference IS NULL OR EXISTS (
    SELECT 1 FROM app_private.akasha_smart_booking b
    WHERE b.usaha_id = v_usaha.usaha_id AND b.reference_code = v_reference
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: nomor referensi tidak dapat dibuat'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO app_private.akasha_smart_booking (
    usaha_id, reservasi_id, permintaan_sewa_id, penyewa_id,
    reference_code, workflow_status, customer_name, customer_phone,
    customer_phone_normalized, customer_note, requested_pickup_date,
    requested_return_date, requested_pickup_at, requested_return_at,
    business_timezone, quote_total, currency_code
  )
  VALUES (
    v_usaha.usaha_id, v_reservasi_id, v_permintaan_id, v_penyewa_id,
    v_reference, 'received', v_name, v_phone, v_phone_normalized,
    v_note, v_pickup_date, v_return_date, v_pickup_at, v_return_at,
    v_timezone, v_total_rental, 'IDR'
  )
  RETURNING smart_booking_id INTO v_booking_id;

  -- Copy rental line snapshots into the booking bounded context. The legacy
  -- detail_reservasi row remains untouched and continues to have its old meaning.
  IF v_reservasi_id IS NOT NULL THEN
    INSERT INTO app_private.akasha_smart_booking_line (
      usaha_id, smart_booking_id, line_kind, barang_id, varian_barang_id,
      paket_sewa_id, quantity, item_name_snapshot, variant_label_snapshot,
      inventory_mode_snapshot, unit_price_snapshot, normal_price_snapshot,
      discount_percent_snapshot, discount_amount_snapshot, subtotal_snapshot,
      currency_code, tarif_sewa_id, promosi_katalog_id, promosi_paket_id,
      line_position
    )
    SELECT
      d.usaha_id,
      v_booking_id,
      'rental',
      d.barang_id,
      d.varian_barang_id,
      d.paket_sewa_id,
      d.jumlah,
      coalesce(b.nama, vb.nama, ps.nama, 'Item rental'),
      vb.nama,
      'serialized',
      coalesce(d.unit_price, 0),
      coalesce(d.harga_normal_snapshot, d.unit_price, 0),
      coalesce(d.diskon_persen_snapshot, 0),
      coalesce(d.nominal_diskon_snapshot, 0),
      coalesce(d.subtotal, 0),
      coalesce(d.currency_code::text, 'IDR'),
      d.tarif_sewa_id,
      d.promosi_katalog_id,
      d.promosi_paket_id,
      row_number() OVER (ORDER BY d.created_at, d.detail_reservasi_id)::integer
    FROM public.detail_reservasi d
    LEFT JOIN public.barang b
      ON b.usaha_id = d.usaha_id AND b.barang_id = d.barang_id
    LEFT JOIN public.varian_barang vb
      ON vb.usaha_id = d.usaha_id AND vb.varian_barang_id = d.varian_barang_id
    LEFT JOIN public.paket_sewa ps
      ON ps.usaha_id = d.usaha_id AND ps.paket_sewa_id = d.paket_sewa_id
    WHERE d.usaha_id = v_usaha.usaha_id
      AND d.reservasi_id = v_reservasi_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: snapshot rental booking tidak ditemukan'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Purchase intent is stored only as a booking quote. No stock, sales, checkout,
  -- finance, payment or unit tables are written here.
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_sale_lines)
  LOOP
    v_item_id := nullif(v_line->>'barang_id', '')::uuid;
    v_variant_id := nullif(v_line->>'varian_barang_id', '')::uuid;
    IF num_nonnulls(v_item_id, v_variant_id) <> 1 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: item pembelian harus memilih satu barang atau varian'
        USING ERRCODE = '22023';
    END IF;

    IF coalesce(v_line->>'jumlah', '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: jumlah pembelian harus berupa bilangan bulat'
        USING ERRCODE = '22023';
    END IF;
    v_quantity := (v_line->>'jumlah')::numeric;
    IF v_quantity < 1 OR v_quantity > 20 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: jumlah pembelian per item adalah 1-20'
        USING ERRCODE = '22023';
    END IF;

    SELECT
      b.barang_id,
      b.nama,
      vb.nama,
      coalesce(vb.harga_jual, b.harga_jual),
      coalesce(vb.inventory_mode, b.inventory_mode, 'serialized')
    INTO
      v_resolved_product_id,
      v_item_name,
      v_variant_name,
      v_normal_price,
      v_inventory_mode
    FROM public.barang b
    LEFT JOIN public.varian_barang vb
      ON vb.usaha_id = b.usaha_id
     AND vb.barang_id = b.barang_id
     AND vb.varian_barang_id = v_variant_id
    WHERE b.usaha_id = v_usaha.usaha_id
      AND b.status = 'active'
      AND b.is_public = true
      AND b.is_sellable = true
      AND (
        (v_variant_id IS NULL AND b.barang_id = v_item_id)
        OR
        (
          v_variant_id IS NOT NULL
          AND vb.varian_barang_id = v_variant_id
          AND vb.status = 'active'
          AND coalesce(vb.is_sellable, b.is_sellable) = true
        )
      );

    IF NOT FOUND OR v_normal_price IS NULL OR v_normal_price <= 0 THEN
      RAISE EXCEPTION 'NOT_FOUND: salah satu item pembelian tidak tersedia'
        USING ERRCODE = 'P0002';
    END IF;

    v_discount_percent := 0;
    v_promo_id := NULL;
    SELECT promo.promosi_katalog_id, promo.diskon_persen
      INTO v_promo_id, v_discount_percent
    FROM app_private.resolve_catalog_promo_price(
      v_usaha.usaha_id,
      CASE WHEN v_variant_id IS NULL THEN v_resolved_product_id ELSE NULL END,
      v_variant_id,
      'sale',
      now()
    ) promo;

    v_discount_percent := coalesce(v_discount_percent, 0);
    v_effective_price := round(v_normal_price * (100 - v_discount_percent) / 100, 2);
    v_discount_amount := round((v_normal_price - v_effective_price) * v_quantity, 2);

    INSERT INTO app_private.akasha_smart_booking_line (
      usaha_id, smart_booking_id, line_kind, barang_id, varian_barang_id,
      quantity, item_name_snapshot, variant_label_snapshot, inventory_mode_snapshot,
      unit_price_snapshot, normal_price_snapshot, discount_percent_snapshot,
      discount_amount_snapshot, subtotal_snapshot, currency_code,
      promosi_katalog_id, line_position
    )
    VALUES (
      v_usaha.usaha_id, v_booking_id, 'sale',
      CASE WHEN v_variant_id IS NULL THEN v_resolved_product_id ELSE NULL END,
      v_variant_id,
      v_quantity, v_item_name, v_variant_name, v_inventory_mode,
      v_effective_price, v_normal_price, v_discount_percent,
      v_discount_amount, round(v_effective_price * v_quantity, 2), 'IDR',
      v_promo_id,
      (SELECT coalesce(max(l.line_position), 0) + 1
       FROM app_private.akasha_smart_booking_line l
       WHERE l.smart_booking_id = v_booking_id)
    );

    v_total_sale := v_total_sale + round(v_effective_price * v_quantity, 2);
  END LOOP;

  v_total := round(v_total_rental + v_total_sale, 2);
  UPDATE app_private.akasha_smart_booking
  SET quote_total = v_total
  WHERE smart_booking_id = v_booking_id;

  -- Name + pickup year + 3-character HMAC-derived suffix, for example
  -- nurdin2026Q1A. The full code is never stored; reference_code is required
  -- as a second factor on customer login.
  v_prefix := substring(
    regexp_replace(lower(split_part(v_name, ' ', 1)), '[^a-z0-9]', '', 'g')
    FROM 1 FOR 12
  );
  IF length(coalesce(v_prefix, '')) < 2 THEN
    v_prefix := 'customer';
  END IF;
  v_access_year := to_char(
    coalesce(v_pickup_date, (now() AT TIME ZONE v_timezone)::date),
    'YYYY'
  );
  v_access_expiry := greatest(
    now() + interval '90 days',
    coalesce(
      v_return_date::timestamp AT TIME ZONE v_timezone + interval '30 days',
      now() + interval '90 days'
    )
  );

  INSERT INTO app_private.akasha_smart_booking_customer_access (
    usaha_id, smart_booking_id, access_code_prefix, access_code_year,
    access_code_hash, credential_version, expires_at
  )
  VALUES (
    v_usaha.usaha_id, v_booking_id, v_prefix, v_access_year,
    decode(repeat('00', 32), 'hex'), 1, v_access_expiry
  );

  v_access_code := app_private.akasha_smart_booking_issue_access_code(v_booking_id, 1);
  v_access_hash := app_private.akasha_smart_booking_hmac(
    'customer-access-code',
    lower(v_access_code)
  );

  UPDATE app_private.akasha_smart_booking_customer_access
  SET access_code_hash = v_access_hash
  WHERE smart_booking_id = v_booking_id
    AND credential_version = 1;

  INSERT INTO app_private.akasha_smart_booking_activity_event (
    usaha_id, smart_booking_id, event_type, actor_type,
    customer_visible, public_message, internal_metadata
  )
  VALUES (
    v_usaha.usaha_id, v_booking_id, 'booking.received', 'system',
    true,
    'Booking Anda berhasil dicatat. Tim Akasha akan meninjau permintaan ini.',
    jsonb_build_object('source', 'akasha-smart-booking')
  );

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, change_summary
  )
  VALUES (
    v_usaha.usaha_id, NULL, NULL, 'create',
    'akasha_smart_booking', v_booking_id, 'akasha-smart-booking',
    jsonb_build_object(
      'reference_code', v_reference,
      'workflow_status', 'received',
      'reservation_id', v_reservasi_id,
      'line_count', v_count,
      'quote_total', v_total,
      'inventory_effect', 'none'
    )
  );

  INSERT INTO public.outbox_event (
    usaha_id, event_type, aggregate_type, aggregate_id, payload
  )
  VALUES (
    v_usaha.usaha_id,
    'akasha_smart_booking.received',
    'akasha_smart_booking',
    v_booking_id,
    jsonb_build_object(
      'smart_booking_id', v_booking_id,
      'reference_code', v_reference,
      'workflow_status', 'received'
    )
  );

  v_response := jsonb_build_object(
    'smart_booking_id', v_booking_id,
    'reference_code', v_reference,
    'workflow_status', 'received',
    'reservation_id', v_reservasi_id,
    'reservation_number', v_legacy_response->>'nomor_reservasi',
    'request_id', v_permintaan_id,
    'request_number', v_legacy_response->>'nomor_permintaan',
    'line_count', v_count,
    'total_estimate', v_total,
    'currency_code', 'IDR',
    'access_expires_at', v_access_expiry,
    'stock_lock_status', 'not_locked'
  );

  UPDATE public.idempotency_key
  SET response_status = 201, response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response || jsonb_build_object('access_code', v_access_code);
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_create_akasha_smart_booking(text, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.command_create_akasha_smart_booking(
  p_slug text,
  p_booking jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.command_create_akasha_smart_booking($1, $2, $3);
$function$;

REVOKE ALL ON FUNCTION public.command_create_akasha_smart_booking(text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.command_create_akasha_smart_booking(text, jsonb, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Customer access exchange. This is server-only (service_role) so trusted
-- server code can submit the edge-derived fingerprint and set an HttpOnly cookie.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.exchange_akasha_smart_booking_access(
  p_slug text,
  p_reference_code text,
  p_access_code text,
  p_client_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_usaha_id uuid;
  v_reference text;
  v_fingerprint_hash bytea;
  v_booking app_private.akasha_smart_booking%ROWTYPE;
  v_access app_private.akasha_smart_booking_customer_access%ROWTYPE;
  v_throttle app_private.akasha_smart_booking_access_throttle%ROWTYPE;
  v_expected_hash bytea;
  v_session_token text;
  v_session_expiry timestamptz;
  v_fail_count integer;
BEGIN
  SELECT u.usaha_id INTO v_usaha_id
  FROM public.usaha u
  WHERE u.slug = btrim(coalesce(p_slug, ''))
    AND u.status = 'active'
  LIMIT 1;

  IF v_usaha_id IS NULL
     OR length(coalesce(p_reference_code, '')) > 24
     OR length(coalesce(p_access_code, '')) < 4
     OR length(coalesce(p_access_code, '')) > 40
     OR length(coalesce(p_client_fingerprint, '')) < 8
     OR length(coalesce(p_client_fingerprint, '')) > 500 THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  v_reference := regexp_replace(upper(btrim(p_reference_code)), '[^A-Z0-9]', '', 'g');
  v_fingerprint_hash := app_private.akasha_smart_booking_hmac(
    'client-fingerprint',
    p_client_fingerprint
  );

  DELETE FROM app_private.akasha_smart_booking_access_throttle
  WHERE usaha_id = v_usaha_id AND last_attempt_at < now() - interval '30 days';

  SELECT * INTO v_throttle
  FROM app_private.akasha_smart_booking_access_throttle t
  WHERE t.usaha_id = v_usaha_id
    AND t.client_fingerprint_hash = v_fingerprint_hash
  FOR UPDATE;

  IF FOUND AND v_throttle.blocked_until IS NOT NULL
     AND v_throttle.blocked_until > now() THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  SELECT * INTO v_booking
  FROM app_private.akasha_smart_booking b
  WHERE b.usaha_id = v_usaha_id
    AND b.reference_code = v_reference
  FOR UPDATE;

  IF FOUND THEN
    SELECT * INTO v_access
    FROM app_private.akasha_smart_booking_customer_access a
    WHERE a.usaha_id = v_usaha_id
      AND a.smart_booking_id = v_booking.smart_booking_id
      AND a.revoked_at IS NULL
    ORDER BY a.credential_version DESC
    LIMIT 1
    FOR UPDATE;

    v_expected_hash := app_private.akasha_smart_booking_hmac(
      'customer-access-code',
      lower(btrim(p_access_code))
    );
  END IF;

  IF v_booking.smart_booking_id IS NULL
     OR v_access.smart_booking_access_id IS NULL
     OR v_access.expires_at <= now()
     OR (v_access.locked_until IS NOT NULL AND v_access.locked_until > now())
     OR v_access.access_code_hash IS DISTINCT FROM v_expected_hash THEN

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

REVOKE ALL ON FUNCTION app_private.exchange_akasha_smart_booking_access(text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.exchange_akasha_smart_booking_access(
  p_slug text,
  p_reference_code text,
  p_access_code text,
  p_client_fingerprint text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.exchange_akasha_smart_booking_access($1, $2, $3, $4);
$function$;

REVOKE ALL ON FUNCTION public.exchange_akasha_smart_booking_access(text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exchange_akasha_smart_booking_access(text, text, text, text)
  TO service_role;

-- Customer portal projection. No direct customer SELECT privileges are granted.
CREATE OR REPLACE FUNCTION app_private.get_akasha_smart_booking_portal(
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_session app_private.akasha_smart_booking_customer_session%ROWTYPE;
  v_booking app_private.akasha_smart_booking%ROWTYPE;
  v_result jsonb;
BEGIN
  IF length(coalesce(p_session_token, '')) <> 64 THEN
    RAISE EXCEPTION 'SESSION_INVALID: sesi portal tidak valid atau telah berakhir'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_session
  FROM app_private.akasha_smart_booking_customer_session s
  WHERE s.session_token_hash = app_private.akasha_smart_booking_hmac(
      'portal-session', p_session_token
    )
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_INVALID: sesi portal tidak valid atau telah berakhir'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_booking
  FROM app_private.akasha_smart_booking b
  WHERE b.smart_booking_id = v_session.smart_booking_id
    AND b.usaha_id = v_session.usaha_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_INVALID: sesi portal tidak valid atau telah berakhir'
      USING ERRCODE = '28000';
  END IF;

  UPDATE app_private.akasha_smart_booking_customer_session
  SET last_used_at = now()
  WHERE smart_booking_session_id = v_session.smart_booking_session_id;

  SELECT jsonb_build_object(
    'smart_booking_id', v_booking.smart_booking_id,
    'reference_code', v_booking.reference_code,
    'workflow_status', v_booking.workflow_status,
    'customer_name', v_booking.customer_name,
    'requested_pickup_date', v_booking.requested_pickup_date,
    'requested_return_date', v_booking.requested_return_date,
    'requested_pickup_at', v_booking.requested_pickup_at,
    'requested_return_at', v_booking.requested_return_at,
    'business_timezone', v_booking.business_timezone,
    'quote_total', v_booking.quote_total,
    'currency_code', v_booking.currency_code,
    'quote_expires_at', v_booking.quote_expires_at,
    'revision', v_booking.revision,
    'created_at', v_booking.created_at,
    'lines', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'line_id', l.smart_booking_line_id,
        'kind', l.line_kind,
        'name', l.item_name_snapshot,
        'variant', l.variant_label_snapshot,
        'quantity', l.quantity,
        'unit_price', l.unit_price_snapshot,
        'normal_price', l.normal_price_snapshot,
        'discount_percent', l.discount_percent_snapshot,
        'discount_amount', l.discount_amount_snapshot,
        'subtotal', l.subtotal_snapshot,
        'currency_code', l.currency_code
      ) ORDER BY l.line_position, l.created_at)
      FROM app_private.akasha_smart_booking_line l
      WHERE l.smart_booking_id = v_booking.smart_booking_id
    ), '[]'::jsonb),
    'change_requests', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.smart_booking_change_request_id,
        'type', c.request_type,
        'status', c.request_status,
        'payload', c.payload,
        'reason', c.reason,
        'public_resolution_note', c.public_resolution_note,
        'created_at', c.created_at,
        'resolved_at', c.resolved_at
      ) ORDER BY c.created_at DESC)
      FROM app_private.akasha_smart_booking_change_request c
      WHERE c.smart_booking_id = v_booking.smart_booking_id
    ), '[]'::jsonb),
    'timeline', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'type', e.event_type,
        'message', e.public_message,
        'occurred_at', e.created_at
      ) ORDER BY e.created_at)
      FROM app_private.akasha_smart_booking_activity_event e
      WHERE e.smart_booking_id = v_booking.smart_booking_id
        AND e.customer_visible = true
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.get_akasha_smart_booking_portal(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_akasha_smart_booking_portal(
  p_session_token text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.get_akasha_smart_booking_portal($1);
$function$;

REVOKE ALL ON FUNCTION public.get_akasha_smart_booking_portal(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_akasha_smart_booking_portal(text)
  TO service_role;

-- Customer change requests never update the booking's line or schedule data.
CREATE OR REPLACE FUNCTION app_private.submit_akasha_smart_booking_change(
  p_session_token text,
  p_request_type text,
  p_payload jsonb,
  p_reason text,
  p_expected_revision integer,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_session app_private.akasha_smart_booking_customer_session%ROWTYPE;
  v_booking app_private.akasha_smart_booking%ROWTYPE;
  v_request_id uuid;
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_hash text;
  v_idem_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_new_status text;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_response jsonb;
BEGIN
  IF length(v_key) < 8 OR length(v_key) > 100 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency key tidak valid'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_payload) IS DISTINCT FROM 'object'
     OR length(v_payload::text) > 12000
     OR length(coalesce(v_reason, '')) > 500 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: isi permintaan tidak valid'
      USING ERRCODE = '22023';
  END IF;
  IF p_request_type NOT IN (
    'item_change', 'variant_change', 'quantity_change',
    'schedule_change', 'cancellation', 'alternative_interest', 'other'
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: jenis permintaan tidak dikenal'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_session
  FROM app_private.akasha_smart_booking_customer_session s
  WHERE s.session_token_hash = app_private.akasha_smart_booking_hmac(
      'portal-session', p_session_token
    )
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_INVALID: sesi portal tidak valid atau telah berakhir'
      USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_booking
  FROM app_private.akasha_smart_booking b
  WHERE b.smart_booking_id = v_session.smart_booking_id
    AND b.usaha_id = v_session.usaha_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: booking tidak ditemukan'
      USING ERRCODE = 'P0002';
  END IF;

  v_hash := encode(
    extensions.digest(
      convert_to(jsonb_build_object(
        'booking_id', v_booking.smart_booking_id,
        'type', p_request_type,
        'payload', v_payload,
        'reason', v_reason,
        'expected_revision', p_expected_revision
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.idempotency_key (
    usaha_id, actor_auth_user_id, key, command_name, request_hash
  )
  VALUES (
    v_booking.usaha_id, NULL, v_key, 'submit_akasha_smart_booking_change', v_hash
  )
  ON CONFLICT (usaha_id, command_name, key) WHERE actor_auth_user_id IS NULL
  DO NOTHING
  RETURNING idempotency_key_id INTO v_idem_id;

  IF v_idem_id IS NULL THEN
    SELECT ik.request_hash, ik.response_body
      INTO v_existing_hash, v_existing_response
    FROM public.idempotency_key ik
    WHERE ik.usaha_id = v_booking.usaha_id
      AND ik.actor_auth_user_id IS NULL
      AND ik.command_name = 'submit_akasha_smart_booking_change'
      AND ik.key = v_key;

    IF v_existing_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk permintaan berbeda'
        USING ERRCODE = '23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: permintaan sedang diproses'
      USING ERRCODE = '40001';
  END IF;

  IF p_expected_revision IS DISTINCT FROM v_booking.revision THEN
    RAISE EXCEPTION 'STALE_REVISION: booking telah berubah. Muat ulang portal sebelum mengirim kembali.'
      USING ERRCODE = '40001';
  END IF;

  IF v_booking.workflow_status IN ('cancelled', 'expired', 'fulfilled') THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: booking sudah ditutup dan tidak menerima perubahan'
      USING ERRCODE = '23514';
  END IF;

  IF (
    SELECT count(*)
    FROM app_private.akasha_smart_booking_change_request c
    WHERE c.smart_booking_id = v_booking.smart_booking_id
      AND c.created_at >= now() - interval '10 minutes'
  ) >= 5 THEN
    RAISE EXCEPTION 'RATE_LIMITED: terlalu banyak permintaan perubahan. Coba kembali beberapa saat lagi.'
      USING ERRCODE = '54000';
  END IF;

  IF p_request_type = 'schedule_change' THEN
    IF v_payload ? 'requested_pickup_date'
       AND nullif(v_payload->>'requested_pickup_date', '') IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: tanggal pengambilan tidak valid'
        USING ERRCODE = '22023';
    END IF;
    IF v_payload ? 'requested_return_date'
       AND nullif(v_payload->>'requested_return_date', '') IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: tanggal pengembalian tidak valid'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_request_type IN ('item_change', 'variant_change', 'quantity_change') THEN
    IF NOT (v_payload ? 'items') OR jsonb_typeof(v_payload->'items') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_payload->'items') < 1
       OR jsonb_array_length(v_payload->'items') > 10 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: daftar item perubahan harus berisi 1-10 item'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_request_type = 'cancellation' THEN
    IF v_reason IS NULL THEN
      v_reason := 'Customer mengajukan pembatalan booking.';
    END IF;
  END IF;

  v_new_status := CASE
    WHEN p_request_type = 'cancellation' THEN 'cancellation_pending'
    ELSE 'change_requested'
  END;

  INSERT INTO app_private.akasha_smart_booking_change_request (
    usaha_id, smart_booking_id, request_type, requested_by_type,
    payload, reason, previous_workflow_status
  )
  VALUES (
    v_booking.usaha_id, v_booking.smart_booking_id, p_request_type,
    'customer', v_payload, v_reason, v_booking.workflow_status
  )
  RETURNING smart_booking_change_request_id INTO v_request_id;

  UPDATE app_private.akasha_smart_booking
  SET workflow_status = v_new_status,
      revision = revision + 1
  WHERE smart_booking_id = v_booking.smart_booking_id;

  INSERT INTO app_private.akasha_smart_booking_activity_event (
    usaha_id, smart_booking_id, event_type, actor_type,
    customer_visible, public_message, internal_metadata
  )
  VALUES (
    v_booking.usaha_id, v_booking.smart_booking_id,
    'booking.change_requested', 'customer', true,
    CASE
      WHEN p_request_type = 'cancellation'
        THEN 'Permintaan pembatalan Anda telah dikirim dan menunggu peninjauan admin.'
      ELSE 'Permintaan perubahan Anda telah dikirim dan menunggu peninjauan admin.'
    END,
    jsonb_build_object('request_id', v_request_id, 'request_type', p_request_type)
  );

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, change_summary
  )
  VALUES (
    v_booking.usaha_id, NULL, NULL, 'request_change',
    'akasha_smart_booking', v_booking.smart_booking_id,
    'akasha-smart-booking-portal',
    jsonb_build_object('request_id', v_request_id, 'request_type', p_request_type)
  );

  INSERT INTO public.outbox_event (
    usaha_id, event_type, aggregate_type, aggregate_id, payload
  )
  VALUES (
    v_booking.usaha_id, 'akasha_smart_booking.change_requested',
    'akasha_smart_booking', v_booking.smart_booking_id,
    jsonb_build_object('smart_booking_id', v_booking.smart_booking_id, 'request_id', v_request_id)
  );

  v_response := jsonb_build_object(
    'request_id', v_request_id,
    'request_status', 'pending',
    'workflow_status', v_new_status,
    'revision', v_booking.revision + 1
  );

  UPDATE public.idempotency_key
  SET response_status = 201, response_body = v_response
  WHERE idempotency_key_id = v_idem_id;

  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.submit_akasha_smart_booking_change(text, text, jsonb, text, integer, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.submit_akasha_smart_booking_change(
  p_session_token text,
  p_request_type text,
  p_payload jsonb,
  p_reason text,
  p_expected_revision integer,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.submit_akasha_smart_booking_change($1, $2, $3, $4, $5, $6);
$function$;

REVOKE ALL ON FUNCTION public.submit_akasha_smart_booking_change(text, text, jsonb, text, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_akasha_smart_booking_change(text, text, jsonb, text, integer, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Admin read models. Tenant membership is checked inside every command.
-- Admin mutations additionally require reservation.amend capability.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.admin_list_akasha_smart_bookings(
  p_usaha_id uuid,
  p_status text DEFAULT NULL,
  p_pickup_from date DEFAULT NULL,
  p_pickup_until date DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 100000));
  v_total bigint;
  v_items jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT app_private.has_usaha_access(p_usaha_id) THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: akses booking tidak diberikan'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_total
  FROM app_private.akasha_smart_booking b
  WHERE b.usaha_id = p_usaha_id
    AND (p_status IS NULL OR b.workflow_status = p_status)
    AND (p_pickup_from IS NULL OR b.requested_pickup_date >= p_pickup_from)
    AND (p_pickup_until IS NULL OR b.requested_pickup_date <= p_pickup_until)
    AND (
      nullif(btrim(p_search), '') IS NULL
      OR b.reference_code ILIKE '%' || btrim(p_search) || '%'
      OR b.customer_name ILIKE '%' || btrim(p_search) || '%'
      OR b.customer_phone_normalized LIKE '%' || regexp_replace(p_search, '[^0-9]', '', 'g') || '%'
      OR EXISTS (
        SELECT 1 FROM app_private.akasha_smart_booking_line l
        WHERE l.smart_booking_id = b.smart_booking_id
          AND l.item_name_snapshot ILIKE '%' || btrim(p_search) || '%'
      )
    );

  SELECT coalesce(jsonb_agg(q.item ORDER BY q.sort_priority, q.pickup_sort NULLS LAST, q.created_sort), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      jsonb_build_object(
        'smart_booking_id', b.smart_booking_id,
        'reference_code', b.reference_code,
        'reservation_id', b.reservasi_id,
        'reservation_number', r.nomor_reservasi,
        'customer_name', b.customer_name,
        'customer_phone', b.customer_phone,
        'workflow_status', b.workflow_status,
        'requested_pickup_date', b.requested_pickup_date,
        'requested_return_date', b.requested_return_date,
        'quote_total', b.quote_total,
        'currency_code', b.currency_code,
        'revision', b.revision,
        'created_at', b.created_at,
        'line_count', (
          SELECT count(*) FROM app_private.akasha_smart_booking_line l
          WHERE l.smart_booking_id = b.smart_booking_id
        ),
        'line_summary', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'kind', x.line_kind,
            'name', x.item_name_snapshot,
            'variant', x.variant_label_snapshot,
            'quantity', x.quantity
          ) ORDER BY x.line_position), '[]'::jsonb)
          FROM app_private.akasha_smart_booking_line x
          WHERE x.smart_booking_id = b.smart_booking_id
        ),
        'pending_change_count', (
          SELECT count(*) FROM app_private.akasha_smart_booking_change_request c
          WHERE c.smart_booking_id = b.smart_booking_id
            AND c.request_status = 'pending'
        )
      ) AS item,
      CASE
        WHEN b.workflow_status IN ('cancellation_pending', 'change_requested', 'customer_action_required') THEN 0
        WHEN b.workflow_status = 'received' THEN 1
        ELSE 2
      END AS sort_priority,
      b.requested_pickup_date AS pickup_sort,
      b.created_at AS created_sort
    FROM app_private.akasha_smart_booking b
    LEFT JOIN public.reservasi r
      ON r.usaha_id = b.usaha_id AND r.reservasi_id = b.reservasi_id
    WHERE b.usaha_id = p_usaha_id
      AND (p_status IS NULL OR b.workflow_status = p_status)
      AND (p_pickup_from IS NULL OR b.requested_pickup_date >= p_pickup_from)
      AND (p_pickup_until IS NULL OR b.requested_pickup_date <= p_pickup_until)
      AND (
        nullif(btrim(p_search), '') IS NULL
        OR b.reference_code ILIKE '%' || btrim(p_search) || '%'
        OR b.customer_name ILIKE '%' || btrim(p_search) || '%'
        OR b.customer_phone_normalized LIKE '%' || regexp_replace(p_search, '[^0-9]', '', 'g') || '%'
        OR EXISTS (
          SELECT 1 FROM app_private.akasha_smart_booking_line l
          WHERE l.smart_booking_id = b.smart_booking_id
            AND l.item_name_snapshot ILIKE '%' || btrim(p_search) || '%'
        )
      )
    ORDER BY sort_priority, b.requested_pickup_date NULLS LAST, b.created_at
    LIMIT v_limit OFFSET v_offset
  ) q;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.admin_list_akasha_smart_bookings(uuid, text, date, date, text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_akasha_smart_bookings(
  p_usaha_id uuid,
  p_status text DEFAULT NULL,
  p_pickup_from date DEFAULT NULL,
  p_pickup_until date DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.admin_list_akasha_smart_bookings($1, $2, $3, $4, $5, $6, $7);
$function$;

REVOKE ALL ON FUNCTION public.admin_list_akasha_smart_bookings(uuid, text, date, date, text, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_akasha_smart_bookings(uuid, text, date, date, text, integer, integer)
  TO authenticated;

CREATE OR REPLACE FUNCTION app_private.admin_get_akasha_smart_booking(
  p_smart_booking_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_booking app_private.akasha_smart_booking%ROWTYPE;
BEGIN
  SELECT * INTO v_booking
  FROM app_private.akasha_smart_booking b
  WHERE b.smart_booking_id = p_smart_booking_id;

  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT app_private.has_usaha_access(v_booking.usaha_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: booking tidak ditemukan'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'smart_booking_id', v_booking.smart_booking_id,
    'usaha_id', v_booking.usaha_id,
    'reference_code', v_booking.reference_code,
    'reservation_id', v_booking.reservasi_id,
    'request_id', v_booking.permintaan_sewa_id,
    'renter_id', v_booking.penyewa_id,
    'workflow_status', v_booking.workflow_status,
    'customer_name', v_booking.customer_name,
    'customer_phone', v_booking.customer_phone,
    'customer_phone_normalized', v_booking.customer_phone_normalized,
    'customer_note', v_booking.customer_note,
    'requested_pickup_date', v_booking.requested_pickup_date,
    'requested_return_date', v_booking.requested_return_date,
    'requested_pickup_at', v_booking.requested_pickup_at,
    'requested_return_at', v_booking.requested_return_at,
    'business_timezone', v_booking.business_timezone,
    'quote_total', v_booking.quote_total,
    'currency_code', v_booking.currency_code,
    'quote_expires_at', v_booking.quote_expires_at,
    'revision', v_booking.revision,
    'reviewed_at', v_booking.reviewed_at,
    'reviewed_by', v_booking.reviewed_by,
    'created_at', v_booking.created_at,
    'updated_at', v_booking.updated_at,
    'lines', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'line_id', l.smart_booking_line_id,
        'kind', l.line_kind,
        'barang_id', l.barang_id,
        'varian_barang_id', l.varian_barang_id,
        'paket_sewa_id', l.paket_sewa_id,
        'name', l.item_name_snapshot,
        'variant', l.variant_label_snapshot,
        'quantity', l.quantity,
        'inventory_mode_snapshot', l.inventory_mode_snapshot,
        'unit_price', l.unit_price_snapshot,
        'normal_price', l.normal_price_snapshot,
        'discount_percent', l.discount_percent_snapshot,
        'discount_amount', l.discount_amount_snapshot,
        'subtotal', l.subtotal_snapshot,
        'currency_code', l.currency_code,
        'tarif_sewa_id', l.tarif_sewa_id,
        'promosi_katalog_id', l.promosi_katalog_id,
        'promosi_paket_id', l.promosi_paket_id
      ) ORDER BY l.line_position, l.created_at)
      FROM app_private.akasha_smart_booking_line l
      WHERE l.smart_booking_id = v_booking.smart_booking_id
    ), '[]'::jsonb),
    'change_requests', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.smart_booking_change_request_id,
        'type', c.request_type,
        'requested_by_type', c.requested_by_type,
        'payload', c.payload,
        'reason', c.reason,
        'status', c.request_status,
        'resolution_note', c.resolution_note,
        'public_resolution_note', c.public_resolution_note,
        'resolved_at', c.resolved_at,
        'created_at', c.created_at
      ) ORDER BY c.created_at DESC)
      FROM app_private.akasha_smart_booking_change_request c
      WHERE c.smart_booking_id = v_booking.smart_booking_id
    ), '[]'::jsonb),
    'timeline', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'type', e.event_type,
        'actor_type', e.actor_type,
        'public_message', e.public_message,
        'internal_metadata', e.internal_metadata,
        'created_at', e.created_at
      ) ORDER BY e.created_at)
      FROM app_private.akasha_smart_booking_activity_event e
      WHERE e.smart_booking_id = v_booking.smart_booking_id
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.admin_get_akasha_smart_booking(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_akasha_smart_booking(
  p_smart_booking_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.admin_get_akasha_smart_booking($1);
$function$;

REVOKE ALL ON FUNCTION public.admin_get_akasha_smart_booking(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_akasha_smart_booking(uuid)
  TO authenticated;

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
  SELECT * INTO v_booking
  FROM app_private.akasha_smart_booking b
  WHERE b.smart_booking_id = p_smart_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: booking tidak ditemukan'
      USING ERRCODE = 'P0002';
  END IF;

  v_admin_id := app_private.require_usaha_permission(v_booking.usaha_id, 'reservation.amend');

  IF p_expected_revision IS DISTINCT FROM v_booking.revision THEN
    RAISE EXCEPTION 'STALE_REVISION: booking telah berubah. Muat ulang sebelum melanjutkan.'
      USING ERRCODE = '40001';
  END IF;

  IF p_target_status NOT IN (
    'reviewing', 'acknowledged', 'customer_action_required',
    'ready_for_checkout', 'cancelled', 'expired'
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: status target tidak diizinkan melalui perintah ini'
      USING ERRCODE = '22023';
  END IF;

  IF v_booking.workflow_status IN ('cancelled', 'expired', 'fulfilled') THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: booking sudah berada pada status akhir'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (v_booking.workflow_status = 'received' AND p_target_status = 'reviewing')
    OR (v_booking.workflow_status = 'reviewing' AND p_target_status IN ('acknowledged', 'customer_action_required', 'cancelled', 'expired'))
    OR (v_booking.workflow_status = 'acknowledged' AND p_target_status IN ('reviewing', 'customer_action_required', 'ready_for_checkout', 'cancelled', 'expired'))
    OR (v_booking.workflow_status = 'customer_action_required' AND p_target_status IN ('reviewing', 'acknowledged', 'ready_for_checkout', 'cancelled', 'expired'))
    OR (v_booking.workflow_status = 'change_requested' AND p_target_status IN ('reviewing', 'acknowledged', 'customer_action_required', 'cancelled', 'expired'))
    OR (v_booking.workflow_status = 'cancellation_pending' AND p_target_status IN ('reviewing', 'acknowledged', 'cancelled'))
    OR (v_booking.workflow_status = 'ready_for_checkout' AND p_target_status IN ('reviewing', 'cancelled', 'expired'))
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: transisi status booking tidak diizinkan'
      USING ERRCODE = '23514';
  END IF;

  IF p_target_status = 'acknowledged' AND v_booking.reviewed_at IS NULL THEN
    UPDATE app_private.akasha_smart_booking
    SET workflow_status = p_target_status,
        reviewed_at = now(),
        reviewed_by = v_admin_id,
        revision = revision + 1
    WHERE smart_booking_id = p_smart_booking_id;
  ELSE
    UPDATE app_private.akasha_smart_booking
    SET workflow_status = p_target_status,
        closed_at = CASE WHEN p_target_status IN ('cancelled', 'expired') THEN now() ELSE closed_at END,
        revision = revision + 1
    WHERE smart_booking_id = p_smart_booking_id;
  END IF;

  v_message := CASE p_target_status
    WHEN 'reviewing' THEN 'Tim Akasha sedang meninjau permintaan booking Anda.'
    WHEN 'acknowledged' THEN 'Permintaan booking Anda telah ditinjau oleh tim Akasha. Ketersediaan barang tetap mengikuti kondisi saat transaksi di lokasi.'
    WHEN 'customer_action_required' THEN coalesce(nullif(btrim(p_note), ''), 'Tim Akasha memerlukan tanggapan tambahan dari Anda.')
    WHEN 'ready_for_checkout' THEN 'Booking Anda telah ditinjau dan siap dijadikan referensi saat kedatangan. Stok belum dialokasikan dan akan diperiksa kembali saat transaksi.'
    WHEN 'cancelled' THEN coalesce(nullif(btrim(p_note), ''), 'Booking Anda telah dibatalkan oleh tim Akasha.')
    WHEN 'expired' THEN coalesce(nullif(btrim(p_note), ''), 'Masa tindak lanjut booking telah berakhir.')
    ELSE 'Status booking diperbarui.'
  END;

  INSERT INTO app_private.akasha_smart_booking_activity_event (
    usaha_id, smart_booking_id, event_type, actor_type, actor_admin_id,
    customer_visible, public_message, internal_metadata
  )
  VALUES (
    v_booking.usaha_id, p_smart_booking_id,
    'booking.status.' || p_target_status, 'admin', v_admin_id,
    true, v_message,
    jsonb_build_object('from', v_booking.workflow_status, 'to', p_target_status, 'note', p_note)
  );

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, change_summary
  )
  VALUES (
    v_booking.usaha_id, auth.uid(), v_admin_id, 'update_status',
    'akasha_smart_booking', p_smart_booking_id, 'rental-admin',
    jsonb_build_object('from', v_booking.workflow_status, 'to', p_target_status, 'revision', v_booking.revision + 1)
  );

  INSERT INTO public.outbox_event (
    usaha_id, event_type, aggregate_type, aggregate_id, payload
  )
  VALUES (
    v_booking.usaha_id, 'akasha_smart_booking.status_changed',
    'akasha_smart_booking', p_smart_booking_id,
    jsonb_build_object('from', v_booking.workflow_status, 'to', p_target_status)
  );

  RETURN jsonb_build_object(
    'smart_booking_id', p_smart_booking_id,
    'workflow_status', p_target_status,
    'revision', v_booking.revision + 1
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.admin_set_akasha_smart_booking_status(uuid, text, integer, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_akasha_smart_booking_status(
  p_smart_booking_id uuid,
  p_target_status text,
  p_expected_revision integer,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.admin_set_akasha_smart_booking_status($1, $2, $3, $4);
$function$;

REVOKE ALL ON FUNCTION public.admin_set_akasha_smart_booking_status(uuid, text, integer, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_akasha_smart_booking_status(uuid, text, integer, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION app_private.admin_resolve_akasha_smart_booking_change(
  p_change_request_id uuid,
  p_decision text,
  p_expected_revision integer,
  p_resolution_note text DEFAULT NULL,
  p_public_resolution_note text DEFAULT NULL,
  p_schedule_payload jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_change app_private.akasha_smart_booking_change_request%ROWTYPE;
  v_booking app_private.akasha_smart_booking%ROWTYPE;
  v_admin_id uuid;
  v_status text;
  v_payload jsonb;
BEGIN
  SELECT * INTO v_change
  FROM app_private.akasha_smart_booking_change_request c
  WHERE c.smart_booking_change_request_id = p_change_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_change.request_status <> 'pending' THEN
    RAISE EXCEPTION 'NOT_FOUND: permintaan perubahan tidak ditemukan atau sudah diproses'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_booking
  FROM app_private.akasha_smart_booking b
  WHERE b.smart_booking_id = v_change.smart_booking_id
    AND b.usaha_id = v_change.usaha_id
  FOR UPDATE;

  v_admin_id := app_private.require_usaha_permission(v_booking.usaha_id, 'reservation.amend');

  IF p_expected_revision IS DISTINCT FROM v_booking.revision THEN
    RAISE EXCEPTION 'STALE_REVISION: booking telah berubah. Muat ulang sebelum menyelesaikan permintaan.'
      USING ERRCODE = '40001';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: keputusan harus approved atau rejected'
      USING ERRCODE = '22023';
  END IF;

  IF p_decision = 'approved'
     AND v_change.request_type NOT IN ('schedule_change', 'cancellation', 'alternative_interest', 'other') THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: perubahan item harus ditinjau melalui editor booking khusus; permintaan tetap pending'
      USING ERRCODE = '23514';
  END IF;

  v_payload := coalesce(p_schedule_payload, v_change.payload);

  IF p_decision = 'approved' AND v_change.request_type = 'schedule_change' THEN
    IF v_payload ? 'requested_pickup_date'
       AND nullif(v_payload->>'requested_pickup_date', '') IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: tanggal pengambilan tidak valid'
        USING ERRCODE = '22023';
    END IF;
    IF v_payload ? 'requested_return_date'
       AND nullif(v_payload->>'requested_return_date', '') IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: tanggal pengembalian tidak valid'
        USING ERRCODE = '22023';
    END IF;

    UPDATE app_private.akasha_smart_booking
    SET
      requested_pickup_date = CASE
        WHEN v_payload ? 'requested_pickup_date'
        THEN (v_payload->>'requested_pickup_date')::date
        ELSE requested_pickup_date
      END,
      requested_return_date = CASE
        WHEN v_payload ? 'requested_return_date'
        THEN (v_payload->>'requested_return_date')::date
        ELSE requested_return_date
      END,
      requested_pickup_at = CASE
        WHEN v_payload ? 'requested_pickup_at'
        THEN nullif(v_payload->>'requested_pickup_at', '')::timestamptz
        ELSE requested_pickup_at
      END,
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
    UPDATE app_private.akasha_smart_booking
    SET workflow_status = 'cancelled', closed_at = now(), revision = revision + 1
    WHERE smart_booking_id = v_booking.smart_booking_id;
    v_status := 'applied';
  ELSE
    UPDATE app_private.akasha_smart_booking
    SET workflow_status = CASE
          WHEN workflow_status IN ('change_requested', 'cancellation_pending')
          THEN v_change.previous_workflow_status
          ELSE workflow_status
        END,
        revision = revision + 1
    WHERE smart_booking_id = v_booking.smart_booking_id;
    v_status := p_decision;
  END IF;

  UPDATE app_private.akasha_smart_booking_change_request
  SET request_status = CASE WHEN v_status = 'applied' THEN 'applied' ELSE p_decision END,
      resolved_by_admin_id = v_admin_id,
      resolved_at = now(),
      resolution_note = nullif(btrim(p_resolution_note), ''),
      public_resolution_note = nullif(btrim(p_public_resolution_note), ''),
      updated_at = now()
  WHERE smart_booking_change_request_id = p_change_request_id;

  INSERT INTO app_private.akasha_smart_booking_activity_event (
    usaha_id, smart_booking_id, event_type, actor_type, actor_admin_id,
    customer_visible, public_message, internal_metadata
  )
  VALUES (
    v_booking.usaha_id, v_booking.smart_booking_id,
    'booking.change.' || v_status, 'admin', v_admin_id,
    true,
    coalesce(
      nullif(btrim(p_public_resolution_note), ''),
      CASE
        WHEN v_status = 'applied' THEN 'Permintaan perubahan Anda telah diterapkan oleh tim Akasha.'
        WHEN p_decision = 'rejected' THEN 'Permintaan perubahan Anda belum dapat disetujui oleh tim Akasha.'
        ELSE 'Permintaan Anda telah ditinjau oleh tim Akasha.'
      END
    ),
    jsonb_build_object('request_id', p_change_request_id, 'request_type', v_change.request_type)
  );

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, change_summary
  )
  VALUES (
    v_booking.usaha_id, auth.uid(), v_admin_id, 'resolve_change_request',
    'akasha_smart_booking', v_booking.smart_booking_id, 'rental-admin',
    jsonb_build_object('request_id', p_change_request_id, 'decision', p_decision, 'result', v_status)
  );

  INSERT INTO public.outbox_event (
    usaha_id, event_type, aggregate_type, aggregate_id, payload
  )
  VALUES (
    v_booking.usaha_id, 'akasha_smart_booking.change_resolved',
    'akasha_smart_booking', v_booking.smart_booking_id,
    jsonb_build_object('request_id', p_change_request_id, 'decision', p_decision, 'result', v_status)
  );

  RETURN jsonb_build_object(
    'request_id', p_change_request_id,
    'request_status', CASE WHEN v_status = 'applied' THEN 'applied' ELSE p_decision END,
    'workflow_status', CASE
      WHEN p_decision = 'approved' AND v_change.request_type = 'cancellation' THEN 'cancelled'
      WHEN p_decision = 'approved' AND v_change.request_type = 'schedule_change' THEN v_change.previous_workflow_status
      ELSE v_change.previous_workflow_status
    END,
    'revision', v_booking.revision + 1
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.admin_resolve_akasha_smart_booking_change(uuid, text, integer, text, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_resolve_akasha_smart_booking_change(
  p_change_request_id uuid,
  p_decision text,
  p_expected_revision integer,
  p_resolution_note text DEFAULT NULL,
  p_public_resolution_note text DEFAULT NULL,
  p_schedule_payload jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.admin_resolve_akasha_smart_booking_change($1, $2, $3, $4, $5, $6);
$function$;

REVOKE ALL ON FUNCTION public.admin_resolve_akasha_smart_booking_change(uuid, text, integer, text, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_akasha_smart_booking_change(uuid, text, integer, text, text, jsonb)
  TO authenticated;

-- QR admin URLs are generated by the admin frontend from the opaque booking
-- reservation ID. This database does not issue a customer portal token in QR.
-- No availability-history, inventory-hold, unit-assignment, or sales tables
-- are introduced or modified by this migration.


-- Admin-controlled credential rotation. The returned memorable code is shown
-- only in this command response; retries with the same idempotency key can
-- safely re-derive the same code while the credential remains active.
CREATE OR REPLACE FUNCTION app_private.admin_rotate_akasha_smart_booking_access(
  p_smart_booking_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_booking app_private.akasha_smart_booking%ROWTYPE;
  v_old_access app_private.akasha_smart_booking_customer_access%ROWTYPE;
  v_admin_id uuid;
  v_actor uuid := auth.uid();
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_request_hash text;
  v_idem_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_version integer;
  v_code text;
  v_expiry timestamptz;
  v_response jsonb;
BEGIN
  IF v_actor IS NULL OR length(v_key) < 8 OR length(v_key) > 100 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: sesi admin atau idempotency key tidak valid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_booking
  FROM app_private.akasha_smart_booking b
  WHERE b.smart_booking_id = p_smart_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: booking tidak ditemukan'
      USING ERRCODE = 'P0002';
  END IF;

  v_admin_id := app_private.require_usaha_permission(v_booking.usaha_id, 'access_control.manage');
  v_request_hash := encode(
    extensions.digest(
      convert_to(jsonb_build_object(
        'booking_id', p_smart_booking_id,
        'actor', v_actor
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.idempotency_key (
    usaha_id, actor_auth_user_id, key, command_name, request_hash
  )
  VALUES (
    v_booking.usaha_id, v_actor, v_key, 'admin_rotate_akasha_smart_booking_access', v_request_hash
  )
  ON CONFLICT (usaha_id, actor_auth_user_id, command_name, key)
  DO NOTHING
  RETURNING idempotency_key_id INTO v_idem_id;

  IF v_idem_id IS NULL THEN
    SELECT ik.request_hash, ik.response_body
      INTO v_existing_hash, v_existing_response
    FROM public.idempotency_key ik
    WHERE ik.usaha_id = v_booking.usaha_id
      AND ik.actor_auth_user_id = v_actor
      AND ik.command_name = 'admin_rotate_akasha_smart_booking_access'
      AND ik.key = v_key;

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah dipakai untuk rotasi berbeda'
        USING ERRCODE = '23505';
    END IF;
    IF v_existing_response IS NULL THEN
      RAISE EXCEPTION 'UNKNOWN_OUTCOME: rotasi credential sedang diproses'
        USING ERRCODE = '40001';
    END IF;

    v_version := (v_existing_response->>'credential_version')::integer;
    v_code := app_private.akasha_smart_booking_issue_access_code(p_smart_booking_id, v_version);
    RETURN v_existing_response || jsonb_build_object('access_code', v_code);
  END IF;

  SELECT * INTO v_old_access
  FROM app_private.akasha_smart_booking_customer_access a
  WHERE a.smart_booking_id = p_smart_booking_id
    AND a.revoked_at IS NULL
  ORDER BY a.credential_version DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: credential customer aktif tidak ditemukan'
      USING ERRCODE = '23514';
  END IF;

  UPDATE app_private.akasha_smart_booking_customer_session
  SET revoked_at = now()
  WHERE smart_booking_access_id = v_old_access.smart_booking_access_id
    AND revoked_at IS NULL;

  UPDATE app_private.akasha_smart_booking_customer_access
  SET revoked_at = now()
  WHERE smart_booking_access_id = v_old_access.smart_booking_access_id;

  SELECT coalesce(max(a.credential_version), 0) + 1
    INTO v_version
  FROM app_private.akasha_smart_booking_customer_access a
  WHERE a.smart_booking_id = p_smart_booking_id;

  v_expiry := greatest(
    now() + interval '90 days',
    coalesce(
      v_booking.requested_return_date::timestamp AT TIME ZONE v_booking.business_timezone + interval '30 days',
      now() + interval '90 days'
    )
  );

  INSERT INTO app_private.akasha_smart_booking_customer_access (
    usaha_id, smart_booking_id, access_code_prefix, access_code_year,
    access_code_hash, credential_version, expires_at
  )
  VALUES (
    v_booking.usaha_id, p_smart_booking_id, v_old_access.access_code_prefix,
    v_old_access.access_code_year, decode(repeat('00', 32), 'hex'),
    v_version, v_expiry
  );

  v_code := app_private.akasha_smart_booking_issue_access_code(p_smart_booking_id, v_version);
  UPDATE app_private.akasha_smart_booking_customer_access
  SET access_code_hash = app_private.akasha_smart_booking_hmac(
        'customer-access-code', lower(v_code)
      )
  WHERE smart_booking_id = p_smart_booking_id
    AND credential_version = v_version;

  UPDATE app_private.akasha_smart_booking
  SET revision = revision + 1
  WHERE smart_booking_id = p_smart_booking_id;

  INSERT INTO app_private.akasha_smart_booking_activity_event (
    usaha_id, smart_booking_id, event_type, actor_type, actor_admin_id,
    customer_visible, public_message, internal_metadata
  )
  VALUES (
    v_booking.usaha_id, p_smart_booking_id, 'booking.access_rotated',
    'admin', v_admin_id, true,
    'Akses portal booking Anda telah diperbarui. Gunakan kode akses terbaru yang diberikan oleh tim Akasha.',
    jsonb_build_object('credential_version', v_version)
  );

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, change_summary
  )
  VALUES (
    v_booking.usaha_id, v_actor, v_admin_id, 'rotate_customer_access',
    'akasha_smart_booking', p_smart_booking_id, 'rental-admin',
    jsonb_build_object('credential_version', v_version)
  );

  v_response := jsonb_build_object(
    'smart_booking_id', p_smart_booking_id,
    'credential_version', v_version,
    'expires_at', v_expiry
  );

  UPDATE public.idempotency_key
  SET response_status = 200, response_body = v_response
  WHERE idempotency_key_id = v_idem_id;

  RETURN v_response || jsonb_build_object('access_code', v_code);
END;
$function$;

REVOKE ALL ON FUNCTION app_private.admin_rotate_akasha_smart_booking_access(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_rotate_akasha_smart_booking_access(
  p_smart_booking_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.admin_rotate_akasha_smart_booking_access($1, $2);
$function$;

REVOKE ALL ON FUNCTION public.admin_rotate_akasha_smart_booking_access(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_rotate_akasha_smart_booking_access(uuid, text)
  TO authenticated;


-- Public create endpoint rate-limit ledger. Only keyed HMAC fingerprints are
-- retained; raw IP addresses and user-agent strings are never persisted.
CREATE TABLE IF NOT EXISTS app_private.akasha_smart_booking_create_throttle (
  usaha_id uuid NOT NULL REFERENCES public.usaha(usaha_id) ON DELETE CASCADE,
  client_fingerprint_hash bytea NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  blocked_until timestamptz,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usaha_id, client_fingerprint_hash)
);

ALTER TABLE app_private.akasha_smart_booking_create_throttle ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.akasha_smart_booking_create_throttle FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app_private.akasha_smart_booking_create_throttle
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.register_akasha_smart_booking_create_attempt(
  p_slug text,
  p_client_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_usaha_id uuid;
  v_fingerprint_hash bytea;
  v_attempt_count integer;
  v_blocked_until timestamptz;
BEGIN
  SELECT u.usaha_id INTO v_usaha_id
  FROM public.usaha u
  WHERE u.slug = btrim(coalesce(p_slug, ''))
    AND u.status = 'active'
  LIMIT 1;

  IF v_usaha_id IS NULL OR length(coalesce(p_client_fingerprint, '')) < 8
     OR length(coalesce(p_client_fingerprint, '')) > 500 THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  v_fingerprint_hash := app_private.akasha_smart_booking_hmac(
    'create-fingerprint', p_client_fingerprint
  );

  DELETE FROM app_private.akasha_smart_booking_create_throttle
  WHERE usaha_id = v_usaha_id AND last_attempt_at < now() - interval '30 days';

  INSERT INTO app_private.akasha_smart_booking_create_throttle (
    usaha_id, client_fingerprint_hash, window_started_at,
    attempt_count, last_attempt_at
  )
  VALUES (v_usaha_id, v_fingerprint_hash, now(), 1, now())
  ON CONFLICT (usaha_id, client_fingerprint_hash)
  DO UPDATE SET
    attempt_count = CASE
      WHEN app_private.akasha_smart_booking_create_throttle.window_started_at
        < now() - interval '10 minutes'
      THEN 1
      ELSE app_private.akasha_smart_booking_create_throttle.attempt_count + 1
    END,
    window_started_at = CASE
      WHEN app_private.akasha_smart_booking_create_throttle.window_started_at
        < now() - interval '10 minutes'
      THEN now()
      ELSE app_private.akasha_smart_booking_create_throttle.window_started_at
    END,
    blocked_until = CASE
      WHEN (
        CASE
          WHEN app_private.akasha_smart_booking_create_throttle.window_started_at
            < now() - interval '10 minutes'
          THEN 1
          ELSE app_private.akasha_smart_booking_create_throttle.attempt_count + 1
        END
      ) > 8
      THEN now() + interval '10 minutes'
      ELSE app_private.akasha_smart_booking_create_throttle.blocked_until
    END,
    last_attempt_at = now()
  RETURNING attempt_count, blocked_until
  INTO v_attempt_count, v_blocked_until;

  RETURN jsonb_build_object(
    'ok', coalesce(v_blocked_until <= now(), v_blocked_until IS NULL)
      AND v_attempt_count <= 8,
    'retry_after_seconds', CASE
      WHEN v_blocked_until > now()
      THEN greatest(1, ceil(extract(epoch FROM (v_blocked_until - now())))::integer)
      ELSE 0
    END
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.register_akasha_smart_booking_create_attempt(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.register_akasha_smart_booking_create_attempt(
  p_slug text,
  p_client_fingerprint text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.register_akasha_smart_booking_create_attempt($1, $2);
$function$;

REVOKE ALL ON FUNCTION public.register_akasha_smart_booking_create_attempt(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_akasha_smart_booking_create_attempt(text, text)
  TO service_role;


CREATE OR REPLACE FUNCTION app_private.revoke_akasha_smart_booking_portal_session(
  p_session_token text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_session_id uuid;
BEGIN
  IF length(coalesce(p_session_token, '')) <> 64 THEN
    RETURN false;
  END IF;

  UPDATE app_private.akasha_smart_booking_customer_session s
  SET revoked_at = now()
  WHERE s.session_token_hash = app_private.akasha_smart_booking_hmac(
    'portal-session', p_session_token
  )
    AND s.revoked_at IS NULL
  RETURNING s.smart_booking_session_id INTO v_session_id;

  RETURN v_session_id IS NOT NULL;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.revoke_akasha_smart_booking_portal_session(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.revoke_akasha_smart_booking_portal_session(
  p_session_token text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.revoke_akasha_smart_booking_portal_session($1);
$function$;

REVOKE ALL ON FUNCTION public.revoke_akasha_smart_booking_portal_session(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_akasha_smart_booking_portal_session(text)
  TO service_role;

REVOKE ALL ON FUNCTION app_private.akasha_smart_booking_touch_updated_at() FROM PUBLIC, anon, authenticated, service_role;
