export default async function eventPromotionsAdminReadOnly({ page, capture }) {
  if (page.url().includes("/login")) {
    await capture("auth-required");
    return { state: "BLOCKED_AUTH", reason: "Modul promosi memerlukan admin terautentikasi." };
  }

  await page.getByRole("heading", { name: /Event & Promosi/i })
    .waitFor({ state: "visible", timeout: 15000 });

  const tabs = [
    ["Promo katalog", "Buat promosi katalog"],
    ["Promo paket", "Kelola promosi paket"],
    ["Loyalitas", "Program loyalitas · Model A"],
    ["Diskon checkout", "Kebijakan diskon checkout"]
  ];

  for (const [tab, expectedHeading] of tabs) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await page.getByText(expectedHeading, { exact: true })
      .waitFor({ state: "visible", timeout: 10000 });
    await capture("event-promotions-" + tab.toLowerCase().replaceAll(" ", "-"));
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  if (overflow) throw new Error("Modul event & promosi mengalami horizontal overflow.");

  const diagnostics = await page.locator("body").innerText();
  if (/column .* does not exist|permission denied|schema cache|VALIDATION_ERROR/i.test(diagnostics)) {
    throw new Error("UI menampilkan error backend/schema pada modul event & promosi.");
  }

  return {
    state: "VERIFIED",
    checks: [
      "catalog-promotion-admin-read",
      "package-promotion-admin-read",
      "loyalty-model-a-admin-read",
      "checkout-policy-admin-read",
      "responsive-layout",
      "no-write-actions-submitted"
    ]
  };
}
