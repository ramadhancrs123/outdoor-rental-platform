export default async function debug({ page, baseURL }) {
  await page.goto(baseURL + "/perawatan/create", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /Pilih unit langsung/i }).click();
  await page.waitForTimeout(1200);
  const body = await page.locator("body").innerText();
  const buttons = await page.locator("button").allTextContents();
  throw new Error("BODY=" + body.slice(0, 5000) + " BUTTONS=" + JSON.stringify(buttons.slice(-50)));
}