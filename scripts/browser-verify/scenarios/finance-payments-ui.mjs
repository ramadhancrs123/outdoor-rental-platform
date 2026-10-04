export default async function financePaymentsUi({ page, baseURL, capture }) {
  await page.goto(baseURL + "/keuangan/pembayaran", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByText("Pembayaran", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
  console.log("PAYMENT_BODY", (await page.locator("body").innerText()).slice(0, 5000));
  for (const label of ["Catat Pembayaran", "Pembayaran Tercatat"]) {
    await page.getByText(label, { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
  }
  const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  if (bodyWidth > viewportWidth + 2) throw new Error("Horizontal overflow pada halaman Pembayaran.");
  const body = await page.locator("body").innerText();
  for (const forbidden of ["business date", "Read model", "Source financial", "Payment page", "Date", "Amount", "Method"]) {
    if (body.includes(forbidden)) throw new Error("Istilah teknis/Inggris masih tampil: " + forbidden);
  }
  await capture("payment-list");
  return { state: "VERIFIED", viewport: page.viewportSize(), overflow: false };
}
