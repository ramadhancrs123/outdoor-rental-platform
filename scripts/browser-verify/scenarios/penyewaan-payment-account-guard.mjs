export default async function penyewaanPaymentAccountGuard({ page, capture }) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);

  const paymentCta = page.getByRole("link", { name: /Catat Pembayaran/i }).first();
  if (!(await paymentCta.isVisible().catch(() => false))) {
    const body = await page.locator("body").innerText();
    throw new Error("CTA Catat Pembayaran tidak terlihat pada Detail Penyewaan. BODY=" + body.slice(0, 4000));
  }

  const href = await paymentCta.getAttribute("href");
  if (!href?.includes("sourceType=rental") || !href.includes("sourceId=")) {
    throw new Error("CTA pembayaran tidak membawa rental source: " + href);
  }

  await paymentCta.click();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);

  const currentUrl = page.url();
  if (!currentUrl.includes("/keuangan/pembayaran/create")) {
    throw new Error("Tidak masuk ke flow Catat Pembayaran: " + currentUrl);
  }

  const unknownOutcome = page.getByText("Status Transaksi Belum Dapat Dipastikan", { exact: true }).first();
  if (await unknownOutcome.isVisible().catch(() => false)) {
    throw new Error("Payment flow masih jatuh ke unknown outcome pada normal validation state.");
  }

  const noAccount = page.getByText("Belum ada akun uang", { exact: true }).first();
  const accountSelector = page.getByText("Uang Masuk ke", { exact: true }).first();
  if (!(await noAccount.isVisible().catch(() => false)) && !(await accountSelector.isVisible().catch(() => false))) {
    const body = await page.locator("body").innerText();
    throw new Error("Flow pembayaran tidak menampilkan account state yang dapat ditindaklanjuti. BODY=" + body.slice(0, 5000));
  }

  await capture("penyewaan-payment-account-guard");
  return {
    state: "VERIFIED",
    paymentFlow: true,
    sourceLinked: true,
    unknownOutcomeVisible: false,
    accountState: (await accountSelector.isVisible().catch(() => false)) ? "available" : "missing_setup",
    url: currentUrl,
  };
}
