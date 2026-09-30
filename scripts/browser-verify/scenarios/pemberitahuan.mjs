export default async function pemberitahuanScenario({ page, capture }) {
  if (page.url().includes("/login")) {
    await capture("auth-required");
    return { state: "BLOCKED_AUTH", reason: "Browser runner berada di halaman login setelah auth flow." };
  }

  await page.getByTestId("notifications-page").waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("heading", { name: "Pemberitahuan" }).waitFor({ state: "visible", timeout: 10000 });

  for (let i = 0; i < 30; i += 1) {
    if (await page.getByText("Inbox Admin", { exact: true }).count()) break;
    if (await page.getByText("Konteks Usaha belum siap.").count()) break;
    if (await page.getByText("Pemberitahuan gagal dimuat.").count()) break;
    await page.waitForTimeout(500);
  }

  if (await page.getByText("Pemberitahuan gagal dimuat.").count()) {
    await capture("notification-load-error");
    return { state: "FAILED", reason: "Notification list failed to load." };
  }

  if (!(await page.getByText("Inbox Admin", { exact: true }).count())) {
    await capture("notification-context-not-ready");
    return { state: "FAILED", reason: "Admin tenant context did not become ready." };
  }

  await capture("notification-inbox");

  const stale = page.getByText("Sumber tidak tersedia");
  if (await stale.count()) await capture("notification-stale-revalidated");

  return {
    state: "VERIFIED",
    staleNotifications: await stale.count(),
    actionableNotifications: await page.getByRole("link", { name: /Buka sumber/i }).count(),
  };
}
