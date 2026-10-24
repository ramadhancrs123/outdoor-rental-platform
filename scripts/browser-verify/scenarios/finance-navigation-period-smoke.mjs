export default async function financeNavigationPeriodSmoke({ page, capture }) {
  if (page.url().includes("/login")) return { state: "BLOCKED_AUTH", reason: "authenticated session required" };

  await page.goto(page.url().replace(/\?.*$/, "") + "?f3=ux", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.getByText("Pemasukan Tercatat", { exact: true }).waitFor({ state: "visible", timeout: 10000 });

  await page.getByRole("button", { name: "Atur periode keuangan", exact: true }).click();
  await page.getByRole("button", { name: "Rentang", exact: true }).click();
  await page.getByLabel("Tanggal mulai").fill("2026-09-01");
  await page.getByLabel("Tanggal selesai").fill("2026-09-15");

  // Investor configuration is intentionally inside Finance settings, not an
  // always-visible Realtime widget or a second source-of-truth page.
  const settings = page.locator("details").filter({ hasText: "Pengaturan & Rekonsiliasi" }).first();
  await settings.locator("summary").click();

  const requiredLinks = [
    "/keuangan/pembayaran/create",
    "/keuangan/pengeluaran/create",
    "/keuangan/transaksi",
    "/laporan",
    "/keuangan/pembayaran",
    "/keuangan/pengeluaran",
    "/keuangan/akun",
    "/keuangan/investor",
    "/investor",
  ];
  for (const href of requiredLinks) {
    await page.locator('a[href="' + href + '"]').first().waitFor({ state: "visible", timeout: 5000 });
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) throw new Error("Finance home horizontal overflow.");

  // Realtime's user-facing Live indicator belongs to the Investor portal,
  // not the Finance dashboard. Finance remains a read/command workspace.
  if (await page.getByRole("status", { name: "Status Realtime Keuangan" }).count()) {
    throw new Error("Finance must not display the Investor portal's Live indicator.");
  }
  if (await page.getByText("Realtime aktif", { exact: true }).count()) {
    throw new Error("Investor Realtime indicator leaked into the Finance page.");
  }

  await capture("finance-navigation-period");
  return {
    state: "VERIFIED",
    checks: ["compact-period-control", "custom-range", "primary-actions-visible", "finance-navigation-visible", "no-horizontal-overflow", "investor-link-visible", "no-investor-live-indicator-on-finance"],
  };
}
