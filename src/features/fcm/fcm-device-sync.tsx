import { useFcmDeviceRegistration } from "./use-fcm-device";

export function FcmDeviceSync() {
  const { status, tokenLength, error } = useFcmDeviceRegistration();

  // Diagnostik aman: hanya log panjang token dan status, tidak mencetak nilai token lengkap.
  // Ini memungkinkan verifikasi end-to-end tanpa membocorkan token ke konsol produksi.
  if (import.meta.env.DEV) {
    if (status === "registered") {
      console.log("[FCM] Perangkat terdaftar. Panjang token:", tokenLength, "| Status database: OK");
    } else if (status === "failed") {
      console.error("[FCM] Registrasi gagal:", error ? (error.length > 200 ? error.substring(0, 200) + "..." : error) : "Unknown error");
    } else if (status === "checking") {
      console.log("[FCM] Memeriksa token Android. Bridge tersedia:", tokenLength !== null ? "Ya (panjang: " + tokenLength + ")" : "Tidak");
    } else if (status === "idle") {
      console.log("[FCM] Status: idle — token belum tersedia atau kondisi belum siap.");
    }
  }

  // Komponen ini tidak merender UI; hanya menjalankan mekanisme registrasi.
  return null;
}
