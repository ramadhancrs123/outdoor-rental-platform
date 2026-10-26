/**
 * Bridge notifikasi denda native (Android) dari admin panel.
 *
 * Kontrak native (rental-android, RentalFineManager):
 * - AndroidInterface.startRentalFine(payloadJson): mulai/perbarui notifikasi
 *   denda berjalan. Payload: { rentalId, nomor, enabled, ratePerHour,
 *   currencyCode, jadwalKembali, toleranceDeadline, actualReturn }.
 *   Formula native identik calculate_rental_late_fee (ceil per jam).
 * - AndroidInterface.stopRentalFine(rentalId): batalkan notifikasi.
 * - AndroidInterface.getActiveRentalFine(): state aktif sebagai JSON string.
 *
 * Aman dipanggil di browser biasa: semua helper no-op bila bridge tidak ada.
 */

export type RentalFineBridge = {
  startRentalFine?: (payloadJson: string) => void;
  stopRentalFine?: (rentalId: string) => void;
  getActiveRentalFine?: () => string;
};

export type RentalFinePayload = {
  rentalId: string;
  nomor: string;
  enabled: boolean;
  ratePerHour: number;
  currencyCode: string;
  jadwalKembali: string | null;
  toleranceDeadline: string | null;
  actualReturn: string | null;
};

type BridgeWindow = Window & {
  AndroidInterface?: RentalFineBridge | null;
  JSBridge?: RentalFineBridge | null;
};

function getRentalFineBridge(): RentalFineBridge | null {
  try {
    if (typeof window === "undefined") return null;
    const bridges = window as BridgeWindow;
    const candidates = [bridges.AndroidInterface, bridges.JSBridge];
    for (const bridge of candidates) {
      if (bridge && typeof bridge.startRentalFine === "function") return bridge;
    }
    return null;
  } catch {
    return null;
  }
}

export function hasRentalFineBridge(): boolean {
  return getRentalFineBridge() !== null;
}

/** Mulai/perbarui notifikasi denda native. No-op di browser biasa. */
export function pushRentalFineToAndroid(payload: RentalFinePayload): void {
  const bridge = getRentalFineBridge();
  if (!bridge || typeof bridge.startRentalFine !== "function") return;
  try {
    bridge.startRentalFine(JSON.stringify(payload));
  } catch {
    // Bridge harusnya tidak pernah melempar; jaga-jaga agar UI tidak ikut gagal.
  }
}

/** Batalkan notifikasi denda native. No-op di browser biasa. */
export function stopRentalFineOnAndroid(rentalId: string | null | undefined): void {
  if (!rentalId) return;
  const bridge = getRentalFineBridge();
  if (!bridge || typeof bridge.stopRentalFine !== "function") return;
  try {
    bridge.stopRentalFine(rentalId);
  } catch {
    // Sama seperti di atas: jangan pernah sampai mengganggu UI.
  }
}
