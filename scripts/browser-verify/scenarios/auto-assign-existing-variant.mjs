export default async function autoAssignExistingVariant({ page, baseURL, capture }) {
  const rentalId = "fe29250a-a274-463d-8522-e8f856486e49";
  await page.goto(baseURL + "/penyewaan/" + rentalId, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(10000);
  const before = await page.locator("body").innerText();

  if (!/Penetapan unit/i.test(before)) {
    throw new Error("Panel penetapan unit tidak muncul. bodyLength=" + before.length + " head=" + before.slice(0,2000) + " tail=" + before.slice(-2000));
  }
  if (!before.includes("Tetapkan Otomatis")) {
    throw new Error("Tombol auto assignment variant tidak tersedia.");
  }
  if (!before.includes("Tetapkan Unit")) {
    throw new Error("Tombol manual assignment tidak tersedia.");
  }

  await page.getByRole("button", { name: "Tetapkan Otomatis", exact: true }).click();
  await page.waitForTimeout(10000);
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const after = await page.locator("body").innerText();

  if (!after.includes("Lengkap")) throw new Error("Auto assignment belum mencapai Lengkap.");
  if (!after.includes("Selesaikan Serah-terima")) throw new Error("Rental tidak tetap menunggu pickup.");
  await capture("auto-assignment-existing-variant");

  return { state: "VERIFIED", rentalId };
}
