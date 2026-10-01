export default async function loginScenario({ page, baseURL, capture }) {
  await page.route("**/auth/v1/token*", async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "invalid_grant",
        error_description: "Invalid login credentials",
      }),
    });
  });

  await page.route("**/auth/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/token") && url.searchParams.get("grant_type") !== "password") {
      await route.continue();
      return;
    }
    await route.continue();
  });

  await page.goto(baseURL + "/login", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByRole("heading", { level: 2, name: "Masuk ke Akasha" }).waitFor({ state: "visible" });
  await page.getByLabel("Email atau nomor telepon").waitFor({ state: "visible" });
  const passwordInput = page.getByRole("textbox", { name: "Kata sandi", exact: true });
  await passwordInput.waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Masuk", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button").filter({ hasText: "Google" }).first().waitFor({ state: "visible" });
  await page.getByRole("button").filter({ hasText: "GitHub" }).first().waitFor({ state: "visible" });

  await page.getByLabel("Email atau nomor telepon").fill("admin@akasha.com");
  await passwordInput.fill("contoh-password");
  const passwordTypeBefore = await passwordInput.getAttribute("type");
  await page.getByRole("button", { name: "Tampilkan kata sandi" }).click();
  const passwordTypeAfter = await passwordInput.getAttribute("type");
  if (passwordTypeBefore !== "password" || passwordTypeAfter !== "text") {
    throw new Error("Password visibility toggle tidak bekerja.");
  }
  await page.getByRole("button", { name: "Sembunyikan kata sandi" }).click();

  await page.getByRole("checkbox", { name: "Ingat saya" }).click();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) throw new Error("Login memiliki horizontal overflow.");

  await capture("login-interaction-ready");
  return {
    state: "VERIFIED",
    checked: [
      "brand/presentation",
      "login-form",
      "password-toggle",
      "remember-me",
      "oauth-buttons",
      "no-horizontal-overflow",
    ],
  };
}
