export default async function location403Scenario({ page, baseURL, capture }) {
  page.on("response", async (response) => {
    if (response.url().includes("/rest/v1/lokasi")) {
      console.log("LOKASI_RESPONSE", response.status(), response.url());
      try { console.log("LOKASI_BODY", (await response.text()).slice(0, 2000)); } catch {}
      console.log("LOKASI_HEADERS", JSON.stringify(response.headers()));
    }
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("/rest/v1/lokasi")) console.log("LOKASI_REQUEST_FAILED", request.url(), request.failure());
  });
  await page.goto(baseURL + "/inventaris/lokasi", {waitUntil:"domcontentloaded"});
  await page.waitForLoadState("networkidle").catch(()=>{});
  await page.waitForTimeout(2000);
  await capture("inventaris-lokasi-debug");
  return {state:"VERIFIED", url:page.url()};
}
