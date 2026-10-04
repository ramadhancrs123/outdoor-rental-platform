export default async function financeManualExpenseCashout({ page, baseURL, capture }) {
  const marker = "QA manual cashout " + new Date().toISOString();
  let cashoutAccountId = null;

  page.on("response", async (response) => {
    if (!response.url().includes("/rest/v1/rpc/command_record_expense_with_finance_cashout")) return;
    try {
      const payload = JSON.parse(await response.text());
      cashoutAccountId = payload?.settlement?.allocations?.[0]?.akun_keuangan_id ?? null;
    } catch {
      // Ignore non-JSON responses; the success state below remains authoritative.
    }
  });

  await page.goto(baseURL + "/keuangan/akun", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.locator('a[href*="/keuangan/akun/"]').first().waitFor({ state: "visible", timeout: 15000 });

  await page.goto(baseURL + "/keuangan/pengeluaran/create", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByRole("heading", { name: "Catat Pengeluaran" }).waitFor({ state: "visible", timeout: 15000 });

  await page.getByRole("button", { name: "Lanjutkan" }).first().click();
  await page.getByLabel("Kategori Biaya").fill("QA Manual");
  await page.getByLabel("Deskripsi").fill(marker);
  await page.getByLabel("Nominal").fill("1000");
  await page.getByRole("button", { name: "Lanjutkan" }).last().click();

  await page.getByText("Sumber uang", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("button", { name: /Bagi otomatis/i }).click();

  const cashoutButton = page.getByRole("button", { name: /Bayar & Catat Pengeluaran/i });
  await cashoutButton.waitFor({ state: "visible", timeout: 15000 });
  if (await cashoutButton.isDisabled()) {
    throw new Error("Tombol cash out tetap disabled setelah alokasi otomatis.");
  }
  await capture("manual-expense-cashout-ready");

  await cashoutButton.click();
  await page.getByText("Pengeluaran Berhasil Dicatat", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
  await capture("manual-expense-cashout-success");

  if (!cashoutAccountId) throw new Error("RPC berhasil tetapi settlement account ID tidak dikembalikan.");
  const accountHref = "/keuangan/akun/" + cashoutAccountId;

  await page.goto(baseURL + accountHref, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByText("Mutasi Akun", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  const manualExpenseMovement = page.getByText(/QA manual cashout /).first();
  await manualExpenseMovement.waitFor({ state: "visible", timeout: 15000 });

  const detailBody = await page.locator("body").innerText();
  if (!detailBody.includes("−Rp 1.000") && !detailBody.includes("−Rp 1.000")) {
    throw new Error("Mutasi cash out Rp 1.000 tidak ditemukan pada detail akun.");
  }

  await capture("manual-expense-cashout-ledger");
  return {
    state: "VERIFIED",
    accountHref,
    marker,
    checked: ["expense-created", "account-movement-recorded"],
  };
}
