export default async function maintenanceFinanceCashoutScenario({ page, baseURL, capture }) {
  if (page.url().includes("/login")) return { state: "BLOCKED_AUTH", reason: "Runner berada di login." };

  await page.goto(baseURL + "/perawatan", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.getByText("Buat Perawatan", { exact: true }).waitFor({ state: "visible" });

  await page.getByRole("link", { name: /Buat Perawatan/i }).click();
  await page.waitForURL(/\/perawatan\/create$/, { timeout: 10000 });
  await page.getByRole("button", { name: /Pilih unit langsung/i }).click();
  const unitButton = page.getByRole("button", { name: /Car-40L-001.*Siap Disewakan/i });
  await unitButton.waitFor({ state: "visible" });
  await unitButton.click();
  await page.getByRole("button", { name: /Lanjut ke Detail/i }).click();

  const executor = page.getByRole("textbox", { name: /Pelaksana/i });
  if (!(await executor.inputValue()).trim()) await executor.fill("QA Finance Cashout");
  await page.getByRole("textbox", { name: /Alasan perawatan manual/i }).fill("Verifikasi integrasi finance cash-out maintenance.");
  await page.getByRole("textbox", { name: /Deskripsi Pekerjaan/i }).fill("Perbaikan dummy untuk verifikasi finance cash-out.");
  await page.getByRole("button", { name: /Lanjut ke Tinjauan/i }).click();
  await page.getByText("Tinjauan sebelum membuat", { exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: /Buat Perawatan/i }).click();
  await page.waitForURL(/\/perawatan\/[a-f0-9-]+$/, { timeout: 10000 });
  await page.getByRole("button", { name: /Mulai Perawatan/i }).click();
  await page.waitForTimeout(700);
  await page.getByRole("heading", { name: /Status Pekerjaan/i }).waitFor({ state: "visible" });

  const costInput = page.getByRole("spinbutton", { name: "Biaya aktual" });
  await costInput.fill("10000");
  await page.getByRole("spinbutton", { name: /Alokasi / }).first().fill("10000");
  await page.getByRole("button", { name: /Bayar & Selesaikan Perawatan/i }).click();
  await page.getByRole("heading", { name: "Perawatan Selesai", exact: true }).waitFor({ state: "visible", timeout: 15000 });

  let body = await page.locator("body").innerText();
  if (!body.includes("Pengeluaran & cash out sudah tercatat")) throw new Error("Success state tidak mengonfirmasi expense + cash out.");
  if (!body.includes("Buka Pengeluaran Finance")) throw new Error("Link Pengeluaran Finance tidak muncul pada success state.");
  await capture("maintenance-finance-cashout-success");

  const verify = page.getByRole("button", { name: /Konfirmasi Siap Disewakan/i });
  if (await verify.isVisible().catch(() => false)) {
    await verify.click();
    await page.waitForTimeout(800);
    body = await page.locator("body").innerText();
    if (!body.includes("Verifikasi LULUS. Inventaris menetapkan unit Siap Disewakan.")) {
      throw new Error("Readiness confirmation tidak berhasil setelah finance cash-out.");
    }
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) throw new Error("Horizontal overflow pada flow maintenance finance cash-out.");

  return { state: "VERIFIED", accountAllocation: 10000, cost: 10000, expenseAndCashout: true, readinessReturned: Boolean(await page.getByText("Siap Disewakan").count()) };
}