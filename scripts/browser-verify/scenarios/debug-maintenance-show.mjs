export default async function debug({ page, baseURL }) {
  const id = "d371741a-1046-4c86-b811-092b54449242";
  await page.goto(baseURL + "/perawatan/" + id, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const body = await page.locator("body").innerText();
  throw new Error("BODY=" + body.slice(0, 7000));
}