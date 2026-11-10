import { calculateRentalLineSubtotal, calculateTariffPeriods } from "@/features/katalog/pricing"

export type SmartBookingTariffPeriod = {
  durasi_unit: string
  durasi_nilai: number
}

function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null
  return date
}

export function getSmartBookingStayNights(pickupDate: string | null, returnDate: string | null): number | null {
  if (!pickupDate || !returnDate) return null
  const pickup = parseDateOnly(pickupDate)
  const returned = parseDateOnly(returnDate)
  if (!pickup || !returned || returned < pickup) return null
  return Math.round((returned.getTime() - pickup.getTime()) / 86_400_000)
}

export function formatSmartBookingStayLabel(pickupDate: string | null, returnDate: string | null): string | null {
  const nights = getSmartBookingStayNights(pickupDate, returnDate)
  if (nights === null) return null
  return nights === 0 ? "1 hari" : (nights + 1) + " hari " + nights + " malam"
}

/**
 * Estimates a date-only booking as if pickup and return use the same local
 * clock time. Admin Walk-in later recalculates using the actual handover times.
 */
export function calculateSmartBookingTariffPeriods(
  pickupDate: string | null,
  returnDate: string | null,
  tariff: SmartBookingTariffPeriod | null | undefined,
): number | null {
  const nights = getSmartBookingStayNights(pickupDate, returnDate)
  if (nights === null || !tariff) return null
  if (!Number.isFinite(tariff.durasi_nilai) || tariff.durasi_nilai <= 0) return null
  if (!["jam", "hari", "minggu"].includes(tariff.durasi_unit.trim().toLowerCase())) return null
  if (nights === 0) return 1

  const start = parseDateOnly(pickupDate as string)
  const end = parseDateOnly(returnDate as string)
  if (!start || !end) return null
  const periods = calculateTariffPeriods(start.toISOString(), end.toISOString(), tariff)
  return periods > 0 ? periods : null
}

export function calculateSmartBookingLineEstimate(
  quantity: number,
  unitPrice: number,
  periods: number,
): number {
  return calculateRentalLineSubtotal(quantity, unitPrice, periods)
}
