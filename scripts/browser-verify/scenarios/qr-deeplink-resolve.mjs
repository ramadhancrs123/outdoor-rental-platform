export default async function scenario({ page, capture }) {
  if (page.url().includes("/login")) return { state: "BLOCKED_AUTH" };
  await page.waitForTimeout(1500);
  const body = await page.locator("body").innerText();
  const url = page.url();
  if (!/inventaris\/a9be6295-bfb9-4fd3-addc-f787a85b7569$/.test(url)) {
    throw new Error("URL=" + url + "\nBODY=" + body.slice(0, 6000));
  }

  const actionsTab = page.getByRole("navigation", { name: "Bagian detail unit" }).getByRole("button", { name: "Aksi", exact: true });
  await actionsTab.waitFor({ state: "visible", timeout: 10000 });
  await actionsTab.click();
  await page.getByRole("button", { name: /Lihat QR Unit/i }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: /Lihat QR Unit/i }).click();
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 5000 });
  if (!(await page.getByRole("dialog").getByText("QR Unit", { exact: true }).count())) {
    throw new Error("Preview QR Unit tidak muncul setelah deep-link.");
  }
  await capture("qr-deeplink-and-unit-preview");
  return { state: "VERIFIED", finalPath: new URL(url).pathname, qrPreview: true };
}
