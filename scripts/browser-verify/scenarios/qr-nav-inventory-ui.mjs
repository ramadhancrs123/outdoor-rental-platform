export default async function scenario({ page, capture }) {
  if (page.url().includes("/login")) return { state: "BLOCKED_AUTH" };
  const nav = page.getByRole("navigation", { name: "Navigasi mobile" });
  await nav.waitFor({ state: "visible", timeout: 10000 });
  if (!(await nav.getByText("Scan QR", { exact: true }).count())) throw new Error("Bottom navigation belum memiliki Scan QR.");
  if (await nav.getByText("Inventaris", { exact: true }).count()) throw new Error("Label Inventaris masih ada di bottom navigation.");
  await nav.getByRole("button", { name: "Scan QR" }).click();
  const runtime = await page.evaluate(() => ({
    isSecureContext: window.isSecureContext,
    mediaDevices: Boolean(navigator.mediaDevices),
    getUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
    barcodeDetector: "BarcodeDetector" in window,
    userAgent: navigator.userAgent,
  }));
  console.log("QR_CAMERA_RUNTIME", JSON.stringify(runtime));
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 5000 });
  if (!(await page.getByRole("dialog").getByText("Scan QR", { exact: true }).count())) throw new Error("Dialog Scan QR tidak muncul.");
  if (!(await page.getByPlaceholder("Tempel kode / tautan QR").count())) throw new Error("Fallback manual QR tidak tersedia.");
  const dialog = page.getByRole("dialog");
  if (!runtime.isSecureContext) {
    if (!(await dialog.getByText("Kamera live membutuhkan HTTPS", { exact: true }).count())) {
      throw new Error("HTTP LAN harus menjelaskan bahwa live camera membutuhkan HTTPS.");
    }
    if (await dialog.getByRole("button", { name: "Buka Kamera", exact: true }).count()) {
      throw new Error("HTTP LAN tidak boleh menawarkan file-input sebagai pengganti live scanner.");
    }
  } else {
    if (!(await dialog.getByRole("button", { name: /Kamera|Buka Kamera|Gunakan Kamera/i }).count())) {
      throw new Error("Secure runtime tidak menyediakan jalur camera/fallback.");
    }
  }
  await capture("qr-nav-inventory-ui");
  return { state: "VERIFIED" };
}
