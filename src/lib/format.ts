import type { BaseUnit } from '@/types/models'
import { roundMoney } from './numbers'

const moneyFormatter = new Intl.NumberFormat('en-MY', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const rateFormatter = new Intl.NumberFormat('en-MY', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})

const qtyFormatter = new Intl.NumberFormat('en-MY', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
})

/** `1234.5` → `RM 1,234.50`, `-12` → `-RM 12.00` */
export function formatMYR(value: number | null | undefined): string {
  const v = roundMoney(value ?? 0)
  const abs = moneyFormatter.format(Math.abs(v))
  return v < 0 ? `-RM ${abs}` : `RM ${abs}`
}

/** Unit rates keep up to 4 decimals: `RM 12.3456` */
export function formatRate(value: number | null | undefined): string {
  const v = value ?? 0
  const abs = rateFormatter.format(Math.abs(v))
  return v < 0 ? `-RM ${abs}` : `RM ${abs}`
}

export function formatNumber(value: number | null | undefined): string {
  return qtyFormatter.format(value ?? 0)
}

export const UNIT_LABELS: Record<BaseUnit, string> = {
  kg: 'kg',
  L: 'L',
  pcs: 'pcs',
}

export const UNIT_NAMES: Record<BaseUnit, string> = {
  kg: 'Kilograms (kg)',
  L: 'Litres (L)',
  pcs: 'Pieces (pcs)',
}

/** `1200.5, 'kg'` → `1,200.5 kg` */
export function formatQty(value: number | null | undefined, unit: BaseUnit): string {
  return `${formatNumber(value)} ${UNIT_LABELS[unit]}`
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(1)}%`
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`
}
