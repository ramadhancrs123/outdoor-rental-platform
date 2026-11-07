export default async function eventPromotionCheckoutPolicy({ page, capture }) {
  const policyResponses = [];
  page.on("response", (response) => {
    if (response.url().includes("/rest/v1/kebijakan_diskon_checkout")) {
      policyResponses.push({ status: response.status(), url: response.url() });
    }
  });

  const policyRead = page.waitForResponse(
    (response) => response.url().includes("/rest/v1/kebijakan_diskon_checkout"),
    { timeout: 20000 },
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Event & Promosi" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Diskon checkout" }).click();
  await page.getByText("Kebijakan diskon checkout", { exact: true }).first().waitFor({ state: "visible" });

  const response = await policyRead;
  if (response.status() !== 200) {
    throw new Error("Baca kebijakan checkout gagal HTTP " + response.status());
  }

  const bodyText = await page.locator("body").innerText();
  if (
    bodyText.includes("Pastikan migrasi Phase 4") ||
    bodyText.includes("Kebijakan diskon belum dapat dibaca")
  ) {
    throw new Error("UI masih menampilkan error migrasi Phase 4 setelah schema tersedia.");
  }

  await capture("event-promotion-checkout-policy-read");
  return {
    state: "VERIFIED",
    policyResponses,
    checks: [
      "authenticated-event-promotion-route",
      "checkout-policy-rest-read-http-200",
      "no-stale-phase4-migration-error",
      "no-production-data-mutated",
    ],
  };
}
