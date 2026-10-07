export default async function financeAccountUi({ page, baseURL, capture }) {
  await page.goto(baseURL + "/keuangan/akun", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByText("Akun Uang", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
  const accountLink = page.locator('a[href*="/keuangan/akun/"]').first();
  if (!(await accountLink.count())) return {state:"BLOCKED_FIXTURE", reason:"Belum ada akun uang pada fixture."};
  await accountLink.click();
  await page.waitForURL(/\/keuangan\/akun\/[^/]+$/,{timeout:10000});
  await page.waitForLoadState("networkidle").catch(() => {});
  for (const label of ["Saldo Akun", "Informasi Akun", "Mutasi Akun"]) await page.getByText(label, {exact:true}).first().waitFor({state:"visible",timeout:15000});
  const metrics = await page.evaluate(() => ({vw:window.innerWidth, sw:document.documentElement.scrollWidth}));
  if (metrics.sw > metrics.vw + 2) throw new Error("Horizontal overflow pada Detail Akun.");
  const body = await page.locator("body").innerText();
  for (const forbidden of ["reconstructed", "recorded.", "Timeline mengikuti timezone", "E-Wallet"]) {
    if (body.includes(forbidden)) throw new Error("Istilah teknis masih tampil: " + forbidden);
  }
  await capture("account-detail");
  return {state:"VERIFIED", viewport:page.viewportSize(), overflow:false};
}
