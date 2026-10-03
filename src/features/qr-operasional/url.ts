import {
  QR_PENYEWAAN_ROUTE_PREFIX,
  QR_UNIT_ROUTE_PREFIX,
} from "./constants";

function cleanBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function buildUnitQrUrl(baseUrl: string, tokenQr: string) {
  if (!tokenQr.trim()) throw new Error("Token QR unit wajib diisi.");
  return cleanBaseUrl(baseUrl) + QR_UNIT_ROUTE_PREFIX + "/" + encodeURIComponent(tokenQr.trim());
}

export function buildPenyewaanQrUrl(baseUrl: string, tokenQr: string) {
  if (!tokenQr.trim()) throw new Error("Token QR penyewaan wajib diisi.");
  return cleanBaseUrl(baseUrl) + QR_PENYEWAAN_ROUTE_PREFIX + "/" + encodeURIComponent(tokenQr.trim());
}
