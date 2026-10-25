export type ParsedQrValue = { jenis?: "unit" | "penyewaan"; token: string };

export function parseQrValue(value: string): ParsedQrValue {
  const raw = value.trim();
  if (!raw) return { token: "" };

  try {
    const url = new URL(raw, window.location.origin);
    const segments = url.pathname.split("/").filter(Boolean);
    const qrIndex = segments.indexOf("qr");
    if (qrIndex >= 0 && segments[qrIndex + 1] === "unit" && segments[qrIndex + 2]) {
      return { jenis: "unit", token: decodeURIComponent(segments[qrIndex + 2]) };
    }
    if (qrIndex >= 0 && segments[qrIndex + 1] === "penyewaan" && segments[qrIndex + 2]) {
      return { jenis: "penyewaan", token: decodeURIComponent(segments[qrIndex + 2]) };
    }
  } catch {
    // Raw token fallback.
  }

  return { token: raw };
}
