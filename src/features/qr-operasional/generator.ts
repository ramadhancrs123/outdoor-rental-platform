export async function generateQrSvg(value: string, size = 256) {
  if (!value.trim()) throw new Error("Nilai QR wajib diisi.");
  const { default: QRCode } = await import("qrcode");
  return QRCode.toString(value, {
    type: "svg",
    errorCorrectionLevel: "H",
    // ISO/IEC 18004 quiet zone: keep at least four modules around the QR symbol.
    margin: 4,
    width: size,
  });
}

export async function generateQrPngDataUrl(value: string, size = 512) {
  if (!value.trim()) throw new Error("Nilai QR wajib diisi.");
  const { default: QRCode } = await import("qrcode");
  return QRCode.toDataURL(value, {
    errorCorrectionLevel: "H",
    // ISO/IEC 18004 quiet zone: keep at least four modules around the QR symbol.
    margin: 4,
    width: size,
  });
}

export function dataUrlToUint8Array(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) throw new Error("Data URL QR tidak valid.");

  const binary = atob(dataUrl.slice(commaIndex + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
