import type { Batch, BusinessDate, PaymentEntry, PaymentStatus } from '@/types/models'
import { daysBetween } from './dates'
import { EPSILON, gte, roundMoney, roundQty, sum } from './numbers'

export interface Allocation {
  batchId: string
  quantity: number
}

/**
 * First-Expiry-First-Out ordering: earliest expiry first, batches without expiry last,
 * ties broken by oldest receipt then batch id (stable and deterministic).
 */
export function compareFefo(a: Batch, b: Batch): number {
  if (a.expiryDate !== b.expiryDate) {
    if (a.expiryDate === null) return 1
    if (b.expiryDate === null) return -1
    return a.expiryDate < b.expiryDate ? -1 : 1
  }
  if (a.receivedDate !== b.receivedDate) return a.receivedDate < b.receivedDate ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Suggest FEFO allocations for `quantity` from `candidates` (already filtered by material / location).
 * Expired batches are skipped unless `includeExpired` is true. Returns the shortfall when stock is insufficient.
 */
export function allocateFefo(
  candidates: Batch[],
  quantity: number,
  today: BusinessDate,
  includeExpired = false,
): { allocations: Allocation[]; shortfall: number } {
  const usable = candidates
    .filter((b) => b.quantity > EPSILON)
    .filter((b) => includeExpired || b.expiryDate === null || b.expiryDate >= today)
    .sort(compareFefo)
  let remaining = roundQty(quantity)
  const allocations: Allocation[] = []
  for (const b of usable) {
    if (remaining <= EPSILON) break
    const take = roundQty(Math.min(b.quantity, remaining))
    allocations.push({ batchId: b.id, quantity: take })
    remaining = roundQty(remaining - take)
  }
  return { allocations, shortfall: remaining > EPSILON ? remaining : 0 }
}

export type ExpiryBucket = 'expired' | 'd30' | 'd60' | 'd90' | 'ok' | 'none'

export const EXPIRY_WINDOWS = [30, 60, 90] as const

export function expiryBucket(expiryDate: BusinessDate | null, today: BusinessDate): ExpiryBucket {
  if (!expiryDate) return 'none'
  const days = daysBetween(today, expiryDate)
  if (days < 0) return 'expired'
  if (days <= 30) return 'd30'
  if (days <= 60) return 'd60'
  if (days <= 90) return 'd90'
  return 'ok'
}

export function daysToExpiry(expiryDate: BusinessDate | null, today: BusinessDate): number | null {
  return expiryDate ? daysBetween(today, expiryDate) : null
}

/** Sum of non-voided payments. */
export function paidTotal(payments: PaymentEntry[]): number {
  return roundMoney(sum(payments.filter((p) => !p.voided).map((p) => p.amount)))
}

export function derivePaymentStatus(paid: number, total: number): PaymentStatus {
  if (total <= EPSILON) return 'paid' // nothing to pay (e.g. free samples)
  if (paid <= EPSILON) return 'unpaid'
  if (gte(paid, total)) return 'paid'
  return 'partial'
}
