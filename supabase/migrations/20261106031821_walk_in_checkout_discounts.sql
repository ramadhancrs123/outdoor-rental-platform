-- Walk-in checkout: stack manual rental discounts with checkout-wide loyalty discounts.
ALTER TABLE public.penyewaan_diskon
  DROP CONSTRAINT penyewaan_diskon_source_check;
ALTER TABLE public.penyewaan_diskon
  ADD CONSTRAINT penyewaan_diskon_source_check
  CHECK (source IN ('loyalty', 'manual', 'combined'));

ALTER TABLE public.checkout
  ADD COLUMN IF NOT EXISTS subtotal_penjualan_gross numeric(14,2),
  ADD COLUMN IF NOT EXISTS discount_penjualan_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loyalty_rental_discount_amount numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.checkout
  ADD CONSTRAINT checkout_sale_discount_math_check CHECK (
    discount_penjualan_amount >= 0
    AND (subtotal_penjualan_gross IS NULL OR (
      subtotal_penjualan_gross >= discount_penjualan_amount
      AND subtotal_penjualan = round(subtotal_penjualan_gross - discount_penjualan_amount, 2)
    ))
    AND (subtotal_penjualan_gross IS NOT NULL OR discount_penjualan_amount = 0)
  );

UPDATE public.checkout c
SET manual_discount_amount = CASE WHEN d.source = 'manual' THEN d.actual_amount ELSE 0 END,
    loyalty_rental_discount_amount = CASE WHEN d.source = 'loyalty' THEN d.actual_amount ELSE 0 END
FROM public.penyewaan_diskon d
WHERE d.usaha_id = c.usaha_id
  AND d.penyewaan_id = c.penyewaan_id;

ALTER TABLE public.penjualan
  ADD COLUMN IF NOT EXISTS subtotal_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS discount_amount numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.penjualan
  ADD CONSTRAINT penjualan_checkout_discount_math_check CHECK (
    discount_amount >= 0
    AND (subtotal_amount IS NULL OR (
      subtotal_amount >= discount_amount
      AND total_amount = round(subtotal_amount - discount_amount, 2)
    ))
    AND (subtotal_amount IS NOT NULL OR discount_amount = 0)
  );

CREATE TABLE public.checkout_discount_snapshots (
  checkout_discount_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usaha_id uuid NOT NULL,
  penyewaan_id uuid NOT NULL,
  checkout_id uuid,
  actor_akun_admin_id uuid NOT NULL,
  request_id uuid NOT NULL,
  rental_subtotal numeric(14,2) NOT NULL CHECK (rental_subtotal >= 0),
  sale_subtotal_gross numeric(14,2) NOT NULL DEFAULT 0 CHECK (sale_subtotal_gross >= 0),
  manual_discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (manual_discount_amount >= 0),
  manual_reason_code text,
  manual_reason_note text,
  loyalty_applied boolean NOT NULL DEFAULT false,
  loyalty_basis_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (loyalty_basis_amount >= 0),
  loyalty_recommended_discount_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (loyalty_recommended_discount_percent BETWEEN 0 AND 100),
  loyalty_recommended_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (loyalty_recommended_amount >= 0),
  loyalty_actual_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (loyalty_actual_amount >= 0),
  loyalty_rental_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (loyalty_rental_amount >= 0),
  loyalty_sale_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (loyalty_sale_amount >= 0),
  completed_rental_count integer NOT NULL DEFAULT 0 CHECK (completed_rental_count >= 0),
  minimum_completed_rentals integer,
  program_loyalitas_id uuid,
  program_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checkout_discount_snapshots_tenant_rental_fk
    FOREIGN KEY (usaha_id, penyewaan_id) REFERENCES public.penyewaan(usaha_id, penyewaan_id) ON DELETE RESTRICT,
  CONSTRAINT checkout_discount_snapshots_checkout_fk
    FOREIGN KEY (checkout_id) REFERENCES public.checkout(checkout_id) ON DELETE RESTRICT,
  CONSTRAINT checkout_discount_snapshots_actor_fk
    FOREIGN KEY (usaha_id, actor_akun_admin_id) REFERENCES public.keanggotaan_usaha(usaha_id, akun_admin_id) ON DELETE RESTRICT,
  CONSTRAINT checkout_discount_snapshots_program_fk
    FOREIGN KEY (usaha_id, program_loyalitas_id) REFERENCES public.program_loyalitas(usaha_id, program_loyalitas_id) ON DELETE RESTRICT,
  CONSTRAINT checkout_discount_snapshots_amount_math_check CHECK (
    loyalty_actual_amount = loyalty_rental_amount + loyalty_sale_amount
    AND (manual_discount_amount = 0 OR length(btrim(coalesce(manual_reason_code, ''))) > 0)
  ),
  CONSTRAINT checkout_discount_snapshots_rental_unique UNIQUE (usaha_id, penyewaan_id)
);
CREATE INDEX checkout_discount_snapshots_checkout_idx
  ON public.checkout_discount_snapshots (usaha_id, checkout_id) WHERE checkout_id IS NOT NULL;
ALTER TABLE public.checkout_discount_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.checkout_discount_snapshots FROM PUBLIC, anon, authenticated, service_role;

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
  v_manual_enabled boolean := false;
  v_loyalty_apply boolean := false;
  v_manual_amount numeric(14,2) := 0;
  v_manual_reason_code text;
  v_manual_reason_note text;
  v_policy public.kebijakan_diskon_checkout%ROWTYPE;
  v_has_policy boolean := false;
  v_loyalty_snapshot jsonb;
  v_loyalty_basis numeric(14,2) := 0;
  v_loyalty_recommended numeric(14,2) := 0;
  v_loyalty_actual numeric(14,2) := 0;
  v_loyalty_rental numeric(14,2) := 0;
  v_loyalty_sale numeric(14,2) := 0;
  v_rental_after_manual numeric(14,2) := 0;
  v_sale_gross numeric(14,2) := 0;
  v_sale_net numeric(14,2) := 0;
  v_sale_discount numeric(14,2) := 0;
  v_sale public.penjualan%ROWTYPE;
  v_sale_payment public.penjualan_pembayaran%ROWTYPE;
  v_sale_movement public.pergerakan_akun_keuangan%ROWTYPE;
  v_sale_payment_count integer := 0;
  v_sale_movement_count integer := 0;
  v_timezone text;
  v_business_year text;
  v_transaction_number bigint;
  v_payment_number bigint;
  v_replacement_transaction_id uuid;
  v_replacement_payment_id uuid;
  v_replacement_payment_number text;
  v_recorded_rental_paid numeric(14,2) := 0;
  v_total_paid numeric(14,2) := 0;
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

  IF p_discount_request->>'mode' = 'combined' THEN
    v_manual_enabled := coalesce((p_discount_request->'manual'->>'enabled')::boolean, false);
    v_loyalty_apply := coalesce((p_discount_request->'loyalty'->>'apply')::boolean, false);
    v_manual_amount := coalesce(nullif(p_discount_request->'manual'->>'amount', '')::numeric, 0);
    v_manual_reason_code := coalesce(nullif(btrim(p_discount_request->'manual'->>'reason_code'), ''), 'other');
    v_manual_reason_note := nullif(btrim(coalesce(p_discount_request->'manual'->>'reason_note', '')), '');

    IF v_manual_amount < 0 OR (NOT v_manual_enabled AND v_manual_amount <> 0) THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: nilai diskon manual tidak konsisten dengan status penerapan'
        USING ERRCODE = '22023';
    END IF;
    IF v_manual_enabled THEN
      PERFORM app_private.require_usaha_permission(p_usaha_id, 'checkout_discount.apply');
      SELECT * INTO v_policy
      FROM public.kebijakan_diskon_checkout
      WHERE usaha_id = p_usaha_id;
      v_has_policy := FOUND;
      IF NOT v_has_policy OR NOT v_policy.manual_discount_enabled THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: diskon manual belum diaktifkan pada kebijakan usaha'
          USING ERRCODE = '23514';
      END IF;
      IF v_manual_amount <= 0 OR v_manual_amount > v_subtotal THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: diskon manual harus lebih besar dari nol dan tidak melebihi subtotal rental'
          USING ERRCODE = '22023';
      END IF;
      IF v_policy.require_reason AND v_manual_reason_note IS NULL THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: alasan pemberian diskon wajib diisi'
          USING ERRCODE = '22023';
      END IF;
      IF NOT (v_manual_reason_code = ANY(v_policy.allowed_reason_codes)) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: kategori alasan diskon tidak diizinkan oleh kebijakan usaha'
          USING ERRCODE = '22023';
      END IF;
      IF v_policy.max_discount_amount IS NOT NULL AND v_manual_amount > v_policy.max_discount_amount THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: nominal diskon melebihi batas kebijakan usaha'
          USING ERRCODE = '23514';
      END IF;
      IF v_policy.max_discount_percent IS NOT NULL AND v_subtotal > 0
         AND (v_manual_amount / v_subtotal * 100) > v_policy.max_discount_percent THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: persentase diskon melebihi batas kebijakan usaha'
          USING ERRCODE = '23514';
      END IF;
    ELSIF v_manual_amount > 0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: diskon manual belum diaktifkan untuk checkout ini'
        USING ERRCODE = '22023';
    END IF;

    IF v_loyalty_apply THEN
      PERFORM app_private.require_usaha_permission(p_usaha_id, 'checkout_discount.apply');
    END IF;

    SELECT * INTO v_checkout
    FROM public.checkout c
    WHERE c.usaha_id = p_usaha_id
      AND c.penyewaan_id = p_penyewaan_id
    FOR UPDATE;
    v_has_checkout := FOUND;

    IF v_has_checkout THEN
      IF v_checkout.source <> 'mixed' OR v_checkout.penjualan_id IS NULL THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: checkout tidak memiliki pasangan penjualan mixed yang valid'
          USING ERRCODE = '23514';
      END IF;
      IF v_checkout.discount_rental_amount <> 0
         OR coalesce(v_checkout.discount_penjualan_amount, 0) <> 0
         OR v_checkout.subtotal_penjualan_gross IS NOT NULL THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: diskon checkout sudah pernah diterapkan'
          USING ERRCODE = '23505';
      END IF;
      v_sale_gross := round(v_checkout.subtotal_penjualan, 2);
      SELECT * INTO v_sale
      FROM public.penjualan s
      WHERE s.usaha_id = p_usaha_id
        AND s.penjualan_id = v_checkout.penjualan_id
      FOR UPDATE;
      IF NOT FOUND OR v_sale.source <> 'mixed' THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: transaksi penjualan pada checkout tidak valid'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    v_rental_after_manual := round(v_subtotal - v_manual_amount, 2);
    v_loyalty_basis := round(v_rental_after_manual + v_sale_gross, 2);
    v_loyalty_snapshot := app_private.resolve_loyalty_discount_snapshot(
      p_usaha_id, v_rental.penyewa_id, v_loyalty_basis
    );
    v_loyalty_recommended := coalesce((v_loyalty_snapshot->>'recommended_amount')::numeric, 0);
    IF v_loyalty_apply THEN
      IF coalesce((v_loyalty_snapshot->>'eligible')::boolean, false) IS DISTINCT FROM true
         OR v_loyalty_recommended <= 0 THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: penyewa belum memenuhi syarat program loyalitas atau nilai rekomendasi nol'
          USING ERRCODE = '23514';
      END IF;
      v_loyalty_actual := v_loyalty_recommended;
    END IF;

    IF v_loyalty_actual < 0 OR v_loyalty_actual > v_loyalty_basis THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: nilai loyalitas berada di luar total checkout setelah diskon manual'
        USING ERRCODE = '22023';
    END IF;

    IF v_loyalty_basis > 0 AND v_loyalty_actual >= v_loyalty_basis THEN
      v_loyalty_sale := v_sale_gross;
      v_loyalty_rental := v_rental_after_manual;
    ELSIF v_loyalty_basis > 0 THEN
      -- Allocate proportionally; any cent remainder is assigned to the rental domain.
      v_loyalty_sale := least(v_sale_gross, round(v_loyalty_actual * v_sale_gross / v_loyalty_basis, 2));
      v_loyalty_rental := round(v_loyalty_actual - v_loyalty_sale, 2);
      IF v_loyalty_rental > v_rental_after_manual THEN
        v_loyalty_rental := v_rental_after_manual;
        v_loyalty_sale := round(v_loyalty_actual - v_loyalty_rental, 2);
      END IF;
    END IF;

    IF v_loyalty_rental > v_rental_after_manual OR v_loyalty_sale > v_sale_gross THEN
      RAISE EXCEPTION 'INTERNAL_ERROR: alokasi loyalitas melebihi nilai transaksi per domain'
        USING ERRCODE = 'P0001';
    END IF;

    v_discount := round(v_manual_amount + v_loyalty_rental, 2);
    v_total := round(v_subtotal - v_discount, 2);
    v_sale_discount := v_loyalty_sale;
    v_sale_net := round(v_sale_gross - v_sale_discount, 2);

    SELECT coalesce(sum(p.amount), 0)::numeric(14,2)
    INTO v_recorded_rental_paid
    FROM public.pembayaran p
    WHERE p.usaha_id = p_usaha_id
      AND p.penyewaan_id = p_penyewaan_id
      AND p.status = 'recorded';
    IF v_recorded_rental_paid > v_total THEN
      RAISE EXCEPTION 'BUSINESS_CONFLICT: pembayaran rental tercatat melebihi kewajiban setelah diskon checkout'
        USING ERRCODE = '23514';
    END IF;

    IF v_has_checkout AND v_sale_discount > 0 THEN
      SELECT count(*)::integer INTO v_sale_payment_count
      FROM public.penjualan_pembayaran pp
      WHERE pp.usaha_id = p_usaha_id
        AND pp.penjualan_id = v_sale.penjualan_id
        AND pp.status = 'recorded';
      IF v_sale_payment_count <> 1 THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: pembayaran penjualan mixed harus memiliki tepat satu pembayaran tercatat untuk alokasi diskon'
          USING ERRCODE = '23514';
      END IF;
      SELECT * INTO v_sale_payment
      FROM public.penjualan_pembayaran pp
      WHERE pp.usaha_id = p_usaha_id
        AND pp.penjualan_id = v_sale.penjualan_id
        AND pp.status = 'recorded'
      FOR UPDATE;

      SELECT count(*)::integer INTO v_sale_movement_count
      FROM public.pergerakan_akun_keuangan m
      WHERE m.usaha_id = p_usaha_id
        AND m.sumber_type = 'payment'
        AND m.sumber_id = v_sale_payment.penjualan_pembayaran_id
        AND m.status = 'recorded';
      IF v_sale_movement_count <> 1 THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: pergerakan kas penjualan tidak memiliki tepat satu catatan aktif; checkout tidak dapat disesuaikan otomatis'
          USING ERRCODE = '23514';
      END IF;
      SELECT * INTO v_sale_movement
      FROM public.pergerakan_akun_keuangan m
      WHERE m.usaha_id = p_usaha_id
        AND m.sumber_type = 'payment'
        AND m.sumber_id = v_sale_payment.penjualan_pembayaran_id
        AND m.status = 'recorded'
      FOR UPDATE;

      IF v_sale_payment.amount <> v_sale_gross
         OR v_sale_movement.amount <> v_sale_gross
         OR v_sale_movement.akun_keuangan_id <> v_sale_payment.akun_keuangan_id
         OR v_sale_movement.transaksi_keuangan_id IS DISTINCT FROM v_sale_payment.transaksi_keuangan_id
         OR v_sale_movement.arah <> 'masuk'
         OR NOT EXISTS (
           SELECT 1
           FROM public.transaksi_keuangan t
           WHERE t.usaha_id = p_usaha_id
             AND t.transaksi_keuangan_id = v_sale_payment.transaksi_keuangan_id
             AND t.amount = v_sale_gross
             AND t.currency_code = 'IDR'
             AND t.jenis = 'sales_payment'
             AND t.arah = 'income'
             AND t.sumber_type = 'sale'
             AND t.sumber_id = v_sale.penjualan_id
             AND t.status = 'recorded'
         ) THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: catatan pembayaran penjualan tidak konsisten dengan subtotal; alokasi diskon dibatalkan agar saldo kas tidak berubah tanpa rekonsiliasi'
          USING ERRCODE = '23514';
      END IF;

      -- Financial source facts are immutable. Reverse the original gross payment and
      -- create a replacement payment for the net sale amount instead of editing it.
      UPDATE public.penjualan_pembayaran
      SET status = 'reversed', updated_at = now()
      WHERE usaha_id = p_usaha_id
        AND penjualan_pembayaran_id = v_sale_payment.penjualan_pembayaran_id;
      UPDATE public.transaksi_keuangan
      SET status = 'reversed', updated_at = now()
      WHERE usaha_id = p_usaha_id
        AND transaksi_keuangan_id = v_sale_payment.transaksi_keuangan_id
        AND status = 'recorded';
      UPDATE public.pergerakan_akun_keuangan
      SET status = 'reversed', updated_at = now()
      WHERE usaha_id = p_usaha_id
        AND pergerakan_akun_keuangan_id = v_sale_movement.pergerakan_akun_keuangan_id
        AND status = 'recorded';

      IF v_sale_net > 0 THEN
        SELECT timezone INTO v_timezone
        FROM public.usaha
        WHERE usaha_id = p_usaha_id AND status = 'active';
        IF v_timezone IS NULL THEN
          RAISE EXCEPTION 'NOT_FOUND: zona waktu usaha aktif tidak ditemukan' USING ERRCODE = 'P0002';
        END IF;
        v_business_year := to_char(now() AT TIME ZONE v_timezone, 'YYYY');
        v_transaction_number := app_private.next_business_number(p_usaha_id, 'TRX', v_business_year);
        v_payment_number := app_private.next_business_number(p_usaha_id, 'SP', v_business_year);
        v_replacement_transaction_id := gen_random_uuid();
        v_replacement_payment_id := gen_random_uuid();
        v_replacement_payment_number := 'SP-' || v_business_year || '-' || lpad(v_payment_number::text, 4, '0');

        INSERT INTO public.transaksi_keuangan (
          transaksi_keuangan_id, usaha_id, nomor_transaksi, jenis, arah,
          tanggal_transaksi, amount, currency_code, sumber_type, sumber_id,
          status, catatan
        ) VALUES (
          v_replacement_transaction_id, p_usaha_id, v_transaction_number::text,
          'sales_payment', 'income', v_sale_payment.dibayar_at,
          v_sale_net, 'IDR', 'sale', v_sale.penjualan_id, 'recorded',
          'Pembayaran bersih setelah alokasi diskon checkout ' || v_checkout.nomor_checkout
        );

        INSERT INTO public.penjualan_pembayaran (
          penjualan_pembayaran_id, usaha_id, penjualan_id, transaksi_keuangan_id,
          akun_keuangan_id, nomor_pembayaran, jenis, metode, amount, currency_code,
          dibayar_at, dicatat_by_admin_id, reference_text, catatan, status
        ) VALUES (
          v_replacement_payment_id, p_usaha_id, v_sale.penjualan_id, v_replacement_transaction_id,
          v_sale_payment.akun_keuangan_id, v_replacement_payment_number,
          'pembayaran_penjualan', v_sale_payment.metode, v_sale_net, 'IDR',
          v_sale_payment.dibayar_at, v_sale_payment.dicatat_by_admin_id,
          v_sale_payment.reference_text,
          'Pembayaran bersih setelah alokasi diskon checkout ' || v_checkout.nomor_checkout,
          'recorded'
        );

        INSERT INTO public.pergerakan_akun_keuangan (
          usaha_id, akun_keuangan_id, transaksi_keuangan_id, arah, amount,
          mata_uang, terjadi_at, sumber_type, sumber_id, status,
          dicatat_by_admin_id, request_id, catatan
        ) VALUES (
          p_usaha_id, v_sale_payment.akun_keuangan_id, v_replacement_transaction_id,
          'masuk', v_sale_net, 'IDR', v_sale_payment.dibayar_at,
          'payment', v_replacement_payment_id, 'recorded',
          v_sale_payment.dicatat_by_admin_id, p_request_id,
          'Penerimaan bersih penjualan checkout ' || v_checkout.nomor_checkout
        );
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
      UPDATE public.penjualan
      SET subtotal_amount = v_sale_gross,
          discount_amount = v_sale_discount,
          total_amount = v_sale_net,
          gross_profit = CASE WHEN total_hpp IS NULL THEN NULL ELSE v_sale_net - total_hpp END,
          payment_status = 'paid',
          updated_at = now()
      WHERE usaha_id = p_usaha_id
        AND penjualan_id = v_sale.penjualan_id
      RETURNING * INTO v_sale;

      v_total_paid := round(v_sale_net + v_recorded_rental_paid, 2);
      IF v_total_paid > round(v_total + v_sale_net, 2) THEN
        RAISE EXCEPTION 'BUSINESS_CONFLICT: pembayaran gabungan melebihi kewajiban setelah alokasi diskon'
          USING ERRCODE = '23514';
      END IF;
      UPDATE public.checkout
      SET subtotal_rental = v_subtotal,
          discount_rental_amount = v_discount,
          manual_discount_amount = v_manual_amount,
          loyalty_rental_discount_amount = v_loyalty_rental,
          subtotal_penjualan_gross = v_sale_gross,
          discount_penjualan_amount = v_sale_discount,
          subtotal_penjualan = v_sale_net,
          total_amount = round(v_total + v_sale_net, 2),
          amount_paid = v_total_paid,
          payment_status = CASE
            WHEN v_total_paid = round(v_total + v_sale_net, 2) THEN 'paid'
            WHEN v_total_paid > 0 THEN 'partial'
            ELSE 'unpaid'
          END
      WHERE usaha_id = p_usaha_id
        AND checkout_id = v_checkout.checkout_id
      RETURNING * INTO v_checkout;
    END IF;

    IF v_manual_amount > 0 OR v_loyalty_actual > 0 THEN
      INSERT INTO public.checkout_discount_snapshots (
        usaha_id, penyewaan_id, checkout_id, actor_akun_admin_id, request_id,
        rental_subtotal, sale_subtotal_gross, manual_discount_amount,
        manual_reason_code, manual_reason_note, loyalty_applied,
        loyalty_basis_amount, loyalty_recommended_discount_percent,
        loyalty_recommended_amount, loyalty_actual_amount,
        loyalty_rental_amount, loyalty_sale_amount,
        completed_rental_count, minimum_completed_rentals,
        program_loyalitas_id, program_version
      ) VALUES (
        p_usaha_id, p_penyewaan_id,
        CASE WHEN v_has_checkout THEN v_checkout.checkout_id ELSE NULL END,
        v_admin_id, p_request_id, v_subtotal, v_sale_gross,
        v_manual_amount, CASE WHEN v_manual_amount > 0 THEN v_manual_reason_code ELSE NULL END,
        CASE WHEN v_manual_amount > 0 THEN v_manual_reason_note ELSE NULL END,
        v_loyalty_apply, v_loyalty_basis,
        coalesce(nullif(v_loyalty_snapshot->>'recommended_discount_percent', '')::numeric, 0),
        v_loyalty_recommended, v_loyalty_actual,
        v_loyalty_rental, v_loyalty_sale,
        coalesce(nullif(v_loyalty_snapshot->>'completed_rental_count', '')::integer, 0),
        nullif(v_loyalty_snapshot->>'minimum_completed_rentals', '')::integer,
        nullif(v_loyalty_snapshot->>'program_loyalitas_id', '')::uuid,
        nullif(v_loyalty_snapshot->>'program_version', '')::integer
      );

      IF v_discount > 0 THEN
        INSERT INTO public.penyewaan_diskon (
          usaha_id, penyewaan_id, source, program_loyalitas_id,
          program_version, completed_rental_count, minimum_completed_rentals,
          recommended_discount_percent, recommended_amount, actual_amount,
          bonus_amount, reason_code, reason_note, actor_akun_admin_id, request_id
        ) VALUES (
          p_usaha_id, p_penyewaan_id,
          CASE
            WHEN v_manual_amount > 0 AND v_loyalty_actual > 0 THEN 'combined'
            WHEN v_manual_amount > 0 THEN 'manual'
            ELSE 'loyalty'
          END,
          nullif(v_loyalty_snapshot->>'program_loyalitas_id', '')::uuid,
          nullif(v_loyalty_snapshot->>'program_version', '')::integer,
          coalesce(nullif(v_loyalty_snapshot->>'completed_rental_count', '')::integer, 0),
          nullif(v_loyalty_snapshot->>'minimum_completed_rentals', '')::integer,
          coalesce(nullif(v_loyalty_snapshot->>'recommended_discount_percent', '')::numeric, 0),
          CASE
            WHEN v_loyalty_apply AND v_loyalty_basis > 0
              THEN least(v_rental_after_manual, round(v_loyalty_recommended * v_rental_after_manual / v_loyalty_basis, 2))
            ELSE 0
          END,
          v_discount,
          0,
          CASE
            WHEN v_manual_amount > 0 AND v_loyalty_actual > 0 THEN 'combined_manual_loyalty'
            WHEN v_manual_amount > 0 THEN v_manual_reason_code
            ELSE 'loyalty_model_a'
          END,
          CASE WHEN v_manual_amount > 0 THEN v_manual_reason_note ELSE NULL END,
          v_admin_id,
          p_request_id
        );
      END IF;

      INSERT INTO public.audit_log (
        usaha_id, actor_auth_user_id, actor_akun_admin_id, action,
        entity_type, entity_id, source_application, request_id, change_summary
      ) VALUES (
        p_usaha_id, auth.uid(), v_admin_id, 'apply_mixed_checkout_discounts',
        'penyewaan', p_penyewaan_id, 'admin-command', p_request_id,
        jsonb_build_object(
          'checkout_id', CASE WHEN v_has_checkout THEN v_checkout.checkout_id ELSE NULL END,
          'rental_subtotal', v_subtotal,
          'sale_subtotal_gross', v_sale_gross,
          'manual_discount_amount', v_manual_amount,
          'loyalty_basis_amount', v_loyalty_basis,
          'loyalty_recommended_amount', v_loyalty_recommended,
          'loyalty_actual_amount', v_loyalty_actual,
          'loyalty_rental_amount', v_loyalty_rental,
          'loyalty_sale_amount', v_loyalty_sale,
          'rental_discount_amount', v_discount,
          'rental_total_amount', v_total,
          'sale_total_amount', v_sale_net,
          'checkout_total_amount', CASE WHEN v_has_checkout THEN v_checkout.total_amount ELSE v_total END
        )
      );
    END IF;

    v_snapshot := jsonb_build_object(
      'source', 'combined',
      'manual_amount', v_manual_amount,
      'manual_reason_code', CASE WHEN v_manual_amount > 0 THEN v_manual_reason_code ELSE NULL END,
      'manual_reason_note', v_manual_reason_note,
      'loyalty_applied', v_loyalty_apply,
      'loyalty_basis_amount', v_loyalty_basis,
      'loyalty_recommended_amount', v_loyalty_recommended,
      'loyalty_actual_amount', v_loyalty_actual,
      'loyalty_rental_amount', v_loyalty_rental,
      'loyalty_sale_amount', v_loyalty_sale,
      'completed_rental_count', v_loyalty_snapshot->'completed_rental_count',
      'minimum_completed_rentals', v_loyalty_snapshot->'minimum_completed_rentals',
      'recommended_discount_percent', v_loyalty_snapshot->'recommended_discount_percent',
      'program_version', v_loyalty_snapshot->'program_version'
    );

    RETURN jsonb_build_object(
      'penyewaan_id', p_penyewaan_id,
      'subtotal_amount', v_subtotal,
      'discount_amount', v_discount,
      'total_amount', v_total,
      'discount_snapshot', v_snapshot,
      'checkout_id', CASE WHEN v_has_checkout THEN v_checkout.checkout_id ELSE NULL END,
      'checkout_total_amount', CASE WHEN v_has_checkout THEN v_checkout.total_amount ELSE NULL END,
      'subtotal_penjualan_gross', v_sale_gross,
      'discount_penjualan_amount', v_sale_discount,
      'subtotal_penjualan', v_sale_net,
      'amount_paid', CASE WHEN v_has_checkout THEN v_checkout.amount_paid ELSE v_recorded_rental_paid END,
      'payment_status', CASE WHEN v_has_checkout THEN v_checkout.payment_status ELSE NULL END
    );
  END IF;

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
        manual_discount_amount = CASE WHEN v_snapshot->>'source' = 'manual' THEN v_discount ELSE 0 END,
        loyalty_rental_discount_amount = CASE WHEN v_snapshot->>'source' = 'loyalty' THEN v_discount ELSE 0 END,
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
