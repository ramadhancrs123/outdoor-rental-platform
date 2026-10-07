export default async function inspectRentalAutoUI({ page, baseURL }) {
  await page.goto(baseURL + "/penyewaan/fe29250a-a274-463d-8522-e8f856486e49", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const body = await page.locator("body").innerText();
  return { state: "VERIFIED", relevant: body.split("\n").filter((x) => /penetapan|tetapkan|unit|serah/i.test(x)).slice(-80) };
}
