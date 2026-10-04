function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

const usahaId = "usaha-finance-qa";
const timezone = "Asia/Jakarta";

const transactions = [{
  transaksi_keuangan_id: "trx-fin-001",
  usaha_id: usahaId,
  nomor_transaksi: "TRX-F3-001",
  jenis: "payment",
  arah: "income",
  tanggal_transaksi: "2026-09-18T06:30:00.000Z",
  amount: 450000,
  currency_code: "IDR",
  sumber_type: "payment",
  sumber_id: "pay-fin-001",
  status: "recorded",
  catatan: "DP rental",
  created_at: "2026-09-18T06:30:00.000Z",
  updated_at: "2026-09-18T06:30:00.000Z",
}];

const payments = [{
  pembayaran_id: "pay-fin-001",
  usaha_id: usahaId,
  reservasi_id: "reservation-fin-001",
  penyewaan_id: null,
  transaksi_keuangan_id: "trx-fin-001",
  nomor_pembayaran: "PAY-F3-001",
  jenis: "dp",
  metode: "bank_transfer",
  amount: 450000,
  currency_code: "IDR",
  dibayar_at: "2026-09-18T06:30:00.000Z",
  dicatat_by_admin_id: "admin-fin-qa",
  reference_text: "TRF-F3-001",
  catatan: "DP",
  status: "recorded",
  created_at: "2026-09-18T06:30:00.000Z",
  updated_at: "2026-09-18T06:30:00.000Z",
  nomor_transaksi: "TRX-F3-001",
  source_label: "Reservasi RSV-F3-001",
}];

const expenses = [{
  pengeluaran_id: "exp-fin-001",
  usaha_id: usahaId,
  transaksi_keuangan_id: "trx-exp-001",
  pemasok_id: "supplier-fin-001",
  source_type: "maintenance",
  source_id: "maintenance-fin-001",
  kategori_biaya: "Maintenance",
  deskripsi: "Perbaikan tenda",
  amount: 125000,
  currency_code: "IDR",
  tanggal_pengeluaran: "2026-09-15",
  bukti_storage_path: "usaha-finance-qa/expense/exp-fin-001.pdf",
  created_at: "2026-09-15T04:00:00.000Z",
  updated_at: "2026-09-15T04:00:00.000Z",
  nomor_transaksi: "TRX-EXP-F3-001",
  pemasok_nama: "Supplier QA",
}];

const summary = {
  start_date: "2026-09-01",
  end_date_exclusive: "2026-10-01",
  timezone,
  recorded_income: 950000,
  recorded_expense: 250000,
  net_operational_movement: 700000,
  recorded_income_transaction_count: 2,
  recorded_expense_transaction_count: 2,
  recorded_payment_amount: 950000,
  recorded_payment_count: 2,
  reversal_income_in_period: 0,
  reversal_expense_in_period: 0,
  source_note: "Server-generated financial summary",
};

const reportPage = (items, total = items.length) => ({
  start_date: "2026-09-01",
  end_date_exclusive: "2026-10-01",
  timezone,
  items,
  total,
  limit: 20,
  offset: 0,
  has_more: false,
});

function assertVisible(page, text) {
  return page.getByText(text, { exact: false }).first().waitFor({ state: "visible" });
}

export default async function financeScenario({ page, baseURL, capture }) {
  page.on("pageerror", (error) => console.log("FINANCE_PAGEERROR_STACK", error.stack || error.message));
  await page.route("**/rest/v1/rpc/**", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    if (name === "finance_summary") return json(route, summary);
    if (name === "finance_expense_analysis") {
      return json(route, {
        ...summary,
        by_category: [{ kategori_biaya: "Maintenance", amount: 125000, count: 1 }],
        by_supplier: [{ pemasok_id: "supplier-fin-001", amount: 125000, count: 1 }],
        by_source: [{ source_type: "maintenance", amount: 125000, count: 1 }],
        note: "Server-generated expense analysis",
      });
    }
    if (name === "finance_recorded_income_by_product") {
      return json(route, {
        ...summary,
        items: [{ barang_id: "barang-fin-001", varian_barang_id: "variant-fin-001", recorded_income_exact: 450000, rental_detail_value: 450000, transaction_count: 1, attribution_status: "exact_single_detail" }],
        total_rental_or_reservation_income: 950000,
        exact_attributable_income: 450000,
        unallocated_income: 500000,
        coverage_ratio: 450000 / 950000,
        allocation_policy: "Exact only; ambiguous income remains unallocated",
      });
    }
    if (name === "finance_recorded_income_by_unit") {
      return json(route, {
        ...summary,
        items: [{ unit_barang_id: "unit-fin-001", kode_unit: "TD4P-001", barang_id: "barang-fin-001", varian_barang_id: "variant-fin-001", recorded_income_exact: 450000, transaction_count: 1, attribution_status: "exact_single_detail_single_unit" }],
        total_rental_income: 950000,
        exact_unit_attributable_income: 450000,
        unallocated_or_ambiguous_income: 500000,
        coverage_ratio: 450000 / 950000,
        allocation_policy: "Exact single detail + single physical unit only",
      });
    }
    if (name === "finance_reconciliation") {
      return json(route, { status: "ATTENTION", critical: { integrity_anomaly: 0 }, attention: { pending_outbox: 1 }, principle: "Health dibuat server dan tenant-scoped." });
    }
    if (name === "finance_reconciliation_findings") {
      return json(route, { items: [{ code: "PENDING_OUTBOX_EVENTS", severity: "attention" }], limit: 20 });
    }
    if (name === "finance_transaction_page") return json(route, reportPage(transactions));
    if (name === "finance_payment_page") return json(route, reportPage(payments));
    if (name === "finance_expense_page") return json(route, reportPage(expenses));
    if (name === "command_correct_payment") return json(route, {
      pembayaran_id: "pay-fin-001",
      status: "voided",
      correction_id: "correction-fin-001",
      nomor_koreksi: "KOR-F3-001",
      replacement_transaksi_keuangan_id: null,
    });
    return json(route, {});
  });

  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.includes("/rpc/")) {
      const name = url.pathname.split("/").pop();
      if (name === "finance_summary") return json(route, summary);
      if (name === "finance_expense_analysis") {
        return json(route, {
          ...summary,
          by_category: [{ kategori_biaya: "Maintenance", amount: 125000, count: 1 }],
          by_supplier: [{ pemasok_id: "supplier-fin-001", amount: 125000, count: 1 }],
          by_source: [{ source_type: "maintenance", amount: 125000, count: 1 }],
          note: "Server-generated expense analysis",
        });
      }
      if (name === "finance_recorded_income_by_product") {
        return json(route, {
          ...summary,
          items: [{ barang_id: "barang-fin-001", varian_barang_id: "variant-fin-001", recorded_income_exact: 450000, rental_detail_value: 450000, transaction_count: 1, attribution_status: "exact_single_detail" }],
          total_rental_or_reservation_income: 950000,
          exact_attributable_income: 450000,
          unallocated_income: 500000,
          coverage_ratio: 450000 / 950000,
          allocation_policy: "Exact only; ambiguous income remains unallocated",
        });
      }
      if (name === "finance_recorded_income_by_unit") {
        return json(route, {
          ...summary,
          items: [{ unit_barang_id: "unit-fin-001", kode_unit: "TD4P-001", barang_id: "barang-fin-001", varian_barang_id: "variant-fin-001", recorded_income_exact: 450000, transaction_count: 1, attribution_status: "exact_single_detail_single_unit" }],
          total_rental_income: 950000,
          exact_unit_attributable_income: 450000,
          unallocated_or_ambiguous_income: 500000,
          coverage_ratio: 450000 / 950000,
          allocation_policy: "Exact single detail + single physical unit only",
        });
      }
      if (name === "finance_reconciliation") return json(route, { status: "ATTENTION", critical: { integrity_anomaly: 0 }, attention: { pending_outbox: 1 }, principle: "Health dibuat server dan tenant-scoped." });
      if (name === "finance_reconciliation_findings") return json(route, { items: [{ code: "PENDING_OUTBOX_EVENTS", severity: "attention" }], limit: 20 });
      if (name === "finance_transaction_page") return json(route, reportPage(transactions));
      if (name === "finance_payment_page") return json(route, reportPage(payments));
      if (name === "finance_expense_page") return json(route, reportPage(expenses));
      if (name === "command_correct_payment") return json(route, {
        pembayaran_id: "pay-fin-001",
        status: "voided",
        correction_id: "correction-fin-001",
        nomor_koreksi: "KOR-F3-001",
        replacement_transaksi_keuangan_id: null,
      });
      return json(route, {});
    }

    const table = url.pathname.split("/").pop();
    const object = request.headers()["accept"]?.includes("vnd.pgrst.object");
    let body = [];

    if (table === "akun_admin") body = [{ akun_admin_id: "admin-fin-qa" }];
    else if (table === "keanggotaan_usaha") body = [{ usaha_id: usahaId, status: "active", revoked_at: null }];
    else if (table === "usaha") body = [{ usaha_id: usahaId, nama: "Akasha Store", status: "active", timezone }];
    else if (table === "transaksi_keuangan") body = transactions;
    else if (table === "pembayaran") body = payments;
    else if (table === "pengeluaran") body = expenses;
    else if (table === "reservasi") body = [{ reservasi_id: "reservation-fin-001", nomor_reservasi: "RSV-F3-001" }];
    else if (table === "penyewaan") body = [];
    else if (table === "pemasok") body = [{ pemasok_id: "supplier-fin-001", nama: "Supplier QA" }];
    else if (table === "akun_keuangan") body = [{ akun_keuangan_id: "akun-fin-001", usaha_id: usahaId, kode_akun: "KAS-01", nama_akun: "Kas Utama", jenis_akun: "kas", mata_uang: "IDR", status: "active", catatan: null, saldo_awal: 0, uang_masuk: 950000, uang_keluar: 250000, saldo: 700000, tanggal_saldo_awal: null }];

    if (object) body = body[0] ?? null;
    return json(route, body);
  });

  await page.goto(baseURL + "/keuangan?f3=1", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  console.log("FINANCE_BODY_START", (await page.locator("body").innerText()).slice(0, 5000));
  await assertVisible(page, "Pemasukan Tercatat");
  await assertVisible(page, "Pengeluaran Tercatat");
  await assertVisible(page, "Net Operasional");
  await assertVisible(page, "Transaksi Terbaru");
  await assertVisible(page, "Perlu Perhatian");
  await assertVisible(page, "Analisis Keuangan");
  await capture("finance-dashboard");

  const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  if (bodyWidth > viewportWidth + 2) {
    throw new Error("Horizontal overflow terdeteksi pada Finance Dashboard: " + bodyWidth + " > " + viewportWidth);
  }

  await page.goto(baseURL + "/keuangan/pembayaran?f3=1", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  if ((page.viewportSize()?.width ?? 1280) <= 768) {
    await page.getByText("Reservasi RSV-F3-001", { exact: true }).first().waitFor({ state: "visible" });
  } else {
    await page.locator("table tbody tr").filter({ hasText: "Reservasi RSV-F3-001" }).first().waitFor({ state: "visible" });
  }
  await page.getByRole("button", { name: /Custom/i }).click();
  await assertVisible(page, "Mulai");
  await capture("finance-payments-period");

  await page.goto(baseURL + "/keuangan/pembayaran/pay-fin-001", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await assertVisible(page, "Koreksi");
  await page.getByRole("button", { name: "Koreksi" }).click();
  await assertVisible(page, "Void");
  await assertVisible(page, "Reversal");
  await page.getByLabel(/Alasan koreksi/i).fill("Koreksi QA finance F3");
  await page.getByRole("button", { name: /Koreksi Finansial/i }).click();
  await assertVisible(page, "Koreksi tersimpan");
  await assertVisible(page, "KOR-F3-001");
  await capture("finance-payment-correction");

  await page.goto(baseURL + "/keuangan/pengeluaran?f3=1", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  if ((page.viewportSize()?.width ?? 1280) <= 768) {
    await page.getByText("Perbaikan tenda", { exact: true }).first().waitFor({ state: "visible" });
  } else {
    await page.locator("table tbody tr").filter({ hasText: "Perbaikan tenda" }).first().waitFor({ state: "visible" });
  }
  await capture("finance-expenses");

  await page.goto(baseURL + "/keuangan/transaksi?f3=1", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  if ((page.viewportSize()?.width ?? 1280) <= 768) {
    await page.getByText("TRX-F3-001", { exact: true }).first().waitFor({ state: "visible" });
  } else {
    await page.locator("table tbody tr").filter({ hasText: "Payment" }).filter({ hasText: "Rp 450.000" }).first().waitFor({ state: "visible" });
  }
  await capture("finance-transactions");

  return { state: "VERIFIED", checked: ["dashboard", "period-filter", "payment-correction", "expense-list", "transaction-list"] };
}
