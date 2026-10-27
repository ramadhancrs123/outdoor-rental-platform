-- Native running-fine (denda) signal plumbing.
-- Consumer already renders in-app messages and queues visible FCM pushes for
-- rental.tolerance_expired / return.completed. This migration enriches the FCM
-- data payload with the fields the Android app needs to start/stop the native
-- persistent fine banner without opening any admin page:
--   rental.tolerance_expired -> kind=rental_fine_start (full fine calculation input)
--   return.completed         -> kind=rental_fine_stop  (rental id that is settled)
-- The edge function process-fcm-queue-cron sends kind=rental_fine_* rows as
-- data-only (silent) messages so FirebaseMessagingService.onMessageReceived
-- can drive RentalFineManager directly.

CREATE OR REPLACE FUNCTION public.consume_notification_outbox(p_limit integer DEFAULT 50)
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
    v_target_user_id uuid;
    v_source_parent_id uuid;
    v_target_user_type text;
    v_amount numeric;
    v_rate numeric(14,2);
    v_push_result jsonb;
    v_webhook_result jsonb;
    v_event_fcm_attempted boolean := false;
    v_event_webhook_dispatched integer := 0;
    v_fcm_sent integer := 0;
    v_fcm_failed integer := 0;
    v_webhook_dispatched integer := 0;
    v_schedule timestamptz;
    v_fine_due timestamptz;
    v_currency text;
    v_fine_enabled boolean;
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
            v_target_user_id := NULL;
            v_source_parent_id := NULL;
            v_target_user_type := NULL;
            v_label := NULL;
            v_amount := NULL;
            v_rate := NULL;
            v_push_result := NULL;
            v_webhook_result := NULL;
            v_event_fcm_attempted := false;
            v_event_webhook_dispatched := 0;
            v_schedule := NULL;
            v_fine_due := NULL;
            v_currency := NULL;
            v_fine_enabled := NULL;

            CASE v_event.event_type
                WHEN 'reservation.confirmed' THEN
                    v_notify := true;
                    SELECT coalesce(nullif(btrim(s.nama_lengkap), ''), nullif(v_event.payload->>'nomor_reservasi', ''), r.nomor_reservasi)
INTO v_label
FROM public.reservasi r
LEFT JOIN public.penyewa s ON s.usaha_id = r.usaha_id AND s.penyewa_id = r.penyewa_id
WHERE r.usaha_id = v_event.usaha_id
AND r.reservasi_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.aggregate_id::text);
                    v_title := 'Reservasi dikonfirmasi';
                    v_message := 'Reservasi atas nama ' || v_label || ' dikonfirmasi. Periksa jadwal dan kesiapan barang.';
                    v_action_target := '/reservasi/' || v_event.aggregate_id::text;

                WHEN 'rental.picked_up' THEN
                    v_notify := true;
                    SELECT coalesce(nullif(btrim(s.nama_lengkap), ''), r.nomor_penyewaan) INTO v_label
FROM public.penyewaan r
LEFT JOIN public.penyewa s ON s.usaha_id = r.usaha_id AND s.penyewa_id = r.penyewa_id
WHERE r.usaha_id = v_event.usaha_id
AND r.penyewaan_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.aggregate_id::text);
                    v_title := 'Serah-terima dicatat';
                    v_message := 'Barang sewaan atas nama ' || v_label || ' sudah diserahkan.';
                    v_action_target := '/penyewaan/' || v_event.aggregate_id::text;

                WHEN 'return.completed' THEN
                    v_notify := true;
                    SELECT coalesce(nullif(btrim(s.nama_lengkap), ''), r.nomor_pengembalian), r.penyewaan_id INTO v_label, v_source_parent_id
FROM public.pengembalian r
LEFT JOIN public.penyewaan se ON se.usaha_id = r.usaha_id AND se.penyewaan_id = r.penyewaan_id
LEFT JOIN public.penyewa s ON s.usaha_id = se.usaha_id AND s.penyewa_id = se.penyewa_id
WHERE r.usaha_id = v_event.usaha_id
AND r.pengembalian_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.aggregate_id::text);
                    v_title := 'Pengembalian selesai';
                    v_message := 'Barang sewaan atas nama ' || v_label || ' sudah dikembalikan. Periksa kondisi unit.';
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
                    v_message := 'Unit ' || v_label || ' perlu ditindaklanjuti melalui Perawatan.';
                    v_action_target := '/pemeriksaan/' || v_event.aggregate_id::text;

                WHEN 'maintenance.completed' THEN
                    v_notify := true;
                    SELECT u.kode_unit INTO v_label
                    FROM public.perawatan m
                    JOIN public.unit_barang u ON u.usaha_id = m.usaha_id AND u.unit_barang_id = m.unit_barang_id
                    WHERE m.usaha_id = v_event.usaha_id
                      AND m.pemeriksaan_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.aggregate_id::text);
                    v_title := 'Perawatan selesai';
                    v_message := 'Perawatan unit ' || v_label || ' selesai. Periksa kondisi sebelum disewakan kembali.';
                    v_action_target := '/perawatan/' || v_event.aggregate_id::text;

                WHEN 'rental.consequence_review_required' THEN
                    v_notify := true;
                    SELECT coalesce(nullif(btrim(s.nama_lengkap), ''), r.nomor_penyewaan), c.nominal_kandidat, c.penyewaan_id
INTO v_label, v_amount, v_source_parent_id
FROM public.evaluasi_konsekuensi_penyewaan c
JOIN public.penyewaan r ON r.usaha_id = c.usaha_id AND r.penyewaan_id = c.penyewaan_id
LEFT JOIN public.penyewa s ON s.usaha_id = r.usaha_id AND s.penyewa_id = r.penyewa_id
WHERE c.usaha_id = v_event.usaha_id
AND c.evaluasi_konsekuensi_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.payload->>'nomor_penyewaan', v_event.aggregate_id::text);
                    v_title := 'Tinjau biaya tambahan';
                    v_message := 'Ada calon ' ||
                                 CASE v_event.payload->>'jenis_konsekuensi'
                                   WHEN 'late_fee' THEN 'denda keterlambatan'
                                   WHEN 'damage' THEN 'biaya kerusakan'
                                   WHEN 'loss' THEN 'biaya kehilangan'
                                   WHEN 'missing_component' THEN 'biaya komponen kurang'
                                   ELSE 'biaya tambahan'
                                 END ||
                                 CASE WHEN v_amount IS NOT NULL THEN
                                   ' Rp ' || replace(to_char(round(v_amount, 0), 'FM999,999,999,990'), ',', '.')
                                   ELSE ''
                                 END ||
                                 ' untuk penyewaan atas nama ' || v_label || '. Tinjau sebelum ditagihkan.';
                    v_action_target := '/penyewaan/' || coalesce(v_source_parent_id::text, v_event.payload->>'penyewaan_id');

                WHEN 'rental.consequence_reviewed' THEN
                    v_notify := true;
                    SELECT coalesce(nullif(btrim(s.nama_lengkap), ''), r.nomor_penyewaan), c.penyewaan_id
INTO v_label, v_source_parent_id
FROM public.evaluasi_konsekuensi_penyewaan c
JOIN public.penyewaan r ON r.usaha_id = c.usaha_id AND r.penyewaan_id = c.penyewaan_id
LEFT JOIN public.penyewa s ON s.usaha_id = r.usaha_id AND s.penyewa_id = r.penyewa_id
WHERE c.usaha_id = v_event.usaha_id
AND c.evaluasi_konsekuensi_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.aggregate_id::text);
                    v_title := CASE WHEN v_event.payload->>'decision' = 'approve'
                                    THEN 'Biaya tambahan disetujui'
                                    ELSE 'Biaya tambahan ditolak'
                               END;
                    v_message := CASE
                                 WHEN v_event.payload->>'decision' = 'approve' THEN
                                   'Biaya tambahan untuk penyewaan atas nama ' || v_label ||
                                   ' disetujui sebesar Rp ' ||
                                   replace(to_char(round(coalesce(nullif(v_event.payload->>'nominal_disetujui', '')::numeric, 0), 0), 'FM999,999,999,990'), ',', '.') || '.'
                                 ELSE
                                   'Biaya tambahan untuk penyewaan atas nama ' || v_label ||
                                   ' ditolak dan tidak dibebankan.'
                               END;
                    v_action_target := '/penyewaan/' || coalesce(v_source_parent_id::text, v_event.payload->>'penyewaan_id');

                WHEN 'payment.recorded' THEN
                    v_notify := true;
                    SELECT coalesce(nullif(btrim(sp.nama_lengkap), ''), nullif(btrim(sr.nama_lengkap), ''), 'penyewa'), p.amount
INTO v_label, v_amount
FROM public.pembayaran p
LEFT JOIN public.penyewaan r ON r.usaha_id = p.usaha_id AND r.penyewaan_id = p.penyewaan_id
LEFT JOIN public.penyewa sp ON sp.usaha_id = r.usaha_id AND sp.penyewa_id = r.penyewa_id
LEFT JOIN public.reservasi rs ON rs.usaha_id = p.usaha_id AND rs.reservasi_id = p.reservasi_id
LEFT JOIN public.penyewa sr ON sr.usaha_id = rs.usaha_id AND sr.penyewa_id = rs.penyewa_id
WHERE p.usaha_id = v_event.usaha_id
AND p.pembayaran_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.aggregate_id::text);
                    v_title := 'Pembayaran dicatat';
                    v_message := 'Pembayaran Rp ' ||
                                 replace(to_char(round(coalesce(v_amount, 0), 0), 'FM999,999,999,990'), ',', '.') ||
                                 ' dari ' || v_label || ' berhasil dicatat.';
                    v_action_target := '/keuangan/pembayaran/' || v_event.aggregate_id::text;

                WHEN 'expense.recorded' THEN
                    v_notify := true;
                    SELECT coalesce(
                             v_event.payload->>'nomor_pengeluaran',
                             t.nomor_transaksi,
                             e.pengeluaran_id::text
                           ) INTO v_label
                    FROM public.pengeluaran e
                    LEFT JOIN public.transaksi_keuangan t
                      ON t.usaha_id = e.usaha_id
                     AND t.transaksi_keuangan_id = e.transaksi_keuangan_id
                    WHERE e.usaha_id = v_event.usaha_id
                      AND e.pengeluaran_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.aggregate_id::text);
                    v_title := 'Pengeluaran dicatat';
                    v_message := 'Pengeluaran berhasil dicatat. Periksa rincian keuangan bila diperlukan.';
                    v_action_target := '/keuangan/pengeluaran/' || v_event.aggregate_id::text;

                WHEN 'inventory.unit_inspection_pending' THEN
                    v_notify := true;
                    SELECT u.kode_unit INTO v_label
                    FROM public.unit_barang u
                    WHERE u.usaha_id = v_event.usaha_id
                      AND u.unit_barang_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.aggregate_id::text);
                    v_title := 'Unit perlu diperiksa';
                    v_message := 'Unit ' || v_label || ' menunggu pemeriksaan kondisi.';
                    v_action_target := '/inventaris/' || v_event.aggregate_id::text;

                WHEN 'inventory.unit_ready' THEN
                    v_notify := true;
                    SELECT u.kode_unit INTO v_label
                    FROM public.unit_barang u
                    WHERE u.usaha_id = v_event.usaha_id
                      AND u.unit_barang_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.aggregate_id::text);
                    v_title := 'Unit siap disewakan';
                    v_message := 'Unit ' || v_label || ' sudah diperiksa dan siap disewakan.';
                    v_action_target := '/inventaris/' || v_event.aggregate_id::text;

                WHEN 'rental.created' THEN
                    v_notify := true;
                    SELECT coalesce(nullif(btrim(s.nama_lengkap), ''), r.nomor_penyewaan) INTO v_label
FROM public.penyewaan r
LEFT JOIN public.penyewa s ON s.usaha_id = r.usaha_id AND s.penyewa_id = r.penyewa_id
WHERE r.usaha_id = v_event.usaha_id
AND r.penyewaan_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.aggregate_id::text);
                    v_title := 'Penyewaan baru';
                    v_message := 'Penyewaan atas nama ' || v_label || ' baru dibuat. Periksa pembayaran dan jadwal serah-terima.';
                    v_action_target := '/penyewaan/' || v_event.aggregate_id::text;

                WHEN 'payment.completed' THEN
                    v_notify := true;
                    SELECT coalesce(nullif(btrim(s.nama_lengkap), ''), 'penyewa') INTO v_label
FROM public.pembayaran p
JOIN public.penyewaan r ON r.usaha_id = p.usaha_id AND r.penyewaan_id = p.penyewaan_id
LEFT JOIN public.penyewa s ON s.usaha_id = r.usaha_id AND s.penyewa_id = r.penyewa_id
WHERE p.usaha_id = v_event.usaha_id
AND p.pembayaran_id = v_event.aggregate_id
AND p.evaluasi_konsekuensi_id IS NULL
AND p.perpanjangan_sewa_id IS NULL
AND coalesce(nullif(v_event.payload->>'rental_total', '')::numeric, 0) > 0
AND coalesce(nullif(v_event.payload->>'total_paid', '')::numeric, 0) >=
    coalesce(nullif(v_event.payload->>'rental_total', '')::numeric, 0);
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.aggregate_id::text);
                    v_title := 'Sewa lunas';
                    v_message := 'Tagihan sewa atas nama ' || v_label ||
                                 ' lunas: Rp ' ||
                                 replace(to_char(round(coalesce(nullif(v_event.payload->>'total_paid', '')::numeric, 0), 0), 'FM999,999,999,990'), ',', '.') ||
                                 ' dari total tagihan Rp ' ||
                                 replace(to_char(round(coalesce(nullif(v_event.payload->>'rental_total', '')::numeric, 0), 0), 'FM999,999,999,990'), ',', '.') ||
                                 '.';
                    v_action_target := '/keuangan/pembayaran/' || v_event.aggregate_id::text;

                WHEN 'rental.return_due' THEN
                    v_notify := true;
                    SELECT coalesce(nullif(btrim(s.nama_lengkap), ''), r.nomor_penyewaan) INTO v_label
FROM public.penyewaan r
LEFT JOIN public.penyewa s ON s.usaha_id = r.usaha_id AND s.penyewa_id = r.penyewa_id
WHERE r.usaha_id = v_event.usaha_id
AND r.penyewaan_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.aggregate_id::text);
                    v_title := 'Jadwal pengembalian tiba';
                    v_message := 'Penyewaan atas nama ' || v_label || ' jatuh tempo sekarang. Pastikan barang kembali.';
                    v_action_target := '/penyewaan/' || v_event.aggregate_id::text;

                WHEN 'rental.tolerance_started' THEN
                    v_notify := true;
                    SELECT coalesce(nullif(btrim(s.nama_lengkap), ''), r.nomor_penyewaan) INTO v_label
FROM public.penyewaan r
LEFT JOIN public.penyewa s ON s.usaha_id = r.usaha_id AND s.penyewa_id = r.penyewa_id
WHERE r.usaha_id = v_event.usaha_id
AND r.penyewaan_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.aggregate_id::text);
                    v_title := 'Masa toleransi dimulai';
                    v_message := 'Penyewaan atas nama ' || v_label || ' belum kembali sesuai jadwal. Masa toleransi dimulai.';
                    v_action_target := '/penyewaan/' || v_event.aggregate_id::text;

                WHEN 'rental.tolerance_warning_2h' THEN
                    v_notify := true;
                    SELECT coalesce(nullif(btrim(s.nama_lengkap), ''), r.nomor_penyewaan) INTO v_label
FROM public.penyewaan r
LEFT JOIN public.penyewa s ON s.usaha_id = r.usaha_id AND s.penyewa_id = r.penyewa_id
WHERE r.usaha_id = v_event.usaha_id
AND r.penyewaan_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.aggregate_id::text);
                    v_title := 'Sisa toleransi: 2 jam';
                    v_message := 'Penyewaan atas nama ' || v_label || ': sisa toleransi 2 jam. Tindak lanjuti pengembalian.';
                    v_action_target := '/penyewaan/' || v_event.aggregate_id::text;

                WHEN 'rental.tolerance_warning_1h' THEN
                    v_notify := true;
                    SELECT coalesce(nullif(btrim(s.nama_lengkap), ''), r.nomor_penyewaan) INTO v_label
FROM public.penyewaan r
LEFT JOIN public.penyewa s ON s.usaha_id = r.usaha_id AND s.penyewa_id = r.penyewa_id
WHERE r.usaha_id = v_event.usaha_id
AND r.penyewaan_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.aggregate_id::text);
                    v_title := 'Sisa toleransi: 1 jam';
                    v_message := 'Penyewaan atas nama ' || v_label || ': sisa toleransi 1 jam. Tindak lanjuti pengembalian.';
                    v_action_target := '/penyewaan/' || v_event.aggregate_id::text;

                WHEN 'rental.tolerance_warning_30m' THEN
                    v_notify := true;
                    SELECT coalesce(nullif(btrim(s.nama_lengkap), ''), r.nomor_penyewaan) INTO v_label
FROM public.penyewaan r
LEFT JOIN public.penyewa s ON s.usaha_id = r.usaha_id AND s.penyewa_id = r.penyewa_id
WHERE r.usaha_id = v_event.usaha_id
AND r.penyewaan_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.aggregate_id::text);
                    v_title := 'Sisa toleransi: 30 menit';
                    v_message := 'Penyewaan atas nama ' || v_label || ': sisa toleransi 30 menit. Segera tindak lanjuti.';
                    v_action_target := '/penyewaan/' || v_event.aggregate_id::text;

                WHEN 'rental.tolerance_expired' THEN
                    v_notify := true;
                    SELECT coalesce(nullif(btrim(s.nama_lengkap), ''), r.nomor_penyewaan),
u.late_fee_per_hour,
CASE
  WHEN coalesce(u.late_fee_enabled, false) AND coalesce(u.late_fee_per_hour, 0) > 0
  THEN round(ceil(greatest(extract(epoch FROM (now() - r.tolerance_deadline)), 0) / 3600.0) * u.late_fee_per_hour, 2)
  ELSE NULL
END,
r.jadwal_kembali,
r.tolerance_deadline,
r.currency_code,
coalesce(u.late_fee_enabled, false)
INTO v_label, v_rate, v_amount, v_schedule, v_fine_due, v_currency, v_fine_enabled
FROM public.penyewaan r
LEFT JOIN public.penyewa s ON s.usaha_id = r.usaha_id AND s.penyewa_id = r.penyewa_id
JOIN public.usaha u ON u.usaha_id = r.usaha_id
WHERE r.usaha_id = v_event.usaha_id
AND r.penyewaan_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.aggregate_id::text);
                    v_title := 'Toleransi pengembalian habis';
                    v_message := 'Penyewaan atas nama ' || v_label || ' melewati masa toleransi. ' ||
                                 CASE
                                   WHEN v_amount IS NOT NULL AND v_amount > 0 THEN
                                     'Estimasi denda Rp ' ||
                                     replace(to_char(round(v_amount, 0), 'FM999,999,999,990'), ',', '.') ||
                                     ' (' ||
                                     ceil(greatest(extract(epoch FROM (
                                       now() - (SELECT r.tolerance_deadline
                                                FROM public.penyewaan r
                                                WHERE r.usaha_id = v_event.usaha_id
                                                  AND r.penyewaan_id = v_event.aggregate_id)
                                     )), 0) / 3600.0)::bigint::text ||
                                     ' jam keterlambatan, tarif Rp ' ||
                                     replace(to_char(round(v_rate, 0), 'FM999,999,999,990'), ',', '.') ||
                                     '/jam). '
                                   ELSE
                                     'Tarif denda belum aktif. '
                                 END ||
                                 'Estimasi ini belum final. Verifikasi saat pengembalian selesai.';
                    v_action_target := '/penyewaan/' || v_event.aggregate_id::text;

WHEN 'rental.late_fee_applied' THEN
                    v_notify := true;
                    SELECT coalesce(nullif(btrim(s.nama_lengkap), ''), r.nomor_penyewaan) INTO v_label
FROM public.penyewaan r
LEFT JOIN public.penyewa s ON s.usaha_id = r.usaha_id AND s.penyewa_id = r.penyewa_id
WHERE r.usaha_id = v_event.usaha_id
AND r.penyewaan_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.aggregate_id::text);
                    v_title := 'Denda keterlambatan';
                    v_message := 'Penyewaan atas nama ' || v_label || ' terkena denda keterlambatan. Periksa nominal sebelum menagih.';
                    v_action_target := '/penyewaan/' || v_event.aggregate_id::text;

                WHEN 'rental.late_fee_accrual_reminder' THEN
                    v_notify := true;
                    SELECT coalesce(nullif(btrim(s.nama_lengkap), ''), r.nomor_penyewaan) INTO v_label
FROM public.penyewaan r
LEFT JOIN public.penyewa s ON s.usaha_id = r.usaha_id AND s.penyewa_id = r.penyewa_id
WHERE r.usaha_id = v_event.usaha_id
AND r.penyewaan_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.aggregate_id::text);
                    v_amount := coalesce(nullif(v_event.payload->>'late_fee_amount', '')::numeric, 0);
                    v_title := 'Denda terus bertambah';
                    v_message := 'Penyewaan atas nama ' || v_label ||
                                 ' belum dikembalikan setelah masa toleransi. Estimasi denda saat ini Rp ' ||
                                 replace(to_char(round(v_amount, 0), 'FM999,999,999,990'), ',', '.') ||
                                 ' selama ' || coalesce(v_event.payload->>'billable_hours', '0') ||
                                 ' jam keterlambatan (Rp ' ||
                                 replace(to_char(round(coalesce(nullif(v_event.payload->>'late_fee_per_hour', '')::numeric, 0), 0), 'FM999,999,999,990'), ',', '.') ||
                                 '/jam). Nilai akhir diverifikasi saat pengembalian selesai.';
                    v_action_target := '/penyewaan/' || v_event.aggregate_id::text;

                WHEN 'rental.extension_requested' THEN
                    v_notify := true;
                    SELECT coalesce(nullif(btrim(s.nama_lengkap), ''), e.nomor_penyewaan), e.penyewaan_id
INTO v_label, v_source_parent_id
FROM public.penyewaan e
JOIN public.perpanjangan_sewa ext ON ext.usaha_id = e.usaha_id AND ext.penyewaan_id = e.penyewaan_id
LEFT JOIN public.penyewa s ON s.usaha_id = e.usaha_id AND s.penyewa_id = e.penyewa_id
WHERE e.usaha_id = v_event.usaha_id
AND ext.perpanjangan_sewa_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.aggregate_id::text);
                    v_title := 'Permintaan perpanjangan';
                    v_message := 'Penyewaan atas nama ' || v_label || ' meminta tambahan waktu sewa. Tinjau permintaan ini.';
                    v_action_target := '/penyewaan/' || coalesce(v_source_parent_id, v_event.aggregate_id)::text;

                WHEN 'rental.extension_approved' THEN
                    v_notify := true;
                    SELECT coalesce(nullif(btrim(s.nama_lengkap), ''), e.nomor_penyewaan), e.penyewaan_id
INTO v_label, v_source_parent_id
FROM public.penyewaan e
JOIN public.perpanjangan_sewa ext ON ext.usaha_id = e.usaha_id AND ext.penyewaan_id = e.penyewaan_id
LEFT JOIN public.penyewa s ON s.usaha_id = e.usaha_id AND s.penyewa_id = e.penyewa_id
WHERE e.usaha_id = v_event.usaha_id
AND ext.perpanjangan_sewa_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.aggregate_id::text);
                    v_title := 'Perpanjangan disetujui';
                    v_message := 'Perpanjangan untuk penyewaan atas nama ' || v_label || ' disetujui. Jadwal kembali sudah diperbarui.';
                    v_action_target := '/penyewaan/' || coalesce(v_source_parent_id, v_event.aggregate_id)::text;

                WHEN 'rental.extension_rejected' THEN
                    v_notify := true;
                    SELECT coalesce(nullif(btrim(s.nama_lengkap), ''), e.nomor_penyewaan), e.penyewaan_id
INTO v_label, v_source_parent_id
FROM public.penyewaan e
JOIN public.perpanjangan_sewa ext ON ext.usaha_id = e.usaha_id AND ext.penyewaan_id = e.penyewaan_id
LEFT JOIN public.penyewa s ON s.usaha_id = e.usaha_id AND s.penyewa_id = e.penyewa_id
WHERE e.usaha_id = v_event.usaha_id
AND ext.perpanjangan_sewa_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.aggregate_id::text);
                    v_title := 'Perpanjangan ditolak';
                    v_message := 'Perpanjangan untuk penyewaan atas nama ' || v_label || ' ditolak. Jadwal kembali tidak berubah.';
                    v_action_target := '/penyewaan/' || coalesce(v_source_parent_id, v_event.aggregate_id)::text;

                WHEN 'damage.found' THEN
                    v_notify := true;
                    SELECT u.kode_unit, t.deskripsi, t.nominal_potensi_biaya, i.pemeriksaan_id
                      INTO v_label, v_message, v_amount, v_source_parent_id
                    FROM public.temuan_pemeriksaan t
                    JOIN public.pemeriksaan i
                      ON i.usaha_id = t.usaha_id
                     AND i.pemeriksaan_id = t.pemeriksaan_id
                    JOIN public.unit_barang u
                      ON u.usaha_id = i.usaha_id
                     AND u.unit_barang_id = i.unit_barang_id
                    WHERE t.usaha_id = v_event.usaha_id
                      AND t.temuan_pemeriksaan_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, v_event.aggregate_id::text);
                    v_title := 'Temuan kondisi unit';
                    v_message := 'Temuan pada unit ' || v_label || ': ' || coalesce(v_message, 'Kondisi unit perlu diperiksa') || 
                                 CASE WHEN v_amount IS NOT NULL AND v_amount > 0 THEN ' (perkiraan biaya Rp ' || replace(to_char(round(v_amount, 0), 'FM999,999,999,990'), ',', '.') || ')' ELSE '' END;
                    v_action_target := '/pemeriksaan/' || coalesce(v_source_parent_id, v_event.aggregate_id)::text;

                WHEN 'damage.check_scheduled' THEN
                    v_notify := true;
                    v_source_exists := true;
                    v_title := 'Periksa kondisi inventaris';
                    v_message := 'Saatnya memeriksa temuan kerusakan terbaru pada inventaris.';
                    v_action_target := '/inventaris/temuan';

                WHEN 'profit.shared' THEN
                    v_notify := true;
                    SELECT d.amount, a.investor_id INTO v_amount, v_target_user_id
                    FROM public.investor_period_distribution d
                    JOIN public.investor_period_allocation a
                      ON a.usaha_id = d.usaha_id AND a.allocation_id = d.allocation_id
                    WHERE d.usaha_id = v_event.usaha_id
                      AND d.distribution_id = v_event.aggregate_id;
                    v_target_user_type := CASE WHEN v_target_user_id IS NOT NULL THEN 'investor' END;
                    v_source_exists := found;
                    v_title := 'Pembaruan catatan keuangan investor';
                    v_message := 'Pencatatan pemisahan kas untuk alokasi periode telah dibuat. Ini bukan bukti pembayaran eksternal. Detail di menu Keuangan Investor.';
                    v_action_target := '/investor/keuangan/distribusi';

                WHEN 'payout.completed' THEN
                    v_notify := true;
                    SELECT p.destination_name, p.amount,
                           CASE WHEN p.stakeholder_type='investor' THEN p.investor_id
                                WHEN p.stakeholder_type='pengelola' THEN p.pengelola_akun_admin_id END,
                           CASE WHEN p.stakeholder_type='investor' THEN 'investor'
                                WHEN p.stakeholder_type='pengelola' THEN 'admin' END
                      INTO v_label, v_amount, v_target_user_id, v_target_user_type
                    FROM public.investor_stakeholder_payout p
                    WHERE p.usaha_id = v_event.usaha_id
                      AND p.payout_id = v_event.aggregate_id;
                    v_source_exists := found;
                    v_label := coalesce(v_label, 'Stakeholder');
                    v_title := 'Pembayaran dicatat';
                    v_message := 'Pembayaran ke ' || v_label || ' sebesar Rp ' || 
                                 coalesce(v_amount::text, '0') || ' sudah dicatat.';
                    v_action_target := '/investor/keuangan/payout';

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
                        usaha_id, penerima_akun_admin_id, jenis, prioritas, judul, pesan,
                        sumber_type, sumber_id, action_type, action_target, outbox_event_id
                    )
                    VALUES (
                        v_event.usaha_id, v_admin_id, 'system', 'normal', v_title, v_message,
                        v_event.event_type, v_event.aggregate_id, 'navigate', v_action_target, v_event.outbox_event_id
                    )
                    ON CONFLICT DO NOTHING;
                    v_recipient_count := v_recipient_count + 1;
                END LOOP;

                IF v_event.event_type IN (
                    'rental.return_due', 'rental.tolerance_started', 'rental.tolerance_warning_2h',
                    'rental.tolerance_warning_1h', 'rental.tolerance_warning_30m', 'rental.tolerance_expired',
                    'rental.created', 'rental.picked_up', 'return.completed', 'payment.recorded',
                    'rental.late_fee_applied', 'rental.late_fee_accrual_reminder',
                    'damage.found', 'rental.extension_requested', 'payment.completed',
                    'rental.consequence_review_required', 'rental.consequence_reviewed'
                ) THEN
                    BEGIN
                        v_push_result := public.send_fcm_push_notification(
                            p_usaha_id => v_event.usaha_id,
                            p_user_type => 'admin',
                            p_title => v_title,
                            p_body => v_message,
                            p_data => jsonb_build_object(
                                'event_type', v_event.event_type,
                                'aggregate_type', v_event.aggregate_type,
                                'aggregate_id', v_event.aggregate_id::text,
                                'action_target', v_action_target,
                                'outbox_event_id', v_event.outbox_event_id::text
                            )
                            || CASE v_event.event_type
                                WHEN 'rental.tolerance_expired' THEN
                                  jsonb_build_object(
                                    'kind', 'rental_fine_start',
                                    'rentalId', v_event.aggregate_id::text,
                                    'nomor', coalesce(v_event.payload->>'rental_number', v_label),
                                    'jadwalKembali', v_schedule,
                                    'toleranceDeadline', v_fine_due,
                                    'ratePerHour', v_rate,
                                    'currencyCode', v_currency,
                                    'enabled', v_fine_enabled
                                  )
                                WHEN 'return.completed' THEN
                                  jsonb_build_object(
                                    'kind', 'rental_fine_stop',
                                    'rentalId', v_source_parent_id::text
                                  )
                                ELSE '{}'::jsonb
                              END,
                            p_priority => 'high'
                        );
                        v_fcm_sent := v_fcm_sent + coalesce(nullif(v_push_result->>'queued', '')::integer, 0);
                        v_event_fcm_attempted := v_event_fcm_attempted OR coalesce(nullif(v_push_result->>'tokens_found','')::integer,0) > 0;
                    EXCEPTION WHEN OTHERS THEN
                        v_fcm_failed := v_fcm_failed + 1;
                        RAISE;
                    END;
                END IF;

                IF v_event.event_type IN ('profit.shared', 'payout.completed')
                   AND v_target_user_type IS NOT NULL
                   AND v_target_user_id IS NOT NULL THEN
                    BEGIN
                        v_push_result := public.send_fcm_push_notification_to_user(
                            p_usaha_id => v_event.usaha_id,
                            p_user_type => v_target_user_type,
                            p_user_id => v_target_user_id,
                            p_title => v_title,
                            p_body => v_message,
                            p_data => jsonb_build_object(
                                'event_type', v_event.event_type,
                                'aggregate_type', v_event.aggregate_type,
                                'aggregate_id', v_event.aggregate_id::text,
                                'action_target', v_action_target,
                                'outbox_event_id', v_event.outbox_event_id::text
                            ),
                            p_priority => 'high'
                        );
                        v_fcm_sent := v_fcm_sent + coalesce(nullif(v_push_result->>'queued', '')::integer, 0);
                        v_event_fcm_attempted := v_event_fcm_attempted OR coalesce(nullif(v_push_result->>'tokens_found','')::integer,0) > 0;
                    EXCEPTION WHEN OTHERS THEN
                        v_fcm_failed := v_fcm_failed + 1;
                        RAISE;
                    END;
                END IF;

                -- WEBHOOK DISPATCH (production)
                BEGIN
                    v_webhook_result := public.dispatch_webhook_event(
                        v_event.outbox_event_id,
                        v_event.event_type,
                        v_event.payload
                    );
                    v_event_webhook_dispatched := coalesce(nullif(v_webhook_result->>'dispatched', '')::integer, 0);
                    v_webhook_dispatched := v_webhook_dispatched + v_event_webhook_dispatched;
                EXCEPTION WHEN OTHERS THEN
                    RAISE;
                END;

                IF v_recipient_count = 0 AND NOT v_event_fcm_attempted AND v_event_webhook_dispatched = 0 THEN
                    RAISE EXCEPTION 'NO_ACTIVE_RECIPIENT';
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
        'fcm_queued', v_fcm_sent,
        'fcm_failed', v_fcm_failed,
        'webhook_dispatched', v_webhook_dispatched,
        'limit', v_limit
    );
END;
$function$;
