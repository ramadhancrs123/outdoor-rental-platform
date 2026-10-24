export default async function investorFinanceHistoryScenario({ page, capture }) {
  if (page.url().includes("/login")) {
    return { state: "BLOCKED_AUTH", reason: "Sesi login tidak tersedia." };
  }

  await page.getByText("Saldo Akun", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByText("Riwayat Hak & Pergerakan Uang", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByText("Uang fisik · saldo akun", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByText("Hak alokasi · saldo hak", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByText("Pembayaran dan Alih Hak", { exact: true }).waitFor({ state: "visible", timeout: 15000 });

  const historyError = await page.getByText("Riwayat belum dapat dimuat. Data keuangan tidak diubah.", { exact: true }).count();
  if (historyError) throw new Error("Endpoint riwayat tidak dapat dimuat.");

  const eventLabel = page.getByText("Pemindahan uang antar akun internal", { exact: true });
  const hasCashMovement = await eventLabel.count() > 0;
  const investorPayoutVisible = await page.getByText("Bayar Investor", { exact: true }).count() > 0;
  const operatorPayoutVisible = await page.getByText("Bayar Pengelola", { exact: true }).count() > 0;
  const rightsSummary = page.getByText(/Alihkan hak Investor · sisa/).first();
  const rightsTransferVisible = await rightsSummary.count() > 0;
  const openAdvanceVisible = await page.getByText("Penarikan sebelum closing", { exact: true }).count() > 0;

  // OPEN periods expose advances from operational cash; CLOSED periods expose
  // settlement of finalized allocations and entitlement transfers. Do not
  // assume both sets of controls exist simultaneously or trigger any mutation.
  if (investorPayoutVisible || operatorPayoutVisible || rightsTransferVisible) {
    if (!investorPayoutVisible || !operatorPayoutVisible || !rightsTransferVisible) {
      throw new Error("Periode CLOSED hanya menampilkan sebagian kontrol settlement/alih hak.");
    }
    await page.getByLabel(/Nama penerima/).first().fill("UAT penerima validasi form");
    await page.getByLabel(/Nominal pencairan/).first().fill("1");
    await rightsSummary.click();
    const targetType = page.getByLabel("Hak dialihkan ke").first();
    await targetType.selectOption("pengelola");
    await page.getByLabel("Alokasi Pengelola").first().waitFor({ state: "visible", timeout: 5000 });
    await targetType.selectOption("usaha");
    await page.getByText("Catat juga pemindahan uang antar akun sekarang", { exact: true }).click();
    await page.getByLabel("Akun sumber uang").first().waitFor({ state: "visible", timeout: 5000 });
    await page.getByLabel("Akun tujuan uang").first().waitFor({ state: "visible", timeout: 5000 });
    await page.getByText("Catat juga pemindahan uang antar akun sekarang", { exact: true }).click();
    await page.getByLabel("Akun sumber uang").first().waitFor({ state: "hidden", timeout: 5000 });
  } else if (!openAdvanceVisible) {
    throw new Error("Kontrol periode tidak cocok dengan OPEN advance maupun CLOSED settlement.");
  }

  await capture("investor-finance-history");

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (horizontalOverflow) throw new Error("Investor finance history menyebabkan overflow horizontal pada viewport ini.");

  return {
    state: "VERIFIED",
    checks: [
      "accounts-view-visible",
      "physical-cash-ledger-visible",
      "entitlement-ledger-visible",
      "history-endpoint-returned-data",
      ...(investorPayoutVisible ? ["closed-period-payout-form-interaction"] : ["open-period-advance-controls-visible"]),
      ...(rightsTransferVisible ? ["rights-target-selection", "optional-physical-transfer-toggle"] : []),
      ...(hasCashMovement ? ["internal-cash-movement-rendered"] : ["empty-event-list-rendered"]),
      "no-horizontal-overflow",
    ],
    horizontalOverflow,
    periodControls: investorPayoutVisible ? "CLOSED" : "OPEN",
  };
}
