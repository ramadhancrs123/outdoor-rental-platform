export default async function investorDashboardDebugScenario({ page, capture }) {
  await page.waitForTimeout(2000);
  await capture("debug");
  return { state: "VERIFIED" };
}
