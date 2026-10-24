export default async function scenario({ page, capture }) {
  const responses = [];
  page.on("response", async (response) => {
    if (response.status() >= 500 && response.url().includes("get_investor")) {
      responses.push({ url: response.url(), status: response.status(), body: await response.text().catch(() => "<unreadable>") });
    }
  });
  await page.waitForTimeout(3500);
  console.log(JSON.stringify(responses, null, 2));
  console.log((await page.locator("body").innerText()).slice(0, 2500));
  await capture("rpc-debug");
  return { state: "VERIFIED" };
}
