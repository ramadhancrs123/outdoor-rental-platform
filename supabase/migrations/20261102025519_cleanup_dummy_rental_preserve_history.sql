-- Safely retire the specifically identified operational test rental without deleting immutable business history.
-- The associated test payment is voided through the finance correction command in the same transaction.
CREATE OR REPLACE FUNCTION app_private.command_cleanup_dummy_rental(
  p_usaha_id uuid,
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
  v_admin_id uuid;
  v_rental public.penyewaan%rowtype;
  v_payment public.pembayaran%rowtype;
  v_assignment_count integer;
  v_detail_count integer;
  v_payment_count integer;
  v_movement_count integer;
  v_finance_correction jsonb;
  v_idempotency_id uuid;
  v_existing_hash text;
  v_existing_response jsonb;
  v_request_hash text;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_void_reason text := 'Pembayaran pada RNT-DUMMY-001 dibatalkan karena merupakan transaksi uji internal, bukan transaksi penyewaan pelanggan.';
  v_response jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user required' USING ERRCODE = '28000';
  END IF;
  IF p_usaha_id IS NULL OR v_key IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: usaha_id, idempotency_key, dan request_id wajib diisi' USING ERRCODE = '22023';
  END IF;

  v_admin_id := app_private.assert_finance_admin(p_usaha_id);
  v_request_hash := md5(jsonb_build_object(
    'usaha_id', p_usaha_id,
    'rental_number', 'RNT-DUMMY-001',
    'cleanup_version', 1
  )::text);

  INSERT INTO public.idempotency_key (
    usaha_id, actor_auth_user_id, key, command_name, request_hash
  )
  VALUES (
    p_usaha_id, v_auth_user_id, v_key, 'cleanup_dummy_rental', v_request_hash
  )
  ON CONFLICT (usaha_id, actor_auth_user_id, command_name, key) DO NOTHING
  RETURNING idempotency_key_id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT response_body, request_hash
      INTO v_existing_response, v_existing_hash
    FROM public.idempotency_key
    WHERE usaha_id = p_usaha_id
      AND actor_auth_user_id = v_auth_user_id
      AND command_name = 'cleanup_dummy_rental'
      AND key = v_key;

    IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: idempotency key sudah digunakan untuk payload berbeda'
        USING ERRCODE = '23505';
    END IF;
    IF v_existing_response IS NOT NULL THEN
      RETURN v_existing_response;
    END IF;
    RAISE EXCEPTION 'UNKNOWN_OUTCOME: cleanup idempotency record exists without response'
      USING ERRCODE = '40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_usaha_id::text || ':RNT-DUMMY-001', 0));

  SELECT *
    INTO v_rental
  FROM public.penyewaan
  WHERE usaha_id = p_usaha_id
    AND nomor_penyewaan = 'RNT-DUMMY-001'
    AND catatan ILIKE 'DUMMY TEST%'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: RNT-DUMMY-001 dengan marker DUMMY TEST tidak ditemukan'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_rental.status <> 'active'
     OR v_rental.actual_pickup_at IS NULL
     OR v_rental.actual_return_started_at IS NOT NULL
     OR v_rental.actual_return_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: rental dummy tidak berada pada keadaan aktivasi uji yang diharapkan'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer
    INTO v_detail_count
  FROM public.detail_penyewaan
  WHERE usaha_id = p_usaha_id AND penyewaan_id = v_rental.penyewaan_id;

  SELECT count(*)::integer
    INTO v_assignment_count
  FROM public.penetapan_unit pu
  JOIN public.detail_penyewaan dp
    ON dp.usaha_id = pu.usaha_id
   AND dp.detail_penyewaan_id = pu.detail_penyewaan_id
  WHERE dp.usaha_id = p_usaha_id
    AND dp.penyewaan_id = v_rental.penyewaan_id
    AND pu.status = 'assigned';

  IF v_detail_count <> 2 OR v_assignment_count <> 1 THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: struktur rental dummy berubah (detail %, assignment aktif %)',
      v_detail_count, v_assignment_count USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.penetapan_unit pu
    JOIN public.detail_penyewaan dp
      ON dp.usaha_id = pu.usaha_id
     AND dp.detail_penyewaan_id = pu.detail_penyewaan_id
    JOIN public.unit_barang ub
      ON ub.usaha_id = pu.usaha_id
     AND ub.unit_barang_id = pu.unit_barang_id
    WHERE dp.usaha_id = p_usaha_id
      AND dp.penyewaan_id = v_rental.penyewaan_id
      AND pu.status = 'assigned'
      AND ub.status <> 'ready'
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: ada unit dummy yang tidak berada pada status ready; rekonsiliasi inventaris manual diperlukan'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.serah_terima
    WHERE usaha_id = p_usaha_id AND penyewaan_id = v_rental.penyewaan_id
  ) OR EXISTS (
    SELECT 1 FROM public.pengembalian
    WHERE usaha_id = p_usaha_id AND penyewaan_id = v_rental.penyewaan_id
  ) OR EXISTS (
    SELECT 1 FROM public.perpanjangan_sewa
    WHERE usaha_id = p_usaha_id AND penyewaan_id = v_rental.penyewaan_id
  ) OR EXISTS (
    SELECT 1 FROM public.evaluasi_konsekuensi_penyewaan
    WHERE usaha_id = p_usaha_id AND penyewaan_id = v_rental.penyewaan_id
  ) OR EXISTS (
    SELECT 1 FROM public.riwayat_toleransi_penyewaan
    WHERE usaha_id = p_usaha_id AND penyewaan_id = v_rental.penyewaan_id
  ) OR EXISTS (
    SELECT 1 FROM public.riwayat_unit
    WHERE usaha_id = p_usaha_id
      AND sumber_type = 'penyewaan'
      AND sumber_id = v_rental.penyewaan_id
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: rental memiliki histori serah-terima/pengembalian/operasional; gunakan workflow terminasi operasional'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer
    INTO v_payment_count
  FROM public.pembayaran
  WHERE usaha_id = p_usaha_id AND penyewaan_id = v_rental.penyewaan_id;

  IF v_payment_count <> 1 THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: jumlah payment dummy bukan satu (ditemukan %)', v_payment_count
      USING ERRCODE = '23514';
  END IF;

  SELECT *
    INTO v_payment
  FROM public.pembayaran
  WHERE usaha_id = p_usaha_id AND penyewaan_id = v_rental.penyewaan_id
  FOR UPDATE;

  IF v_payment.status <> 'recorded'
     OR v_payment.amount <> v_rental.total_amount
     OR v_payment.transaksi_keuangan_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.transaksi_keuangan t
       WHERE t.usaha_id = p_usaha_id
         AND t.transaksi_keuangan_id = v_payment.transaksi_keuangan_id
         AND t.sumber_type = 'rental'
         AND t.sumber_id = v_rental.penyewaan_id
         AND t.jenis = 'rental_payment'
         AND t.arah = 'income'
         AND t.amount = v_payment.amount
         AND t.status = 'recorded'
     ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: payment/ledger tidak sesuai dengan transaksi dummy yang diharapkan'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer
    INTO v_movement_count
  FROM public.pergerakan_akun_keuangan
  WHERE usaha_id = p_usaha_id
    AND transaksi_keuangan_id = v_payment.transaksi_keuangan_id
    AND sumber_type = 'payment'
    AND sumber_id = v_payment.pembayaran_id
    AND arah = 'masuk'
    AND amount = v_payment.amount
    AND status = 'recorded';

  IF v_movement_count <> 1
     OR EXISTS (
       SELECT 1 FROM public.pengembalian_dana_pembayaran
       WHERE usaha_id = p_usaha_id AND pembayaran_id = v_payment.pembayaran_id
     )
     OR EXISTS (
       SELECT 1 FROM public.keuangan_koreksi
       WHERE usaha_id = p_usaha_id
         AND target_type = 'payment'
         AND target_id = v_payment.pembayaran_id
     ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: histori ledger/refund payment dummy tidak sesuai untuk void otomatis'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pengeluaran
    WHERE usaha_id = p_usaha_id AND transaksi_keuangan_id = v_payment.transaksi_keuangan_id
  ) OR EXISTS (
    SELECT 1 FROM public.transfer_akun_keuangan
    WHERE usaha_id = p_usaha_id AND transaksi_keuangan_id = v_payment.transaksi_keuangan_id
  ) OR EXISTS (
    SELECT 1 FROM public.investor_entitlement_transfer
    WHERE usaha_id = p_usaha_id AND transaksi_keuangan_id = v_payment.transaksi_keuangan_id
  ) OR EXISTS (
    SELECT 1 FROM public.investor_stakeholder_payout
    WHERE usaha_id = p_usaha_id AND transaksi_keuangan_id = v_payment.transaksi_keuangan_id
  ) THEN
    RAISE EXCEPTION 'BUSINESS_CONFLICT: transaksi keuangan memiliki dependency non-payment'
      USING ERRCODE = '23514';
  END IF;

  v_finance_correction := app_private.command_correct_payment(
    p_usaha_id,
    v_payment.pembayaran_id,
    'void',
    v_void_reason,
    v_key || ':void-payment',
    p_request_id
  );

  UPDATE public.penetapan_unit pu
  SET status = 'cancelled',
      dibatalkan_at = now(),
      catatan = concat_ws(E'\n', nullif(btrim(pu.catatan), ''), 'RNT-DUMMY-001 dibatalkan: bukan serah-terima pelanggan.')
  FROM public.detail_penyewaan dp
  WHERE pu.usaha_id = dp.usaha_id
    AND pu.detail_penyewaan_id = dp.detail_penyewaan_id
    AND dp.usaha_id = p_usaha_id
    AND dp.penyewaan_id = v_rental.penyewaan_id
    AND pu.status = 'assigned';

  UPDATE public.qr_penyewaan
  SET status_qr = 'dicabut',
      diperbarui_at = now()
  WHERE usaha_id = p_usaha_id
    AND penyewaan_id = v_rental.penyewaan_id
    AND status_qr = 'aktif';

  -- The timestamp came from the erroneous test activation; there is no
  -- serah_terima or rental-sourced unit history, and all assigned units are ready.
  -- Clear the false pickup marker in the same update that moves the rental to cancelled.
  UPDATE public.penyewaan
  SET status = 'cancelled',
      actual_pickup_at = NULL,
      catatan = concat_ws(E'\n', nullif(btrim(catatan), ''), 'Cleanup terverifikasi: dummy internal dibatalkan tanpa serah-terima fisik.')
  WHERE usaha_id = p_usaha_id
    AND penyewaan_id = v_rental.penyewaan_id
    AND nomor_penyewaan = 'RNT-DUMMY-001';

  INSERT INTO public.audit_log (
    usaha_id, actor_auth_user_id, actor_akun_admin_id, action, entity_type, entity_id,
    source_application, request_id, change_summary, reason
  )
  VALUES (
    p_usaha_id, v_auth_user_id, v_admin_id, 'cleanup_dummy_rental',
    'penyewaan', v_rental.penyewaan_id, 'admin-command', p_request_id,
    jsonb_build_object(
      'nomor_penyewaan', v_rental.nomor_penyewaan,
      'previous_status', v_rental.status,
      'previous_actual_pickup_at', v_rental.actual_pickup_at,
      'status_after', 'cancelled',
      'actual_pickup_at_after', NULL,
      'details_preserved', v_detail_count,
      'assignments_cancelled', v_assignment_count,
      'qr_revoked', true,
      'payment_correction', v_finance_correction
    ),
    'Pembersihan rental dummy atas permintaan admin; seluruh histori immutable dipertahankan dan payment uji di-void melalui command finance.'
  );

  INSERT INTO public.outbox_event (
    usaha_id, event_type, aggregate_type, aggregate_id, payload
  )
  VALUES (
    p_usaha_id, 'rental.cancelled', 'penyewaan', v_rental.penyewaan_id,
    jsonb_build_object(
      'penyewaan_id', v_rental.penyewaan_id,
      'nomor_penyewaan', v_rental.nomor_penyewaan,
      'reason', 'dummy_test_cleanup',
      'payment_status', 'voided'
    )
  );

  v_response := jsonb_build_object(
    'state', 'cancelled',
    'penyewaan_id', v_rental.penyewaan_id,
    'nomor_penyewaan', v_rental.nomor_penyewaan,
    'payment_id', v_payment.pembayaran_id,
    'payment_status', 'voided',
    'finance_correction', v_finance_correction,
    'assignment_count_cancelled', v_assignment_count,
    'qr_status', 'dicabut'
  );

  UPDATE public.idempotency_key
  SET response_status = 200, response_body = v_response
  WHERE idempotency_key_id = v_idempotency_id;

  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.command_cleanup_dummy_rental(uuid,text,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.command_cleanup_dummy_rental(uuid,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.command_cleanup_dummy_rental(
  p_usaha_id uuid,
  p_idempotency_key text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.command_cleanup_dummy_rental($1,$2,$3);
$function$;

REVOKE ALL ON FUNCTION public.command_cleanup_dummy_rental(uuid,text,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.command_cleanup_dummy_rental(uuid,text,uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
