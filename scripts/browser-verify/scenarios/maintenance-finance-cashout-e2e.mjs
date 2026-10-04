export default async function maintenanceFinanceCashoutE2E({ page, baseURL, capture }) {
  const maintenanceId = "d371741a-1046-4c86-b811-092b54449242";
  await page.goto(baseURL + "/perawatan/" + maintenanceId, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(700);
  await page.getByText("Selesaikan Perawatan + Finance", { exact: true }).waitFor({ state: "visible" });

  const cost = page.getByRole("spinbutton", { name: "Biaya aktual" });
  await cost.fill("10000");
  const qrisAllocation = page.getByRole("spinbutton", { name: /Alokasi Akasha Qris/i });
  await qrisAllocation.waitFor({ state: "visible" });
  await qrisAllocation.fill("10000");

  await page.getByRole("button", { name: /Bayar & Selesaikan Perawatan/i }).click();
  await page.getByRole("heading", { name: "Perawatan Selesai", exact: true }).waitFor({ state: "visible", timeout: 15000 });

  let body = await page.locator("body").innerText();
  if (!body.includes("Pengeluaran & cash out sudah tercatat")) throw new Error("Success state tidak mengonfirmasi expense + cash out.");
  if (!body.includes("Buka Pengeluaran Finance")) throw new Error("Link Pengeluaran Finance tidak muncul.");
  await capture("maintenance-finance-cashout-success");

  const verify = page.getByRole("button", { name: /Konfirmasi Siap Disewakan/i });
  if (await verify.isVisible().catch(() => false)) {
    await verify.click();
    await page.waitForTimeout(900);
    body = await page.locator("body").innerText();
    if (!body.includes("Verifikasi LULUS. Inventaris menetapkan unit Siap Disewakan.")) {
      throw new Error("Readiness verification tidak berhasil setelah cash out.");
    }
  }

  const expenseLink = page.getByRole("link", { name: /Buka Pengeluaran Finance/i });
  await expenseLink.click();
  await page.waitForTimeout(700);
  body = await page.locator("body").innerText();
  if (!body.includes("Pengeluaran")) throw new Error("Detail Pengeluaran Finance tidak terbuka.");
  if (!body.includes("Perawatan")) throw new Error("Detail Pengeluaran tidak menunjukkan source Perawatan.");
  await capture("finance-expense-after-maintenance-cashout");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) throw new Error("Horizontal overflow pada maintenance finance cash-out flow.");

  return { state: "VERIFIED", maintenanceId, cost: 10000, account: "Akasha Qris", expenseLinked: true, financeDetailOpened: true };
}