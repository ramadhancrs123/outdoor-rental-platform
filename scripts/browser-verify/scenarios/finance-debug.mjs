export default async function debug({ page, baseURL, capture }) {
  await page.goto(baseURL + "/keuangan/transaksi", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  console.log("TXBODY", (await page.locator("body").innerText()).slice(0,7000));
  await page.goto(baseURL + "/keuangan/akun", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  const href = await page.locator('a[href*="/keuangan/akun/"]').first().getAttribute("href").catch(()=>null);
  console.log("ACCTLINK", href);
  if (href) { await page.goto(baseURL + href, {waitUntil:"networkidle"}); console.log("ACCOUNTBODY", (await page.locator("body").innerText()).slice(0,7000)); }
  await capture("debug");
  return {state:"DEBUG", href};
}
