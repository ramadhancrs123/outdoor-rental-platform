export default async function financeAccountLedgerVisibility({ page, capture }) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);

  const accountTab = page.getByRole("link", { name: "Akun Uang", exact: true }).first();
  if (!(await accountTab.isVisible().catch(() => false))) {
    const body = await page.locator("body").innerText();
    throw new Error("Tab Akun Uang tidak terlihat di halaman Keuangan. BODY=" + body.slice(0, 5000));
  }

  await accountTab.click();
  await page.waitForLoadState("domcontentloaded");
  await page.getByText("Akun Uang", { exact: true }).first().waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(500);

  if (!page.url().includes("/keuangan/akun")) {
    throw new Error("Tab Akun Uang tidak membuka route yang benar: " + page.url());
  }

  const qris = page.getByText("Akasha Qris", { exact: true }).first();
  const saldo = page.getByText(/Rp\s*15\.000/).first();
  const mutation = page.getByRole("link", { name: /Lihat Mutasi/i }).last();

  await qris.waitFor({ state: "visible", timeout: 10_000 });
  if (!(await qris.isVisible().catch(() => false))) {
    const body = await page.locator("body").innerText();
    throw new Error("Akun Akasha Qris tidak terlihat. BODY=" + body.slice(0, 5000));
  }
  if (!(await saldo.isVisible().catch(() => false))) {
    const body = await page.locator("body").innerText();
    throw new Error("Saldo Akasha Qris Rp15.000 tidak terlihat. BODY=" + body.slice(0, 5000));
  }
  if (!(await mutation.isVisible().catch(() => false))) {
    throw new Error("CTA Lihat Mutasi tidak terlihat.");
  }

  await mutation.click();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(900);

  if (!page.url().includes("/keuangan/akun/")) {
    throw new Error("Detail akun tidak terbuka: " + page.url());
  }

  const detailTitle = page.getByText("Mutasi Akun", { exact: true }).first();
  const paymentMovement = page.getByText(/Pembayaran #6/).first();
  const incoming = page.getByText(/\+\s*Rp\s*15\.000/).first();

  await detailTitle.waitFor({ state: "visible", timeout: 10_000 });
  if (!(await detailTitle.isVisible().catch(() => false))) {
    const body = await page.locator("body").innerText();
    throw new Error("Section Mutasi Akun tidak terlihat. BODY=" + body.slice(0, 5000));
  }
  await paymentMovement.waitFor({ state: "visible", timeout: 10_000 });
  await incoming.waitFor({ state: "visible", timeout: 10_000 });
  if (!(await paymentMovement.isVisible().catch(() => false))) throw new Error("Mutasi pembayaran #6 tidak terlihat.");
  if (!(await incoming.isVisible().catch(() => false))) throw new Error("Mutasi masuk Rp15.000 tidak terlihat.");

  const metrics = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  if (metrics.scrollWidth > metrics.clientWidth) throw new Error("Horizontal overflow: " + JSON.stringify(metrics));

  await capture("finance-account-ledger-visibility");
  return { state: "VERIFIED", accountTab: true, accountSummary: true, accountDetail: true, overflow: false };
}
