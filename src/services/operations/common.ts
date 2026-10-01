import { isValidBusinessDate, yearOf } from '@/lib/dates'
import { formatDocNumber } from '@/lib/ids'
import { formatMYR } from '@/lib/format'
import { isPositive, lte, roundMoney } from '@/lib/numbers'
import { paidTotal, derivePaymentStatus } from '@/lib/stock'
import type { Actor, Counter, Material, PaymentEntry, PaymentStatus, StorageLocation, UserProfile } from '@/types/models'
import { AppError, type Transaction } from '../backend/types'

export type DocPrefix = 'PO' | 'SO' | 'TR'

/** Reads the next sequence number. Caller MUST later call `commitCounter` (writes come after reads). */
export async function readNextNumber(
  tx: Transaction,
  prefix: DocPrefix,
  date: string,
): Promise<{ key: string; seq: number; number: string }> {
  const year = yearOf(date)
  const key = `${prefix}-${year}`
  const counter = await tx.get<Counter>('counters', key)
  const seq = (counter?.value ?? 0) + 1
  return { key, seq, number: formatDocNumber(prefix, year, seq) }
}

export function commitCounter(tx: Transaction, counter: { key: string; seq: number }): void {
  tx.set('counters', counter.key, { value: counter.seq })
}

/** Verifies the actor is an active Super Admin (defence in depth — Security Rules enforce the same). */
export async function assertAdmin(tx: Transaction, actor: Actor): Promise<UserProfile> {
  const me = await tx.get<UserProfile>('users', actor.uid)
  if (!me || me.status !== 'active' || me.role !== 'admin') {
    throw new AppError('Only a Super Admin can perform this action.')
  }
  return me
}

export function requireText(value: string | null | undefined, label: string, max = 200): string {
  const v = (value ?? '').trim()
  if (!v) throw new AppError(`${label} is required.`)
  if (v.length > max) throw new AppError(`${label} must be ${max} characters or fewer.`)
  return v
}

export function optionalText(value: string | null | undefined, label: string, max = 1000): string {
  const v = (value ?? '').trim()
  if (v.length > max) throw new AppError(`${label} must be ${max} characters or fewer.`)
  return v
}

export function requireDate(value: string | null | undefined, label: string): string {
  if (!isValidBusinessDate(value)) throw new AppError(`${label} must be a valid date.`)
  return value
}

export function optionalDate(value: string | null | undefined, label: string): string | null {
  if (value === null || value === undefined || value === '') return null
  return requireDate(value, label)
}

export async function readMaterial(tx: Transaction, id: string): Promise<Material> {
  const m = await tx.get<Material>('materials', id)
  if (!m) throw new AppError('A selected material no longer exists.')
  return m
}

export async function readActiveLocation(tx: Transaction, id: string): Promise<StorageLocation> {
  const loc = await tx.get<StorageLocation>('locations', id)
  if (!loc) throw new AppError('A selected location no longer exists.')
  if (!loc.active) throw new AppError(`Location "${loc.name}" is inactive.`)
  return loc
}

export interface PaymentInput {
  date: string
  amount: number
  reference: string
  note: string
}

/** Appends a payment, enforcing 0 < amount ≤ outstanding. Returns the new payment fields to write. */
export function applyPayment(
  payments: PaymentEntry[],
  total: number,
  input: PaymentInput,
  actor: Actor,
  newId: string,
  now: string,
): { payments: PaymentEntry[]; paid: number; status: PaymentStatus } {
  const date = requireDate(input.date, 'Payment date')
  if (!isPositive(input.amount)) throw new AppError('Payment amount must be greater than RM 0.00.')
  const amount = roundMoney(input.amount)
  const outstanding = roundMoney(total - paidTotal(payments))
  if (!lte(amount, outstanding)) {
    throw new AppError(`Payment exceeds the outstanding balance of ${formatMYR(outstanding)}.`)
  }
  const entry: PaymentEntry = {
    id: newId,
    date,
    amount,
    reference: optionalText(input.reference, 'Reference', 100),
    note: optionalText(input.note, 'Note', 500),
    recordedAt: now,
    recordedBy: actor.email,
    voided: false,
    voidedAt: null,
    voidedBy: null,
  }
  const next = [...payments, entry]
  const paid = paidTotal(next)
  return { payments: next, paid, status: derivePaymentStatus(paid, total) }
}

export function voidPaymentEntry(
  payments: PaymentEntry[],
  total: number,
  paymentId: string,
  actor: Actor,
  now: string,
): { payments: PaymentEntry[]; paid: number; status: PaymentStatus } {
  const target = payments.find((p) => p.id === paymentId)
  if (!target) throw new AppError('Payment not found.')
  if (target.voided) throw new AppError('This payment has already been voided.')
  const next = payments.map((p) =>
    p.id === paymentId ? { ...p, voided: true, voidedAt: now, voidedBy: actor.email } : p,
  )
  const paid = paidTotal(next)
  return { payments: next, paid, status: derivePaymentStatus(paid, total) }
}
