export default async function inventarisScenario({ page, capture }) {
  const badResponses = [];
  const requestFailures = [];
  const pageErrors = [];

  page.on("response", (response) => {
    if (!response.url().includes("/rest/v1/")) return;
    const pathname = new URL(response.url()).pathname;
    if (
      pathname.includes("unit_barang") ||
      pathname.includes("barang") ||
      pathname.includes("varian_barang") ||
      pathname.includes("lokasi")
    ) {
      if (response.status() >= 300) {
        badResponses.push({
          status: response.status(),
          method: response.request().method(),
          url: response.url(),
        });
      }
    }
  });
  page.on("requestfailed", (request) => {
    requestFailures.push({
      method: request.method(),
      url: request.url(),
      failure: request.failure()?.errorText ?? "failed",
    });
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.getByText("Unit Barang", { exact: true }).waitFor({ state: "visible" });
  await page.waitForTimeout(2500);

  const bodyText = await page.locator("body").innerText();
  if (bodyText.includes("Data unit belum dapat ditampilkan")) {
    throw new Error("Inventaris masih menampilkan error pemuatan unit.");
  }

  if (!bodyText.includes("Unit Barang") || !/(\d+) unit|Tidak ada unit/.test(bodyText)) {
    throw new Error("Inventaris tidak mencapai state list/empty-state unit yang valid.");
  }

  if (badResponses.length || requestFailures.length || pageErrors.length) {
    throw new Error(
      JSON.stringify({ badResponses, requestFailures, pageErrors }, null, 2),
    );
  }

  await capture("inventaris-list");
  return { state: "VERIFIED", finalURL: page.url() };
}
