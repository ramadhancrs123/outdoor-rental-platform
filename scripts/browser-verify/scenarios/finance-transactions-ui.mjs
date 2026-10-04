export default async function financeTransactionsUi({ page, baseURL, capture }) {
  await page.goto(baseURL + "/keuangan/transaksi", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByText("Transaksi", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
  for (const label of ["Periode", "Transaksi Tercatat"]) await page.getByText(label, { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
  const metrics = await page.evaluate(() => ({vw:window.innerWidth, sw:document.documentElement.scrollWidth}));
  if (metrics.sw > metrics.vw + 2) throw new Error("Horizontal overflow pada halaman Transaksi.");
  const body = await page.locator("body").innerText();
  for (const forbidden of ["read model", "Financial Truth", "Source", "Direction", "Date", "Amount", "Status"]) {
    if (body.includes(forbidden)) throw new Error("Istilah teknis/Inggris masih tampil: " + forbidden);
  }
  await capture("transaction-list");
  return {state:"VERIFIED", viewport:page.viewportSize(), overflow:false};
}
