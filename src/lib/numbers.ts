/** Tolerance for floating-point comparisons of quantities (base units) and money. */
export const EPSILON = 1e-6

function roundTo(value: number, dp: number): number {
  if (!Number.isFinite(value) || value === 0) return 0
  // Decimal-string shifting avoids binary artefacts (1.005 → 1.01, not 1.00). Half rounds away from zero.
  const abs = Math.abs(value)
  const shifted = Math.round(Number(`${abs}e${dp}`))
  const result = Number(`${shifted}e-${dp}`)
  const magnitude = Number.isFinite(result) ? result : Math.round(abs * 10 ** dp) / 10 ** dp
  if (magnitude === 0) return 0
  return value < 0 ? -magnitude : magnitude
}

/** Money totals (sen precision). */
export const roundMoney = (v: number) => roundTo(v, 2)
/** Unit cost / unit price per base unit. */
export const roundRate = (v: number) => roundTo(v, 6)
/** Quantities in base units (gram / millilitre precision). */
export const roundQty = (v: number) => roundTo(v, 3)

export const isZero = (v: number) => Math.abs(v) < EPSILON
export const gte = (a: number, b: number) => a > b - EPSILON
export const lte = (a: number, b: number) => a < b + EPSILON

export function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0)
}

/** True for finite numbers > 0. */
export function isPositive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > EPSILON
}

/** True for finite numbers >= 0. */
export function isNonNegative(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > -EPSILON
}
