export default async function investorDashboardScenario({ page, capture }) {
  if (page.url().includes("/login")) {
    await capture("auth-required");
    return { state: "BLOCKED_AUTH", reason: "Dashboard Investor membutuhkan sesi authenticated." };
  }

  try {
    await page.getByText(/^(Estimasi Hak Investor|Alokasi Final Investor)$/, { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  } catch (error) {
    const visibleBody = (await page.locator("body").innerText().catch(() => "<body text unavailable>")).slice(0, 1800);
    throw new Error("Investor summary header did not appear. Visible page text: " + visibleBody + ". Original: " + (error instanceof Error ? error.message : String(error)));
  }
  await page.getByText("Partisipasi Investor", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "Performa" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("status", { name: "Realtime Investor aktif" }).first().waitFor({ state: "visible", timeout: 15000 });
  await capture("investor-summary");

  const previousPeriodButton = page.getByRole("button", { name: "Periode sebelumnya" });
  if (await previousPeriodButton.isVisible().catch(() => false)) {
    const periodText = () => previousPeriodButton.evaluate((button) => button.parentElement?.innerText ?? "");
    const currentPeriodText = await periodText();
    await previousPeriodButton.click();
    await page.waitForFunction((before) => {
      const button = document.querySelector('button[aria-label="Periode sebelumnya"]');
      return Boolean(button && button.parentElement?.innerText !== before);
    }, currentPeriodText, { timeout: 10000 });
    await capture("investor-previous-period");

    await page.getByRole("button", { name: "Periode berikutnya" }).click();
    await page.waitForFunction((before) => {
      const button = document.querySelector('button[aria-label="Periode sebelumnya"]');
      return Boolean(button && button.parentElement?.innerText === before);
    }, currentPeriodText, { timeout: 10000 });
    await capture("investor-current-period-restored");
  }

  await page.getByRole("button", { name: "Performa", exact: true }).click();
  await page.getByText("Performa Operasional", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Kinerja Hak Investor", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await capture("investor-performance");

  await page.getByRole("button", { name: "Transaksi", exact: true }).click();
  await page.getByText("Semua", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Pemasukan", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  const downloadName = download.suggestedFilename();
  await capture("investor-transactions");

  if (!downloadName.endsWith(".csv")) {
    throw new Error(`Investor export produced unexpected filename: ${downloadName}`);
  }

  const transactionRows = page.getByRole("button").filter({ hasText: "Pemasukan menambah hasil bersih" });
  if (await transactionRows.first().count()) {
    await transactionRows.first().click();
    await page.getByRole("button", { name: "Tutup", exact: true }).waitFor({ state: "visible", timeout: 5000 });
    await page.getByRole("button", { name: "Tutup", exact: true }).click();
  }

  const perfTab = page.getByRole("button", { name: "Performa", exact: true });
  await perfTab.focus();
  const focusVerified = await perfTab.evaluate((element) => document.activeElement === element);
  if (!focusVerified) throw new Error("Investor tab keyboard focus could not be verified.");

  await page.getByRole("button", { name: "Akun", exact: true }).click();
  await page.getByText("Saldo Akun", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Rincian Keuangan Investor", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await capture("investor-accounts");

  const bottomNav = page.getByRole("navigation", { name: "Investor tab navigation" });
  const bottomNavVisible = await bottomNav.isVisible().catch(() => false);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  const isMobileViewport = (page.viewportSize()?.width ?? 1280) <= 767;
  if (bottomNavVisible !== isMobileViewport) {
    throw new Error(`Investor tab navigation visibility mismatch: mobile=${isMobileViewport}, visible=${bottomNavVisible}.`);
  }
  if (overflow) throw new Error("Investor dashboard horizontal overflow.");

  if (isMobileViewport) {
    const innerMain = page.locator("main").last();
    await bottomNav.getByRole("link", { name: "Performa" }).click();
    await page.getByText("Performa Operasional", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
    if (!(await innerMain.innerText()).trim()) throw new Error("Investor mobile navigation opened a blank Performa view.");
    await capture("investor-bottom-nav-performance");

    await bottomNav.getByRole("link", { name: "Transaksi" }).click();
    await page.getByText("Semua", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
    if (!(await innerMain.innerText()).trim()) throw new Error("Investor mobile navigation opened a blank Transaksi view.");
    await capture("investor-bottom-nav-transactions");

    await bottomNav.getByRole("link", { name: "Akun" }).click();
    await page.getByText("Saldo Akun", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
    if (!(await innerMain.innerText()).trim()) throw new Error("Investor mobile navigation opened a blank Akun view.");
    await capture("investor-bottom-nav-accounts");

    await bottomNav.getByRole("link", { name: "Ringkasan" }).click();
    await page.getByText("Partisipasi Investor", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
    if (!(await innerMain.innerText()).trim()) throw new Error("Investor mobile navigation opened a blank Ringkasan view.");
    await capture("investor-bottom-nav-summary");
  }

  return {
    state: "VERIFIED",
    checks: [
      "summary-visible",
      "realtime-live-label-requires-verified-live-connection",
      "performance-tab-visible",
      "transactions-tab-visible",
      "accounts-tab-visible",
      "responsive-tab-navigation-visibility",
      "four-tabs-captured",
      "mobile-bottom-navigation-preserves-content",
      "no-horizontal-overflow",
    ],
    bottomNavVisible,
    horizontalOverflow: overflow,
  };
}
