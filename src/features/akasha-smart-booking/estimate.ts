import { calculateRentalLineSubtotal, calculateTariffPeriods } from "@/features/katalog/pricing"

export type SmartBookingTariffPeriod = {
  durasi_unit: string
  durasi_nilai: number | string
}

export type SmartBookingEstimateLineInput = {
  kind: "rental" | "sale"
  quantity: number
  unit_price: number
  normal_price?: number
  durasi_unit_snapshot?: string | null
  durasi_nilai_snapshot?: number | string | null
}

export type SmartBookingEstimateTimeInput = {
  pickupAt?: string | null
  returnAt?: string | null
}

export type SmartBookingLineEstimate = {
  periods: number | null
  subtotal: number | null
  normalSubtotal: number | null
}

export type SmartBookingTotalEstimate = {
  total: number | null
  unresolvedRentalCount: number
  lines: SmartBookingLineEstimate[]
}

export type SmartBookingTotalDisplay = {
  total: number | null
  source: "calculated" | "snapshot" | "unavailable"
}

/** Prefer a reproducible calculation; otherwise show the immutable booking quote. */
export function resolveSmartBookingTotalDisplay(
  calculatedTotal: number | null,
  quoteTotal: number | null,
): SmartBookingTotalDisplay {
  if (calculatedTotal !== null && Number.isFinite(calculatedTotal) && calculatedTotal >= 0) {
    return { total: calculatedTotal, source: "calculated" }
  }
  if (quoteTotal !== null && Number.isFinite(quoteTotal) && quoteTotal >= 0) {
    return { total: quoteTotal, source: "snapshot" }
  }
  return { total: null, source: "unavailable" }
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
 * Date-only bookings use equal pickup/return clock times. If exact timestamps
 * exist, use them. Hourly tariffs require timestamps because date-only values
 * cannot establish the actual billed hours.
 */
export function calculateSmartBookingTariffPeriods(
  pickupDate: string | null,
  returnDate: string | null,
  tariff: SmartBookingTariffPeriod | null | undefined,
  pickupAt?: string | null,
  returnAt?: string | null,
): number | null {
  const durationValue = Number(tariff?.durasi_nilai)
  const durationUnit = typeof tariff?.durasi_unit === "string"
    ? tariff.durasi_unit.trim().toLowerCase()
    : null
  if (!tariff) return null
  if (!Number.isFinite(durationValue) || durationValue <= 0) return null
  if (!["jam", "hari", "minggu"].includes(durationUnit ?? "")) return null

  if (Boolean(pickupAt) !== Boolean(returnAt)) return null

  if (pickupAt && returnAt) {
    const exactStart = new Date(pickupAt)
    const exactEnd = new Date(returnAt)
    if (Number.isNaN(exactStart.getTime()) || Number.isNaN(exactEnd.getTime()) || exactEnd <= exactStart) {
      return null
    }
    const periods = calculateTariffPeriods(exactStart.toISOString(), exactEnd.toISOString(), {
      durasi_unit: durationUnit as string,
      durasi_nilai: durationValue,
    })
    return periods > 0 ? periods : null
  }

  const nights = getSmartBookingStayNights(pickupDate, returnDate)
  if (nights === null) return null
  if (durationUnit === "jam") return null
  if (nights === 0) return 1

  const start = parseDateOnly(pickupDate as string)
  const end = parseDateOnly(returnDate as string)
  if (!start || !end) return null
  const periods = calculateTariffPeriods(start.toISOString(), end.toISOString(), {
    durasi_unit: durationUnit as string,
    durasi_nilai: durationValue,
  })
  return periods > 0 ? periods : null
}

export function calculateSmartBookingLineEstimate(
  quantity: number,
  unitPrice: number,
  periods: number,
): number {
  return calculateRentalLineSubtotal(quantity, unitPrice, periods)
}

/** A sale is charged once; a rental uses its immutable tariff-duration snapshot. */
export function estimateSmartBookingLine(
  line: SmartBookingEstimateLineInput,
  pickupDate: string | null,
  returnDate: string | null,
  timeInput: SmartBookingEstimateTimeInput = {},
): SmartBookingLineEstimate {
  const periods = line.kind === "sale"
    ? 1
    : calculateSmartBookingTariffPeriods(
      pickupDate,
      returnDate,
      line.durasi_unit_snapshot && line.durasi_nilai_snapshot !== null && line.durasi_nilai_snapshot !== undefined
        ? { durasi_unit: line.durasi_unit_snapshot, durasi_nilai: line.durasi_nilai_snapshot }
        : null,
      timeInput.pickupAt,
      timeInput.returnAt,
    )

  if (
    periods === null
    || !Number.isFinite(line.quantity)
    || line.quantity <= 0
    || !Number.isFinite(line.unit_price)
    || line.unit_price < 0
  ) {
    return { periods, subtotal: null, normalSubtotal: null }
  }

  const normalPrice = line.normal_price
  const subtotal = calculateSmartBookingLineEstimate(line.quantity, line.unit_price, periods)
  const normalSubtotal = Number.isFinite(normalPrice) && (normalPrice ?? -1) >= 0
    ? calculateSmartBookingLineEstimate(line.quantity, normalPrice as number, periods)
    : null
  if (!Number.isFinite(subtotal) || subtotal < 0 || (normalSubtotal !== null && !Number.isFinite(normalSubtotal))) {
    return { periods, subtotal: null, normalSubtotal: null }
  }

  return { periods, subtotal, normalSubtotal }
}

export function estimateSmartBookingTotal(
  lines: SmartBookingEstimateLineInput[],
  pickupDate: string | null,
  returnDate: string | null,
  timeInput: SmartBookingEstimateTimeInput = {},
): SmartBookingTotalEstimate {
  const estimates = lines.map((line) => estimateSmartBookingLine(line, pickupDate, returnDate, timeInput))
  const unresolvedRentalCount = estimates.filter((estimate, index) =>
    lines[index].kind === "rental" && estimate.subtotal === null,
  ).length
  const total = estimates.length > 0 && estimates.every((estimate) => estimate.subtotal !== null)
    ? estimates.reduce((sum, estimate) => sum + (estimate.subtotal ?? 0), 0)
    : null

  return { total: total !== null && Number.isFinite(total) ? total : null, unresolvedRentalCount, lines: estimates }
}


export type SmartBookingDpEstimate = {
  percent: number | null
  remaining: number | null
  excess: number
}

export function calculateSmartBookingDpEstimate(
  estimateTotal: number | null,
  dpAmount: number | null,
): SmartBookingDpEstimate {
  if (
    estimateTotal === null
    || dpAmount === null
    || !Number.isFinite(estimateTotal)
    || !Number.isFinite(dpAmount)
    || estimateTotal < 0
    || dpAmount < 0
  ) {
    return { percent: null, remaining: null, excess: 0 }
  }

  return {
    percent: estimateTotal > 0 ? (dpAmount / estimateTotal) * 100 : (dpAmount === 0 ? 0 : null),
    remaining: Math.max(0, estimateTotal - dpAmount),
    excess: Math.max(0, dpAmount - estimateTotal),
  }
}
