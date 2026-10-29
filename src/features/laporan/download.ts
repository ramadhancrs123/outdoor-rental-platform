const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type AndroidDownloadBridge = {
  saveXlsxFromBase64?: (base64Payload: string, fileName: string) => boolean;
};

function blobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const separator = result.indexOf(",");
      if (separator < 0) {
        reject(new Error("Excel gagal disiapkan untuk disimpan."));
        return;
      }
      resolve(result.slice(separator + 1));
    };
    reader.onerror = () => reject(new Error("Excel gagal dibaca untuk disimpan."));
    reader.readAsDataURL(blob);
  });
}

/** Downloads the XLSX on web and uses the native Downloads bridge inside the Android WebView. */
export async function downloadExcelBlob(blob: Blob, fileName: string): Promise<void> {
  const bridge = (window as Window & { AndroidInterface?: AndroidDownloadBridge }).AndroidInterface;
  if (bridge) {
    if (typeof bridge.saveXlsxFromBase64 !== "function") {
      throw new Error(
        "Versi aplikasi Android belum mendukung penyimpanan Excel. Pasang APK Rental Outdoor terbaru.",
      );
    }
    const saved = bridge.saveXlsxFromBase64(await blobAsBase64(blob), fileName);
    if (!saved) {
      throw new Error("Android tidak dapat menyimpan Excel. Pastikan aplikasi terbaru terpasang, lalu coba lagi.");
    }
    return;
  }

  const url = URL.createObjectURL(new Blob([blob], { type: XLSX_MIME }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
