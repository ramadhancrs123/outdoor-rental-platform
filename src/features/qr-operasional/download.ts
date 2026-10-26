type AndroidDownloadBridge = {
  savePdfFromBase64?: (base64Payload: string, fileName: string) => boolean;
};

function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const separator = result.indexOf(",");
      if (separator < 0) {
        reject(new Error("PDF gagal disiapkan untuk disimpan."));
        return;
      }
      resolve(result.slice(separator + 1));
    };
    reader.onerror = () => reject(new Error("PDF gagal dibaca untuk disimpan."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Saves generated PDF bytes through the Android bridge when running in the
 * trusted WebView. Regular browsers continue to use the browser download flow.
 */
export async function downloadPdfBytes(bytes: Uint8Array, fileName: string): Promise<void> {
  const safeBytes = new Uint8Array(bytes.byteLength);
  safeBytes.set(bytes);
  const blob = new Blob([safeBytes.buffer], { type: "application/pdf" });
  const bridge = (window as Window & { AndroidInterface?: AndroidDownloadBridge }).AndroidInterface;

  if (bridge) {
    if (typeof bridge.savePdfFromBase64 !== "function") {
      throw new Error("Versi aplikasi Android belum mendukung penyimpanan PDF. Pasang APK Rental Outdoor terbaru.");
    }
    const saved = bridge.savePdfFromBase64(await readBlobAsBase64(blob), fileName);
    if (!saved) {
      throw new Error("Android tidak dapat menyimpan PDF. Pastikan aplikasi terbaru terpasang, lalu coba lagi.");
    }
    return;
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
}
