-- Smart Booking admin archive + immutable estimate read models.
-- Archive hides a booking from admin/customer surfaces and revokes access.
-- It deliberately preserves converted rental/sale/checkout/financial records.

-- Freeze tariff duration alongside the price snapshot. This avoids changing
-- historical estimates when an administrator edits or removes a live tariff.
ALTER TABLE app_private.akasha_smart_booking_line
  ADD COLUMN IF NOT EXISTS durasi_unit_snapshot text,
  ADD COLUMN IF NOT EXISTS durasi_nilai_snapshot numeric(12,4);

-- Existing lines predate the duration snapshot. Prefer the immutable
-- duration on their linked legacy detail row; use the current tariff only as
-- a one-time baseline when no historical duration was stored. quote_total and
-- subtotal_snapshot remain unchanged as the original booking amounts.
UPDATE app_private.akasha_smart_booking_line l
SET durasi_unit_snapshot = coalesce(
      l.durasi_unit_snapshot,
      (
        SELECT d.durasi_unit_snapshot
        FROM public.detail_reservasi d
        JOIN app_private.akasha_smart_booking b
          ON b.usaha_id = d.usaha_id
         AND b.reservasi_id = d.reservasi_id
        WHERE b.usaha_id = l.usaha_id
          AND b.smart_booking_id = l.smart_booking_id
          AND d.tarif_sewa_id = l.tarif_sewa_id
          AND d.barang_id IS NOT DISTINCT FROM l.barang_id
          AND d.varian_barang_id IS NOT DISTINCT FROM l.varian_barang_id
          AND d.paket_sewa_id IS NOT DISTINCT FROM l.paket_sewa_id
        LIMIT 1
      ),
      (
        SELECT t.durasi_unit
        FROM public.tarif_sewa t
        WHERE t.usaha_id = l.usaha_id
          AND t.tarif_sewa_id = l.tarif_sewa_id
      )
    ),
    durasi_nilai_snapshot = coalesce(
      l.durasi_nilai_snapshot,
      (
        SELECT d.durasi_nilai_snapshot
        FROM public.detail_reservasi d
        JOIN app_private.akasha_smart_booking b
          ON b.usaha_id = d.usaha_id
         AND b.reservasi_id = d.reservasi_id
        WHERE b.usaha_id = l.usaha_id
          AND b.smart_booking_id = l.smart_booking_id
          AND d.tarif_sewa_id = l.tarif_sewa_id
          AND d.barang_id IS NOT DISTINCT FROM l.barang_id
          AND d.varian_barang_id IS NOT DISTINCT FROM l.varian_barang_id
          AND d.paket_sewa_id IS NOT DISTINCT FROM l.paket_sewa_id
        LIMIT 1
      ),
      (
        SELECT t.durasi_nilai
        FROM public.tarif_sewa t
        WHERE t.usaha_id = l.usaha_id
          AND t.tarif_sewa_id = l.tarif_sewa_id
      )
    )
WHERE l.line_kind = 'rental'
  AND (l.durasi_unit_snapshot IS NULL OR l.durasi_nilai_snapshot IS NULL)
  AND lower(btrim(coalesce(
    l.durasi_unit_snapshot,
    (
      SELECT d.durasi_unit_snapshot
      FROM public.detail_reservasi d
      JOIN app_private.akasha_smart_booking b
        ON b.usaha_id = d.usaha_id
       AND b.reservasi_id = d.reservasi_id
      WHERE b.usaha_id = l.usaha_id
        AND b.smart_booking_id = l.smart_booking_id
        AND d.tarif_sewa_id = l.tarif_sewa_id
        AND d.barang_id IS NOT DISTINCT FROM l.barang_id
        AND d.varian_barang_id IS NOT DISTINCT FROM l.varian_barang_id
        AND d.paket_sewa_id IS NOT DISTINCT FROM l.paket_sewa_id
      LIMIT 1
    ),
    (
      SELECT t.durasi_unit
      FROM public.tarif_sewa t
      WHERE t.usaha_id = l.usaha_id
        AND t.tarif_sewa_id = l.tarif_sewa_id
    )
  ))) IN ('jam', 'hari', 'minggu')
  AND coalesce(
    l.durasi_nilai_snapshot,
    (
      SELECT d.durasi_nilai_snapshot
      FROM public.detail_reservasi d
      JOIN app_private.akasha_smart_booking b
        ON b.usaha_id = d.usaha_id
       AND b.reservasi_id = d.reservasi_id
      WHERE b.usaha_id = l.usaha_id
        AND b.smart_booking_id = l.smart_booking_id
        AND d.tarif_sewa_id = l.tarif_sewa_id
        AND d.barang_id IS NOT DISTINCT FROM l.barang_id
        AND d.varian_barang_id IS NOT DISTINCT FROM l.varian_barang_id
        AND d.paket_sewa_id IS NOT DISTINCT FROM l.paket_sewa_id
      LIMIT 1
    ),
    (
      SELECT t.durasi_nilai
      FROM public.tarif_sewa t
      WHERE t.usaha_id = l.usaha_id
        AND t.tarif_sewa_id = l.tarif_sewa_id
    )
  ) > 0;

CREATE OR REPLACE FUNCTION app_private.capture_akasha_smart_booking_tariff_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_should_refresh boolean;
  v_tariff_changed boolean := false;
BEGIN
  v_should_refresh := NEW.line_kind = 'rental'
    AND NEW.tarif_sewa_id IS NOT NULL
    AND (NEW.durasi_unit_snapshot IS NULL OR NEW.durasi_nilai_snapshot IS NULL);

  IF TG_OP = 'UPDATE' THEN
    v_tariff_changed := NEW.tarif_sewa_id IS DISTINCT FROM OLD.tarif_sewa_id;
    IF NEW.line_kind = 'rental'
       AND NEW.tarif_sewa_id IS NOT NULL
       AND v_tariff_changed THEN
      v_should_refresh := true;
    END IF;
  END IF;

  IF v_should_refresh THEN
    SELECT
      coalesce(
        CASE WHEN v_tariff_changed THEN NULL ELSE NEW.durasi_unit_snapshot END,
        coalesce(d.durasi_unit_snapshot, t.durasi_unit)
      ),
      coalesce(
        CASE WHEN v_tariff_changed THEN NULL ELSE NEW.durasi_nilai_snapshot END,
        coalesce(d.durasi_nilai_snapshot, t.durasi_nilai)
      )
      INTO NEW.durasi_unit_snapshot, NEW.durasi_nilai_snapshot
    FROM app_private.akasha_smart_booking b
    LEFT JOIN public.detail_reservasi d
      ON d.usaha_id = b.usaha_id
     AND d.reservasi_id = b.reservasi_id
     AND d.tarif_sewa_id = NEW.tarif_sewa_id
     AND d.barang_id IS NOT DISTINCT FROM NEW.barang_id
     AND d.varian_barang_id IS NOT DISTINCT FROM NEW.varian_barang_id
     AND d.paket_sewa_id IS NOT DISTINCT FROM NEW.paket_sewa_id
    LEFT JOIN public.tarif_sewa t
      ON t.usaha_id = NEW.usaha_id
     AND t.tarif_sewa_id = NEW.tarif_sewa_id
    WHERE b.usaha_id = NEW.usaha_id
      AND b.smart_booking_id = NEW.smart_booking_id
      AND lower(btrim(coalesce(d.durasi_unit_snapshot, t.durasi_unit))) IN ('jam', 'hari', 'minggu')
      AND coalesce(d.durasi_nilai_snapshot, t.durasi_nilai) > 0;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_akasha_smart_booking_tariff_snapshot
  ON app_private.akasha_smart_booking_line;
CREATE TRIGGER trg_akasha_smart_booking_tariff_snapshot
BEFORE INSERT OR UPDATE OF tarif_sewa_id, line_kind, durasi_unit_snapshot, durasi_nilai_snapshot
ON app_private.akasha_smart_booking_line
FOR EACH ROW
EXECUTE FUNCTION app_private.capture_akasha_smart_booking_tariff_snapshot();

REVOKE ALL ON FUNCTION app_private.capture_akasha_smart_booking_tariff_snapshot()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS app_private.akasha_smart_booking_archive (
  usaha_id uuid NOT NULL,
  smart_booking_id uuid NOT NULL,
  archived_by uuid NOT NULL REFERENCES public.akun_admin(akun_admin_id) ON DELETE RESTRICT,
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usaha_id, smart_booking_id),
  CONSTRAINT akasha_smart_booking_archive_booking_fk
    FOREIGN KEY (usaha_id, smart_booking_id)
    REFERENCES app_private.akasha_smart_booking(usaha_id, smart_booking_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_akasha_smart_booking_archive_archived_at
  ON app_private.akasha_smart_booking_archive (usaha_id, archived_at DESC);

REVOKE ALL ON TABLE app_private.akasha_smart_booking_archive
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.admin_archive_akasha_smart_bookings(
  p_usaha_id uuid,
  p_smart_booking_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_admin_id uuid;
  v_requested_count integer;
  v_eligible_count integer;
  v_archived_ids uuid[];
BEGIN
  v_admin_id := app_private.require_usaha_permission(p_usaha_id, 'reservation.amend');

  v_requested_count := coalesce(cardinality(p_smart_booking_ids), 0);
  IF v_requested_count < 1 OR v_requested_count > 100
     OR array_position(p_smart_booking_ids, NULL) IS NOT NULL
     OR (
       SELECT count(DISTINCT item_id)::integer
       FROM unnest(p_smart_booking_ids) AS ids(item_id)
     ) <> v_requested_count THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: pilih 1 sampai 100 reservasi yang berbeda'
      USING ERRCODE = '22023';
  END IF;

  -- Lock in stable order. The archive is atomic: no partial bulk operation.
  PERFORM 1
  FROM app_private.akasha_smart_booking b
  WHERE b.usaha_id = p_usaha_id
    AND b.smart_booking_id = ANY(p_smart_booking_ids)
  ORDER BY b.smart_booking_id
  FOR UPDATE;

  SELECT count(*)::integer
  INTO v_eligible_count
  FROM app_private.akasha_smart_booking b
  WHERE b.usaha_id = p_usaha_id
    AND b.smart_booking_id = ANY(p_smart_booking_ids)
    AND b.workflow_status IN ('received', 'reviewing', 'acknowledged', 'ready_for_checkout', 'fulfilled')
    AND NOT EXISTS (
      SELECT 1
      FROM app_private.akasha_smart_booking_archive a
      WHERE a.usaha_id = b.usaha_id
        AND a.smart_booking_id = b.smart_booking_id
    );

  IF v_eligible_count <> v_requested_count THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: sebagian reservasi tidak ditemukan, sudah dihapus, atau statusnya tidak dapat diarsipkan'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO app_private.akasha_smart_booking_archive (
    usaha_id, smart_booking_id, archived_by
  )
  SELECT b.usaha_id, b.smart_booking_id, v_admin_id
  FROM app_private.akasha_smart_booking b
  WHERE b.usaha_id = p_usaha_id
    AND b.smart_booking_id = ANY(p_smart_booking_ids);

  -- Remove credential hashes and portal-link hashes permanently; the access
  -- table's ON DELETE CASCADE also removes every session bound to the codes.
  DELETE FROM app_private.akasha_smart_booking_customer_access a
  WHERE a.usaha_id = p_usaha_id
    AND a.smart_booking_id = ANY(p_smart_booking_ids);

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, change_summary
  )
  SELECT
    b.usaha_id, auth.uid(), v_admin_id, 'archive',
    'akasha_smart_booking', b.smart_booking_id, 'rental-admin',
    jsonb_build_object(
      'reference_code', b.reference_code,
      'workflow_status', b.workflow_status,
      'customer_access_revoked', true,
      'financial_records_preserved', true
    )
  FROM app_private.akasha_smart_booking b
  WHERE b.usaha_id = p_usaha_id
    AND b.smart_booking_id = ANY(p_smart_booking_ids);

  SELECT array_agg(smart_booking_id ORDER BY smart_booking_id)
  INTO v_archived_ids
  FROM app_private.akasha_smart_booking_archive a
  WHERE a.usaha_id = p_usaha_id
    AND a.smart_booking_id = ANY(p_smart_booking_ids);

  RETURN jsonb_build_object(
    'archived_count', v_requested_count,
    'smart_booking_ids', to_jsonb(v_archived_ids),
    'customer_access_revoked', true,
    'financial_records_preserved', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.admin_archive_akasha_smart_bookings(uuid, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_archive_akasha_smart_bookings(
  p_usaha_id uuid,
  p_smart_booking_ids uuid[]
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.admin_archive_akasha_smart_bookings($1, $2);
$function$;

REVOKE ALL ON FUNCTION public.admin_archive_akasha_smart_bookings(uuid, uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_archive_akasha_smart_bookings(uuid, uuid[])
  TO authenticated;

-- Update existing read models in place while preserving their grants, security
-- definer declarations, tenant checks, return contract and pagination rules.
DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_occurrences integer;
BEGIN
  -- Admin list: archive filtering is applied to both the count and item query.
  v_definition := pg_get_functiondef(
    'app_private.admin_list_akasha_smart_bookings(uuid,text,date,date,text,integer,integer)'::regprocedure
  );
  v_old := 'WHERE b.usaha_id = p_usaha_id';
  v_new := v_old || E'\n      AND NOT EXISTS (\n        SELECT 1 FROM app_private.akasha_smart_booking_archive a\n        WHERE a.usaha_id = b.usaha_id AND a.smart_booking_id = b.smart_booking_id\n      )';
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  IF v_occurrences <> 2 THEN
    RAISE EXCEPTION 'Unexpected list read model shape: expected 2 tenant predicates, got %', v_occurrences;
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  v_old := '''quantity'', x.quantity';
  v_new := v_old || ', ' || '''unit_price'', x.unit_price_snapshot, '
    || '''tarif_sewa_id'', x.tarif_sewa_id, '
    || '''durasi_unit_snapshot'', x.durasi_unit_snapshot, '
    || '''durasi_nilai_snapshot'', x.durasi_nilai_snapshot';
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'List read model line summary could not be extended';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := '''requested_return_date'', b.requested_return_date,';
  v_new := v_old || E'\n        ' || '''requested_pickup_at'', b.requested_pickup_at, '
    || '''requested_return_at'', b.requested_return_at,';
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'List read model timestamps could not be exposed';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;

  -- Admin detail: archived booking cannot be reached by a direct detail URL.
  v_definition := pg_get_functiondef(
    'app_private.admin_get_akasha_smart_booking(uuid)'::regprocedure
  );
  v_old := 'WHERE b.smart_booking_id = p_smart_booking_id;';
  v_new := 'WHERE b.smart_booking_id = p_smart_booking_id' || E'\n    AND NOT EXISTS (\n      SELECT 1 FROM app_private.akasha_smart_booking_archive a\n      WHERE a.usaha_id = b.usaha_id AND a.smart_booking_id = b.smart_booking_id\n    );';
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Admin detail read model could not be archive-filtered';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  v_old := '''tarif_sewa_id'', l.tarif_sewa_id,';
  v_new := v_old || E'\n        ' || '''durasi_unit_snapshot'', l.durasi_unit_snapshot, '
    || '''durasi_nilai_snapshot'', l.durasi_nilai_snapshot,';
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Admin detail tariff-duration snapshots could not be exposed';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;

  -- Summary: keep the closed bucket while exposing a dedicated fulfilled count.
  v_definition := pg_get_functiondef(
    'app_private.admin_get_akasha_smart_booking_summary(uuid)'::regprocedure
  );
  v_old := '''ready_for_checkout'', count(*) FILTER (WHERE b.workflow_status = ''ready_for_checkout'')::integer,';
  v_new := v_old || E'\n    ' || '''fulfilled'', count(*) FILTER (WHERE b.workflow_status = ''fulfilled'')::integer,';
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Summary read model is missing ready_for_checkout count';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  v_old := '''ready_for_checkout'', 0,';
  v_new := v_old || E'\n    ' || '''fulfilled'', 0,';
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Summary read model is missing empty fulfilled count';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  v_old := 'WHERE b.usaha_id = p_usaha_id;';
  v_new := 'WHERE b.usaha_id = p_usaha_id' || E'\n    AND NOT EXISTS (\n      SELECT 1 FROM app_private.akasha_smart_booking_archive a\n      WHERE a.usaha_id = b.usaha_id AND a.smart_booking_id = b.smart_booking_id\n    );';
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Summary read model could not be archive-filtered';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;

  -- Exclude archived bookings from the pending-change summary bucket.
  v_old := 'AND cb.workflow_status NOT IN (''cancelled'', ''expired'', ''fulfilled'')';
  v_new := v_old || E'\n        AND NOT EXISTS (\n          SELECT 1 FROM app_private.akasha_smart_booking_archive a\n          WHERE a.usaha_id = cb.usaha_id AND a.smart_booking_id = cb.smart_booking_id\n        )';
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Summary pending-change counter could not be archive-filtered';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;

  -- Calendar/agenda: exclude archived bookings from counters and agenda.
  v_definition := pg_get_functiondef(
    'app_private.admin_get_akasha_smart_booking_calendar(date,date,date,uuid)'::regprocedure
  );
  v_old := 'AND b.workflow_status NOT IN (''cancelled'', ''expired'', ''fulfilled'')';
  v_new := v_old || E'\n      AND NOT EXISTS (\n        SELECT 1 FROM app_private.akasha_smart_booking_archive a\n        WHERE a.usaha_id = b.usaha_id AND a.smart_booking_id = b.smart_booking_id\n      )';
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  IF v_occurrences < 3 THEN
    RAISE EXCEPTION 'Unexpected calendar read model shape: expected at least 3 active-booking predicates, got %', v_occurrences;
  END IF;
  v_definition := replace(v_definition, v_old, v_new);

  -- The JSON agenda reads from active_bookings (alias a), so carry exact
  -- timestamps into that CTE before exposing them in its result payload.
  v_old := '      b.requested_return_date,';
  v_new := v_old || E'\n      b.requested_pickup_at,\n      b.requested_return_at,';
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Calendar CTE timestamps could not be exposed';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := '''quantity'', l.quantity';
  v_new := v_old || ', ' || '''unit_price'', l.unit_price_snapshot, '
    || '''tarif_sewa_id'', l.tarif_sewa_id, '
    || '''durasi_unit_snapshot'', l.durasi_unit_snapshot, '
    || '''durasi_nilai_snapshot'', l.durasi_nilai_snapshot';
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Calendar agenda line summary could not be extended';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := '''requested_return_date'', a.requested_return_date,';
  v_new := v_old || E'\n            ' || '''requested_pickup_at'', a.requested_pickup_at, '
    || '''requested_return_at'', a.requested_return_at,';
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Calendar agenda timestamps could not be exposed';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;

  -- New customer access exchange and existing portal sessions reject archives.
  v_definition := pg_get_functiondef(
    'app_private.exchange_akasha_smart_booking_access(text,text,text,text)'::regprocedure
  );
  v_old := 'AND b.reference_code = v_reference';
  v_new := v_old || E'\n    AND NOT EXISTS (\n      SELECT 1 FROM app_private.akasha_smart_booking_archive a\n      WHERE a.usaha_id = b.usaha_id AND a.smart_booking_id = b.smart_booking_id\n    )';
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Customer access exchange could not be archive-filtered';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;

  -- The live customer portal authenticates against access hashes. Archived
  -- bookings must never re-enter by code or link even if a credential row
  -- were restored by an out-of-band recovery.
  v_definition := pg_get_functiondef(
    'app_private.exchange_akasha_smart_booking_customer_credential(text,text,text,text)'::regprocedure
  );
  v_old := 'v_valid := FOUND' || E'\n      AND v_access.expires_at > now()';
  v_new := 'v_valid := FOUND' || E'\n      AND NOT EXISTS (' || E'\n        SELECT 1 FROM app_private.akasha_smart_booking_archive a' ||
    E'\n        WHERE a.usaha_id = v_access.usaha_id AND a.smart_booking_id = v_access.smart_booking_id' ||
    E'\n      )' || E'\n      AND v_access.expires_at > now()';
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Customer credential exchange could not be archive-filtered';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;

  -- Prevent a direct stale admin request from issuing fresh customer access.
  v_definition := pg_get_functiondef(
    'app_private.admin_rotate_akasha_smart_booking_access(uuid,text)'::regprocedure
  );
  v_old := E'  v_admin_id := app_private.require_usaha_permission(v_booking.usaha_id, ''access_control.manage'');';
  v_new := v_old || E'\n  IF EXISTS (' ||
    E'\n    SELECT 1 FROM app_private.akasha_smart_booking_archive a' ||
    E'\n    WHERE a.usaha_id = v_booking.usaha_id AND a.smart_booking_id = v_booking.smart_booking_id' ||
    E'\n  ) THEN' ||
    E'\n    RAISE EXCEPTION ''BUSINESS_CONFLICT: reservasi telah dihapus dari panel''' ||
    E'\n      USING ERRCODE = ''23514'';' ||
    E'\n  END IF;';
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Admin credential rotation could not be archive-protected';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;

  v_definition := pg_get_functiondef(
    'app_private.get_akasha_smart_booking_portal(text)'::regprocedure
  );
  v_old := 'AND b.usaha_id = v_session.usaha_id;';
  v_new := 'AND b.usaha_id = v_session.usaha_id' || E'\n    AND NOT EXISTS (\n      SELECT 1 FROM app_private.akasha_smart_booking_archive a\n      WHERE a.usaha_id = b.usaha_id AND a.smart_booking_id = b.smart_booking_id\n    );';
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Customer portal read model could not be archive-filtered';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;
  -- Keep the existing DP validation cap tied to quote_total; only the
  -- informational percentage and activity metadata use the date-based estimate.
  v_definition := pg_get_functiondef(
    'app_private.admin_confirm_akasha_smart_booking(uuid,integer,numeric)'::regprocedure
  );
  v_old := '  v_dp_percent numeric(7,2);';
  v_new := '  v_dp_percent numeric(14,2);' || E'\n  v_estimate_total numeric(24,2);';
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'DP confirmation declaration could not be extended';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := '  v_dp_percent := CASE';
  v_new := $replacement$
  SELECT CASE
    WHEN count(*) = 0 THEN NULL
    WHEN bool_and(periods IS NOT NULL)
      THEN coalesce(sum(quantity * unit_price_snapshot * periods), 0)
    ELSE NULL
  END
  INTO v_estimate_total
  FROM (
    SELECT
      l.quantity,
      l.unit_price_snapshot,
      CASE
        WHEN l.line_kind = 'sale' THEN 1::numeric
        WHEN l.line_kind = 'rental'
          AND (
            (v_booking.requested_pickup_at IS NULL) <> (v_booking.requested_return_at IS NULL)
            OR (
              v_booking.requested_pickup_at IS NOT NULL
              AND v_booking.requested_return_at IS NOT NULL
              AND v_booking.requested_return_at <= v_booking.requested_pickup_at
            )
            OR (
              v_booking.requested_pickup_at IS NULL
              AND v_booking.requested_return_at IS NULL
              AND v_booking.requested_pickup_date IS NOT NULL
              AND v_booking.requested_return_date IS NOT NULL
              AND v_booking.requested_return_date < v_booking.requested_pickup_date
            )
          )
        THEN NULL
        WHEN l.line_kind = 'rental'
          AND l.durasi_nilai_snapshot > 0
          AND l.durasi_unit_snapshot IS NOT NULL
        THEN CASE lower(btrim(l.durasi_unit_snapshot))
          WHEN 'jam' THEN CASE
            WHEN v_booking.requested_pickup_at IS NOT NULL
              AND v_booking.requested_return_at IS NOT NULL
            THEN greatest(
              1::numeric,
              ceil(extract(epoch FROM (v_booking.requested_return_at - v_booking.requested_pickup_at))
                / 3600 / l.durasi_nilai_snapshot)
            )
            ELSE NULL
          END
          WHEN 'hari' THEN greatest(
            1::numeric,
            ceil((
              CASE
                WHEN v_booking.requested_pickup_at IS NOT NULL
                  AND v_booking.requested_return_at IS NOT NULL
                THEN extract(epoch FROM (v_booking.requested_return_at - v_booking.requested_pickup_at)) / 86400
                ELSE (v_booking.requested_return_date - v_booking.requested_pickup_date)::numeric
              END
            ) / l.durasi_nilai_snapshot)
          )
          WHEN 'minggu' THEN greatest(
            1::numeric,
            ceil((
              CASE
                WHEN v_booking.requested_pickup_at IS NOT NULL
                  AND v_booking.requested_return_at IS NOT NULL
                THEN extract(epoch FROM (v_booking.requested_return_at - v_booking.requested_pickup_at)) / 604800
                ELSE (v_booking.requested_return_date - v_booking.requested_pickup_date)::numeric / 7
              END
            ) / l.durasi_nilai_snapshot)
          )
          ELSE NULL
        END
        ELSE NULL
      END AS periods
    FROM app_private.akasha_smart_booking_line l
    WHERE l.usaha_id = v_booking.usaha_id
      AND l.smart_booking_id = p_smart_booking_id
  ) estimate_lines;

  -- Match the UI: when an exact duration cannot be resolved, use the immutable
  -- booking quote as the displayed DP percentage denominator.
  v_estimate_total := coalesce(v_estimate_total, v_booking.quote_total);

  v_dp_percent := CASE$replacement$;
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'DP percentage computation could not be changed';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  v_old := 'WHEN v_booking.quote_total > 0' || E'\n      THEN round((p_dp_amount / v_booking.quote_total) * 100, 2)';
  v_new := 'WHEN coalesce(v_estimate_total, 0) > 0' || E'\n      THEN round((p_dp_amount / v_estimate_total) * 100, 2)';
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'DP percentage denominator could not be updated';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  v_old := '''booking_total'', v_booking.quote_total,';
  v_new := '''booking_total'', v_estimate_total, ' || '''quote_total_snapshot'', v_booking.quote_total,';
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'DP activity metadata could not be aligned to estimate';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;

END;
$migration$;
