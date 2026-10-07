export default async function financeAccountSetupVisibility({ page, capture }) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);

  const heading = page.getByText("Akun uang", { exact: true }).first();
  const setupTitle = page.getByText("Belum ada akun uang", { exact: true }).first();
  const createButton = page.getByRole("button", { name: /Buat Akun/i }).first();

  if (!(await heading.isVisible().catch(() => false))) throw new Error("Section Akun uang tidak terlihat.");
  if (!(await setupTitle.isVisible().catch(() => false))) throw new Error("Empty/setup state akun uang tidak terlihat.");
  if (!(await createButton.isVisible().catch(() => false))) throw new Error("CTA Buat Akun tidak terlihat.");

  await capture("finance-account-setup-visibility");
  return { state: "VERIFIED", setupVisible: true, createActionVisible: true };
}
