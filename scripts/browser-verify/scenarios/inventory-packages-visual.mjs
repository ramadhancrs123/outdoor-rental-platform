export default async function inventoryPackagesVisualScenario({ page, capture }) {
  await page.getByRole("button", { name: "Paket", exact: true }).click();
  await page.waitForTimeout(500);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  if (overflow) throw new Error("Tab Paket memiliki horizontal overflow.");

  const cards = page.locator("main .grid > .rounded-xl");
  if (!(await cards.count())) {
    return {
      state: "BLOCKED_FIXTURE",
      reason: "Belum ada paket aktif untuk divisualisasikan.",
    };
  }

  const firstCard = cards.first();
  await firstCard.waitFor({ state: "visible", timeout: 10000 });

  const mediaHeights = await cards.locator("div.relative").evaluateAll(
    (elements) => elements.map((element) => Math.round(element.getBoundingClientRect().height)),
  );

  const cardHeights = await cards.evaluateAll(
    (elements) => elements.slice(0, 6).map((element) => Math.round(element.getBoundingClientRect().height)),
  );

  await capture("inventory-packages");

  return {
    state: "VERIFIED",
    cards: await cards.count(),
    mediaHeights,
    cardHeights,
    mobileFriendly: cardHeights.every((height) => height < 500),
  };
}
