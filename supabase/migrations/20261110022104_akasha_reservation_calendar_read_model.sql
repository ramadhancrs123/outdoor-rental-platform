-- Unified reservation workspace calendar read model.
-- Smart Booking is the single admin reservation aggregate. Its linked legacy
-- public.reservasi row remains an operational compatibility record, not a
-- second calendar entry. This function is read-only and never locks stock.

CREATE OR REPLACE FUNCTION app_private.admin_get_akasha_smart_booking_calendar(
  p_date_from date,
  p_date_until date,
  p_selected_date date,
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
  v_days jsonb;
  v_agenda jsonb;
  v_agenda_total integer;
  v_scheduled_total integer;
  v_pickup_total integer;
  v_return_total integer;
  v_unscheduled_total integer;
BEGIN
  IF auth.uid() IS NULL OR p_usaha_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.akun_admin aa
    JOIN public.keanggotaan_usaha ku
      ON ku.akun_admin_id = aa.akun_admin_id
     AND ku.usaha_id = p_usaha_id
     AND ku.status = 'active'
     AND ku.revoked_at IS NULL
    WHERE aa.auth_user_id = auth.uid()
      AND aa.status = 'active'
  ) THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: akses Reservasi tidak diberikan'
      USING ERRCODE = '42501';
  END IF;

  IF p_date_from IS NULL OR p_date_until IS NULL
     OR p_date_until < p_date_from
     OR p_date_until - p_date_from > 62 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: rentang kalender tidak valid'
      USING ERRCODE = '22023';
  END IF;

  IF p_selected_date IS NOT NULL
     AND (p_selected_date < p_date_from OR p_selected_date > p_date_until) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: tanggal agenda berada di luar rentang kalender'
      USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(nullif(u.timezone, ''), 'Asia/Jakarta')
    INTO v_timezone
  FROM public.usaha u
  WHERE u.usaha_id = p_usaha_id
    AND u.status = 'active';

  IF v_timezone IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_timezone_names tz
       WHERE tz.name = v_timezone
     ) THEN
    RAISE EXCEPTION 'NOT_FOUND: Usaha aktif atau zona waktunya tidak valid'
      USING ERRCODE = 'P0002';
  END IF;

  WITH active_bookings AS (
    SELECT
      b.smart_booking_id,
      b.reference_code,
      b.reservasi_id,
      b.customer_name,
      b.customer_phone,
      b.workflow_status,
      b.requested_pickup_date,
      b.requested_return_date,
      b.quote_total,
      b.currency_code,
      b.created_at
    FROM app_private.akasha_smart_booking b
    WHERE b.usaha_id = p_usaha_id
      AND b.workflow_status NOT IN ('cancelled', 'expired', 'fulfilled')
      AND b.requested_pickup_date IS NOT NULL
  ),
  days AS (
    SELECT (p_date_from + offsets.day_offset)::date AS calendar_date
    FROM generate_series(0, p_date_until - p_date_from) AS offsets(day_offset)
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', to_char(d.calendar_date, 'YYYY-MM-DD'),
        'booking_count', (
          SELECT count(*)::integer
          FROM active_bookings b
          WHERE b.requested_pickup_date <= d.calendar_date
            AND coalesce(b.requested_return_date, b.requested_pickup_date) >= d.calendar_date
        ),
        'pickup_count', (
          SELECT count(*)::integer
          FROM active_bookings b
          WHERE b.requested_pickup_date = d.calendar_date
        ),
        'return_count', (
          SELECT count(*)::integer
          FROM active_bookings b
          WHERE b.requested_return_date = d.calendar_date
        ),
        'in_period_count', (
          SELECT count(*)::integer
          FROM active_bookings b
          WHERE b.requested_pickup_date < d.calendar_date
            AND coalesce(b.requested_return_date, b.requested_pickup_date) > d.calendar_date
        )
      )
      ORDER BY d.calendar_date
    ),
    '[]'::jsonb
  )
  INTO v_days
  FROM days d;

  IF p_selected_date IS NOT NULL THEN
    WITH active_bookings AS (
      SELECT b.*
      FROM app_private.akasha_smart_booking b
      WHERE b.usaha_id = p_usaha_id
        AND b.workflow_status NOT IN ('cancelled', 'expired', 'fulfilled')
        AND b.requested_pickup_date IS NOT NULL
        AND b.requested_pickup_date <= p_selected_date
        AND coalesce(b.requested_return_date, b.requested_pickup_date) >= p_selected_date
    ),
    selected_agenda AS (
      SELECT
        b.*,
        r.nomor_reservasi,
        coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'kind', l.line_kind,
            'name', l.item_name_snapshot,
            'variant', l.variant_label_snapshot,
            'quantity', l.quantity
          ) ORDER BY l.line_position, l.created_at)
          FROM app_private.akasha_smart_booking_line l
          WHERE l.usaha_id = b.usaha_id
            AND l.smart_booking_id = b.smart_booking_id
        ), '[]'::jsonb) AS line_summary,
        (
          SELECT count(*)::integer
          FROM app_private.akasha_smart_booking_change_request c
          WHERE c.usaha_id = b.usaha_id
            AND c.smart_booking_id = b.smart_booking_id
            AND c.request_status = 'pending'
        ) AS pending_change_count
      FROM active_bookings b
      LEFT JOIN public.reservasi r
        ON r.usaha_id = b.usaha_id
       AND r.reservasi_id = b.reservasi_id
    )
    SELECT
      count(*)::integer,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'smart_booking_id', a.smart_booking_id,
            'reference_code', a.reference_code,
            'reservation_id', a.reservasi_id,
            'reservation_number', a.nomor_reservasi,
            'customer_name', a.customer_name,
            'customer_phone', a.customer_phone,
            'workflow_status', a.workflow_status,
            'requested_pickup_date', a.requested_pickup_date,
            'requested_return_date', a.requested_return_date,
            'quote_total', a.quote_total,
            'currency_code', a.currency_code,
            'created_at', a.created_at,
            'line_summary', a.line_summary,
            'pending_change_count', a.pending_change_count,
            'is_pickup', a.requested_pickup_date = p_selected_date,
            'is_return', a.requested_return_date = p_selected_date,
            'is_in_period', a.requested_pickup_date < p_selected_date
              AND coalesce(a.requested_return_date, a.requested_pickup_date) > p_selected_date
          )
          ORDER BY
            CASE
              WHEN a.workflow_status IN ('change_requested', 'cancellation_pending', 'customer_action_required', 'received') THEN 0
              ELSE 1
            END,
            a.requested_pickup_date,
            a.created_at
        ),
        '[]'::jsonb
      )
    INTO v_agenda_total, v_agenda
    FROM selected_agenda a;
  ELSE
    v_agenda_total := 0;
    v_agenda := '[]'::jsonb;
  END IF;

  SELECT
    count(*) FILTER (
      WHERE b.requested_pickup_date IS NOT NULL
        AND b.requested_pickup_date <= p_date_until
        AND coalesce(b.requested_return_date, b.requested_pickup_date) >= p_date_from
    )::integer,
    count(*) FILTER (
      WHERE b.requested_pickup_date BETWEEN p_date_from AND p_date_until
    )::integer,
    count(*) FILTER (
      WHERE b.requested_return_date BETWEEN p_date_from AND p_date_until
    )::integer,
    count(*) FILTER (
      WHERE b.requested_pickup_date IS NULL
    )::integer
  INTO v_scheduled_total, v_pickup_total, v_return_total, v_unscheduled_total
  FROM app_private.akasha_smart_booking b
  WHERE b.usaha_id = p_usaha_id
    AND b.workflow_status NOT IN ('cancelled', 'expired', 'fulfilled');

  RETURN jsonb_build_object(
    'business_timezone', v_timezone,
    'date_from', p_date_from,
    'date_until', p_date_until,
    'scheduled_count', coalesce(v_scheduled_total, 0),
    'pickup_count', coalesce(v_pickup_total, 0),
    'return_count', coalesce(v_return_total, 0),
    'unscheduled_count', coalesce(v_unscheduled_total, 0),
    'agenda_total', coalesce(v_agenda_total, 0),
    'days', v_days,
    'agenda', v_agenda
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.admin_get_akasha_smart_booking_calendar(date, date, date, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_akasha_smart_booking_calendar(
  p_date_from date,
  p_date_until date,
  p_selected_date date,
  p_usaha_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.admin_get_akasha_smart_booking_calendar($1, $2, $3, $4);
$function$;

REVOKE ALL ON FUNCTION public.admin_get_akasha_smart_booking_calendar(date, date, date, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_akasha_smart_booking_calendar(date, date, date, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.admin_get_akasha_smart_booking_calendar(date, date, date, uuid)
  IS 'Read-only calendar projection for the unified Akasha reservation workspace. Smart Booking is the single calendar aggregate; linked legacy reservasi rows are displayed only as compatibility metadata and are not double-counted.';


-- Admin-created reservations from a rental request must enter the same
-- Smart Booking aggregate as website-created reservations. The legacy
-- public.reservasi row is retained only as the transaction/compatibility link.
CREATE OR REPLACE FUNCTION app_private.admin_create_akasha_smart_booking_from_request(
  p_usaha_id uuid,
  p_permintaan_sewa_id uuid,
  p_lines jsonb,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_admin_id uuid;
  v_timezone text;
  v_response jsonb;
  v_reservasi_id uuid;
  v_booking_id uuid;
  v_reference text;
  v_attempt integer;
  v_name text;
  v_phone text;
  v_phone_normalized text;
  v_note text;
  v_pickup date;
  v_return date;
  v_quote_total numeric(14,2);
BEGIN
  IF v_actor IS NULL OR p_usaha_id IS NULL
     OR p_permintaan_sewa_id IS NULL OR p_request_id IS NULL
     OR nullif(btrim(coalesce(p_idempotency_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: konteks admin dan idempotency reservasi wajib diisi'
      USING ERRCODE = '22023';
  END IF;

  SELECT aa.akun_admin_id
    INTO v_admin_id
  FROM public.akun_admin aa
  JOIN public.keanggotaan_usaha ku
    ON ku.akun_admin_id = aa.akun_admin_id
   AND ku.usaha_id = p_usaha_id
   AND ku.status = 'active'
   AND ku.revoked_at IS NULL
  WHERE aa.auth_user_id = v_actor
    AND aa.status = 'active';

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_ERROR: admin tidak memiliki keanggotaan aktif pada Usaha ini'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(nullif(u.timezone, ''), 'Asia/Jakarta')
    INTO v_timezone
  FROM public.usaha u
  WHERE u.usaha_id = p_usaha_id
    AND u.status = 'active';

  IF v_timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names tz WHERE tz.name = v_timezone
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: Usaha aktif atau zona waktunya tidak valid'
      USING ERRCODE = 'P0002';
  END IF;

  -- Keep the existing trusted command responsible for request validation,
  -- pricing resolution, legacy reservation creation, audit, and idempotency.
  v_response := public.command_create_reservation_from_request(
    p_usaha_id,
    p_permintaan_sewa_id,
    p_lines,
    p_idempotency_key,
    p_request_id
  );
  v_reservasi_id := nullif(v_response->>'reservasi_id', '')::uuid;

  IF v_reservasi_id IS NULL THEN
    RAISE EXCEPTION 'INTEGRITY_ERROR: command reservasi tidak mengembalikan reservasi_id'
      USING ERRCODE = '23514';
  END IF;

  SELECT b.smart_booking_id, b.reference_code
    INTO v_booking_id, v_reference
  FROM app_private.akasha_smart_booking b
  WHERE b.usaha_id = p_usaha_id
    AND b.reservasi_id = v_reservasi_id;

  IF v_booking_id IS NOT NULL THEN
    RETURN v_response || jsonb_build_object(
      'smart_booking_id', v_booking_id,
      'reference_code', v_reference
    );
  END IF;

  SELECT
    pe.nama_lengkap,
    pe.nomor_telepon,
    coalesce(
      nullif(pe.nomor_telepon_normalized, ''),
      regexp_replace(coalesce(pe.nomor_telepon, ''), '[^0-9]', '', 'g')
    ),
    r.catatan,
    r.mulai_reservasi,
    r.selesai_reservasi,
    round(coalesce(sum(d.subtotal), 0), 2)
  INTO
    v_name, v_phone, v_phone_normalized, v_note, v_pickup, v_return, v_quote_total
  FROM public.reservasi r
  JOIN public.penyewa pe
    ON pe.usaha_id = r.usaha_id
   AND pe.penyewa_id = r.penyewa_id
  LEFT JOIN public.detail_reservasi d
    ON d.usaha_id = r.usaha_id
   AND d.reservasi_id = r.reservasi_id
  WHERE r.usaha_id = p_usaha_id
    AND r.reservasi_id = v_reservasi_id
  GROUP BY
    pe.nama_lengkap, pe.nomor_telepon, pe.nomor_telepon_normalized,
    r.catatan, r.mulai_reservasi, r.selesai_reservasi;

  IF v_name IS NULL OR length(btrim(v_name)) < 2
     OR length(coalesce(v_phone, '')) < 8
     OR length(coalesce(v_phone_normalized, '')) NOT BETWEEN 8 AND 16 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: lengkapi nama dan nomor WhatsApp penyewa sebelum membuat Reservasi'
      USING ERRCODE = '22023';
  END IF;

  IF v_pickup IS NULL OR v_return IS NULL OR v_return < v_pickup THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: periode Reservasi tidak valid'
      USING ERRCODE = '22023';
  END IF;

  FOR v_attempt IN 1..8 LOOP
    v_reference := app_private.akasha_smart_booking_new_reference();
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM app_private.akasha_smart_booking b
      WHERE b.usaha_id = p_usaha_id
        AND b.reference_code = v_reference
    );
  END LOOP;

  IF v_reference IS NULL OR EXISTS (
    SELECT 1
    FROM app_private.akasha_smart_booking b
    WHERE b.usaha_id = p_usaha_id
      AND b.reference_code = v_reference
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: referensi Reservasi tidak dapat dibuat'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO app_private.akasha_smart_booking (
    usaha_id, reservasi_id, permintaan_sewa_id, penyewa_id,
    reference_code, workflow_status, customer_name, customer_phone,
    customer_phone_normalized, customer_note, requested_pickup_date,
    requested_return_date, business_timezone, quote_total, currency_code,
    reviewed_at, reviewed_by
  )
  SELECT
    r.usaha_id, r.reservasi_id, r.permintaan_sewa_id, r.penyewa_id,
    v_reference, 'acknowledged', v_name, v_phone, v_phone_normalized,
    nullif(left(coalesce(v_note, ''), 500), ''),
    r.mulai_reservasi, r.selesai_reservasi, v_timezone, v_quote_total, 'IDR',
    now(), v_admin_id
  FROM public.reservasi r
  WHERE r.usaha_id = p_usaha_id
    AND r.reservasi_id = v_reservasi_id
  RETURNING smart_booking_id INTO v_booking_id;

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
    coalesce(vb.inventory_mode, b.inventory_mode, 'serialized'),
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
  WHERE d.usaha_id = p_usaha_id
    AND d.reservasi_id = v_reservasi_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: snapshot rincian Reservasi tidak ditemukan'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO app_private.akasha_smart_booking_activity_event (
    usaha_id, smart_booking_id, event_type, actor_type, actor_admin_id,
    customer_visible, public_message, internal_metadata
  )
  VALUES (
    p_usaha_id, v_booking_id, 'booking.acknowledged', 'admin', v_admin_id,
    true, 'Reservasi Anda sudah ditinjau dan dicatat oleh tim Akasha.',
    jsonb_build_object(
      'source', 'admin-request',
      'request_id', p_permintaan_sewa_id,
      'reservation_id', v_reservasi_id,
      'actor_admin_id', v_admin_id
    )
  );

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
    entity_type, entity_id, source_application, request_id, change_summary
  )
  VALUES (
    p_usaha_id, v_actor, v_admin_id, 'create',
    'akasha_smart_booking', v_booking_id, 'admin-command', p_request_id,
    jsonb_build_object(
      'reference_code', v_reference,
      'reservation_id', v_reservasi_id,
      'workflow_status', 'acknowledged',
      'inventory_effect', 'none'
    )
  );

  INSERT INTO public.outbox_event (
    usaha_id, event_type, aggregate_type, aggregate_id, payload
  )
  VALUES (
    p_usaha_id,
    'akasha_smart_booking.received',
    'akasha_smart_booking',
    v_booking_id,
    jsonb_build_object(
      'smart_booking_id', v_booking_id,
      'reference_code', v_reference,
      'workflow_status', 'acknowledged'
    )
  );

  RETURN v_response || jsonb_build_object(
    'smart_booking_id', v_booking_id,
    'reference_code', v_reference,
    'workflow_status', 'acknowledged'
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.admin_create_akasha_smart_booking_from_request(uuid, uuid, jsonb, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_create_akasha_smart_booking_from_request(
  p_usaha_id uuid,
  p_permintaan_sewa_id uuid,
  p_lines jsonb,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT app_private.admin_create_akasha_smart_booking_from_request($1, $2, $3, $4, $5);
$function$;

REVOKE ALL ON FUNCTION public.admin_create_akasha_smart_booking_from_request(uuid, uuid, jsonb, text, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_akasha_smart_booking_from_request(uuid, uuid, jsonb, text, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.admin_create_akasha_smart_booking_from_request(uuid, uuid, jsonb, text, uuid)
  IS 'Creates an admin-request reservation and its single Smart Booking aggregate atomically; preserves the legacy reservation row only as a linked compatibility record.';


-- Make the newly added RPC visible to PostgREST after migration application.
NOTIFY pgrst, 'reload schema';
