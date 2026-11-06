-- Finance retail read model: preserve separate source ledgers and the shared cash-account model.
-- This migration only expands read/reporting paths; it does not mutate rental transactions.

CREATE OR REPLACE FUNCTION app_private.finance_purchase_analysis(
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
  v_currency_totals jsonb;
  v_by_supplier jsonb;
  v_by_product jsonb;
  v_by_status jsonb;
  v_purchase_count bigint := 0;
  v_total_purchase_value numeric := 0;
  v_linked_recorded_expense numeric := 0;
  v_linked_expense_count bigint := 0;
BEGIN
  v_admin_id := app_private.assert_finance_admin(p_usaha_id);

  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date <= p_start_date THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: periode harus valid dan end-exclusive' USING ERRCODE='22023';
  END IF;

  SELECT u.timezone INTO v_timezone
  FROM public.usaha u
  WHERE u.usaha_id = p_usaha_id AND u.status = 'active';

  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  v_start_at := (p_start_date::text || ' 00:00:00 ' || v_timezone)::timestamptz;
  v_end_at := (p_end_date::text || ' 00:00:00 ' || v_timezone)::timestamptz;

  SELECT count(*), coalesce(sum(p.total_amount), 0)
  INTO v_purchase_count, v_total_purchase_value
  FROM public.pembelian p
  WHERE p.usaha_id = p_usaha_id
    AND p.tanggal_pembelian >= p_start_date
    AND p.tanggal_pembelian < p_end_date;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'currency_code', x.currency_code,
    'purchase_count', x.purchase_count,
    'total_purchase_value', x.total_purchase_value
  ) ORDER BY x.currency_code), '[]'::jsonb)
  INTO v_currency_totals
  FROM (
    SELECT p.currency_code, count(*)::bigint AS purchase_count,
           coalesce(sum(p.total_amount), 0) AS total_purchase_value
    FROM public.pembelian p
    WHERE p.usaha_id = p_usaha_id
      AND p.tanggal_pembelian >= p_start_date AND p.tanggal_pembelian < p_end_date
    GROUP BY p.currency_code
  ) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'pemasok_id', x.pemasok_id,
    'nama_pemasok', x.nama_pemasok,
    'purchase_count', x.purchase_count,
    'total_purchase_value', x.total_purchase_value
  ) ORDER BY x.total_purchase_value DESC, x.nama_pemasok), '[]'::jsonb)
  INTO v_by_supplier
  FROM (
    SELECT p.pemasok_id, coalesce(s.nama, 'Pemasok tidak teridentifikasi') AS nama_pemasok,
           count(*)::bigint AS purchase_count, coalesce(sum(p.total_amount), 0) AS total_purchase_value
    FROM public.pembelian p
    LEFT JOIN public.pemasok s ON s.pemasok_id = p.pemasok_id AND s.usaha_id = p.usaha_id
    WHERE p.usaha_id = p_usaha_id
      AND p.tanggal_pembelian >= p_start_date AND p.tanggal_pembelian < p_end_date
    GROUP BY p.pemasok_id, s.nama
  ) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'barang_id', x.barang_id,
    'varian_barang_id', x.varian_barang_id,
    'detail_count', x.detail_count,
    'quantity', x.quantity,
    'total_purchase_value', x.total_purchase_value,
    'average_unit_price', x.average_unit_price
  ) ORDER BY x.total_purchase_value DESC), '[]'::jsonb)
  INTO v_by_product
  FROM (
    SELECT d.barang_id, d.varian_barang_id, count(*)::bigint AS detail_count,
           coalesce(sum(d.jumlah), 0) AS quantity,
           coalesce(sum(d.subtotal), 0) AS total_purchase_value,
           CASE WHEN sum(d.jumlah) = 0 THEN NULL ELSE sum(d.subtotal) / sum(d.jumlah) END AS average_unit_price
    FROM public.detail_pembelian d
    JOIN public.pembelian p ON p.pembelian_id = d.pembelian_id AND p.usaha_id = d.usaha_id
    WHERE d.usaha_id = p_usaha_id
      AND p.tanggal_pembelian >= p_start_date AND p.tanggal_pembelian < p_end_date
    GROUP BY d.barang_id, d.varian_barang_id
  ) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'status', x.status,
    'purchase_count', x.purchase_count,
    'total_purchase_value', x.total_purchase_value
  ) ORDER BY x.status), '[]'::jsonb)
  INTO v_by_status
  FROM (
    SELECT coalesce(p.status, 'unknown') AS status, count(*)::bigint AS purchase_count,
           coalesce(sum(p.total_amount), 0) AS total_purchase_value
    FROM public.pembelian p
    WHERE p.usaha_id = p_usaha_id
      AND p.tanggal_pembelian >= p_start_date AND p.tanggal_pembelian < p_end_date
    GROUP BY p.status
  ) x;

  SELECT count(*), coalesce(sum(t.amount), 0)
  INTO v_linked_expense_count, v_linked_recorded_expense
  FROM public.transaksi_keuangan t
  WHERE t.usaha_id = p_usaha_id
    AND t.status = 'recorded'
    AND t.arah = 'expense'
    AND t.sumber_type = 'purchase'
    AND t.tanggal_transaksi >= v_start_at
    AND t.tanggal_transaksi < v_end_at;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('start_date', p_start_date, 'end_date_exclusive', p_end_date, 'timezone', v_timezone),
    'purchase_count', v_purchase_count,
    'total_purchase_value', v_total_purchase_value,
    'currency_totals', v_currency_totals,
    'by_supplier', v_by_supplier,
    'by_product', v_by_product,
    'by_status', v_by_status,
    'linked_recorded_expense', v_linked_recorded_expense,
    'linked_recorded_expense_count', v_linked_expense_count,
    'source_note', 'Nilai pembelian berasal dari fakta procurement; linked recorded expense berasal dari transaksi Finance dengan source purchase. Pembelian tidak otomatis berarti pembayaran atau cash out.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.finance_purchase_analysis(uuid,date,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.finance_purchase_analysis(uuid,date,date) TO authenticated;

-- Payment history is a read-only union over two source subledgers. The source tables remain independent.
CREATE OR REPLACE FUNCTION app_private.finance_payment_page(
  p_usaha_id uuid,
  p_start_date date,
  p_end_date date,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
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
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint := 0;
  v_items jsonb := '[]'::jsonb;
BEGIN
  v_admin_id := app_private.assert_finance_admin(p_usaha_id);
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date <= p_start_date THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: periode tidak valid' USING ERRCODE='22023';
  END IF;

  SELECT u.timezone INTO v_timezone
  FROM public.usaha u
  WHERE u.usaha_id = p_usaha_id AND u.status = 'active';
  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: usaha aktif tidak ditemukan' USING ERRCODE='P0002';
  END IF;

  v_start_at := (p_start_date::text || ' 00:00:00 ' || v_timezone)::timestamptz;
  v_end_at := (p_end_date::text || ' 00:00:00 ' || v_timezone)::timestamptz;

  WITH all_payments AS (
    SELECT
      p.pembayaran_id,
      p.usaha_id,
      p.reservasi_id,
      p.penyewaan_id,
      NULL::uuid AS penjualan_id,
      NULL::text AS nomor_penjualan,
      p.transaksi_keuangan_id,
      p.nomor_pembayaran,
      p.jenis,
      p.metode,
      p.amount,
      p.currency_code,
      p.dibayar_at,
      p.dicatat_by_admin_id,
      p.reference_text,
      p.catatan,
      p.status,
      p.created_at,
      p.updated_at,
      'rental'::text AS payment_source_type,
      CASE
        WHEN p.reservasi_id IS NOT NULL THEN 'Reservasi ' || coalesce(r.nomor_reservasi, p.reservasi_id::text)
        WHEN p.penyewaan_id IS NOT NULL THEN 'Penyewaan ' || coalesce(se.nomor_penyewaan, p.penyewaan_id::text)
        ELSE 'Pembayaran rental'
      END AS source_label,
      t.nomor_transaksi
    FROM public.pembayaran p
    LEFT JOIN public.reservasi r
      ON r.usaha_id = p.usaha_id AND r.reservasi_id = p.reservasi_id
    LEFT JOIN public.penyewaan se
      ON se.usaha_id = p.usaha_id AND se.penyewaan_id = p.penyewaan_id
    LEFT JOIN public.transaksi_keuangan t
      ON t.usaha_id = p.usaha_id AND t.transaksi_keuangan_id = p.transaksi_keuangan_id
    WHERE p.usaha_id = p_usaha_id
      AND p.dibayar_at >= v_start_at AND p.dibayar_at < v_end_at

    UNION ALL

    SELECT
      pp.penjualan_pembayaran_id AS pembayaran_id,
      pp.usaha_id,
      NULL::uuid AS reservasi_id,
      NULL::uuid AS penyewaan_id,
      pp.penjualan_id,
      s.nomor_penjualan,
      pp.transaksi_keuangan_id,
      pp.nomor_pembayaran,
      pp.jenis,
      pp.metode,
      pp.amount,
      pp.currency_code,
      pp.dibayar_at,
      pp.dicatat_by_admin_id,
      pp.reference_text,
      pp.catatan,
      pp.status,
      pp.created_at,
      pp.updated_at,
      'sale'::text AS payment_source_type,
      'Penjualan ' || s.nomor_penjualan AS source_label,
      t.nomor_transaksi
    FROM public.penjualan_pembayaran pp
    JOIN public.penjualan s
      ON s.usaha_id = pp.usaha_id AND s.penjualan_id = pp.penjualan_id
    LEFT JOIN public.transaksi_keuangan t
      ON t.usaha_id = pp.usaha_id AND t.transaksi_keuangan_id = pp.transaksi_keuangan_id
    WHERE pp.usaha_id = p_usaha_id
      AND pp.dibayar_at >= v_start_at AND pp.dibayar_at < v_end_at
  )
  SELECT count(*) INTO v_total FROM all_payments;

  WITH all_payments AS (
    SELECT
      p.pembayaran_id,
      p.usaha_id,
      p.reservasi_id,
      p.penyewaan_id,
      NULL::uuid AS penjualan_id,
      NULL::text AS nomor_penjualan,
      p.transaksi_keuangan_id,
      p.nomor_pembayaran,
      p.jenis,
      p.metode,
      p.amount,
      p.currency_code,
      p.dibayar_at,
      p.dicatat_by_admin_id,
      p.reference_text,
      p.catatan,
      p.status,
      p.created_at,
      p.updated_at,
      'rental'::text AS payment_source_type,
      CASE
        WHEN p.reservasi_id IS NOT NULL THEN 'Reservasi ' || coalesce(r.nomor_reservasi, p.reservasi_id::text)
        WHEN p.penyewaan_id IS NOT NULL THEN 'Penyewaan ' || coalesce(se.nomor_penyewaan, p.penyewaan_id::text)
        ELSE 'Pembayaran rental'
      END AS source_label,
      t.nomor_transaksi
    FROM public.pembayaran p
    LEFT JOIN public.reservasi r
      ON r.usaha_id = p.usaha_id AND r.reservasi_id = p.reservasi_id
    LEFT JOIN public.penyewaan se
      ON se.usaha_id = p.usaha_id AND se.penyewaan_id = p.penyewaan_id
    LEFT JOIN public.transaksi_keuangan t
      ON t.usaha_id = p.usaha_id AND t.transaksi_keuangan_id = p.transaksi_keuangan_id
    WHERE p.usaha_id = p_usaha_id
      AND p.dibayar_at >= v_start_at AND p.dibayar_at < v_end_at

    UNION ALL

    SELECT
      pp.penjualan_pembayaran_id AS pembayaran_id,
      pp.usaha_id,
      NULL::uuid AS reservasi_id,
      NULL::uuid AS penyewaan_id,
      pp.penjualan_id,
      s.nomor_penjualan,
      pp.transaksi_keuangan_id,
      pp.nomor_pembayaran,
      pp.jenis,
      pp.metode,
      pp.amount,
      pp.currency_code,
      pp.dibayar_at,
      pp.dicatat_by_admin_id,
      pp.reference_text,
      pp.catatan,
      pp.status,
      pp.created_at,
      pp.updated_at,
      'sale'::text AS payment_source_type,
      'Penjualan ' || s.nomor_penjualan AS source_label,
      t.nomor_transaksi
    FROM public.penjualan_pembayaran pp
    JOIN public.penjualan s
      ON s.usaha_id = pp.usaha_id AND s.penjualan_id = pp.penjualan_id
    LEFT JOIN public.transaksi_keuangan t
      ON t.usaha_id = pp.usaha_id AND t.transaksi_keuangan_id = pp.transaksi_keuangan_id
    WHERE pp.usaha_id = p_usaha_id
      AND pp.dibayar_at >= v_start_at AND pp.dibayar_at < v_end_at
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'pembayaran_id', x.pembayaran_id,
    'usaha_id', x.usaha_id,
    'reservasi_id', x.reservasi_id,
    'penyewaan_id', x.penyewaan_id,
    'penjualan_id', x.penjualan_id,
    'nomor_penjualan', x.nomor_penjualan,
    'transaksi_keuangan_id', x.transaksi_keuangan_id,
    'nomor_transaksi', x.nomor_transaksi,
    'nomor_pembayaran', x.nomor_pembayaran,
    'jenis', x.jenis,
    'metode', x.metode,
    'amount', x.amount,
    'currency_code', x.currency_code,
    'dibayar_at', x.dibayar_at,
    'dicatat_by_admin_id', x.dicatat_by_admin_id,
    'reference_text', x.reference_text,
    'catatan', x.catatan,
    'status', x.status,
    'created_at', x.created_at,
    'updated_at', x.updated_at,
    'payment_source_type', x.payment_source_type,
    'source_label', x.source_label
  ) ORDER BY x.dibayar_at DESC, x.pembayaran_id DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT * FROM all_payments
    ORDER BY dibayar_at DESC, pembayaran_id DESC
    LIMIT v_limit OFFSET v_offset
  ) x;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('start_date', p_start_date, 'end_date_exclusive', p_end_date, 'timezone', v_timezone),
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'has_more', (v_offset + v_limit) < v_total
  );
END;
$function$;

REVOKE ALL ON FUNCTION app_private.finance_payment_page(uuid,date,date,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.finance_payment_page(uuid,date,date,integer,integer) TO authenticated;

-- Retail analysis is deliberately read-only and derives profit from line-level HPP snapshots.
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
    'sales_revenue', coalesce((SELECT sum(subtotal) FROM line_scope), 0),
    'sold_quantity', coalesce((SELECT sum(jumlah) FROM line_scope), 0),
    'known_hpp', coalesce((SELECT sum(hpp_total) FROM line_scope WHERE hpp_total IS NOT NULL), 0),
    'gross_profit_known', coalesce((SELECT sum(subtotal - hpp_total) FROM line_scope WHERE hpp_total IS NOT NULL), 0),
    'hpp_unknown_revenue', coalesce((SELECT sum(subtotal) FROM line_scope WHERE hpp_total IS NULL), 0),
    'hpp_unknown_lines', (SELECT count(*) FROM line_scope WHERE hpp_total IS NULL),
    'known_hpp_lines', (SELECT count(*) FROM line_scope WHERE hpp_total IS NOT NULL),
    'sales_with_incomplete_hpp', (
      SELECT count(*) FROM (
        SELECT penjualan_id FROM line_scope GROUP BY penjualan_id
        HAVING count(*) FILTER (WHERE hpp_total IS NULL) > 0
      ) x
    ),
    'hpp_coverage_pct', CASE
      WHEN coalesce((SELECT sum(subtotal) FROM line_scope), 0) = 0 THEN NULL
      ELSE round(
        100.0 * coalesce((SELECT sum(subtotal) FROM line_scope WHERE hpp_total IS NOT NULL), 0)
        / nullif((SELECT sum(subtotal) FROM line_scope), 0), 2
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
      coalesce(sum(d.jumlah), 0) AS sold_quantity,
      coalesce(sum(d.hpp_total) FILTER (WHERE d.hpp_total IS NOT NULL), 0) AS known_hpp,
      coalesce(sum(d.subtotal - d.hpp_total) FILTER (WHERE d.hpp_total IS NOT NULL), 0) AS gross_profit_known,
      count(*) FILTER (WHERE d.hpp_total IS NULL) AS hpp_unknown_lines
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
  p_usaha_id uuid,
  p_start_date date,
  p_end_date date,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT app_private.finance_retail_analysis(p_usaha_id, p_start_date, p_end_date, p_limit);
$function$;

REVOKE ALL ON FUNCTION public.finance_retail_analysis(uuid,date,date,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_retail_analysis(uuid,date,date,integer) TO authenticated;

COMMENT ON COLUMN public.transaksi_keuangan.jenis IS
  'Subjenis transaksi keuangan untuk klasifikasi laporan (contoh rental_payment, sales_payment, expense); bukan penentu arah uang.';
COMMENT ON COLUMN public.transaksi_keuangan.arah IS
  'Arah nominal transaksi Finance (income atau expense); berbeda dari subjenis dan sumber transaksi.';
COMMENT ON COLUMN public.transaksi_keuangan.sumber_type IS
  'Domain sumber transaksi Finance (contoh rental, reservation, sale, purchase); bukan namespace pergerakan akun uang.';
COMMENT ON COLUMN public.pergerakan_akun_keuangan.sumber_type IS
  'Jenis peristiwa mutasi akun uang (contoh payment atau expense_settlement); namespace ini berbeda dari transaksi_keuangan.sumber_type.';
