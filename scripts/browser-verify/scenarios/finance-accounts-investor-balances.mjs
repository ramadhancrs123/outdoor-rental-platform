export default async function financeAccountsInvestorBalancesScenario({ page, capture }) {
  if (page.url().includes("/login")) {
    await capture("auth-required");
    return { state: "BLOCKED_AUTH", reason: "Halaman Akun Uang membutuhkan sesi admin." };
  }

  await page.getByRole("heading", { name: "Akun Uang", exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Saldo pemilik dicatat terpisah", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Saldo Investor (tercatat)", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Saldo Pengelola (tercatat)", { exact: true }).waitFor({ state: "visible", timeout: 10000 });

  const investorSection = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Saldo Investor (tercatat)", exact: true }),
  }).first();
  const investorNames = await investorSection.locator("article p").allTextContents();

  await page.getByRole("button", { name: "Tambah akun", exact: true }).click();
  await page.getByLabel("Kode akun", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
  await page.getByText(/Akun dibuat sebagai Akun Usaha \/ operasional/).waitFor({ state: "visible", timeout: 5000 });
  await page.getByText(/tidak membuat profil Investor atau Pengelola/).waitFor({ state: "visible", timeout: 5000 });
  // No submit: this is a non-mutating acceptance check of the account semantics.

  await page.getByRole("link", { name: /Konfigurasi Investor/ }).click();
  await page.getByRole("heading", { name: "Konfigurasi Investor" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("link", { name: "Kembali ke Akun Uang" }).click();
  await page.getByRole("heading", { name: "Akun Uang", exact: true }).waitFor({ state: "visible", timeout: 10000 });

  await page.getByRole("link", { name: /Buka Portal Investor/ }).click();
  await page.getByText(/^(Estimasi Hak Investor|Alokasi Final Investor)$/, { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await page.goto(new URL("/keuangan/akun", page.url()).href, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Akun Uang", exact: true }).waitFor({ state: "visible", timeout: 10000 });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) throw new Error("Finance accounts horizontal overflow.");
  await capture("finance-account-investor-balances");

  if (investorNames.length === 0) {
    throw new Error("Investor balance section is visible but has no rows or empty state.");
  }

  return {
    state: "VERIFIED",
    checks: [
      "finance-accounts-page-visible",
      "physical-investor-balance-section-visible",
      "operator-balance-section-visible",
      "owner-balances-explained-separately-from-operational-total",
      "account-creation-is-operational-only",
      "config-is-master-and-return-link-works",
      "portal-investor-link-opens-dashboard",
      "no-horizontal-overflow",
      "no-financial-mutation-issued",
    ],
    investorSectionText: investorNames,
    horizontalOverflow: overflow,
    persistedChanges: false,
  };
}
