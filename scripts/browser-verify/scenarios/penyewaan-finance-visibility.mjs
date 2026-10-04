export default async function rentalFinanceVisibility({ page, capture }) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);
  const body = await page.locator("body").innerText();
  const detail = page.getByText("Detail Penyewaan", { exact: true }).first();
  const finance = page.getByText("Keuangan", { exact: true }).first();
  const payment = page.getByRole("link", { name: /Catat Pembayaran/i }).first();

  if (!(await detail.isVisible().catch(() => false))) {
    throw new Error("Detail Penyewaan belum terlihat. BODY=" + body.slice(0, 2500));
  }
  if (!(await finance.isVisible().catch(() => false))) {
    throw new Error("Keuangan belum terlihat. BODY=" + body.slice(0, 2500));
  }
  if (!(await payment.isVisible().catch(() => false))) {
    throw new Error("CTA Catat Pembayaran belum terlihat. BODY=" + body.slice(0, 2500));
  }

  const href = await payment.getAttribute("href");
  if (!href?.includes("sourceType=rental") || !href.includes("sourceId=")) {
    throw new Error("CTA Catat Pembayaran tidak membawa rental source: " + href);
  }

  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (metrics.scrollWidth > metrics.clientWidth) {
    throw new Error("Horizontal overflow: " + JSON.stringify(metrics));
  }

  await capture("penyewaan-finance-visibility");
  return {
    state: "VERIFIED",
    financeVisible: true,
    paymentCtaVisible: true,
    paymentHref: href,
    overflow: false,
  };
}
