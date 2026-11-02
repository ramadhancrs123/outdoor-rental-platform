export default async function walkInPeriodAwarePackageStock({ page, capture }) {
  const candidateResponses = [];
  page.on("response", async (response) => {
    if (!response.url().includes("/rest/v1/rpc/find_inventory_unit_candidates")) return;
    try {
      candidateResponses.push({ status: response.status(), body: await response.json() });
    } catch {
      candidateResponses.push({ status: response.status(), body: null });
    }
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  const periodInputs = page.locator('input[type="datetime-local"]');
  await periodInputs.nth(0).waitFor({ state: "visible", timeout: 10000 });
  const start = new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(Date.now() + 49 * 60 * 60 * 1000);
  const localValue = (value) => {
    const pad = (n) => String(n).padStart(2, "0");
    return value.getFullYear() + "-" + pad(value.getMonth() + 1) + "-" + pad(value.getDate()) +
      "T" + pad(value.getHours()) + ":" + pad(value.getMinutes());
  };
  await periodInputs.nth(0).fill(localValue(start));
  await periodInputs.nth(1).fill(localValue(end));

  const catalogButton = page.getByRole("button", { name: /Buka Katalog Rental/i });
  await catalogButton.waitFor({ state: "visible", timeout: 15000 });
  await catalogButton.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  await dialog.getByRole("button", { name: "Paket", exact: true }).click();
  await dialog.getByText("Paket camping 2 orang", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  for (let attempt = 0; attempt < 40 && candidateResponses.length < 2; attempt += 1) {
    await page.waitForTimeout(250);
  }

  const packageCard = dialog.getByRole("button").filter({ hasText: "Paket camping 2 orang" }).first();
  const cardText = await packageCard.innerText();
  const availableText = cardText.match(/Ready\s+(\d+)/i);
  if (!availableText || Number(availableText[1]) < 1) {
    throw new Error("Variant-only package components were not resolved to ready physical units: " + cardText + " | candidate RPC: " + JSON.stringify(candidateResponses));
  }
  if (candidateResponses.length < 2 || candidateResponses.some((response) => response.status !== 200)) {
    throw new Error("Expected successful candidate RPC checks for the tent and tracking-pole variants.");
  }

  await packageCard.click();
  const packageAddButton = dialog.getByRole("button", { name: /Tambah Paket ke Keranjang$/i });
  await packageAddButton.waitFor({ state: "visible", timeout: 10000 });
  for (let attempt = 0; attempt < 40 && await packageAddButton.isDisabled(); attempt += 1) {
    await page.waitForTimeout(250);
  }
  if (await packageAddButton.isDisabled()) {
    throw new Error("Package with sufficient ready stock was blocked from the rental cart. Detail: " + await dialog.innerText());
  }
  await capture("walk-in-period-aware-package-stock");
  return { state: "VERIFIED", candidateRpcCallsObserved: candidateResponses.length, packageAvailability: cardText, addDisabled: false };
}
