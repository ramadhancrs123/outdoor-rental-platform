export default async function walkInLivePackagePromoCard({ page, capture }) {
  const promoResponses = [];
  let writes = 0;
  page.on("response", async (response) => {
    if (!response.url().includes("/rest/v1/promosi_paket_sewa")) return;
    try {
      promoResponses.push({ status: response.status(), rows: await response.json() });
    } catch {
      promoResponses.push({ status: response.status(), rows: null });
    }
  });
  page.on("request", (request) => {
    if (request.url().includes("/rest/v1/rpc/command_create_")) writes += 1;
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Buka Katalog Rental/i }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("button", { name: /Buka Katalog Rental/i }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("heading", { name: "Katalog Rental" }).waitFor({ state: "visible", timeout: 10000 });
  await dialog.getByRole("button", { name: "Paket", exact: true }).click();

  const card = dialog.getByRole("button").filter({ hasText: "Paket camping 2 orang" }).first();
  await card.waitFor({ state: "visible", timeout: 15000 });
  await card.getByText("Promo", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
  await card.getByText(/50[.]000/).waitFor({ state: "visible", timeout: 5000 });
  await card.getByText(/80[.]000/).waitFor({ state: "visible", timeout: 5000 });
  if (!/Atur periode rental/.test(await card.innerText())) {
    throw new Error("The package card should explain that availability requires a valid rental period.");
  }

  const dimensions = await card.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    text: element.innerText,
  }));
  if (dimensions.scrollWidth > dimensions.clientWidth + 2) {
    throw new Error("Live promo price content overflows its package card: " + JSON.stringify(dimensions));
  }
  if (!promoResponses.some((response) => response.status === 200 && Array.isArray(response.rows) && response.rows.some((row) => Number(row.harga_promo) === 50000 && Number(row.harga_normal) === 80000))) {
    throw new Error("The live package promo price (Rp50.000 from Rp80.000) was not read from Supabase.");
  }
  if (writes > 0) throw new Error("Live promo display scenario unexpectedly attempted a rental write.");

  await capture("walk-in-live-package-promo-card");
  return { state: "VERIFIED", normalPrice: 80000, promoPrice: 50000, cardDimensions: dimensions, promoReads: promoResponses.length, writes };
}
