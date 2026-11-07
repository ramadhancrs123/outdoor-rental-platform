-- Dashboard total transaction count: rentals + unified retail/mixed checkouts.
-- Replaces the existing analytics function without changing its authorization contract.

-- Dashboard overview: daily cash movement and promotion KPIs.
-- Read-only reporting contract. Does not create or mutate financial facts.

CREATE OR REPLACE FUNCTION app_private.finance_dashboard_analytics(
  p_usaha_id uuid,
  p_start_date date,
  p_end_date date
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
  v_currency_codes text[];
  v_cashflow jsonb;
  v_payment_summary jsonb;
  v_promo_active_catalog bigint := 0;
  v_promo_active_packages bigint := 0;
  v_loyalty_active boolean := false;
  v_promo_usage_count bigint := 0;
  v_total_transaction_count bigint := 0;
  v_discount_by_currency jsonb := '[]'::jsonb;
BEGIN
  v_admin_id := app_private.assert_finance_admin(p_usaha_id);

  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date <= p_start_date THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: periode dashboard tidak valid'
      USING ERRCODE = '22023';
  END IF;

  IF p_end_date - p_start_date > 366 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: periode grafik maksimal 366 hari'
      USING ERRCODE = '22023';
  END IF;

  SELECT u.timezone
  INTO v_timezone
  FROM public.usaha u
  WHERE u.usaha_id = p_usaha_id
    AND u.status = 'active';

  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan'
      USING ERRCODE = 'P0002';
  END IF;

  v_start_at := p_start_date::timestamp AT TIME ZONE v_timezone;
  v_end_at := p_end_date::timestamp AT TIME ZONE v_timezone;

  SELECT coalesce(array_agg(x.currency_code ORDER BY x.currency_code), ARRAY['IDR']::text[])
  INTO v_currency_codes
  FROM (
    SELECT DISTINCT upper(btrim(t.currency_code::text)) AS currency_code
    FROM public.transaksi_keuangan t
    WHERE t.usaha_id = p_usaha_id
      AND t.status = 'recorded'
      AND t.tanggal_transaksi >= v_start_at
      AND t.tanggal_transaksi < v_end_at
    UNION
    SELECT DISTINCT upper(btrim(p.currency_code::text)) AS currency_code
    FROM (
      SELECT currency_code, dibayar_at
      FROM public.pembayaran
      WHERE usaha_id = p_usaha_id AND status = 'recorded'
        AND dibayar_at >= v_start_at AND dibayar_at < v_end_at
      UNION ALL
      SELECT currency_code, dibayar_at
      FROM public.penjualan_pembayaran
      WHERE usaha_id = p_usaha_id AND status = 'recorded'
        AND dibayar_at >= v_start_at AND dibayar_at < v_end_at
    ) p
  ) x
  WHERE x.currency_code IS NOT NULL AND x.currency_code <> '';

  WITH days AS (
    SELECT d::date AS business_date
    FROM generate_series(
      p_start_date::timestamp,
      LEAST(p_end_date - 1, (now() AT TIME ZONE v_timezone)::date)::timestamp,
      interval '1 day'
    ) d
  ),
  movement AS (
    SELECT
      (t.tanggal_transaksi AT TIME ZONE v_timezone)::date AS business_date,
      upper(btrim(t.currency_code::text)) AS currency_code,
      sum(t.amount) FILTER (WHERE t.arah = 'income') AS income,
      sum(t.amount) FILTER (WHERE t.arah = 'expense') AS expense,
      sum(t.amount) FILTER (
        WHERE t.arah = 'income' AND t.sumber_type IN ('rental', 'reservation')
      ) AS rental_income,
      sum(t.amount) FILTER (
        WHERE t.arah = 'income' AND t.sumber_type = 'sale'
      ) AS retail_income,
      sum(t.amount) FILTER (
        WHERE t.arah = 'expense' AND t.sumber_type = 'purchase'
      ) AS purchase_expense,
      sum(t.amount) FILTER (
        WHERE t.arah = 'expense' AND coalesce(t.sumber_type, '') <> 'purchase'
      ) AS other_expense
    FROM public.transaksi_keuangan t
    WHERE t.usaha_id = p_usaha_id
      AND t.status = 'recorded'
      AND t.tanggal_transaksi >= v_start_at
      AND t.tanggal_transaksi < v_end_at
    GROUP BY 1, 2
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'date', to_char(d.business_date, 'YYYY-MM-DD'),
      'currency_code', c.currency_code,
      'income', coalesce(m.income, 0),
      'expense', coalesce(m.expense, 0),
      'rental_income', coalesce(m.rental_income, 0),
      'retail_income', coalesce(m.retail_income, 0),
      'purchase_expense', coalesce(m.purchase_expense, 0),
      'other_expense', coalesce(m.other_expense, 0),
      'net', coalesce(m.income, 0) - coalesce(m.expense, 0)
    )
    ORDER BY c.currency_code, d.business_date
  ), '[]'::jsonb)
  INTO v_cashflow
  FROM days d
  CROSS JOIN unnest(v_currency_codes) AS c(currency_code)
  LEFT JOIN movement m
    ON m.business_date = d.business_date
   AND m.currency_code = c.currency_code;

  WITH payments AS (
    SELECT
      (p.dibayar_at AT TIME ZONE v_timezone)::date AS business_date,
      upper(btrim(p.currency_code::text)) AS currency_code,
      p.amount
    FROM public.pembayaran p
    WHERE p.usaha_id = p_usaha_id
      AND p.status = 'recorded'
      AND p.dibayar_at >= v_start_at
      AND p.dibayar_at < v_end_at
    UNION ALL
    SELECT
      (p.dibayar_at AT TIME ZONE v_timezone)::date,
      upper(btrim(p.currency_code::text)),
      p.amount
    FROM public.penjualan_pembayaran p
    WHERE p.usaha_id = p_usaha_id
      AND p.status = 'recorded'
      AND p.dibayar_at >= v_start_at
      AND p.dibayar_at < v_end_at
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'currency_code', currency_code,
      'amount', amount,
      'count', payment_count
    )
    ORDER BY currency_code
  ), '[]'::jsonb)
  INTO v_payment_summary
  FROM (
    SELECT currency_code, sum(amount) AS amount, count(*) AS payment_count
    FROM payments
    GROUP BY currency_code
  ) grouped_payments;

  -- Count business transactions by creation date. Retail POS and mixed
  -- checkouts are counted once through checkout; their linked rental record
  -- is excluded below. Standalone rentals are counted as one transaction.
  SELECT
    (
      SELECT count(*)
      FROM public.checkout c
      WHERE c.usaha_id = p_usaha_id
        AND c.status = 'completed'
        AND c.created_at >= v_start_at
        AND c.created_at < v_end_at
    )
    +
    (
      SELECT count(*)
      FROM public.penyewaan r
      WHERE r.usaha_id = p_usaha_id
        AND r.created_at >= v_start_at
        AND r.created_at < v_end_at
        AND r.status IN (
          'confirmed',
          'ready_for_pickup',
          'active',
          'return_in_progress',
          'completed',
          'returned'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.checkout c
          WHERE c.usaha_id = r.usaha_id
            AND c.penyewaan_id = r.penyewaan_id
            AND c.source = 'mixed'
        )
    )
  INTO v_total_transaction_count;

  SELECT count(*)
  INTO v_promo_active_catalog
  FROM public.promosi_katalog p
  WHERE p.usaha_id = p_usaha_id
    AND p.status = 'active'
    AND p.ended_at IS NULL
    AND p.started_at <= now()
    AND (p.valid_until IS NULL OR p.valid_until > now());

  SELECT count(*)
  INTO v_promo_active_packages
  FROM public.promosi_paket_sewa p
  WHERE p.usaha_id = p_usaha_id
    AND p.status = 'active'
    AND p.ended_at IS NULL
    AND p.started_at <= now();

  SELECT coalesce(bool_or(
    p.is_enabled
    AND p.valid_from <= now()
    AND (p.valid_until IS NULL OR p.valid_until > now())
  ), false)
  INTO v_loyalty_active
  FROM public.program_loyalitas p
  WHERE p.usaha_id = p_usaha_id;

  WITH discount_events AS (
    SELECT
      'sale'::text AS source_type,
      s.penjualan_id AS source_id,
      upper(btrim(d.currency_code::text)) AS currency_code,
      sum(coalesce(d.nominal_diskon_snapshot, 0)) AS discount_amount
    FROM public.detail_penjualan d
    JOIN public.penjualan s
      ON s.usaha_id = d.usaha_id
     AND s.penjualan_id = d.penjualan_id
    WHERE d.usaha_id = p_usaha_id
      AND s.status = 'completed'
      AND s.created_at >= v_start_at
      AND s.created_at < v_end_at
      AND (
        d.promosi_katalog_id IS NOT NULL
        OR coalesce(d.nominal_diskon_snapshot, 0) > 0
      )
    GROUP BY s.penjualan_id, upper(btrim(d.currency_code::text))

    UNION ALL

    SELECT
      'rental'::text,
      r.penyewaan_id,
      upper(btrim(d.currency_code::text)),
      sum(
        CASE
          WHEN d.promosi_paket_id IS NOT NULL AND pp.promosi_paket_id IS NOT NULL
            THEN round(
              (pp.harga_normal - pp.harga_promo)
              * d.jumlah
              * greatest(
                  1,
                  ceil(
                    extract(epoch FROM (r.jadwal_kembali - r.jadwal_mulai))
                    / nullif(
                        CASE lower(btrim(coalesce(d.durasi_unit_snapshot, t.durasi_unit)))
                          WHEN 'jam' THEN coalesce(d.durasi_nilai_snapshot, t.durasi_nilai) * 3600
                          WHEN 'hari' THEN coalesce(d.durasi_nilai_snapshot, t.durasi_nilai) * 86400
                          WHEN 'minggu' THEN coalesce(d.durasi_nilai_snapshot, t.durasi_nilai) * 604800
                          ELSE NULL
                        END,
                        0
                      )
                  )
                ),
              2
            )
          ELSE coalesce(d.nominal_diskon_snapshot, 0)
        END
      )
    FROM public.detail_penyewaan d
    JOIN public.penyewaan r
      ON r.usaha_id = d.usaha_id
     AND r.penyewaan_id = d.penyewaan_id
    LEFT JOIN public.promosi_paket_sewa pp
      ON pp.usaha_id = d.usaha_id
     AND pp.promosi_paket_id = d.promosi_paket_id
    LEFT JOIN public.tarif_sewa t
      ON t.usaha_id = d.usaha_id
     AND t.tarif_sewa_id = d.tarif_sewa_id
    WHERE d.usaha_id = p_usaha_id
      AND r.created_at >= v_start_at
      AND r.created_at < v_end_at
      AND r.status NOT IN ('cancelled', 'canceled')
      AND (
        d.promosi_katalog_id IS NOT NULL
        OR d.promosi_paket_id IS NOT NULL
        OR coalesce(d.nominal_diskon_snapshot, 0) > 0
      )
    GROUP BY r.penyewaan_id, upper(btrim(d.currency_code::text))

    UNION ALL

    SELECT
      'rental'::text,
      r.penyewaan_id,
      upper(btrim(r.currency_code::text)),
      sum(coalesce(d.actual_amount, 0))
    FROM public.penyewaan_diskon d
    JOIN public.penyewaan r
      ON r.usaha_id = d.usaha_id
     AND r.penyewaan_id = d.penyewaan_id
    WHERE d.usaha_id = p_usaha_id
      AND r.created_at >= v_start_at
      AND r.created_at < v_end_at
      AND r.status NOT IN ('cancelled', 'canceled')
      AND coalesce(d.actual_amount, 0) > 0
    GROUP BY r.penyewaan_id, upper(btrim(r.currency_code::text))
  ),
  transaction_promos AS (
    SELECT source_type, source_id, currency_code, sum(discount_amount) AS discount_amount
    FROM discount_events
    GROUP BY source_type, source_id, currency_code
  )
  SELECT
    coalesce((
      SELECT count(*)
      FROM (
        SELECT DISTINCT source_type, source_id
        FROM transaction_promos
      ) used_transactions
    ), 0),
    coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'currency_code', currency_code,
          'amount', discount_amount
        )
        ORDER BY currency_code
      )
      FROM (
        SELECT currency_code, sum(discount_amount) AS discount_amount
        FROM transaction_promos
        GROUP BY currency_code
      ) discount_totals
    ), '[]'::jsonb)
  INTO v_promo_usage_count, v_discount_by_currency;

  -- Include a currency that has discount activity even when no cash was
  -- received in that currency during the selected period.
  SELECT coalesce(
    array_agg(DISTINCT currency_code ORDER BY currency_code),
    ARRAY['IDR']::text[]
  )
  INTO v_currency_codes
  FROM (
    SELECT unnest(v_currency_codes) AS currency_code
    UNION
    SELECT item->>'currency_code'
    FROM jsonb_array_elements(v_discount_by_currency) AS discount_currency(item)
  ) expanded_currencies
  WHERE currency_code IS NOT NULL AND currency_code <> '';

  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'start_date', p_start_date,
      'end_date_exclusive', p_end_date,
      'timezone', v_timezone
    ),
    'currencies', to_jsonb(v_currency_codes),
    'cashflow', v_cashflow,
    'payment_summary', v_payment_summary,
    'total_transaction_count', v_total_transaction_count,
    'promotions', jsonb_build_object(
      'active_catalog_count', v_promo_active_catalog,
      'active_package_count', v_promo_active_packages,
      'loyalty_active', v_loyalty_active,
      'active_count', v_promo_active_catalog + v_promo_active_packages
        + CASE WHEN v_loyalty_active THEN 1 ELSE 0 END,
      'used_transaction_count', v_promo_usage_count,
      'discount_by_currency', v_discount_by_currency
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.finance_dashboard_analytics(uuid,date,date)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.finance_dashboard_analytics(uuid,date,date)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.finance_dashboard_analytics(
  p_usaha_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
  SELECT app_private.finance_dashboard_analytics(p_usaha_id, p_start_date, p_end_date);
$function$;

REVOKE ALL ON FUNCTION public.finance_dashboard_analytics(uuid,date,date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_dashboard_analytics(uuid,date,date)
  TO authenticated;
