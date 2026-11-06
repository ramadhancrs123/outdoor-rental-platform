-- Phase 3: loyalty Model A, rental-only nominal discount snapshots and atomic checkout wrappers.
-- The discount is a pricing adjustment, never a cash/expense ledger movement.

CREATE TABLE IF NOT EXISTS public.program_loyalitas (
  program_loyalitas_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL UNIQUE,
  is_enabled boolean NOT NULL DEFAULT false,
  minimum_completed_rentals integer NOT NULL,
  recommended_discount_percent numeric(5,2) NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_by_akun_admin_id uuid NOT NULL,
  updated_by_akun_admin_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT program_loyalitas_usaha_fk
    FOREIGN KEY (usaha_id) REFERENCES public.usaha(usaha_id) ON DELETE RESTRICT,
  CONSTRAINT program_loyalitas_tenant_unique UNIQUE (usaha_id, program_loyalitas_id),
  CONSTRAINT program_loyalitas_creator_fk
    FOREIGN KEY (usaha_id, created_by_akun_admin_id)
    REFERENCES public.keanggotaan_usaha(usaha_id, akun_admin_id) ON DELETE RESTRICT,
  CONSTRAINT program_loyalitas_updater_fk
    FOREIGN KEY (usaha_id, updated_by_akun_admin_id)
    REFERENCES public.keanggotaan_usaha(usaha_id, akun_admin_id) ON DELETE RESTRICT,
  CONSTRAINT program_loyalitas_threshold_check
    CHECK (minimum_completed_rentals > 0),
  CONSTRAINT program_loyalitas_percent_check
    CHECK (recommended_discount_percent > 0 AND recommended_discount_percent <= 100),
  CONSTRAINT program_loyalitas_period_check
    CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT program_loyalitas_version_check
    CHECK (version > 0)
);

ALTER TABLE public.program_loyalitas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.program_loyalitas FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.program_loyalitas TO authenticated;
DROP POLICY IF EXISTS program_loyalitas_member_read ON public.program_loyalitas;
CREATE POLICY program_loyalitas_member_read
  ON public.program_loyalitas
  FOR SELECT TO authenticated
  USING (app_private.has_usaha_access(usaha_id));

CREATE INDEX IF NOT EXISTS penyewaan_loyalty_completed_renter_idx
  ON public.penyewaan (usaha_id, penyewa_id, actual_return_completed_at DESC)
  WHERE status = 'completed' AND actual_return_completed_at IS NOT NULL;

ALTER TABLE public.penyewaan
  ADD COLUMN IF NOT EXISTS subtotal_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount numeric(14,2) NOT NULL DEFAULT 0;

UPDATE public.penyewaan
SET subtotal_amount = total_amount,
    discount_amount = 0
WHERE subtotal_amount = 0
  AND discount_amount = 0
  AND total_amount > 0;

ALTER TABLE public.checkout
  ADD COLUMN IF NOT EXISTS discount_rental_amount numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.penjualan
  ADD COLUMN IF NOT EXISTS bonus_hpp_amount numeric(14,2) DEFAULT 0;

ALTER TABLE public.detail_penjualan
  ADD COLUMN IF NOT EXISTS is_bonus_rental boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bonus_reason text;

ALTER TABLE public.detail_penjualan
  DROP CONSTRAINT IF EXISTS detail_penjualan_unit_price_check,
  DROP CONSTRAINT IF EXISTS detail_penjualan_subtotal_check,
  ADD CONSTRAINT detail_penjualan_unit_price_nonnegative_check CHECK (unit_price >= 0),
  ADD CONSTRAINT detail_penjualan_subtotal_nonnegative_check CHECK (subtotal >= 0),
  ADD CONSTRAINT detail_penjualan_bonus_price_check CHECK (
    (is_bonus_rental = false AND unit_price > 0 AND subtotal > 0 AND bonus_reason IS NULL)
    OR
    (is_bonus_rental = true AND unit_price = 0 AND subtotal = 0 AND length(btrim(coalesce(bonus_reason, ''))) > 0)
  );

ALTER TABLE public.penjualan
  DROP CONSTRAINT IF EXISTS penjualan_total_amount_check,
  ADD CONSTRAINT penjualan_total_amount_nonnegative_check CHECK (total_amount >= 0);

ALTER TABLE public.checkout
  DROP CONSTRAINT IF EXISTS checkout_subtotal_penjualan_check,
  DROP CONSTRAINT IF EXISTS checkout_total_amount_check,
  ADD CONSTRAINT checkout_subtotal_penjualan_nonnegative_check CHECK (subtotal_penjualan >= 0),
  ADD CONSTRAINT checkout_total_amount_nonnegative_check CHECK (total_amount >= 0);

ALTER TABLE public.checkout
  DROP CONSTRAINT IF EXISTS checkout_total_math,
  DROP CONSTRAINT IF EXISTS checkout_source_consistency,
  ADD CONSTRAINT checkout_total_math
    CHECK (total_amount = round(subtotal_rental - discount_rental_amount + subtotal_penjualan, 2)),
  ADD CONSTRAINT checkout_discount_rental_nonnegative_check
    CHECK (discount_rental_amount >= 0),
  ADD CONSTRAINT checkout_discount_rental_limit_check
    CHECK (discount_rental_amount <= subtotal_rental),
  ADD CONSTRAINT checkout_source_consistency
    CHECK (
      (
        source = 'pos'
        AND penyewaan_id IS NULL
        AND penjualan_id IS NOT NULL
        AND subtotal_rental = 0
        AND discount_rental_amount = 0
      )
      OR
      (
        source = 'mixed'
        AND penyewaan_id IS NOT NULL
        AND penjualan_id IS NOT NULL
      )
    );

CREATE OR REPLACE FUNCTION app_private.guard_penyewaan_discount_math()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Backward compatibility for trusted commands created before this schema:
    -- an omitted snapshot means no checkout discount was applied.
    IF NEW.subtotal_amount = 0
       AND NEW.discount_amount = 0
       AND NEW.total_amount > 0 THEN
      NEW.subtotal_amount := NEW.total_amount;
    END IF;
  ELSIF NEW.total_amount IS DISTINCT FROM OLD.total_amount
     AND NEW.subtotal_amount IS NOT DISTINCT FROM OLD.subtotal_amount
     AND NEW.discount_amount IS NOT DISTINCT FROM OLD.discount_amount THEN
    IF OLD.discount_amount = 0 THEN
      NEW.subtotal_amount := NEW.total_amount;
    ELSE
      RAISE EXCEPTION 'Rental total must be changed through the discount snapshot invariant';
    END IF;
  END IF;

  IF NEW.subtotal_amount < 0
     OR NEW.discount_amount < 0
     OR NEW.discount_amount > NEW.subtotal_amount THEN
    RAISE EXCEPTION 'Rental discount must be between zero and the rental subtotal';
  END IF;

  NEW.total_amount := round(NEW.subtotal_amount - NEW.discount_amount, 2);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS penyewaan_discount_math_guard ON public.penyewaan;
CREATE TRIGGER penyewaan_discount_math_guard
BEFORE INSERT OR UPDATE OF total_amount, subtotal_amount, discount_amount
ON public.penyewaan
FOR EACH ROW
EXECUTE FUNCTION app_private.guard_penyewaan_discount_math();

ALTER TABLE public.penyewaan
  DROP CONSTRAINT IF EXISTS penyewaan_discount_math_check,
  ADD CONSTRAINT penyewaan_discount_math_check
    CHECK (
      subtotal_amount >= 0
      AND discount_amount >= 0
      AND discount_amount <= subtotal_amount
      AND total_amount = round(subtotal_amount - discount_amount, 2)
    );

CREATE TABLE IF NOT EXISTS public.penyewaan_diskon (
  penyewaan_diskon_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  penyewaan_id uuid NOT NULL,
  source text NOT NULL,
  program_loyalitas_id uuid,
  program_version integer,
  completed_rental_count integer NOT NULL DEFAULT 0,
  minimum_completed_rentals integer,
  recommended_discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  recommended_amount numeric(14,2) NOT NULL DEFAULT 0,
  actual_amount numeric(14,2) NOT NULL,
  bonus_amount numeric(14,2) NOT NULL DEFAULT 0,
  reason_code text NOT NULL,
  reason_note text,
  actor_akun_admin_id uuid NOT NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT penyewaan_diskon_rental_unique UNIQUE (usaha_id, penyewaan_id),
  CONSTRAINT penyewaan_diskon_tenant_fk
    FOREIGN KEY (usaha_id, penyewaan_id)
    REFERENCES public.penyewaan(usaha_id, penyewaan_id) ON DELETE RESTRICT,
  CONSTRAINT penyewaan_diskon_program_fk
    FOREIGN KEY (usaha_id, program_loyalitas_id)
    REFERENCES public.program_loyalitas(usaha_id, program_loyalitas_id) ON DELETE RESTRICT,
  CONSTRAINT penyewaan_diskon_actor_fk
    FOREIGN KEY (usaha_id, actor_akun_admin_id)
    REFERENCES public.keanggotaan_usaha(usaha_id, akun_admin_id) ON DELETE RESTRICT,
  CONSTRAINT penyewaan_diskon_source_check
    CHECK (source IN ('loyalty', 'manual')),
  CONSTRAINT penyewaan_diskon_count_check
    CHECK (completed_rental_count >= 0),
  CONSTRAINT penyewaan_diskon_percent_check
    CHECK (recommended_discount_percent >= 0 AND recommended_discount_percent <= 100),
  CONSTRAINT penyewaan_diskon_amount_check
    CHECK (
      recommended_amount >= 0
      AND actual_amount > 0
      AND bonus_amount >= 0
      AND bonus_amount <= actual_amount
    ),
  CONSTRAINT penyewaan_diskon_reason_check
    CHECK (length(btrim(reason_code)) > 0)
);

CREATE INDEX IF NOT EXISTS penyewaan_diskon_program_idx
  ON public.penyewaan_diskon (usaha_id, program_loyalitas_id, created_at DESC)
  WHERE program_loyalitas_id IS NOT NULL;

ALTER TABLE public.penyewaan_diskon ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.penyewaan_diskon FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.penyewaan_diskon TO authenticated;
DROP POLICY IF EXISTS penyewaan_diskon_member_read ON public.penyewaan_diskon;
CREATE POLICY penyewaan_diskon_member_read
  ON public.penyewaan_diskon
  FOR SELECT TO authenticated
  USING (app_private.has_usaha_access(usaha_id));

CREATE OR REPLACE FUNCTION app_private.command_set_loyalty_program(
  p_usaha_id uuid,
  p_is_enabled boolean,
  p_minimum_completed_rentals integer,
  p_recommended_discount_percent numeric,
  p_valid_from timestamptz,
  p_valid_until timestamptz,
  p_expected_version integer,
  p_idempotency_key text,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.require_usaha_permission(p_usaha_id, 'event_promotion.manage');
  v_current public.program_loyalitas%ROWTYPE;
  v_result public.program_loyalitas%ROWTYPE;
  v_claim jsonb;
  v_idempotency_id uuid;
  v_hash text;
  v_response jsonb;
BEGIN
  IF p_is_enabled IS NULL
     OR p_minimum_completed_rentals IS NULL
     OR p_minimum_completed_rentals <= 0
     OR p_recommended_discount_percent IS NULL
     OR p_recommended_discount_percent <= 0
     OR p_recommended_discount_percent > 100
     OR p_valid_from IS NULL
     OR (p_valid_until IS NOT NULL AND p_valid_until <= p_valid_from)
     OR p_idempotency_key IS NULL
     OR btrim(p_idempotency_key) = ''
     OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: konfigurasi loyalitas tidak valid'
      USING ERRCODE = '22023';
  END IF;

  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'is_enabled', p_is_enabled,
    'minimum_completed_rentals', p_minimum_completed_rentals,
    'recommended_discount_percent', p_recommended_discount_percent,
    'valid_from', p_valid_from,
    'valid_until', p_valid_until,
    'expected_version', p_expected_version
  )::text);
  v_claim := app_private.catalog_idempotency_claim(
    p_usaha_id, 'set_loyalty_program', p_idempotency_key, v_hash
  );
  IF v_claim->>'state' = 'committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state' = 'unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: status perubahan program loyalitas belum dapat dipastikan'
      USING ERRCODE = '40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text || ':loyalty-program', 0));
  SELECT * INTO v_current
  FROM public.program_loyalitas
  WHERE usaha_id = p_usaha_id
  FOR UPDATE;

  IF FOUND THEN
    IF p_expected_version IS NULL OR p_expected_version <> v_current.version THEN
      RAISE EXCEPTION 'STALE_DATA: program loyalitas sudah berubah; muat ulang konfigurasi'
        USING ERRCODE = '40001';
    END IF;

    UPDATE public.program_loyalitas
    SET is_enabled = p_is_enabled,
        minimum_completed_rentals = p_minimum_completed_rentals,
        recommended_discount_percent = round(p_recommended_discount_percent, 2),
        valid_from = p_valid_from,
        valid_until = p_valid_until,
        version = version + 1,
        updated_by_akun_admin_id = v_admin_id,
        updated_at = now()
    WHERE usaha_id = p_usaha_id
    RETURNING * INTO v_result;
  ELSE
    IF coalesce(p_expected_version, 0) <> 0 THEN
      RAISE EXCEPTION 'STALE_DATA: program loyalitas belum pernah dibuat'
        USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.program_loyalitas (
      usaha_id, is_enabled, minimum_completed_rentals,
      recommended_discount_percent, valid_from, valid_until,
      version, created_by_akun_admin_id, updated_by_akun_admin_id
    )
    VALUES (
      p_usaha_id, p_is_enabled, p_minimum_completed_rentals,
      round(p_recommended_discount_percent, 2), p_valid_from, p_valid_until,
      1, v_admin_id, v_admin_id
    )
    RETURNING * INTO v_result;
  END IF;

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, request_id, change_summary
  )
  VALUES (
    p_usaha_id, auth.uid(), v_admin_id, 'configure',
    'program_loyalitas', v_result.program_loyalitas_id,
    'admin-command', p_request_id,
    jsonb_build_object(
      'is_enabled', v_result.is_enabled,
      'minimum_completed_rentals', v_result.minimum_completed_rentals,
      'recommended_discount_percent', v_result.recommended_discount_percent,
      'valid_from', v_result.valid_from,
      'valid_until', v_result.valid_until,
      'version', v_result.version
    )
  );

  v_response := jsonb_build_object(
    'program_loyalitas_id', v_result.program_loyalitas_id,
    'usaha_id', p_usaha_id,
    'is_enabled', v_result.is_enabled,
    'minimum_completed_rentals', v_result.minimum_completed_rentals,
    'recommended_discount_percent', v_result.recommended_discount_percent,
    'valid_from', v_result.valid_from,
    'valid_until', v_result.valid_until,
    'version', v_result.version,
    'updated_at', v_result.updated_at
  );
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id, 200, v_response);
  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_set_loyalty_program(
  uuid, boolean, integer, numeric, timestamptz, timestamptz, integer, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_set_loyalty_program(
  uuid, boolean, integer, numeric, timestamptz, timestamptz, integer, text, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.command_set_loyalty_program(
  p_usaha_id uuid,
  p_is_enabled boolean,
  p_minimum_completed_rentals integer,
  p_recommended_discount_percent numeric,
  p_valid_from timestamptz,
  p_valid_until timestamptz,
  p_expected_version integer,
  p_idempotency_key text,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_set_loyalty_program(
    p_usaha_id, p_is_enabled, p_minimum_completed_rentals,
    p_recommended_discount_percent, p_valid_from, p_valid_until,
    p_expected_version, p_idempotency_key, p_request_id
  );
$function$;

REVOKE ALL ON FUNCTION public.command_set_loyalty_program(
  uuid, boolean, integer, numeric, timestamptz, timestamptz, integer, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_set_loyalty_program(
  uuid, boolean, integer, numeric, timestamptz, timestamptz, integer, text, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.resolve_loyalty_discount_snapshot(
  p_usaha_id uuid,
  p_penyewa_id uuid,
  p_rental_subtotal numeric
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_program public.program_loyalitas%ROWTYPE;
  v_completed_count integer;
  v_is_in_period boolean := false;
  v_eligible boolean := false;
  v_percent numeric(5,2) := 0;
  v_recommended numeric(14,2) := 0;
BEGIN
  IF p_usaha_id IS NULL OR p_penyewa_id IS NULL
     OR p_rental_subtotal IS NULL OR p_rental_subtotal < 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha, penyewa dan subtotal rental wajib valid'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.penyewa p
    WHERE p.usaha_id = p_usaha_id
      AND p.penyewa_id = p_penyewa_id
      AND p.status = 'active'
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: penyewa aktif tidak ditemukan pada Usaha ini'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*)::integer
  INTO v_completed_count
  FROM public.penyewaan r
  WHERE r.usaha_id = p_usaha_id
    AND r.penyewa_id = p_penyewa_id
    AND r.status = 'completed'
    AND r.actual_return_completed_at IS NOT NULL;

  SELECT * INTO v_program
  FROM public.program_loyalitas p
  WHERE p.usaha_id = p_usaha_id;

  IF FOUND THEN
    v_is_in_period := v_program.valid_from <= now()
      AND (v_program.valid_until IS NULL OR now() < v_program.valid_until);
    v_eligible := v_program.is_enabled
      AND v_is_in_period
      AND v_completed_count >= v_program.minimum_completed_rentals;
    IF v_eligible THEN
      v_percent := v_program.recommended_discount_percent;
      v_recommended := least(
        round(p_rental_subtotal * v_percent / 100, 2),
        round(p_rental_subtotal, 2)
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'program_loyalitas_id', v_program.program_loyalitas_id,
    'program_version', v_program.version,
    'is_enabled', coalesce(v_program.is_enabled, false),
    'is_in_period', v_is_in_period,
    'completed_rental_count', v_completed_count,
    'minimum_completed_rentals', v_program.minimum_completed_rentals,
    'eligible', v_eligible,
    'recommended_discount_percent', v_percent,
    'recommended_amount', v_recommended,
    'rental_subtotal', round(p_rental_subtotal, 2)
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.resolve_loyalty_discount_snapshot(uuid, uuid, numeric)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.preview_loyalty_discount(
  p_usaha_id uuid,
  p_penyewa_id uuid,
  p_rental_subtotal numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  PERFORM app_private.catalog_require_admin(p_usaha_id);
  RETURN app_private.resolve_loyalty_discount_snapshot(
    p_usaha_id, p_penyewa_id, p_rental_subtotal
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.preview_loyalty_discount(uuid, uuid, numeric)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.preview_loyalty_discount(uuid, uuid, numeric)
  TO authenticated;

CREATE OR REPLACE FUNCTION app_private.resolve_checkout_discount(
  p_usaha_id uuid,
  p_penyewa_id uuid,
  p_rental_subtotal numeric,
  p_discount_request jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_mode text := coalesce(p_discount_request->>'mode', 'none');
  v_admin_id uuid;
  v_loyalty jsonb;
  v_eligible boolean := false;
  v_recommended numeric(14,2) := 0;
  v_actual numeric(14,2) := 0;
  v_bonus numeric(14,2) := 0;
  v_reason text;
BEGIN
  IF p_rental_subtotal IS NULL OR p_rental_subtotal < 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: subtotal rental tidak valid'
      USING ERRCODE = '22023';
  END IF;

  IF v_mode = 'none' THEN
    RETURN jsonb_build_object(
      'source', 'none',
      'actual_amount', 0,
      'recommended_amount', 0,
      'bonus_amount', 0,
      'reason_code', NULL,
      'reason_note', NULL
    );
  END IF;

  IF v_mode NOT IN ('loyalty', 'manual') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: mode diskon harus none, loyalty, atau manual'
      USING ERRCODE = '22023';
  END IF;

  v_admin_id := app_private.require_usaha_permission(
    p_usaha_id, 'checkout_discount.apply'
  );
  v_loyalty := app_private.resolve_loyalty_discount_snapshot(
    p_usaha_id, p_penyewa_id, p_rental_subtotal
  );
  v_eligible := coalesce((v_loyalty->>'eligible')::boolean, false);
  v_recommended := coalesce((v_loyalty->>'recommended_amount')::numeric, 0);

  IF v_mode = 'loyalty' THEN
    IF NOT v_eligible OR v_recommended <= 0 THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: penyewa belum memenuhi syarat program loyalitas atau nilai rekomendasi nol'
        USING ERRCODE = '23514';
    END IF;
    v_actual := v_recommended;
    v_reason := 'loyalty_model_a';
  ELSE
    IF p_discount_request->>'amount' IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: nominal diskon manual wajib diisi'
        USING ERRCODE = '22023';
    END IF;
    v_actual := round((p_discount_request->>'amount')::numeric, 2);
    v_reason := nullif(btrim(coalesce(p_discount_request->>'reason', '')), '');
    IF v_actual <= 0 OR v_reason IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: nominal diskon manual harus positif dan alasan wajib diisi'
        USING ERRCODE = '22023';
    END IF;
    IF v_eligible AND v_actual > v_recommended THEN
      PERFORM app_private.require_usaha_permission(
        p_usaha_id, 'checkout_discount.override'
      );
      v_bonus := round(v_actual - v_recommended, 2);
    END IF;
  END IF;

  IF v_actual > round(p_rental_subtotal, 2) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: diskon rental tidak boleh melebihi subtotal rental'
      USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'source', v_mode,
    'program_loyalitas_id', v_loyalty->'program_loyalitas_id',
    'program_version', v_loyalty->'program_version',
    'completed_rental_count', v_loyalty->'completed_rental_count',
    'minimum_completed_rentals', v_loyalty->'minimum_completed_rentals',
    'eligible', v_eligible,
    'recommended_discount_percent', v_loyalty->'recommended_discount_percent',
    'recommended_amount', v_recommended,
    'actual_amount', v_actual,
    'bonus_amount', v_bonus,
    'reason_code', v_reason,
    'reason_note', CASE WHEN v_mode = 'manual' THEN v_reason ELSE NULL END
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.resolve_checkout_discount(uuid, uuid, numeric, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.apply_checkout_discount_to_rental(
  p_usaha_id uuid,
  p_penyewaan_id uuid,
  p_discount_request jsonb,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid := app_private.catalog_require_admin(p_usaha_id);
  v_rental public.penyewaan%ROWTYPE;
  v_checkout public.checkout%ROWTYPE;
  v_snapshot jsonb;
  v_subtotal numeric(14,2);
  v_discount numeric(14,2);
  v_total numeric(14,2);
  v_recorded_rental_payments numeric(14,2) := 0;
  v_has_checkout boolean := false;
BEGIN
  IF p_penyewaan_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: rental dan request_id wajib diisi'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_rental
  FROM public.penyewaan
  WHERE usaha_id = p_usaha_id
    AND penyewaan_id = p_penyewaan_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: penyewaan tidak ditemukan pada Usaha ini'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_rental.status <> 'draft' THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: diskon checkout hanya dapat diterapkan sebelum rental diaktifkan'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.penyewaan_diskon d
    WHERE d.usaha_id = p_usaha_id AND d.penyewaan_id = p_penyewaan_id
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: snapshot diskon untuk rental ini sudah tercatat'
      USING ERRCODE = '23505';
  END IF;

  SELECT coalesce(sum(d.subtotal), 0)::numeric(14,2)
  INTO v_subtotal
  FROM public.detail_penyewaan d
  WHERE d.usaha_id = p_usaha_id
    AND d.penyewaan_id = p_penyewaan_id;

  v_snapshot := app_private.resolve_checkout_discount(
    p_usaha_id, v_rental.penyewa_id, v_subtotal, p_discount_request
  );
  v_discount := coalesce((v_snapshot->>'actual_amount')::numeric, 0);
  v_total := round(v_subtotal - v_discount, 2);

  IF v_discount < 0 OR v_discount > v_subtotal THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: nilai diskon berada di luar batas subtotal rental'
      USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(sum(p.amount), 0)::numeric(14,2)
  INTO v_recorded_rental_payments
  FROM public.pembayaran p
  WHERE p.usaha_id = p_usaha_id
    AND p.penyewaan_id = p_penyewaan_id
    AND p.status = 'recorded';
  IF v_recorded_rental_payments > v_total THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: pembayaran rental yang tercatat melebihi kewajiban setelah diskon; sesuaikan pembayaran sebelum promo diterapkan'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_checkout
  FROM public.checkout c
  WHERE c.usaha_id = p_usaha_id
    AND c.penyewaan_id = p_penyewaan_id
  FOR UPDATE;
  v_has_checkout := FOUND;

  IF v_has_checkout THEN
    IF v_checkout.amount_paid > round(v_total + v_checkout.subtotal_penjualan, 2) THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: pembayaran tercatat melebihi total setelah diskon; kurangi alokasi pembayaran sebelum menerapkan promo'
        USING ERRCODE = '23514';
    END IF;
    IF v_checkout.discount_rental_amount <> 0 THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: checkout sudah memiliki diskon rental'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  UPDATE public.penyewaan
  SET subtotal_amount = v_subtotal,
      discount_amount = v_discount,
      total_amount = v_total,
      updated_at = now()
  WHERE usaha_id = p_usaha_id
    AND penyewaan_id = p_penyewaan_id
  RETURNING * INTO v_rental;

  IF v_has_checkout THEN
    UPDATE public.checkout
    SET subtotal_rental = v_subtotal,
        discount_rental_amount = v_discount,
        total_amount = round(v_subtotal - v_discount + v_checkout.subtotal_penjualan, 2),
        payment_status = CASE
          WHEN amount_paid = round(v_subtotal - v_discount + v_checkout.subtotal_penjualan, 2) THEN 'paid'
          WHEN amount_paid > 0 THEN 'partial'
          ELSE 'unpaid'
        END
    WHERE usaha_id = p_usaha_id
      AND checkout_id = v_checkout.checkout_id
    RETURNING * INTO v_checkout;
  END IF;

  IF v_discount > 0 THEN
    INSERT INTO public.penyewaan_diskon (
      usaha_id, penyewaan_id, source, program_loyalitas_id,
      program_version, completed_rental_count, minimum_completed_rentals,
      recommended_discount_percent, recommended_amount, actual_amount,
      bonus_amount, reason_code, reason_note, actor_akun_admin_id, request_id
    )
    VALUES (
      p_usaha_id, p_penyewaan_id, v_snapshot->>'source',
      nullif(v_snapshot->>'program_loyalitas_id', '')::uuid,
      nullif(v_snapshot->>'program_version', '')::integer,
      coalesce(nullif(v_snapshot->>'completed_rental_count', '')::integer, 0),
      nullif(v_snapshot->>'minimum_completed_rentals', '')::integer,
      coalesce(nullif(v_snapshot->>'recommended_discount_percent', '')::numeric, 0),
      coalesce(nullif(v_snapshot->>'recommended_amount', '')::numeric, 0),
      v_discount,
      coalesce(nullif(v_snapshot->>'bonus_amount', '')::numeric, 0),
      v_snapshot->>'reason_code',
      v_snapshot->>'reason_note',
      v_admin_id,
      p_request_id
    );

    INSERT INTO public.audit_log (
      usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
      entity_type, entity_id, source_application, request_id, change_summary
    )
    VALUES (
      p_usaha_id, auth.uid(), v_admin_id, 'apply_checkout_discount',
      'penyewaan', p_penyewaan_id, 'admin-command', p_request_id,
      jsonb_build_object(
        'subtotal_amount', v_subtotal,
        'discount_amount', v_discount,
        'total_amount', v_total,
        'discount_snapshot', v_snapshot,
        'checkout_id', CASE WHEN v_has_checkout THEN v_checkout.checkout_id ELSE NULL END
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'penyewaan_id', p_penyewaan_id,
    'subtotal_amount', v_subtotal,
    'discount_amount', v_discount,
    'total_amount', v_total,
    'discount_snapshot', v_snapshot,
    'checkout_id', CASE WHEN v_has_checkout THEN v_checkout.checkout_id ELSE NULL END,
    'checkout_total_amount', CASE WHEN v_has_checkout THEN v_checkout.total_amount ELSE NULL END,
    'amount_paid', CASE WHEN v_has_checkout THEN v_checkout.amount_paid ELSE 0 END,
    'payment_status', CASE WHEN v_has_checkout THEN v_checkout.payment_status ELSE NULL END
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.apply_checkout_discount_to_rental(uuid, uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.command_create_direct_rental_with_discount(
  p_usaha_id uuid,
  p_penyewa_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz,
  p_lines jsonb,
  p_catatan text,
  p_discount_request jsonb,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_hash text;
  v_claim jsonb;
  v_idempotency_id uuid;
  v_rental jsonb;
  v_discount jsonb;
  v_response jsonb;
BEGIN
  PERFORM app_private.catalog_require_admin(p_usaha_id);
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi'
      USING ERRCODE = '22023';
  END IF;
  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id, 'penyewa_id', p_penyewa_id,
    'jadwal_mulai', p_jadwal_mulai, 'jadwal_kembali', p_jadwal_kembali,
    'lines', p_lines, 'catatan', p_catatan, 'discount_request', p_discount_request
  )::text);
  v_claim := app_private.catalog_idempotency_claim(
    p_usaha_id, 'create_direct_rental_with_discount', p_idempotency_key, v_hash
  );
  IF v_claim->>'state' = 'committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state' = 'unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: status pembuatan rental dengan diskon belum dapat dipastikan'
      USING ERRCODE = '40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  v_rental := app_private.command_create_direct_rental(
    p_usaha_id, p_penyewa_id, p_jadwal_mulai, p_jadwal_kembali,
    p_lines, p_catatan, left(btrim(p_idempotency_key) || ':base', 240), p_request_id
  );
  v_discount := app_private.apply_checkout_discount_to_rental(
    p_usaha_id, (v_rental->>'penyewaan_id')::uuid,
    p_discount_request, p_request_id
  );
  v_response := v_rental || jsonb_build_object(
    'subtotal_amount', v_discount->'subtotal_amount',
    'discount_amount', v_discount->'discount_amount',
    'total_amount', v_discount->'total_amount',
    'discount_snapshot', v_discount->'discount_snapshot'
  );
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id, 200, v_response);
  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_create_direct_rental_with_discount(
  uuid, uuid, timestamptz, timestamptz, jsonb, text, jsonb, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_create_direct_rental_with_discount(
  uuid, uuid, timestamptz, timestamptz, jsonb, text, jsonb, text, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.command_create_direct_rental_with_discount(
  p_usaha_id uuid,
  p_penyewa_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz,
  p_lines jsonb,
  p_catatan text,
  p_discount_request jsonb,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_create_direct_rental_with_discount(
    p_usaha_id, p_penyewa_id, p_jadwal_mulai, p_jadwal_kembali,
    p_lines, p_catatan, p_discount_request, p_idempotency_key, p_request_id
  );
$function$;

REVOKE ALL ON FUNCTION public.command_create_direct_rental_with_discount(
  uuid, uuid, timestamptz, timestamptz, jsonb, text, jsonb, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_create_direct_rental_with_discount(
  uuid, uuid, timestamptz, timestamptz, jsonb, text, jsonb, text, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.command_create_direct_rental_and_activate_with_discount(
  p_usaha_id uuid,
  p_penyewa_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz,
  p_lines jsonb,
  p_catatan text,
  p_discount_request jsonb,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_hash text;
  v_claim jsonb;
  v_idempotency_id uuid;
  v_rental jsonb;
  v_activation jsonb;
  v_response jsonb;
BEGIN
  PERFORM app_private.catalog_require_admin(p_usaha_id);
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi'
      USING ERRCODE = '22023';
  END IF;
  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id, 'penyewa_id', p_penyewa_id,
    'jadwal_mulai', p_jadwal_mulai, 'jadwal_kembali', p_jadwal_kembali,
    'lines', p_lines, 'catatan', p_catatan, 'discount_request', p_discount_request
  )::text);
  v_claim := app_private.catalog_idempotency_claim(
    p_usaha_id, 'create_direct_rental_and_activate_with_discount', p_idempotency_key, v_hash
  );
  IF v_claim->>'state' = 'committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state' = 'unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: status rental langsung dengan diskon belum dapat dipastikan'
      USING ERRCODE = '40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  v_rental := app_private.command_create_direct_rental_with_discount(
    p_usaha_id, p_penyewa_id, p_jadwal_mulai, p_jadwal_kembali,
    p_lines, p_catatan, p_discount_request,
    left(btrim(p_idempotency_key) || ':draft', 240), p_request_id
  );
  v_activation := app_private.command_operational_activate_rental(
    p_usaha_id,
    (v_rental->>'penyewaan_id')::uuid,
    p_catatan,
    left(btrim(p_idempotency_key) || ':activate', 240),
    p_request_id
  );
  v_response := v_rental || jsonb_build_object('rental_activation', v_activation);
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id, 200, v_response);
  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_create_direct_rental_and_activate_with_discount(
  uuid, uuid, timestamptz, timestamptz, jsonb, text, jsonb, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_create_direct_rental_and_activate_with_discount(
  uuid, uuid, timestamptz, timestamptz, jsonb, text, jsonb, text, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.command_create_direct_rental_and_activate_with_discount(
  p_usaha_id uuid,
  p_penyewa_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz,
  p_lines jsonb,
  p_catatan text,
  p_discount_request jsonb,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_create_direct_rental_and_activate_with_discount(
    p_usaha_id, p_penyewa_id, p_jadwal_mulai, p_jadwal_kembali,
    p_lines, p_catatan, p_discount_request, p_idempotency_key, p_request_id
  );
$function$;

REVOKE ALL ON FUNCTION public.command_create_direct_rental_and_activate_with_discount(
  uuid, uuid, timestamptz, timestamptz, jsonb, text, jsonb, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_create_direct_rental_and_activate_with_discount(
  uuid, uuid, timestamptz, timestamptz, jsonb, text, jsonb, text, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.command_create_mixed_checkout_with_discount(
  p_usaha_id uuid,
  p_penyewa_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz,
  p_rental_lines jsonb,
  p_sale_lines jsonb,
  p_akun_keuangan_id uuid,
  p_metode text,
  p_payment_rental_amount numeric,
  p_dibayar_at timestamptz,
  p_catatan text,
  p_discount_request jsonb,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_hash text;
  v_claim jsonb;
  v_idempotency_id uuid;
  v_base jsonb;
  v_discount jsonb;
  v_checkout public.checkout%ROWTYPE;
  v_rental_id uuid;
  v_payment jsonb;
  v_rental_net numeric(14,2);
  v_paid_rental numeric(14,2) := coalesce(p_payment_rental_amount, 0);
  v_response jsonb;
BEGIN
  PERFORM app_private.catalog_require_admin(p_usaha_id);
  IF v_paid_rental < 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: pembayaran rental tidak boleh negatif' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi'
      USING ERRCODE = '22023';
  END IF;
  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id, 'penyewa_id', p_penyewa_id,
    'jadwal_mulai', p_jadwal_mulai, 'jadwal_kembali', p_jadwal_kembali,
    'rental_lines', p_rental_lines, 'sale_lines', p_sale_lines,
    'akun_keuangan_id', p_akun_keuangan_id, 'metode', p_metode,
    'payment_rental_amount', p_payment_rental_amount,
    'dibayar_at', p_dibayar_at, 'catatan', p_catatan,
    'discount_request', p_discount_request
  )::text);
  v_claim := app_private.catalog_idempotency_claim(
    p_usaha_id, 'create_mixed_checkout_with_discount', p_idempotency_key, v_hash
  );
  IF v_claim->>'state' = 'committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state' = 'unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: status checkout gabungan dengan diskon belum dapat dipastikan'
      USING ERRCODE = '40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  v_base := app_private.command_create_mixed_checkout(
    p_usaha_id, p_penyewa_id, p_jadwal_mulai, p_jadwal_kembali,
    p_rental_lines, p_sale_lines, p_akun_keuangan_id, p_metode,
    0, p_dibayar_at, p_catatan,
    left(btrim(p_idempotency_key) || ':base', 240), p_request_id
  );
  v_rental_id := (v_base->>'penyewaan_id')::uuid;
  v_discount := app_private.apply_checkout_discount_to_rental(
    p_usaha_id, v_rental_id, p_discount_request, p_request_id
  );
  v_rental_net := coalesce((v_discount->>'total_amount')::numeric, 0);
  IF v_paid_rental > v_rental_net THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: pembayaran rental melebihi nilai rental setelah diskon'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_checkout
  FROM public.checkout
  WHERE usaha_id = p_usaha_id
    AND checkout_id = (v_base->>'checkout_id')::uuid
  FOR UPDATE;

  IF v_paid_rental > 0 THEN
    v_payment := app_private.command_record_payment_with_account(
      p_usaha_id, NULL, v_rental_id, p_akun_keuangan_id,
      CASE WHEN v_paid_rental = v_rental_net THEN 'pelunasan' ELSE 'dp' END,
      p_metode, v_paid_rental, coalesce(p_dibayar_at, now()),
      'Checkout gabungan ' || v_checkout.nomor_checkout,
      'Alokasi pembayaran rental setelah diskon checkout',
      left(btrim(p_idempotency_key) || ':rental-payment', 240), p_request_id
    );
  END IF;

  UPDATE public.checkout
  SET amount_paid = subtotal_penjualan + v_paid_rental,
      payment_status = CASE
        WHEN subtotal_penjualan + v_paid_rental = total_amount THEN 'paid'
        WHEN subtotal_penjualan + v_paid_rental > 0 THEN 'partial'
        ELSE 'unpaid'
      END
  WHERE usaha_id = p_usaha_id AND checkout_id = v_checkout.checkout_id
  RETURNING * INTO v_checkout;

  v_response := v_base || jsonb_build_object(
    'subtotal_rental', v_checkout.subtotal_rental,
    'discount_rental_amount', v_checkout.discount_rental_amount,
    'subtotal_penjualan', v_checkout.subtotal_penjualan,
    'total_amount', v_checkout.total_amount,
    'amount_paid', v_checkout.amount_paid,
    'rental_payment', v_payment,
    'payment_status', v_checkout.payment_status,
    'rental_discount', v_discount->'discount_snapshot'
  );
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id, 200, v_response);
  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_create_mixed_checkout_with_discount(
  uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, uuid, text,
  numeric, timestamptz, text, jsonb, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_create_mixed_checkout_with_discount(
  uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, uuid, text,
  numeric, timestamptz, text, jsonb, text, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.command_create_mixed_checkout_with_discount(
  p_usaha_id uuid,
  p_penyewa_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz,
  p_rental_lines jsonb,
  p_sale_lines jsonb,
  p_akun_keuangan_id uuid,
  p_metode text,
  p_payment_rental_amount numeric,
  p_dibayar_at timestamptz,
  p_catatan text,
  p_discount_request jsonb,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_create_mixed_checkout_with_discount(
    p_usaha_id, p_penyewa_id, p_jadwal_mulai, p_jadwal_kembali,
    p_rental_lines, p_sale_lines, p_akun_keuangan_id, p_metode,
    p_payment_rental_amount, p_dibayar_at, p_catatan,
    p_discount_request, p_idempotency_key, p_request_id
  );
$function$;

REVOKE ALL ON FUNCTION public.command_create_mixed_checkout_with_discount(
  uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, uuid, text,
  numeric, timestamptz, text, jsonb, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_create_mixed_checkout_with_discount(
  uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, uuid, text,
  numeric, timestamptz, text, jsonb, text, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.command_create_mixed_checkout_and_activate_with_discount(
  p_usaha_id uuid,
  p_penyewa_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz,
  p_rental_lines jsonb,
  p_sale_lines jsonb,
  p_akun_keuangan_id uuid,
  p_metode text,
  p_payment_rental_amount numeric,
  p_dibayar_at timestamptz,
  p_catatan text,
  p_discount_request jsonb,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_hash text;
  v_claim jsonb;
  v_idempotency_id uuid;
  v_checkout jsonb;
  v_activation jsonb;
  v_response jsonb;
BEGIN
  PERFORM app_private.catalog_require_admin(p_usaha_id);
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi'
      USING ERRCODE = '22023';
  END IF;
  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id, 'penyewa_id', p_penyewa_id,
    'jadwal_mulai', p_jadwal_mulai, 'jadwal_kembali', p_jadwal_kembali,
    'rental_lines', p_rental_lines, 'sale_lines', p_sale_lines,
    'akun_keuangan_id', p_akun_keuangan_id, 'metode', p_metode,
    'payment_rental_amount', p_payment_rental_amount,
    'dibayar_at', p_dibayar_at, 'catatan', p_catatan,
    'discount_request', p_discount_request
  )::text);
  v_claim := app_private.catalog_idempotency_claim(
    p_usaha_id, 'create_mixed_checkout_and_activate_with_discount', p_idempotency_key, v_hash
  );
  IF v_claim->>'state' = 'committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state' = 'unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: status checkout langsung dengan diskon belum dapat dipastikan'
      USING ERRCODE = '40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  v_checkout := app_private.command_create_mixed_checkout_with_discount(
    p_usaha_id, p_penyewa_id, p_jadwal_mulai, p_jadwal_kembali,
    p_rental_lines, p_sale_lines, p_akun_keuangan_id, p_metode,
    p_payment_rental_amount, p_dibayar_at, p_catatan,
    p_discount_request, left(btrim(p_idempotency_key) || ':checkout', 240), p_request_id
  );
  v_activation := app_private.command_operational_activate_rental(
    p_usaha_id,
    (v_checkout->>'penyewaan_id')::uuid,
    p_catatan,
    left(btrim(p_idempotency_key) || ':activate', 240),
    p_request_id
  );
  v_response := v_checkout || jsonb_build_object('rental_activation', v_activation);
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id, 200, v_response);
  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_create_mixed_checkout_and_activate_with_discount(
  uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, uuid, text,
  numeric, timestamptz, text, jsonb, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_create_mixed_checkout_and_activate_with_discount(
  uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, uuid, text,
  numeric, timestamptz, text, jsonb, text, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.command_create_mixed_checkout_and_activate_with_discount(
  p_usaha_id uuid,
  p_penyewa_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz,
  p_rental_lines jsonb,
  p_sale_lines jsonb,
  p_akun_keuangan_id uuid,
  p_metode text,
  p_payment_rental_amount numeric,
  p_dibayar_at timestamptz,
  p_catatan text,
  p_discount_request jsonb,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_create_mixed_checkout_and_activate_with_discount(
    p_usaha_id, p_penyewa_id, p_jadwal_mulai, p_jadwal_kembali,
    p_rental_lines, p_sale_lines, p_akun_keuangan_id, p_metode,
    p_payment_rental_amount, p_dibayar_at, p_catatan,
    p_discount_request, p_idempotency_key, p_request_id
  );
$function$;

REVOKE ALL ON FUNCTION public.command_create_mixed_checkout_and_activate_with_discount(
  uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, uuid, text,
  numeric, timestamptz, text, jsonb, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_create_mixed_checkout_and_activate_with_discount(
  uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, uuid, text,
  numeric, timestamptz, text, jsonb, text, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.command_create_rental_from_reservation_with_discount(
  p_usaha_id uuid,
  p_reservasi_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz,
  p_discount_request jsonb,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_hash text;
  v_claim jsonb;
  v_idempotency_id uuid;
  v_rental jsonb;
  v_discount jsonb;
  v_response jsonb;
BEGIN
  PERFORM app_private.catalog_require_admin(p_usaha_id);
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi'
      USING ERRCODE = '22023';
  END IF;
  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id, 'reservasi_id', p_reservasi_id,
    'jadwal_mulai', p_jadwal_mulai, 'jadwal_kembali', p_jadwal_kembali,
    'discount_request', p_discount_request
  )::text);
  v_claim := app_private.catalog_idempotency_claim(
    p_usaha_id, 'create_rental_from_reservation_with_discount', p_idempotency_key, v_hash
  );
  IF v_claim->>'state' = 'committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state' = 'unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: status konversi reservasi dengan diskon belum dapat dipastikan'
      USING ERRCODE = '40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  v_rental := app_private.command_create_rental_from_reservation(
    p_usaha_id, p_reservasi_id, p_jadwal_mulai, p_jadwal_kembali,
    left(btrim(p_idempotency_key) || ':base', 240), p_request_id
  );
  v_discount := app_private.apply_checkout_discount_to_rental(
    p_usaha_id, (v_rental->>'penyewaan_id')::uuid,
    p_discount_request, p_request_id
  );
  v_response := v_rental || jsonb_build_object(
    'subtotal_amount', v_discount->'subtotal_amount',
    'discount_amount', v_discount->'discount_amount',
    'total_amount', v_discount->'total_amount',
    'discount_snapshot', v_discount->'discount_snapshot'
  );
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id, 200, v_response);
  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_create_rental_from_reservation_with_discount(
  uuid, uuid, timestamptz, timestamptz, jsonb, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_create_rental_from_reservation_with_discount(
  uuid, uuid, timestamptz, timestamptz, jsonb, text, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.command_create_rental_from_reservation_with_discount(
  p_usaha_id uuid,
  p_reservasi_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz,
  p_discount_request jsonb,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_create_rental_from_reservation_with_discount(
    p_usaha_id, p_reservasi_id, p_jadwal_mulai, p_jadwal_kembali,
    p_discount_request, p_idempotency_key, p_request_id
  );
$function$;

REVOKE ALL ON FUNCTION public.command_create_rental_from_reservation_with_discount(
  uuid, uuid, timestamptz, timestamptz, jsonb, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_create_rental_from_reservation_with_discount(
  uuid, uuid, timestamptz, timestamptz, jsonb, text, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.command_create_reservation_rental_activate_discount(
  p_usaha_id uuid,
  p_reservasi_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz,
  p_catatan text,
  p_discount_request jsonb,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_hash text;
  v_claim jsonb;
  v_idempotency_id uuid;
  v_rental jsonb;
  v_activation jsonb;
  v_response jsonb;
BEGIN
  PERFORM app_private.catalog_require_admin(p_usaha_id);
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi'
      USING ERRCODE = '22023';
  END IF;
  v_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id, 'reservasi_id', p_reservasi_id,
    'jadwal_mulai', p_jadwal_mulai, 'jadwal_kembali', p_jadwal_kembali,
    'catatan', p_catatan, 'discount_request', p_discount_request
  )::text);
  v_claim := app_private.catalog_idempotency_claim(
    p_usaha_id, 'create_rental_from_reservation_and_activate_with_discount', p_idempotency_key, v_hash
  );
  IF v_claim->>'state' = 'committed' THEN RETURN v_claim->'response'; END IF;
  IF v_claim->>'state' = 'unknown' THEN
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: status konversi dan aktivasi reservasi dengan diskon belum dapat dipastikan'
      USING ERRCODE = '40001';
  END IF;
  v_idempotency_id := (v_claim->>'idempotency_key_id')::uuid;

  v_rental := app_private.command_create_rental_from_reservation_with_discount(
    p_usaha_id, p_reservasi_id, p_jadwal_mulai, p_jadwal_kembali,
    p_discount_request, left(btrim(p_idempotency_key) || ':draft', 240), p_request_id
  );
  v_activation := app_private.command_operational_activate_rental(
    p_usaha_id, (v_rental->>'penyewaan_id')::uuid,
    p_catatan, left(btrim(p_idempotency_key) || ':activate', 240), p_request_id
  );
  v_response := v_rental || jsonb_build_object('rental_activation', v_activation);
  PERFORM app_private.catalog_idempotency_finish(v_idempotency_id, 200, v_response);
  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_create_reservation_rental_activate_discount(
  uuid, uuid, timestamptz, timestamptz, text, jsonb, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_create_reservation_rental_activate_discount(
  uuid, uuid, timestamptz, timestamptz, text, jsonb, text, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.command_create_reservation_rental_activate_discount(
  p_usaha_id uuid,
  p_reservasi_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz,
  p_catatan text,
  p_discount_request jsonb,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_create_reservation_rental_activate_discount(
    p_usaha_id, p_reservasi_id, p_jadwal_mulai, p_jadwal_kembali,
    p_catatan, p_discount_request, p_idempotency_key, p_request_id
  );
$function$;

REVOKE ALL ON FUNCTION public.command_create_reservation_rental_activate_discount(
  uuid, uuid, timestamptz, timestamptz, text, jsonb, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_create_reservation_rental_activate_discount(
  uuid, uuid, timestamptz, timestamptz, text, jsonb, text, uuid
) TO authenticated;

-- A mixed checkout may legitimately contain a rental discounted by 100%.
-- The separate sale obligation remains positive, and the checkout still has a charge.



-- A mixed checkout still requires a positive retail obligation, but rental itself may be fully discounted.
CREATE OR REPLACE FUNCTION app_private.command_create_sale_mixed_bonus_internal(
  p_usaha_id uuid,
  p_source text,
  p_nama_pelanggan text,
  p_nomor_telepon text,
  p_catatan text,
  p_lines jsonb,
  p_akun_keuangan_id uuid,
  p_metode text,
  p_idempotency_key text,
  p_request_id uuid,
  p_allow_rental_bonus boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid;
  v_timezone text;
  v_account public.akun_keuangan%ROWTYPE;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_sale_id uuid := gen_random_uuid();
  v_checkout_id uuid := gen_random_uuid();
  v_payment_id uuid := gen_random_uuid();
  v_transaction_id uuid := gen_random_uuid();
  v_sale_number text;
  v_checkout_number text;
  v_payment_number text;
  v_payment_number_seq bigint;
  v_transaction_number bigint;
  v_sale_number_seq bigint;
  v_checkout_number_seq bigint;
  v_now timestamptz := now();
  v_year text;
  v_line jsonb;
  v_barang_id uuid;
  v_variant_id uuid;
  v_parent_id uuid;
  v_barang_name text;
  v_variant_name text;
  v_sellable boolean;
  v_price numeric(14,2);
  v_harga_normal numeric(14,2);
  v_promosi_katalog_id uuid;
  v_is_bonus boolean := false;
  v_bonus_reason text;
  v_bonus_hpp numeric(14,2) := 0;
  v_bonus_hpp_complete boolean := true;
  v_bonus_line_count integer := 0;
  v_diskon_persen numeric(5,2) := 0;
  v_nominal_diskon numeric(14,2) := 0;
  v_cost numeric(14,2);
  v_line_hpp numeric(14,2);
  v_unit_hpp_total numeric(14,2) := 0;
  v_unit_hpp_complete boolean := true;
  v_total_hpp numeric(14,2) := 0;
  v_hpp_complete boolean := true;
  v_mode text;
  v_qty integer;
  v_subtotal numeric(14,2);
  v_total numeric(14,2) := 0;
  v_available integer;
  v_reserved numeric := 0;
  v_reservation record;
  v_unit record;
  v_detail_id uuid;
  v_selected integer;
  v_stock public.stok_barang%ROWTYPE;
  v_response jsonb;
  v_method text := lower(btrim(coalesce(p_metode,'')));
BEGIN
  v_admin_id := app_private.assert_finance_admin(p_usaha_id);
  IF p_allow_rental_bonus IS DISTINCT FROM true OR p_source <> 'pos' THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: jalur bonus retail hanya tersedia untuk command mixed checkout internal' USING ERRCODE='42501';
  END IF;
  IF p_source NOT IN ('pos','mixed') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: sumber penjualan tidak valid' USING ERRCODE='22023';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines)=0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: minimal satu barang penjualan wajib dipilih' USING ERRCODE='22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_lines) AS line(value)
    WHERE coalesce(nullif(line.value->>'is_bonus_rental', '')::boolean, false)
  ) THEN
    PERFORM app_private.require_usaha_permission(p_usaha_id, 'retail_bonus.apply');
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi' USING ERRCODE='22023';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'source',p_source,'nama_pelanggan',nullif(btrim(p_nama_pelanggan),''),
    'nomor_telepon',nullif(btrim(p_nomor_telepon),''),'catatan',nullif(btrim(p_catatan),''),
    'lines',p_lines,'akun',p_akun_keuangan_id,'metode',v_method
  )::text);

  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'create_sale',v_request_hash)
  ON CONFLICT(usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body,request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id AND actor_auth_user_id=v_auth_user_id
      AND command_name='create_sale' AND key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: status penjualan belum dapat dipastikan' USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text,0));

  SELECT timezone INTO v_timezone
  FROM public.usaha WHERE usaha_id=p_usaha_id AND status='active';
  IF v_timezone IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002'; END IF;

  -- Resolve all prices and validate item eligibility from database truth, never from client-supplied prices.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_barang_id := nullif(v_line->>'barang_id','')::uuid;
    v_variant_id := nullif(v_line->>'varian_barang_id','')::uuid;
    v_qty := coalesce(nullif(v_line->>'jumlah','')::integer,0);
    IF num_nonnulls(v_barang_id,v_variant_id) <> 1 OR v_qty <= 0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: setiap baris harus berisi tepat satu produk/varian dan jumlah bulat positif' USING ERRCODE='22023';
    END IF;

    IF v_variant_id IS NOT NULL THEN
      SELECT b.barang_id,b.nama,v.nama,
        coalesce(v.is_sellable,b.is_sellable),
        coalesce(v.harga_jual,b.harga_jual),
        coalesce(v.harga_beli,b.harga_beli),
        coalesce(v.inventory_mode,b.inventory_mode)
      INTO v_parent_id,v_barang_name,v_variant_name,v_sellable,v_price,v_cost,v_mode
      FROM public.varian_barang v
      JOIN public.barang b ON b.usaha_id=v.usaha_id AND b.barang_id=v.barang_id
      WHERE v.usaha_id=p_usaha_id AND v.varian_barang_id=v_variant_id
        AND v.status='active' AND b.status='active';
    ELSE
      SELECT b.barang_id,b.nama,NULL::text,b.is_sellable,b.harga_jual,b.harga_beli,b.inventory_mode
      INTO v_parent_id,v_barang_name,v_variant_name,v_sellable,v_price,v_cost,v_mode
      FROM public.barang b
      WHERE b.usaha_id=p_usaha_id AND b.barang_id=v_barang_id AND b.status='active';
    END IF;

    IF v_parent_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: produk atau varian aktif tidak ditemukan' USING ERRCODE='P0002'; END IF;
    IF v_sellable IS DISTINCT FROM true THEN RAISE EXCEPTION 'BUSINESS_CONFLICT: produk/varian ini belum diizinkan untuk dijual' USING ERRCODE='23514'; END IF;
    IF v_price IS NULL OR v_price <= 0 THEN RAISE EXCEPTION 'PRICE_REQUIRED: harga jual produk/varian belum ditentukan' USING ERRCODE='23514'; END IF;
    IF v_mode NOT IN ('serialized','quantity','untracked') THEN RAISE EXCEPTION 'VALIDATION_ERROR: mode inventaris produk tidak valid' USING ERRCODE='22023'; END IF;
    IF v_cost IS NOT NULL AND v_cost < 0 THEN RAISE EXCEPTION 'VALIDATION_ERROR: harga beli tidak boleh negatif' USING ERRCODE='22023'; END IF;

    v_is_bonus := coalesce(nullif(v_line->>'is_bonus_rental', '')::boolean, false);
    v_bonus_reason := nullif(btrim(coalesce(v_line->>'bonus_reason', '')), '');
    IF v_is_bonus THEN
      IF v_bonus_reason IS NULL THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: alasan bonus retail wajib diisi' USING ERRCODE='22023';
      END IF;
      v_promosi_katalog_id := NULL;
      v_diskon_persen := 0;
      v_price := 0;
      v_bonus_line_count := v_bonus_line_count + 1;
    ELSE
      v_harga_normal := v_price;
      v_promosi_katalog_id := NULL;
      v_diskon_persen := 0;
    v_promosi_katalog_id := NULL;
    v_diskon_persen := 0;
    SELECT rp.promosi_katalog_id, rp.diskon_persen
      INTO v_promosi_katalog_id, v_diskon_persen
    FROM app_private.resolve_catalog_promo_price(
      p_usaha_id,
      CASE WHEN v_variant_id IS NULL THEN v_parent_id ELSE NULL::uuid END,
      v_variant_id,
      'sale',
      v_now
    ) rp;
    IF FOUND THEN
      v_price := round(v_harga_normal * (100 - v_diskon_persen) / 100, 2);
    END IF;
    END IF;
    v_subtotal := round(v_qty * v_price,2);
    v_total := v_total + v_subtotal;
  END LOOP;

  IF v_total < 0 OR (v_total = 0 AND v_bonus_line_count = 0) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: transaksi mixed harus memiliki nilai penjualan positif atau baris bonus retail yang sah' USING ERRCODE='22023';
  END IF;

  IF v_total > 0 THEN
    IF p_akun_keuangan_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: akun penerima wajib dipilih untuk transaksi retail berbayar' USING ERRCODE='22023';
    END IF;
    IF v_method NOT IN ('cash','bank_transfer','qris_manual','other') THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: metode pembayaran tidak didukung' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v_account
    FROM public.akun_keuangan
    WHERE usaha_id=p_usaha_id AND akun_keuangan_id=p_akun_keuangan_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: akun penerima tidak ditemukan' USING ERRCODE='P0002'; END IF;
    IF v_account.status <> 'active' OR v_account.mata_uang <> 'IDR' THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: akun penerima tidak aktif atau bukan akun IDR' USING ERRCODE='23514';
    END IF;
  END IF;

  v_year := to_char(v_now AT TIME ZONE v_timezone,'YYYY');
  v_sale_number_seq := app_private.next_business_number(p_usaha_id,'POS',v_year);
  v_checkout_number_seq := app_private.next_business_number(p_usaha_id,'CKO',v_year);
  v_payment_number_seq := app_private.next_business_number(p_usaha_id,'SP',v_year);
  v_transaction_number := app_private.next_business_number(p_usaha_id,'TRX',v_year);
  v_sale_number := 'POS-' || v_year || '-' || lpad(v_sale_number_seq::text,4,'0');
  v_checkout_number := 'CK-' || v_year || '-' || lpad(v_checkout_number_seq::text,4,'0');
  v_payment_number := 'SP-' || v_year || '-' || lpad(v_payment_number_seq::text,4,'0');

  INSERT INTO public.penjualan(
    penjualan_id,usaha_id,nomor_penjualan,source,nama_pelanggan,nomor_telepon,status,
    payment_status,total_amount,currency_code,catatan,created_by_admin_id
  ) VALUES (
    v_sale_id,p_usaha_id,v_sale_number,p_source,
    nullif(btrim(coalesce(p_nama_pelanggan,'')),''),
    nullif(btrim(coalesce(p_nomor_telepon,'')),''),
    'completed','paid',v_total,'IDR',
    nullif(btrim(coalesce(p_catatan,'')),''),v_admin_id
  );

  -- Re-read each line under the tenant stock lock, then consume exactly the stock class assigned to that product/variant.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_barang_id := nullif(v_line->>'barang_id','')::uuid;
    v_variant_id := nullif(v_line->>'varian_barang_id','')::uuid;
    v_qty := (v_line->>'jumlah')::integer;

    IF v_variant_id IS NOT NULL THEN
      SELECT b.barang_id,b.nama,v.nama,
        coalesce(v.is_sellable,b.is_sellable),
        coalesce(v.harga_jual,b.harga_jual),
        coalesce(v.harga_beli,b.harga_beli),
        coalesce(v.inventory_mode,b.inventory_mode)
      INTO v_parent_id,v_barang_name,v_variant_name,v_sellable,v_price,v_cost,v_mode
      FROM public.varian_barang v
      JOIN public.barang b ON b.usaha_id=v.usaha_id AND b.barang_id=v.barang_id
      WHERE v.usaha_id=p_usaha_id AND v.varian_barang_id=v_variant_id
        AND v.status='active' AND b.status='active';
    ELSE
      SELECT b.barang_id,b.nama,NULL::text,b.is_sellable,b.harga_jual,b.harga_beli,b.inventory_mode
      INTO v_parent_id,v_barang_name,v_variant_name,v_sellable,v_price,v_cost,v_mode
      FROM public.barang b
      WHERE b.usaha_id=p_usaha_id AND b.barang_id=v_barang_id AND b.status='active';
    END IF;

    v_is_bonus := coalesce(nullif(v_line->>'is_bonus_rental', '')::boolean, false);
    v_bonus_reason := nullif(btrim(coalesce(v_line->>'bonus_reason', '')), '');
    v_harga_normal := v_price;
    v_promosi_katalog_id := NULL;
    v_diskon_persen := 0;
    IF v_is_bonus THEN
      IF v_bonus_reason IS NULL THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: alasan bonus retail wajib diisi' USING ERRCODE='22023';
      END IF;
      v_price := 0;
    ELSE
      SELECT rp.promosi_katalog_id, rp.diskon_persen
        INTO v_promosi_katalog_id, v_diskon_persen
      FROM app_private.resolve_catalog_promo_price(
        p_usaha_id,
        CASE WHEN v_variant_id IS NULL THEN v_parent_id ELSE NULL::uuid END,
        v_variant_id,
        'sale',
        v_now
      ) rp;
      IF FOUND THEN
        v_price := round(v_harga_normal * (100 - v_diskon_persen) / 100, 2);
        IF v_price <= 0 THEN
          RAISE EXCEPTION 'BUSINESS_CONFLICT: promo sale tidak boleh menjadikan harga retail Rp0; gunakan bonus retail pada checkout gabungan' USING ERRCODE='23514';
        END IF;
      END IF;
    END IF;
    v_subtotal := round(v_qty * v_price,2);
    v_nominal_diskon := round((v_harga_normal - v_price) * v_qty, 2);
    v_detail_id := gen_random_uuid();
    v_unit_hpp_total := 0;
    v_unit_hpp_complete := true;
    v_selected := 0;

    INSERT INTO public.detail_penjualan(
      detail_penjualan_id,usaha_id,penjualan_id,barang_id,varian_barang_id,
      nama_barang_snapshot,nama_varian_snapshot,inventory_mode,jumlah,unit_price,subtotal,currency_code,
      harga_beli_satuan,hpp_total,
      promosi_katalog_id,harga_normal_snapshot,diskon_persen_snapshot,nominal_diskon_snapshot,
      is_bonus_rental,bonus_reason
    ) VALUES (
      v_detail_id,p_usaha_id,v_sale_id,v_parent_id,v_variant_id,
      v_barang_name,v_variant_name,v_mode,v_qty,v_price,v_subtotal,'IDR',
      v_cost,CASE WHEN v_cost IS NULL THEN NULL ELSE round(v_qty*v_cost,2) END,
      v_promosi_katalog_id,v_harga_normal,coalesce(v_diskon_persen,0),
      CASE WHEN v_is_bonus THEN 0 ELSE v_nominal_diskon END,
      v_is_bonus,CASE WHEN v_is_bonus THEN v_bonus_reason ELSE NULL END
    );

    IF v_mode='untracked' THEN
      NULL; -- Consumables without stock tracking: sale does not mutate stock.
    ELSIF v_mode='quantity' THEN
      SELECT * INTO v_stock
      FROM public.stok_barang
      WHERE usaha_id=p_usaha_id AND barang_id=v_parent_id
        AND varian_barang_id IS NOT DISTINCT FROM v_variant_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'STOCK_NOT_CONFIGURED: saldo stok kuantitas belum diatur untuk %',coalesce(v_variant_name,v_barang_name) USING ERRCODE='23514';
      END IF;
      IF v_stock.jumlah < v_qty THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: stok % tersedia %, diminta %',coalesce(v_variant_name,v_barang_name),v_stock.jumlah,v_qty USING ERRCODE='23514';
      END IF;

      UPDATE public.stok_barang
      SET jumlah=jumlah-v_qty,updated_at=now()
      WHERE stok_barang_id=v_stock.stok_barang_id;

      INSERT INTO public.pergerakan_stok(
        usaha_id,stok_barang_id,barang_id,varian_barang_id,jenis_pergerakan,
        quantity_delta,source_type,source_id,actor_akun_admin_id,request_id,catatan,metadata
      ) VALUES (
        p_usaha_id,v_stock.stok_barang_id,v_parent_id,v_variant_id,'sale',
        -v_qty,'sale',v_sale_id,v_admin_id,p_request_id,
        'Penjualan '||v_sale_number,
        jsonb_build_object('penjualan_id',v_sale_id,'detail_penjualan_id',v_detail_id)
      );
    ELSE
      SELECT count(*) INTO v_available
      FROM public.unit_barang u
      WHERE u.usaha_id=p_usaha_id AND u.status='ready'
        AND (
          (v_variant_id IS NOT NULL AND u.varian_barang_id=v_variant_id)
          OR (v_variant_id IS NULL AND u.barang_id=v_parent_id AND u.varian_barang_id IS NULL)
        );

      v_reserved := 0;
      FOR v_reservation IN
        SELECT r.mulai_reservasi,r.selesai_reservasi
        FROM public.reservasi r
        WHERE r.usaha_id=p_usaha_id AND r.status='confirmed' AND r.stock_lock_status='locked'
      LOOP
        v_reserved := greatest(v_reserved,app_private.reservation_locked_component_requirement(
          p_usaha_id,v_reservation.mulai_reservasi,v_reservation.selesai_reservasi,
          CASE WHEN v_variant_id IS NULL THEN v_parent_id ELSE NULL::uuid END,
          v_variant_id,NULL
        ));
      END LOOP;

      IF v_available - v_reserved < v_qty THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: unit % tidak dapat dijual karena stok dibutuhkan untuk rental/reservasi; tersedia %, sudah dikomitmen %',
          coalesce(v_variant_name,v_barang_name),v_available,v_reserved USING ERRCODE='23514';
      END IF;

      v_selected := 0;
      FOR v_unit IN
        SELECT u.unit_barang_id,u.kode_unit,u.lokasi_id,u.harga_perolehan
        FROM public.unit_barang u
        WHERE u.usaha_id=p_usaha_id AND u.status='ready'
          AND (
            (v_variant_id IS NOT NULL AND u.varian_barang_id=v_variant_id)
            OR (v_variant_id IS NULL AND u.barang_id=v_parent_id AND u.varian_barang_id IS NULL)
          )
        ORDER BY u.created_at,u.unit_barang_id
        LIMIT v_qty
        FOR UPDATE
      LOOP
        UPDATE public.unit_barang
        SET status='sold',updated_at=now()
        WHERE usaha_id=p_usaha_id AND unit_barang_id=v_unit.unit_barang_id AND status='ready';
        IF NOT FOUND THEN
          RAISE EXCEPTION 'BUSINESS_CONFLICT: unit berubah saat proses penjualan, ulangi setelah memuat stok terbaru' USING ERRCODE='40001';
        END IF;
        INSERT INTO public.detail_penjualan_unit(
          usaha_id,detail_penjualan_id,penjualan_id,unit_barang_id
        ) VALUES (p_usaha_id,v_detail_id,v_sale_id,v_unit.unit_barang_id);
        INSERT INTO public.riwayat_unit(
          usaha_id,unit_barang_id,jenis_kejadian,terjadi_at,status_sebelum,status_sesudah,
          lokasi_sebelum_id,lokasi_sesudah_id,sumber_type,sumber_id,actor_akun_admin_id,catatan,metadata
        ) VALUES (
          p_usaha_id,v_unit.unit_barang_id,'unit_sold',v_now,'ready','sold',
          v_unit.lokasi_id,v_unit.lokasi_id,'sale',v_sale_id,v_admin_id,
          'Dijual melalui transaksi '||v_sale_number,
          jsonb_build_object('penjualan_id',v_sale_id,'nomor_penjualan',v_sale_number,'kode_unit',v_unit.kode_unit)
        );
        IF v_unit.harga_perolehan IS NULL THEN
          v_unit_hpp_complete := false;
        ELSE
          v_unit_hpp_total := v_unit_hpp_total + v_unit.harga_perolehan;
        END IF;
        v_selected := v_selected + 1;
      END LOOP;

      IF v_selected <> v_qty THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: jumlah unit siap berubah ketika penjualan diproses' USING ERRCODE='40001';
      END IF;
    END IF;

    IF v_mode='serialized' AND v_selected=v_qty AND v_unit_hpp_complete THEN
      v_line_hpp := v_unit_hpp_total;
      UPDATE public.detail_penjualan
      SET harga_beli_satuan=round(v_line_hpp/v_qty,2),hpp_total=v_line_hpp
      WHERE usaha_id=p_usaha_id AND detail_penjualan_id=v_detail_id;
    ELSE
      v_line_hpp := CASE WHEN v_cost IS NULL THEN NULL ELSE round(v_qty*v_cost,2) END;
    END IF;

    IF v_is_bonus THEN
      IF v_line_hpp IS NULL THEN
        v_bonus_hpp_complete := false;
      ELSE
        v_bonus_hpp := v_bonus_hpp + v_line_hpp;
      END IF;
    ELSE
      IF v_line_hpp IS NULL THEN
        v_hpp_complete := false;
      ELSE
        v_total_hpp := v_total_hpp + v_line_hpp;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.penjualan
  SET total_hpp=CASE WHEN v_hpp_complete THEN v_total_hpp ELSE NULL END,
      gross_profit=CASE WHEN v_hpp_complete THEN v_total-v_total_hpp ELSE NULL END,
      bonus_hpp_amount=CASE WHEN v_bonus_hpp_complete THEN v_bonus_hpp ELSE NULL END
  WHERE usaha_id=p_usaha_id AND penjualan_id=v_sale_id;

  IF v_total > 0 THEN
    INSERT INTO public.transaksi_keuangan(
      transaksi_keuangan_id,usaha_id,nomor_transaksi,jenis,arah,tanggal_transaksi,
      amount,currency_code,sumber_type,sumber_id,status,catatan
    ) VALUES (
      v_transaction_id,p_usaha_id,v_transaction_number::text,'sales_payment','income',v_now,
      v_total,'IDR','sale',v_sale_id,'recorded',
      'Pembayaran penjualan '||v_sale_number
    );

    INSERT INTO public.penjualan_pembayaran(
      penjualan_pembayaran_id,usaha_id,penjualan_id,transaksi_keuangan_id,akun_keuangan_id,
      nomor_pembayaran,jenis,metode,amount,currency_code,dibayar_at,dicatat_by_admin_id,
      reference_text,catatan,status
    ) VALUES (
      v_payment_id,p_usaha_id,v_sale_id,v_transaction_id,p_akun_keuangan_id,
      v_payment_number,'pembayaran_penjualan',v_method,v_total,'IDR',v_now,v_admin_id,
      null,nullif(btrim(coalesce(p_catatan,'')),''),'recorded'
    );

    INSERT INTO public.pergerakan_akun_keuangan(
      usaha_id,akun_keuangan_id,transaksi_keuangan_id,arah,amount,mata_uang,terjadi_at,
      sumber_type,sumber_id,status,dicatat_by_admin_id,request_id,catatan
    ) VALUES (
      p_usaha_id,p_akun_keuangan_id,v_transaction_id,'masuk',v_total,'IDR',v_now,
      'payment',v_payment_id,'recorded',v_admin_id,p_request_id,
      'Pembayaran penjualan '||v_sale_number
    );

  END IF;

  INSERT INTO public.checkout(
    checkout_id,usaha_id,nomor_checkout,source,penyewaan_id,penjualan_id,
    subtotal_rental,subtotal_penjualan,total_amount,amount_paid,payment_status,
    status,created_by_admin_id
  ) VALUES (
    v_checkout_id,p_usaha_id,v_checkout_number,'pos',NULL,v_sale_id,
    0,v_total,v_total,v_total,'paid','completed',v_admin_id
  );

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  ) VALUES (
    p_usaha_id,v_auth_user_id,v_admin_id,'create_sale','penjualan',v_sale_id,
    'admin-command',p_request_id,
    jsonb_build_object('nomor_penjualan',v_sale_number,'checkout_id',v_checkout_id,
      'total_amount',v_total,'total_hpp',CASE WHEN v_hpp_complete THEN v_total_hpp ELSE NULL END,
      'gross_profit',CASE WHEN v_hpp_complete THEN v_total-v_total_hpp ELSE NULL END,
      'bonus_hpp_amount',CASE WHEN v_bonus_hpp_complete THEN v_bonus_hpp ELSE NULL END,
      'bonus_line_count',v_bonus_line_count,
      'line_count',jsonb_array_length(p_lines),'source','mixed')
  );

  INSERT INTO public.outbox_event(usaha_id,event_type,aggregate_type,aggregate_id,payload)
  VALUES (
    p_usaha_id,'sale.completed','penjualan',v_sale_id,
    jsonb_build_object('penjualan_id',v_sale_id,'nomor_penjualan',v_sale_number,
      'checkout_id',v_checkout_id,'total_amount',v_total,
      'bonus_line_count',v_bonus_line_count,
      'bonus_hpp_amount',CASE WHEN v_bonus_hpp_complete THEN v_bonus_hpp ELSE NULL END)
  );

  v_response := jsonb_build_object(
    'checkout_id',v_checkout_id,'nomor_checkout',v_checkout_number,
    'penjualan_id',v_sale_id,'nomor_penjualan',v_sale_number,
    'total_amount',v_total,'total_hpp',CASE WHEN v_hpp_complete THEN v_total_hpp ELSE NULL END,
    'gross_profit',CASE WHEN v_hpp_complete THEN v_total-v_total_hpp ELSE NULL END,
    'bonus_hpp_amount',CASE WHEN v_bonus_hpp_complete THEN v_bonus_hpp ELSE NULL END,
    'bonus_line_count',v_bonus_line_count,
    'amount_paid',v_total,'payment_status','paid',
    'penjualan_pembayaran_id',CASE WHEN v_total > 0 THEN v_payment_id ELSE NULL END,
    'transaksi_keuangan_id',CASE WHEN v_total > 0 THEN v_transaction_id ELSE NULL END,
    'status','completed'
  );
  UPDATE public.idempotency_key
  SET response_status=200,response_body=v_response
  WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_create_sale_mixed_bonus_internal(uuid,text,text,text,text,jsonb,uuid,text,text,uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;



CREATE OR REPLACE FUNCTION app_private.command_create_sale_mixed_with_bonus(
  p_usaha_id uuid,
  p_nama_pelanggan text,
  p_nomor_telepon text,
  p_catatan text,
  p_lines jsonb,
  p_akun_keuangan_id uuid,
  p_metode text,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_account public.akun_keuangan%ROWTYPE;
BEGIN
  PERFORM app_private.assert_finance_admin(p_usaha_id);
  IF p_akun_keuangan_id IS NOT NULL THEN
    SELECT * INTO v_account
    FROM public.akun_keuangan
    WHERE usaha_id = p_usaha_id AND akun_keuangan_id = p_akun_keuangan_id
    FOR UPDATE;
    IF NOT FOUND OR v_account.status <> 'active' OR v_account.mata_uang <> 'IDR'
       OR v_account.fungsi_akun <> 'operasional' THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: akun penerima harus aktif, berjenis operasional, dan bermata uang IDR'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN app_private.command_create_sale_mixed_bonus_internal(
    p_usaha_id, 'pos', p_nama_pelanggan, p_nomor_telepon, p_catatan,
    p_lines, p_akun_keuangan_id, p_metode, p_idempotency_key, p_request_id, true
  );
END;
$function$;
REVOKE ALL ON FUNCTION app_private.command_create_sale_mixed_with_bonus(uuid,text,text,text,jsonb,uuid,text,text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;


CREATE OR REPLACE FUNCTION app_private.command_create_mixed_checkout(
  p_usaha_id uuid,
  p_penyewa_id uuid,
  p_jadwal_mulai timestamptz,
  p_jadwal_kembali timestamptz,
  p_rental_lines jsonb,
  p_sale_lines jsonb,
  p_akun_keuangan_id uuid,
  p_metode text,
  p_payment_rental_amount numeric,
  p_dibayar_at timestamptz,
  p_catatan text,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_admin_id uuid := app_private.assert_finance_admin(p_usaha_id);
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_rental jsonb;
  v_sale jsonb;
  v_payment jsonb;
  v_rental_id uuid;
  v_sale_id uuid;
  v_checkout_id uuid;
  v_rental_total numeric(14,2);
  v_sale_total numeric(14,2);
  v_paid_rental numeric(14,2) := coalesce(p_payment_rental_amount,0);
  v_total_paid numeric(14,2);
  v_total numeric(14,2);
  v_response jsonb;
  v_timezone text;
BEGIN
  IF p_usaha_id IS NULL OR p_penyewa_id IS NULL OR p_rental_lines IS NULL
     OR jsonb_typeof(p_rental_lines)<>'array' OR jsonb_array_length(p_rental_lines)=0
     OR p_sale_lines IS NULL OR jsonb_typeof(p_sale_lines)<>'array' OR jsonb_array_length(p_sale_lines)=0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: checkout gabungan membutuhkan minimal satu baris rental dan satu baris pembelian' USING ERRCODE='22023';
  END IF;
  IF p_payment_rental_amount > 0 AND (p_akun_keuangan_id IS NULL OR p_metode NOT IN ('cash','bank_transfer','qris_manual','other')) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: akun dan metode pembayaran wajib valid jika rental dibayar saat checkout' USING ERRCODE='22023';
  END IF;
  IF v_paid_rental < 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: pembayaran rental tidak boleh negatif' USING ERRCODE='22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: idempotency_key dan request_id wajib diisi' USING ERRCODE='22023';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'usaha_id',p_usaha_id,'penyewa_id',p_penyewa_id,'jadwal_mulai',p_jadwal_mulai,
    'jadwal_kembali',p_jadwal_kembali,'rental_lines',p_rental_lines,'sale_lines',p_sale_lines,
    'account',p_akun_keuangan_id,'method',p_metode,'payment_rental',v_paid_rental,
    'dibayar_at',p_dibayar_at,'catatan',p_catatan
  )::text);

  INSERT INTO public.idempotency_key(usaha_id,actor_auth_user_id,key,command_name,request_hash)
  VALUES(p_usaha_id,v_auth_user_id,btrim(p_idempotency_key),'create_mixed_checkout',v_request_hash)
  ON CONFLICT(usaha_id,actor_auth_user_id,command_name,key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body,request_hash INTO v_existing_response,v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id=p_usaha_id AND actor_auth_user_id=v_auth_user_id
      AND command_name='create_mixed_checkout' AND key=btrim(p_idempotency_key);
    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key checkout sudah digunakan untuk payload berbeda' USING ERRCODE='23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN RETURN v_existing_response; END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: status checkout gabungan belum dapat dipastikan' USING ERRCODE='40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text,0));
  SELECT timezone INTO v_timezone FROM public.usaha WHERE usaha_id=p_usaha_id AND status='active';
  IF v_timezone IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002'; END IF;

  -- Consume retail stock first. Rental availability is validated against the reduced stock;
  -- any rental failure aborts this transaction and rolls the sale and finance ledger back.
  v_sale := app_private.command_create_sale_mixed_with_bonus(
    p_usaha_id,
    (SELECT p.nama_lengkap FROM public.penyewa p WHERE p.usaha_id=p_usaha_id AND p.penyewa_id=p_penyewa_id),
    (SELECT p.nomor_telepon FROM public.penyewa p WHERE p.usaha_id=p_usaha_id AND p.penyewa_id=p_penyewa_id),
    'Pembelian pada checkout gabungan '||btrim(p_idempotency_key),
    p_sale_lines,p_akun_keuangan_id,p_metode,
    left(btrim(p_idempotency_key)||':sale',240),p_request_id
  );
  v_sale_id := (v_sale->>'penjualan_id')::uuid;
  v_checkout_id := (v_sale->>'checkout_id')::uuid;
  v_sale_total := round((v_sale->>'total_amount')::numeric,2);
  IF v_sale_id IS NULL OR v_checkout_id IS NULL OR v_sale_total < 0 THEN
    RAISE EXCEPTION 'INTERNAL_ERROR: transaksi penjualan tidak mengembalikan ringkasan yang valid' USING ERRCODE='P0001';
  END IF;

  v_rental := app_private.command_create_direct_rental(
    p_usaha_id,p_penyewa_id,p_jadwal_mulai,p_jadwal_kembali,p_rental_lines,
    p_catatan,left(btrim(p_idempotency_key)||':rental',240),p_request_id
  );
  v_rental_id := (v_rental->>'penyewaan_id')::uuid;
  v_rental_total := round((v_rental->>'total_amount')::numeric,2);
  IF v_rental_id IS NULL OR v_rental_total IS NULL OR v_rental_total < 0 THEN
    RAISE EXCEPTION 'INTERNAL_ERROR: transaksi rental tidak mengembalikan ringkasan yang valid' USING ERRCODE='P0001';
  END IF;
  IF v_paid_rental > v_rental_total THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: pembayaran rental melebihi nilai rental' USING ERRCODE='22023';
  END IF;

  IF v_paid_rental > 0 THEN
    v_payment := app_private.command_record_payment_with_account(
      p_usaha_id,NULL,v_rental_id,p_akun_keuangan_id,
      CASE WHEN v_paid_rental=v_rental_total THEN 'pelunasan' ELSE 'dp' END,
      p_metode,v_paid_rental,coalesce(p_dibayar_at,now()),
      'Checkout gabungan '||(SELECT nomor_checkout FROM public.checkout WHERE checkout_id=v_checkout_id),
      'Alokasi pembayaran rental pada checkout gabungan',
      left(btrim(p_idempotency_key)||':rental-payment',240),p_request_id
    );
  END IF;

  v_total := v_rental_total + v_sale_total;
  v_total_paid := v_sale_total + v_paid_rental;
  UPDATE public.penjualan
  SET source='mixed'
  WHERE usaha_id=p_usaha_id AND penjualan_id=v_sale_id;

  UPDATE public.checkout
  SET source='mixed',
      penyewaan_id=v_rental_id,
      subtotal_rental=v_rental_total,
      total_amount=v_total,
      amount_paid=v_total_paid,
      payment_status=CASE WHEN v_total_paid=v_total THEN 'paid' WHEN v_total_paid>0 THEN 'partial' ELSE 'unpaid' END
  WHERE usaha_id=p_usaha_id AND checkout_id=v_checkout_id;

  INSERT INTO public.audit_log(
    usaha_id,actor_auth_user_id,actor_akun_admin_id,action,entity_type,entity_id,
    source_application,request_id,change_summary
  ) VALUES (
    p_usaha_id,v_auth_user_id,v_admin_id,'create_mixed_checkout','checkout',v_checkout_id,
    'admin-command',p_request_id,
    jsonb_build_object('penyewaan_id',v_rental_id,'penjualan_id',v_sale_id,
      'subtotal_rental',v_rental_total,'subtotal_penjualan',v_sale_total,
      'total_amount',v_total,'amount_paid',v_total_paid)
  );

  v_response := jsonb_build_object(
    'checkout_id',v_checkout_id,
    'nomor_checkout',(SELECT nomor_checkout FROM public.checkout WHERE checkout_id=v_checkout_id),
    'penyewaan_id',v_rental_id,
    'nomor_penyewaan',v_rental->>'nomor_penyewaan',
    'penjualan_id',v_sale_id,
    'nomor_penjualan',v_sale->>'nomor_penjualan',
    'subtotal_rental',v_rental_total,
    'subtotal_penjualan',v_sale_total,
    'total_amount',v_total,
    'total_hpp',v_sale->'total_hpp',
    'gross_profit',v_sale->'gross_profit',
    'amount_paid',v_total_paid,
    'payment_status',CASE WHEN v_total_paid=v_total THEN 'paid' WHEN v_total_paid>0 THEN 'partial' ELSE 'unpaid' END,
    'status','completed'
  );
  UPDATE public.idempotency_key
  SET response_status=200,response_body=v_response,completed_at=now()
  WHERE idempotency_key_id=v_idempotency_id;
  RETURN v_response;
END;
$function$;



-- Bonus retail is only a zero-priced mixed-checkout line; inventory/HPP remains recorded.

CREATE OR REPLACE FUNCTION app_private.assert_retail_rental_bonus_context(p_penjualan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_sale public.penjualan%ROWTYPE;
  v_checkout public.checkout%ROWTYPE;
  v_bonus_count integer;
  v_regular_total numeric(14,2);
  v_bonus_subtotal numeric(14,2);
  v_line_total numeric(14,2);
BEGIN
  SELECT * INTO v_sale FROM public.penjualan WHERE penjualan_id = p_penjualan_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*) FILTER (WHERE is_bonus_rental = true)::integer,
         coalesce(sum(subtotal) FILTER (WHERE is_bonus_rental = false), 0)::numeric(14,2),
         coalesce(sum(subtotal) FILTER (WHERE is_bonus_rental = true), 0)::numeric(14,2)
  INTO v_bonus_count, v_regular_total, v_bonus_subtotal
  FROM public.detail_penjualan
  WHERE usaha_id = v_sale.usaha_id AND penjualan_id = p_penjualan_id;

  SELECT coalesce(sum(subtotal), 0)::numeric(14,2)
  INTO v_line_total
  FROM public.detail_penjualan
  WHERE usaha_id = v_sale.usaha_id AND penjualan_id = p_penjualan_id;

  IF v_sale.total_amount IS DISTINCT FROM v_line_total THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: total header penjualan tidak sama dengan total seluruh detail'
      USING ERRCODE = '23514';
  END IF;

  IF v_bonus_count = 0 THEN
    IF v_sale.total_amount <= 0 THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: penjualan nol hanya sah jika terdapat bonus rental yang tervalidasi'
        USING ERRCODE = '23514';
    END IF;
    RETURN;
  END IF;

  IF v_sale.source <> 'mixed' THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: bonus barang tidak diizinkan pada penjualan POS mandiri'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_checkout
  FROM public.checkout c
  WHERE c.usaha_id = v_sale.usaha_id
    AND c.penjualan_id = p_penjualan_id
    AND c.source = 'mixed'
    AND c.penyewaan_id IS NOT NULL;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.penyewaan r
    WHERE r.usaha_id = v_sale.usaha_id AND r.penyewaan_id = v_checkout.penyewaan_id
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: bonus retail wajib terhubung ke checkout gabungan yang memiliki rental'
      USING ERRCODE = '23514';
  END IF;

  IF v_sale.total_amount IS DISTINCT FROM v_regular_total OR v_bonus_subtotal <> 0 THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: nilai bonus harus Rp0 dan total penjualan hanya menghitung barang berbayar'
      USING ERRCODE = '23514';
  END IF;
  IF v_checkout.subtotal_penjualan IS DISTINCT FROM v_sale.total_amount THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: subtotal retail checkout tidak sesuai total penjualan'
      USING ERRCODE = '23514';
  END IF;
  IF v_checkout.total_amount = 0 AND NOT (
    v_checkout.source = 'mixed'
    AND v_checkout.subtotal_rental = v_checkout.discount_rental_amount
    AND v_checkout.subtotal_penjualan = 0
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: checkout nol hanya sah untuk rental yang didiskon 100%% dan seluruh retail bernilai nol'
      USING ERRCODE = '23514';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION app_private.assert_retail_rental_bonus_context(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.validate_retail_rental_bonus_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_sale_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'checkout' THEN
    v_sale_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.penjualan_id ELSE NEW.penjualan_id END;
  ELSE
    v_sale_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.penjualan_id ELSE NEW.penjualan_id END;
  END IF;
  IF v_sale_id IS NOT NULL THEN
    PERFORM app_private.assert_retail_rental_bonus_context(v_sale_id);
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS detail_penjualan_bonus_context_deferred ON public.detail_penjualan;
CREATE CONSTRAINT TRIGGER detail_penjualan_bonus_context_deferred
AFTER INSERT OR UPDATE OR DELETE ON public.detail_penjualan
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION app_private.validate_retail_rental_bonus_context();

DROP TRIGGER IF EXISTS penjualan_bonus_context_deferred ON public.penjualan;
CREATE CONSTRAINT TRIGGER penjualan_bonus_context_deferred
AFTER INSERT OR UPDATE ON public.penjualan
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION app_private.validate_retail_rental_bonus_context();

DROP TRIGGER IF EXISTS checkout_bonus_context_deferred ON public.checkout;
CREATE CONSTRAINT TRIGGER checkout_bonus_context_deferred
AFTER INSERT OR UPDATE ON public.checkout
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION app_private.validate_retail_rental_bonus_context();


-- Keep gifted retail HPP separate from normal retail margin and sales analytics.
CREATE OR REPLACE FUNCTION app_private.finance_retail_analysis(
  p_usaha_id uuid,
  p_start_date date,
  p_end_date date,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid;
  v_timezone text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_summary jsonb;
  v_top_products jsonb;
  v_recent_sales jsonb;
  v_purchase_history jsonb;
  v_stock_snapshot jsonb;
BEGIN
  v_admin_id := app_private.assert_finance_admin(p_usaha_id);
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date <= p_start_date THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: periode retail tidak valid' USING ERRCODE='22023';
  END IF;

  SELECT u.timezone INTO v_timezone
  FROM public.usaha u
  WHERE u.usaha_id = p_usaha_id AND u.status = 'active';
  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  v_start_at := (p_start_date::text || ' 00:00:00 ' || v_timezone)::timestamptz;
  v_end_at := (p_end_date::text || ' 00:00:00 ' || v_timezone)::timestamptz;

  WITH sales_scope AS (
    SELECT s.penjualan_id
    FROM public.penjualan s
    WHERE s.usaha_id = p_usaha_id
      AND s.status = 'completed'
      AND s.created_at >= v_start_at AND s.created_at < v_end_at
  ),
  line_scope AS (
    SELECT d.*
    FROM public.detail_penjualan d
    JOIN sales_scope s ON s.penjualan_id = d.penjualan_id
    WHERE d.usaha_id = p_usaha_id
  ),
  payment_scope AS (
    SELECT pp.amount, pp.penjualan_pembayaran_id
    FROM public.penjualan_pembayaran pp
    JOIN public.penjualan s
      ON s.usaha_id = pp.usaha_id AND s.penjualan_id = pp.penjualan_id
    WHERE pp.usaha_id = p_usaha_id
      AND pp.status = 'recorded'
      AND s.status = 'completed'
      AND pp.dibayar_at >= v_start_at AND pp.dibayar_at < v_end_at
  )
  SELECT jsonb_build_object(
    'sales_count', (SELECT count(*) FROM sales_scope),
    'sales_revenue', coalesce((SELECT sum(subtotal) FROM line_scope WHERE is_bonus_rental = false), 0),
    'promotion_bonus_quantity', coalesce((SELECT sum(jumlah) FROM line_scope WHERE is_bonus_rental = true), 0),
    'promotion_bonus_cost', coalesce((SELECT sum(hpp_total) FROM line_scope WHERE is_bonus_rental = true AND hpp_total IS NOT NULL), 0),
    'promotion_bonus_hpp_unknown_lines', (SELECT count(*) FROM line_scope WHERE is_bonus_rental = true AND hpp_total IS NULL),
    'sold_quantity', coalesce((SELECT sum(jumlah) FROM line_scope WHERE is_bonus_rental = false), 0),
    'known_hpp', coalesce((SELECT sum(hpp_total) FROM line_scope WHERE is_bonus_rental = false AND hpp_total IS NOT NULL), 0),
    'gross_profit_known', coalesce((SELECT sum(subtotal - hpp_total) FROM line_scope WHERE is_bonus_rental = false AND hpp_total IS NOT NULL), 0),
    'hpp_unknown_revenue', coalesce((SELECT sum(subtotal) FROM line_scope WHERE is_bonus_rental = false AND hpp_total IS NULL), 0),
    'hpp_unknown_lines', (SELECT count(*) FROM line_scope WHERE is_bonus_rental = false AND hpp_total IS NULL),
    'known_hpp_lines', (SELECT count(*) FROM line_scope WHERE is_bonus_rental = false AND hpp_total IS NOT NULL),
    'sales_with_incomplete_hpp', (
      SELECT count(*) FROM (
        SELECT penjualan_id FROM line_scope GROUP BY penjualan_id
        HAVING count(*) FILTER (WHERE is_bonus_rental = false AND hpp_total IS NULL) > 0
      ) x
    ),
    'hpp_coverage_pct', CASE
      WHEN coalesce((SELECT sum(subtotal) FROM line_scope WHERE is_bonus_rental = false), 0) = 0 THEN NULL
      ELSE round(
        100.0 * coalesce((SELECT sum(subtotal) FROM line_scope WHERE is_bonus_rental = false AND hpp_total IS NOT NULL), 0)
        / nullif((SELECT sum(subtotal) FROM line_scope WHERE is_bonus_rental = false), 0), 2
      )
    END,
    'payment_received', coalesce((SELECT sum(amount) FROM payment_scope), 0),
    'payment_count', (SELECT count(*) FROM payment_scope),
    'completed_purchase_count', (
      SELECT count(*) FROM public.pembelian p
      WHERE p.usaha_id = p_usaha_id AND p.status = 'completed'
        AND p.tanggal_pembelian >= p_start_date AND p.tanggal_pembelian < p_end_date
    ),
    'completed_purchase_value', coalesce((
      SELECT sum(p.total_amount) FROM public.pembelian p
      WHERE p.usaha_id = p_usaha_id AND p.status = 'completed'
        AND p.tanggal_pembelian >= p_start_date AND p.tanggal_pembelian < p_end_date
    ), 0),
    'purchase_cash_out', coalesce((
      SELECT sum(t.amount) FROM public.transaksi_keuangan t
      WHERE t.usaha_id = p_usaha_id AND t.status = 'recorded'
        AND t.arah = 'expense' AND t.sumber_type = 'purchase'
        AND t.tanggal_transaksi >= v_start_at AND t.tanggal_transaksi < v_end_at
    ), 0),
    'receiving_count', (
      SELECT count(*) FROM public.penerimaan_pembelian r
      WHERE r.usaha_id = p_usaha_id AND r.status = 'completed'
        AND r.received_at >= v_start_at AND r.received_at < v_end_at
    ),
    'received_quantity', coalesce((
      SELECT sum(d.quantity_received)
      FROM public.penerimaan_pembelian r
      JOIN public.detail_penerimaan_pembelian d
        ON d.usaha_id = r.usaha_id AND d.penerimaan_pembelian_id = r.penerimaan_pembelian_id
      WHERE r.usaha_id = p_usaha_id AND r.status = 'completed'
        AND r.received_at >= v_start_at AND r.received_at < v_end_at
    ), 0),
    'received_stock_value', coalesce((
      SELECT sum(d.subtotal_cost)
      FROM public.penerimaan_pembelian r
      JOIN public.detail_penerimaan_pembelian d
        ON d.usaha_id = r.usaha_id AND d.penerimaan_pembelian_id = r.penerimaan_pembelian_id
      WHERE r.usaha_id = p_usaha_id AND r.status = 'completed'
        AND r.received_at >= v_start_at AND r.received_at < v_end_at
    ), 0),
    'currency_code', 'IDR'
  )
  INTO v_summary;

  WITH sales_scope AS (
    SELECT s.penjualan_id
    FROM public.penjualan s
    WHERE s.usaha_id = p_usaha_id AND s.status = 'completed'
      AND s.created_at >= v_start_at AND s.created_at < v_end_at
  ),
  grouped AS (
    SELECT
      d.barang_id,
      d.varian_barang_id,
      d.nama_barang_snapshot,
      d.nama_varian_snapshot,
      d.inventory_mode,
      sum(d.jumlah)::numeric AS quantity_sold,
      sum(d.subtotal)::numeric AS revenue,
      coalesce(sum(d.hpp_total) FILTER (WHERE d.hpp_total IS NOT NULL), 0)::numeric AS known_hpp,
      coalesce(sum(d.subtotal - d.hpp_total) FILTER (WHERE d.hpp_total IS NOT NULL), 0)::numeric AS gross_profit_known,
      coalesce(sum(d.subtotal) FILTER (WHERE d.hpp_total IS NULL), 0)::numeric AS hpp_unknown_revenue,
      count(*) FILTER (WHERE d.hpp_total IS NULL)::bigint AS hpp_unknown_lines,
      count(DISTINCT d.penjualan_id)::bigint AS sale_count
    FROM public.detail_penjualan d
    JOIN sales_scope s ON s.penjualan_id = d.penjualan_id
    WHERE d.usaha_id = p_usaha_id
      AND d.is_bonus_rental = false
    GROUP BY d.barang_id, d.varian_barang_id, d.nama_barang_snapshot, d.nama_varian_snapshot, d.inventory_mode
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'barang_id', x.barang_id,
    'varian_barang_id', x.varian_barang_id,
    'nama_barang', x.nama_barang_snapshot,
    'nama_varian', x.nama_varian_snapshot,
    'inventory_mode', x.inventory_mode,
    'quantity_sold', x.quantity_sold,
    'revenue', x.revenue,
    'known_hpp', x.known_hpp,
    'gross_profit_known', x.gross_profit_known,
    'hpp_unknown_revenue', x.hpp_unknown_revenue,
    'hpp_unknown_lines', x.hpp_unknown_lines,
    'sale_count', x.sale_count
  ) ORDER BY x.revenue DESC, x.nama_barang), '[]'::jsonb)
  INTO v_top_products
  FROM (SELECT * FROM grouped ORDER BY revenue DESC, nama_barang_snapshot LIMIT v_limit) x;

  WITH sales_scope AS (
    SELECT s.*
    FROM public.penjualan s
    WHERE s.usaha_id = p_usaha_id AND s.status = 'completed'
      AND s.created_at >= v_start_at AND s.created_at < v_end_at
  ),
  line_totals AS (
    SELECT d.penjualan_id,
      coalesce(sum(d.jumlah) FILTER (WHERE d.is_bonus_rental = false), 0) AS sold_quantity,
      coalesce(sum(d.hpp_total) FILTER (WHERE d.is_bonus_rental = false AND d.hpp_total IS NOT NULL), 0) AS known_hpp,
      coalesce(sum(d.subtotal - d.hpp_total) FILTER (WHERE d.is_bonus_rental = false AND d.hpp_total IS NOT NULL), 0) AS gross_profit_known,
      count(*) FILTER (WHERE d.is_bonus_rental = false AND d.hpp_total IS NULL) AS hpp_unknown_lines,
      coalesce(sum(d.jumlah) FILTER (WHERE d.is_bonus_rental = true), 0) AS bonus_quantity,
      coalesce(sum(d.hpp_total) FILTER (WHERE d.is_bonus_rental = true AND d.hpp_total IS NOT NULL), 0) AS bonus_hpp_cost,
      count(*) FILTER (WHERE d.is_bonus_rental = true AND d.hpp_total IS NULL) AS bonus_hpp_unknown_lines
    FROM public.detail_penjualan d
    JOIN sales_scope s ON s.penjualan_id = d.penjualan_id
    WHERE d.usaha_id = p_usaha_id
    GROUP BY d.penjualan_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'penjualan_id', x.penjualan_id,
    'nomor_penjualan', x.nomor_penjualan,
    'source', x.source,
    'nama_pelanggan', x.nama_pelanggan,
    'nomor_telepon', x.nomor_telepon,
    'status', x.status,
    'payment_status', x.payment_status,
    'total_amount', x.total_amount,
    'total_hpp', x.total_hpp,
    'gross_profit', x.gross_profit,
    'known_hpp', coalesce(l.known_hpp, 0),
    'gross_profit_known', coalesce(l.gross_profit_known, 0),
    'hpp_unknown_lines', coalesce(l.hpp_unknown_lines, 0),
    'sold_quantity', coalesce(l.sold_quantity, 0),
    'bonus_hpp_amount', x.bonus_hpp_amount,
    'bonus_quantity', coalesce(l.bonus_quantity, 0),
    'bonus_hpp_cost', coalesce(l.bonus_hpp_cost, 0),
    'bonus_hpp_unknown_lines', coalesce(l.bonus_hpp_unknown_lines, 0),
    'created_at', x.created_at,
    'currency_code', x.currency_code
  ) ORDER BY x.created_at DESC, x.penjualan_id DESC), '[]'::jsonb)
  INTO v_recent_sales
  FROM (
    SELECT * FROM sales_scope
    ORDER BY created_at DESC, penjualan_id DESC
    LIMIT v_limit
  ) x
  LEFT JOIN line_totals l ON l.penjualan_id = x.penjualan_id;

  WITH purchase_scope AS (
    SELECT p.*
    FROM public.pembelian p
    WHERE p.usaha_id = p_usaha_id
      AND p.tanggal_pembelian >= p_start_date AND p.tanggal_pembelian < p_end_date
  ),
  receiving_totals AS (
    SELECT r.pembelian_id,
      count(DISTINCT r.penerimaan_pembelian_id)::bigint AS receiving_count,
      coalesce(sum(d.quantity_received), 0) AS received_quantity,
      coalesce(sum(d.subtotal_cost), 0) AS received_stock_value
    FROM public.penerimaan_pembelian r
    LEFT JOIN public.detail_penerimaan_pembelian d
      ON d.usaha_id = r.usaha_id AND d.penerimaan_pembelian_id = r.penerimaan_pembelian_id
    WHERE r.usaha_id = p_usaha_id AND r.status = 'completed'
    GROUP BY r.pembelian_id
  ),
  cashout_totals AS (
    SELECT t.sumber_id AS pembelian_id, sum(t.amount) AS cash_out_amount
    FROM public.transaksi_keuangan t
    WHERE t.usaha_id = p_usaha_id AND t.status = 'recorded'
      AND t.arah = 'expense' AND t.sumber_type = 'purchase'
      AND t.sumber_id IS NOT NULL
    GROUP BY t.sumber_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'pembelian_id', x.pembelian_id,
    'nomor_pembelian', x.nomor_pembelian,
    'tanggal_pembelian', x.tanggal_pembelian,
    'status', x.status,
    'pemasok_id', x.pemasok_id,
    'nama_pemasok', coalesce(s.nama, 'Pemasok tidak teridentifikasi'),
    'total_amount', x.total_amount,
    'currency_code', x.currency_code,
    'receiving_count', coalesce(rt.receiving_count, 0),
    'received_quantity', coalesce(rt.received_quantity, 0),
    'received_stock_value', coalesce(rt.received_stock_value, 0),
    'cash_out_amount', coalesce(ct.cash_out_amount, 0),
    'catatan', x.catatan
  ) ORDER BY x.tanggal_pembelian DESC, x.pembelian_id DESC), '[]'::jsonb)
  INTO v_purchase_history
  FROM (
    SELECT * FROM purchase_scope
    ORDER BY tanggal_pembelian DESC, pembelian_id DESC
    LIMIT v_limit
  ) x
  LEFT JOIN public.pemasok s ON s.usaha_id = x.usaha_id AND s.pemasok_id = x.pemasok_id
  LEFT JOIN receiving_totals rt ON rt.pembelian_id = x.pembelian_id
  LEFT JOIN cashout_totals ct ON ct.pembelian_id = x.pembelian_id;

  WITH targets AS (
    SELECT
      b.barang_id,
      NULL::uuid AS varian_barang_id,
      b.nama AS nama_barang,
      NULL::text AS nama_varian,
      k.nama AS kategori_nama,
      b.inventory_mode,
      b.satuan_jual
    FROM public.barang b
    LEFT JOIN public.kategori_barang k
      ON k.usaha_id = b.usaha_id AND k.kategori_barang_id = b.kategori_barang_id
    WHERE b.usaha_id = p_usaha_id AND b.status = 'active' AND b.is_sellable = true
      AND NOT EXISTS (
        SELECT 1 FROM public.varian_barang v
        WHERE v.usaha_id = b.usaha_id AND v.barang_id = b.barang_id
          AND v.status = 'active' AND coalesce(v.is_sellable, b.is_sellable) = true
      )

    UNION ALL

    SELECT
      b.barang_id,
      v.varian_barang_id,
      b.nama AS nama_barang,
      v.nama AS nama_varian,
      k.nama AS kategori_nama,
      coalesce(v.inventory_mode, b.inventory_mode) AS inventory_mode,
      b.satuan_jual
    FROM public.varian_barang v
    JOIN public.barang b ON b.usaha_id = v.usaha_id AND b.barang_id = v.barang_id
    LEFT JOIN public.kategori_barang k
      ON k.usaha_id = b.usaha_id AND k.kategori_barang_id = b.kategori_barang_id
    WHERE b.usaha_id = p_usaha_id AND b.status = 'active'
      AND v.status = 'active' AND coalesce(v.is_sellable, b.is_sellable) = true
  ),
  stock_rows AS (
    SELECT
      t.*,
      CASE
        WHEN t.inventory_mode = 'serialized' THEN coalesce(u.ready_quantity, 0)
        WHEN t.inventory_mode = 'quantity' THEN coalesce(q.stock_quantity, 0)
        ELSE NULL
      END AS stock_quantity,
      CASE
        WHEN t.inventory_mode = 'serialized' THEN coalesce(u.known_cost_value, 0)
        WHEN t.inventory_mode = 'quantity' THEN q.known_cost_value
        ELSE NULL
      END AS known_cost_value,
      CASE
        WHEN t.inventory_mode = 'serialized' THEN coalesce(u.unknown_cost_units, 0)
        WHEN t.inventory_mode = 'quantity' THEN coalesce(q.unknown_cost_quantity, 0)
        ELSE 0
      END AS unknown_cost_quantity,
      CASE
        WHEN t.inventory_mode = 'quantity' THEN q.average_unit_cost
        ELSE NULL
      END AS average_unit_cost
    FROM targets t
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE u.status = 'ready')::bigint AS ready_quantity,
        coalesce(sum(u.harga_perolehan) FILTER (WHERE u.status = 'ready' AND u.harga_perolehan IS NOT NULL), 0) AS known_cost_value,
        count(*) FILTER (WHERE u.status = 'ready' AND u.harga_perolehan IS NULL)::bigint AS unknown_cost_units
      FROM public.unit_barang u
      WHERE u.usaha_id = p_usaha_id AND u.barang_id = t.barang_id
        AND u.varian_barang_id IS NOT DISTINCT FROM t.varian_barang_id
    ) u ON true
    LEFT JOIN LATERAL (
      SELECT
        coalesce(sum(st.jumlah), 0)::numeric AS stock_quantity,
        coalesce(sum(st.jumlah * st.average_unit_cost) FILTER (WHERE st.average_unit_cost IS NOT NULL), 0) AS known_cost_value,
        coalesce(sum(st.jumlah) FILTER (WHERE st.jumlah > 0 AND st.average_unit_cost IS NULL), 0)::numeric AS unknown_cost_quantity,
        CASE
          WHEN sum(st.jumlah) > 0 AND count(*) FILTER (WHERE st.average_unit_cost IS NULL AND st.jumlah > 0) = 0
            THEN sum(st.jumlah * st.average_unit_cost) / nullif(sum(st.jumlah), 0)
          ELSE NULL
        END AS average_unit_cost
      FROM public.stok_barang st
      WHERE st.usaha_id = p_usaha_id AND st.barang_id = t.barang_id
        AND st.varian_barang_id IS NOT DISTINCT FROM t.varian_barang_id
    ) q ON true
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'barang_id', x.barang_id,
    'varian_barang_id', x.varian_barang_id,
    'nama_barang', x.nama_barang,
    'nama_varian', x.nama_varian,
    'kategori_nama', x.kategori_nama,
    'inventory_mode', x.inventory_mode,
    'satuan_jual', x.satuan_jual,
    'stock_quantity', x.stock_quantity,
    'known_cost_value', x.known_cost_value,
    'unknown_cost_quantity', x.unknown_cost_quantity,
    'average_unit_cost', x.average_unit_cost
  ) ORDER BY x.nama_barang, x.nama_varian NULLS FIRST), '[]'::jsonb)
  INTO v_stock_snapshot
  FROM stock_rows x;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('start_date', p_start_date, 'end_date_exclusive', p_end_date, 'timezone', v_timezone),
    'summary', v_summary,
    'top_products', v_top_products,
    'recent_sales', v_recent_sales,
    'purchase_history', v_purchase_history,
    'stock_snapshot', v_stock_snapshot,
    'read_only', true,
    'account_policy', 'Pemasukan retail dan rental tetap masuk ke akun uang sesuai lokasi penerimaan riil; klasifikasi sumber transaksi tidak membuat akun uang baru.',
    'hpp_policy', 'HPP diakui pada saat barang terjual dari snapshot biaya perolehan. Pembelian adalah arus kas keluar dan tidak dihitung ulang sebagai pengeluaran HPP.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.finance_retail_analysis(uuid,date,date,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.finance_retail_analysis(uuid,date,date,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.finance_retail_analysis(
  p_usaha_id uuid, p_start_date date, p_end_date date, p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.finance_retail_analysis(p_usaha_id, p_start_date, p_end_date, p_limit);
$function$;

REVOKE ALL ON FUNCTION public.finance_retail_analysis(uuid,date,date,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_retail_analysis(uuid,date,date,integer) TO authenticated;
