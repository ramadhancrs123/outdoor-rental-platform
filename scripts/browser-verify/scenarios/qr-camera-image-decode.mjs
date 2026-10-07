import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";

export default async function scenario({ page, baseURL, capture }) {
  if (page.url().includes("/login")) return { state: "BLOCKED_AUTH" };

  const fixturePath = path.join(process.cwd(), ".visual-verify", "qr-camera-fixture.png");
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });

  const token = process.env.QR_FIXTURE_TOKEN;
  if (!token) throw new Error("QR_FIXTURE_TOKEN belum tersedia.");

  const qrValue = baseURL + "/qr/unit/" + token;
  await QRCode.toFile(fixturePath, qrValue, {
    errorCorrectionLevel: "H",
    margin: 2,
    width: 900,
  });

  const nav = page.getByRole("navigation", { name: "Navigasi mobile" });
  await nav.waitFor({ state: "visible", timeout: 10000 });
  await nav.getByRole("button", { name: "Scan QR" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  await dialog.getByRole("button", { name: "Buka Kamera", exact: true }).waitFor({ state: "visible", timeout: 5000 });

  const fileInput = dialog.locator('input[type="file"][capture="environment"]');
  await fileInput.setInputFiles(fixturePath);

  await page.waitForURL((url) => /\/inventaris\/[^/]+$/.test(url.pathname), { timeout: 15000 });
  await page.waitForLoadState("domcontentloaded");

  const resolvedPath = new URL(page.url()).pathname;
  if (!/^\/inventaris\/[^/]+$/.test(resolvedPath)) {
    throw new Error("QR fixture tidak mengarahkan ke detail unit.");
  }

  await capture("qr-camera-image-decode");
  return { state: "VERIFIED", resolvedPath };
}
