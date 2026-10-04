export default async function financeExpensesUi({ page, baseURL, capture }) {
  await page.goto(baseURL + "/keuangan/pengeluaran", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByText("Pengeluaran", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
  for (const label of ["Catat Pengeluaran", "Periode", "Pengeluaran Tercatat"]) {
    await page.getByText(label, { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
  }
  const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  if (bodyWidth > viewportWidth + 2) throw new Error("Horizontal overflow pada halaman Pengeluaran.");
  const body = await page.locator("body").innerText();
  for (const forbidden of ["business date", "Read model", "Source financial", "Expense page", "Date", "Amount", "Transaction"]) {
    if (body.includes(forbidden)) throw new Error("Istilah teknis/Inggris masih tampil: " + forbidden);
  }
  await capture("expense-list");
  return { state: "VERIFIED", viewport: page.viewportSize(), overflow: false };
}
