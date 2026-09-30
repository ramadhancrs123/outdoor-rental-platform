CREATE OR REPLACE FUNCTION app_private.consume_notification_outbox(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_event public.outbox_event%ROWTYPE;
  v_processed integer := 0;
  v_failed integer := 0;
  v_stale integer := 0;
  v_skipped integer := 0;
  v_recipient_count integer;
  v_title text;
  v_message text;
  v_action_target text;
  v_notify boolean;
  v_source_exists boolean;
  v_label text;
  v_admin_id uuid;
BEGIN
  FOR v_event IN
    SELECT o.*
    FROM public.outbox_event o
    WHERE o.status = 'pending'
       OR (o.status = 'failed' AND (o.next_attempt_at IS NULL OR o.next_attempt_at <= now()))
    ORDER BY o.occurred_at, o.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  LOOP
    UPDATE public.outbox_event
    SET status = 'processing',
        attempt_count = coalesce(attempt_count, 0) + 1,
        next_attempt_at = NULL
    WHERE outbox_event_id = v_event.outbox_event_id;

    BEGIN
      v_notify := false;
      v_source_exists := true;
      v_title := NULL;
      v_message := NULL;
      v_action_target := NULL;
      v_label := NULL;

      CASE v_event.event_type
        WHEN 'reservation.confirmed' THEN
          v_notify := true;
          SELECT coalesce(v_event.payload->>'nomor_reservasi', r.nomor_reservasi)
            INTO v_label
          FROM public.reservasi r
          WHERE r.usaha_id = v_event.usaha_id
            AND r.reservasi_id = v_event.aggregate_id;
          v_source_exists := found;
          v_label := coalesce(v_label, v_event.aggregate_id::text);
          v_title := 'Reservasi dikonfirmasi';
          v_message := 'Reservasi ' || v_label || ' telah dikonfirmasi.';
          v_action_target := '/reservasi/' || v_event.aggregate_id::text;

        WHEN 'rental.picked_up' THEN
          v_notify := true;
          SELECT r.nomor_penyewaan INTO v_label
          FROM public.penyewaan r
          WHERE r.usaha_id = v_event.usaha_id
            AND r.penyewaan_id = v_event.aggregate_id;
          v_source_exists := found;
          v_label := coalesce(v_label, v_event.aggregate_id::text);
          v_title := 'Rental sudah diambil';
          v_message := 'Penyewaan ' || v_label || ' sudah dicatat sebagai serah-terima.';
          v_action_target := '/penyewaan/' || v_event.aggregate_id::text;

        WHEN 'return.completed' THEN
          v_notify := true;
          SELECT r.nomor_pengembalian INTO v_label
          FROM public.pengembalian r
          WHERE r.usaha_id = v_event.usaha_id
            AND r.pengembalian_id = v_event.aggregate_id;
          v_source_exists := found;
          v_label := coalesce(v_label, v_event.aggregate_id::text);
          v_title := 'Pengembalian selesai';
          v_message := 'Pengembalian ' || v_label || ' selesai dan masuk ke workflow berikutnya.';
          v_action_target := '/pengembalian/' || v_event.aggregate_id::text;

        WHEN 'inspection.maintenance_required' THEN
          v_notify := true;
          SELECT u.kode_unit INTO v_label
          FROM public.pemeriksaan i
          JOIN public.unit_barang u ON u.usaha_id = i.usaha_id AND u.unit_barang_id = i.unit_barang_id
          WHERE i.usaha_id = v_event.usaha_id
            AND i.pemeriksaan_id = v_event.aggregate_id;
          v_source_exists := found;
          v_label := coalesce(v_label, v_event.aggregate_id::text);
          v_title := 'Unit membutuhkan perawatan';
          v_message := 'Unit ' || v_label || ' memerlukan tindak lanjut Perawatan.';
          v_action_target := '/pemeriksaan/' || v_event.aggregate_id::text;

        WHEN 'maintenance.completed' THEN
          v_notify := true;
          SELECT u.kode_unit INTO v_label
          FROM public.perawatan m
          JOIN public.unit_barang u ON u.usaha_id = m.usaha_id AND u.unit_barang_id = m.unit_barang_id
          WHERE m.usaha_id = v_event.usaha_id
            AND m.perawatan_id = v_event.aggregate_id;
          v_source_exists := found;
          v_label := coalesce(v_label, v_event.aggregate_id::text);
          v_title := 'Perawatan selesai';
          v_message := 'Perawatan untuk unit ' || v_label || ' telah selesai; readiness tetap mengikuti proses verifikasi.';
          v_action_target := '/perawatan/' || v_event.aggregate_id::text;

        WHEN 'payment.recorded' THEN
          v_notify := true;
          SELECT p.nomor_pembayaran INTO v_label
          FROM public.pembayaran p
          WHERE p.usaha_id = v_event.usaha_id
            AND p.pembayaran_id = v_event.aggregate_id;
          v_source_exists := found;
          v_label := coalesce(v_label, v_event.aggregate_id::text);
          v_title := 'Pembayaran tercatat';
          v_message := 'Pembayaran ' || v_label || ' telah dicatat oleh Keuangan.';
          v_action_target := '/keuangan/pembayaran/' || v_event.aggregate_id::text;

        WHEN 'expense.recorded' THEN
          v_notify := true;
          SELECT e.nomor_pengeluaran INTO v_label
          FROM public.pengeluaran e
          WHERE e.usaha_id = v_event.usaha_id
            AND e.pengeluaran_id = v_event.aggregate_id;
          v_source_exists := found;
          v_label := coalesce(v_label, v_event.aggregate_id::text);
          v_title := 'Pengeluaran tercatat';
          v_message := 'Pengeluaran ' || v_label || ' telah dicatat oleh Keuangan.';
          v_action_target := '/keuangan/pengeluaran/' || v_event.aggregate_id::text;

        WHEN 'inventory.unit_inspection_pending' THEN
          v_notify := true;
          SELECT u.kode_unit INTO v_label
          FROM public.unit_barang u
          WHERE u.usaha_id = v_event.usaha_id
            AND u.unit_barang_id = v_event.aggregate_id;
          v_source_exists := found;
          v_label := coalesce(v_label, v_event.aggregate_id::text);
          v_title := 'Unit menunggu pemeriksaan';
          v_message := 'Unit ' || v_label || ' menunggu pemeriksaan.';
          v_action_target := '/inventaris/' || v_event.aggregate_id::text;

        WHEN 'inventory.unit_ready' THEN
          v_notify := true;
          SELECT u.kode_unit INTO v_label
          FROM public.unit_barang u
          WHERE u.usaha_id = v_event.usaha_id
            AND u.unit_barang_id = v_event.aggregate_id;
          v_source_exists := found;
          v_label := coalesce(v_label, v_event.aggregate_id::text);
          v_title := 'Unit siap digunakan';
          v_message := 'Unit ' || v_label || ' dinyatakan ready oleh Inventaris.';
          v_action_target := '/inventaris/' || v_event.aggregate_id::text;

        ELSE
          NULL;
      END CASE;

      IF v_notify AND NOT v_source_exists THEN
        UPDATE public.outbox_event
        SET status = 'stale',
            processed_at = now(),
            last_error = 'SOURCE_NOT_FOUND:' || coalesce(v_event.aggregate_type, 'unknown') || ':' || v_event.aggregate_id::text,
            next_attempt_at = NULL
        WHERE outbox_event_id = v_event.outbox_event_id;
        v_stale := v_stale + 1;

      ELSIF v_notify THEN
        v_recipient_count := 0;

        FOR v_admin_id IN
          SELECT aa.akun_admin_id
          FROM public.keanggotaan_usaha ku
          JOIN public.akun_admin aa ON aa.akun_admin_id = ku.akun_admin_id
          WHERE ku.usaha_id = v_event.usaha_id
            AND ku.status = 'active'
            AND ku.revoked_at IS NULL
            AND aa.status = 'active'
            AND aa.role = 'super_admin'
        LOOP
          INSERT INTO public.pemberitahuan (
            usaha_id,penerima_akun_admin_id,jenis,prioritas,judul,pesan,
            sumber_type,sumber_id,action_type,action_target,outbox_event_id
          )
          VALUES (
            v_event.usaha_id,v_admin_id,'system','normal',v_title,v_message,
            v_event.event_type,v_event.aggregate_id,'navigate',v_action_target,v_event.outbox_event_id
          )
          ON CONFLICT DO NOTHING;
          v_recipient_count := v_recipient_count + 1;
        END LOOP;

        IF v_recipient_count = 0 THEN
          RAISE EXCEPTION 'NO_ACTIVE_ADMIN_RECIPIENT';
        END IF;

        UPDATE public.outbox_event
        SET status = 'processed', processed_at = now(), last_error = NULL, next_attempt_at = NULL
        WHERE outbox_event_id = v_event.outbox_event_id;

        v_processed := v_processed + 1;
      ELSE
        UPDATE public.outbox_event
        SET status = 'processed', processed_at = now(), last_error = NULL, next_attempt_at = NULL
        WHERE outbox_event_id = v_event.outbox_event_id;
        v_skipped := v_skipped + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      UPDATE public.outbox_event
      SET status = 'failed',
          processed_at = NULL,
          last_error = left(SQLERRM, 1000),
          next_attempt_at = now() + interval '5 minutes'
      WHERE outbox_event_id = v_event.outbox_event_id;
      v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'processed', v_processed,
    'failed', v_failed,
    'stale', v_stale,
    'skipped_without_notification_policy', v_skipped,
    'limit', v_limit
  );
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.revalidate_notification(p_pemberitahuan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_notification public.pemberitahuan%ROWTYPE;
  v_admin_id uuid;
  v_exists boolean := false;
  v_target text := null;
BEGIN
  SELECT *
  INTO v_notification
  FROM public.pemberitahuan
  WHERE pemberitahuan_id = p_pemberitahuan_id;

  IF NOT found THEN
    RAISE EXCEPTION 'NOTIFICATION_NOT_FOUND';
  END IF;

  SELECT aa.akun_admin_id
    INTO v_admin_id
  FROM public.akun_admin aa
  WHERE aa.auth_user_id = auth.uid()
    AND aa.status = 'active';

  IF v_admin_id IS NULL OR v_admin_id <> v_notification.penerima_akun_admin_id THEN
    RAISE EXCEPTION 'NOTIFICATION_FORBIDDEN';
  END IF;

  IF NOT app_private.has_usaha_access(v_notification.usaha_id) THEN
    RAISE EXCEPTION 'NOTIFICATION_TENANT_FORBIDDEN';
  END IF;

  CASE v_notification.sumber_type
    WHEN 'reservation.confirmed' THEN
      SELECT exists(
        SELECT 1 FROM public.reservasi r
        WHERE r.usaha_id = v_notification.usaha_id
          AND r.reservasi_id = v_notification.sumber_id
      ) INTO v_exists;
      v_target := '/reservasi/' || v_notification.sumber_id::text;

    WHEN 'rental.picked_up' THEN
      SELECT exists(
        SELECT 1 FROM public.penyewaan r
        WHERE r.usaha_id = v_notification.usaha_id
          AND r.penyewaan_id = v_notification.sumber_id
      ) INTO v_exists;
      v_target := '/penyewaan/' || v_notification.sumber_id::text;

    WHEN 'return.completed' THEN
      SELECT exists(
        SELECT 1 FROM public.pengembalian r
        WHERE r.usaha_id = v_notification.usaha_id
          AND r.pengembalian_id = v_notification.sumber_id
      ) INTO v_exists;
      v_target := '/pengembalian/' || v_notification.sumber_id::text;

    WHEN 'inspection.maintenance_required' THEN
      SELECT exists(
        SELECT 1 FROM public.pemeriksaan r
        WHERE r.usaha_id = v_notification.usaha_id
          AND r.pemeriksaan_id = v_notification.sumber_id
      ) INTO v_exists;
      v_target := '/pemeriksaan/' || v_notification.sumber_id::text;

    WHEN 'maintenance.completed' THEN
      SELECT exists(
        SELECT 1 FROM public.perawatan r
        WHERE r.usaha_id = v_notification.usaha_id
          AND r.perawatan_id = v_notification.sumber_id
      ) INTO v_exists;
      v_target := '/perawatan/' || v_notification.sumber_id::text;

    WHEN 'payment.recorded' THEN
      SELECT exists(
        SELECT 1 FROM public.pembayaran r
        WHERE r.usaha_id = v_notification.usaha_id
          AND r.pembayaran_id = v_notification.sumber_id
      ) INTO v_exists;
      v_target := '/keuangan/pembayaran/' || v_notification.sumber_id::text;

    WHEN 'expense.recorded' THEN
      SELECT exists(
        SELECT 1 FROM public.pengeluaran r
        WHERE r.usaha_id = v_notification.usaha_id
          AND r.pengeluaran_id = v_notification.sumber_id
      ) INTO v_exists;
      v_target := '/keuangan/pengeluaran/' || v_notification.sumber_id::text;

    WHEN 'inventory.unit_inspection_pending', 'inventory.unit_ready' THEN
      SELECT exists(
        SELECT 1 FROM public.unit_barang r
        WHERE r.usaha_id = v_notification.usaha_id
          AND r.unit_barang_id = v_notification.sumber_id
      ) INTO v_exists;
      v_target := '/inventaris/' || v_notification.sumber_id::text;

    ELSE
      v_exists := false;
  END CASE;

  RETURN jsonb_build_object(
    'pemberitahuan_id', v_notification.pemberitahuan_id,
    'source_exists', v_exists,
    'action_target', CASE WHEN v_exists THEN v_target ELSE null END,
    'source_type', v_notification.sumber_type,
    'source_id', v_notification.sumber_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.revalidate_notification(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.revalidate_notification(uuid) TO authenticated;
