import { nowISO } from '@/lib/dates'
import { formatQty } from '@/lib/format'
import { isNonNegative, isPositive, lte, roundMoney, roundQty, roundRate, sum, EPSILON } from '@/lib/numbers'
import { packageSize } from '@/lib/packaging'
import { derivePaymentStatus } from '@/lib/stock'
import type { Actor, Batch, LotCost, Material, Movement, Sale, SaleLine } from '@/types/models'
import { AppError, type DocumentStore } from '../backend/types'
import {
  applyPayment,
  assertAdmin,
  commitCounter,
  optionalText,
  readMaterial,
  readNextNumber,
  requireDate,
  requireText,
  voidPaymentEntry,
  type PaymentInput,
} from './common'

export interface SaleLineInput {
  materialId: string
  packagingId: string | null
  packageQty: number
  packagePrice: number
  /** Which batches to deduct from (pre-filled FEFO by the UI, editable by the admin) */
  allocations: Array<{ batchId: string; quantity: number }>
}

export interface SaleInput {
  customer: string
  customerRef: string
  saleDate: string
  notes: string
  lines: SaleLineInput[]
}

/** Record a dispatch: deducts the allocated batches and stores revenue + actual batch cost, atomically. */
export async function createSale(store: DocumentStore, actor: Actor, input: SaleInput): Promise<string> {
  const customer = requireText(input.customer, 'Customer')
  const saleDate = requireDate(input.saleDate, 'Sale date')
  if (input.lines.length === 0) throw new AppError('Add at least one line item.')
  const id = store.newId('sales')

  await store.runTransaction(async (tx) => {
    await assertAdmin(tx, actor)
    const materials = new Map<string, Material>()
    for (const mid of new Set(input.lines.map((l) => l.materialId))) {
      if (!mid) throw new AppError('Select a material on every line.')
      const m = await readMaterial(tx, mid)
      if (!m.active) throw new AppError(`Material "${m.name}" is inactive.`)
      materials.set(mid, m)
    }
    const batches = new Map<string, Batch>()
    for (const bid of new Set(input.lines.flatMap((l) => l.allocations.map((a) => a.batchId)))) {
      const b = await tx.get<Batch>('batches', bid)
      if (!b) throw new AppError('A selected batch no longer exists.')
      batches.set(bid, b)
    }
    const costs = new Map<string, LotCost>()
    for (const lotId of new Set([...batches.values()].map((b) => b.lotId))) {
      const c = await tx.get<LotCost>('lotCosts', lotId)
      if (!c) throw new AppError('Cost record for a selected batch is missing.')
      costs.set(lotId, c)
    }
    const counter = await readNextNumber(tx, 'SO', saleDate)

    // ── validate & build ──
    const used = new Map<string, number>()
    const lines: SaleLine[] = input.lines.map((l, i) => {
      const n = i + 1
      const m = materials.get(l.materialId)!
      const size = packageSize(m.packaging, l.packagingId)
      if (size === null) throw new AppError(`Line ${n}: the selected packaging for ${m.name} is invalid.`)
      if (!isPositive(l.packageQty)) throw new AppError(`Line ${n}: quantity must be greater than 0.`)
      if (!isNonNegative(l.packagePrice)) throw new AppError(`Line ${n}: price cannot be negative.`)
      const quantity = roundQty(l.packageQty * size)
      const allocs = l.allocations.filter((a) => a.quantity > EPSILON)
      const allocated = roundQty(sum(allocs.map((a) => a.quantity)))
      if (Math.abs(allocated - quantity) > 0.0005) {
        throw new AppError(
          `Line ${n} (${m.name}): batches allocated ${formatQty(allocated, m.baseUnit)} but the line needs ${formatQty(quantity, m.baseUnit)}.`,
        )
      }
      const allocations = allocs.map((a) => {
        const b = batches.get(a.batchId)!
        if (b.materialId !== m.id) throw new AppError(`Line ${n}: batch ${b.batchNo} is not ${m.name}.`)
        const q = roundQty(a.quantity)
        used.set(b.id, roundQty((used.get(b.id) ?? 0) + q))
        return { batchId: b.id, lotId: b.lotId, locationId: b.locationId, quantity: q, unitCost: costs.get(b.lotId)!.unitCost }
      })
      const lineCost = roundMoney(sum(allocations.map((a) => a.quantity * a.unitCost)))
      const lineRevenue = roundMoney(l.packageQty * l.packagePrice)
      return {
        id: store.newId('sales'),
        materialId: m.id,
        packagingId: l.packagingId,
        packageQty: l.packageQty,
        packagePrice: roundRate(l.packagePrice),
        quantity,
        unitPrice: roundRate(l.packagePrice / size),
        lineRevenue,
        lineCost,
        allocations,
      }
    })
    for (const [bid, q] of used) {
      const b = batches.get(bid)!
      if (!lte(q, b.quantity)) {
        const m = materials.get(b.materialId)
        throw new AppError(
          `Batch ${b.batchNo} only has ${formatQty(b.quantity, m?.baseUnit ?? 'kg')} left — ${formatQty(q, m?.baseUnit ?? 'kg')} was requested. Refresh and try again.`,
        )
      }
    }

    // ── writes ──
    const now = nowISO()
    for (const [bid, q] of used) {
      const b = batches.get(bid)!
      tx.update('batches', bid, { quantity: roundQty(b.quantity - q), updatedAt: now })
    }
    for (const line of lines) {
      for (const a of line.allocations) {
        const movement: Omit<Movement, 'id'> = {
          type: 'sale',
          materialId: line.materialId,
          locationId: a.locationId,
          lotId: a.lotId,
          batchId: a.batchId,
          quantity: -a.quantity,
          refType: 'sale',
          refId: id,
          refNumber: counter.number,
          date: saleDate,
          createdAt: now,
          createdBy: actor.email,
        }
        tx.set('movements', store.newId('movements'), movement)
      }
    }
    const totalAmount = roundMoney(sum(lines.map((l) => l.lineRevenue)))
    const totalCost = roundMoney(sum(lines.map((l) => l.lineCost)))
    const sale: Omit<Sale, 'id'> = {
      saleNumber: counter.number,
      customer,
      customerRef: optionalText(input.customerRef, 'Customer reference', 100),
      saleDate,
      lines,
      totalAmount,
      totalCost,
      grossMargin: roundMoney(totalAmount - totalCost),
      amountCollected: 0,
      paymentStatus: derivePaymentStatus(0, totalAmount),
      payments: [],
      status: 'completed',
      notes: optionalText(input.notes, 'Notes'),
      createdAt: now,
      createdBy: actor.email,
      updatedAt: now,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
    }
    commitCounter(tx, counter)
    tx.set('sales', id, sale)
  })
  return id
}

/** Header-only edit. Changing quantities requires voiding and re-entering (keeps the ledger honest). */
export async function updateSaleDetails(
  store: DocumentStore,
  actor: Actor,
  saleId: string,
  input: { customer: string; customerRef: string; notes: string },
): Promise<void> {
  const customer = requireText(input.customer, 'Customer')
  await store.runTransaction(async (tx) => {
    await assertAdmin(tx, actor)
    const sale = await tx.get<Sale>('sales', saleId)
    if (!sale) throw new AppError('Sale not found.')
    if (sale.status === 'void') throw new AppError('A voided sale cannot be edited.')
    tx.update('sales', saleId, {
      customer,
      customerRef: optionalText(input.customerRef, 'Customer reference', 100),
      notes: optionalText(input.notes, 'Notes'),
      updatedAt: nowISO(),
    })
  })
}

/** Void a sale: returns every allocated quantity to its batch and writes reversing ledger entries. */
export async function voidSale(store: DocumentStore, actor: Actor, saleId: string, reason: string): Promise<void> {
  const why = requireText(reason, 'Reason for voiding', 300)
  await store.runTransaction(async (tx) => {
    await assertAdmin(tx, actor)
    const sale = await tx.get<Sale>('sales', saleId)
    if (!sale) throw new AppError('Sale not found.')
    if (sale.status === 'void') throw new AppError('This sale is already void.')
    const batches = new Map<string, Batch>()
    for (const bid of new Set(sale.lines.flatMap((l) => l.allocations.map((a) => a.batchId)))) {
      const b = await tx.get<Batch>('batches', bid)
      if (!b) throw new AppError('A batch from this sale could not be found.')
      batches.set(bid, b)
    }
    const now = nowISO()
    const restore = new Map<string, number>()
    for (const line of sale.lines) {
      for (const a of line.allocations) {
        restore.set(a.batchId, roundQty((restore.get(a.batchId) ?? 0) + a.quantity))
        const movement: Omit<Movement, 'id'> = {
          type: 'sale_void',
          materialId: line.materialId,
          locationId: a.locationId,
          lotId: a.lotId,
          batchId: a.batchId,
          quantity: a.quantity,
          refType: 'sale',
          refId: saleId,
          refNumber: sale.saleNumber,
          date: sale.saleDate,
          createdAt: now,
          createdBy: actor.email,
        }
        tx.set('movements', store.newId('movements'), movement)
      }
    }
    for (const [bid, q] of restore) {
      const b = batches.get(bid)!
      tx.update('batches', bid, { quantity: roundQty(b.quantity + q), updatedAt: now })
    }
    tx.update('sales', saleId, {
      status: 'void',
      voidedAt: now,
      voidedBy: actor.email,
      voidReason: why,
      updatedAt: now,
    })
  })
}

export async function recordSaleCollection(
  store: DocumentStore,
  actor: Actor,
  saleId: string,
  input: PaymentInput,
): Promise<void> {
  await store.runTransaction(async (tx) => {
    await assertAdmin(tx, actor)
    const sale = await tx.get<Sale>('sales', saleId)
    if (!sale) throw new AppError('Sale not found.')
    if (sale.status === 'void') throw new AppError('Cannot record a collection on a voided sale.')
    const now = nowISO()
    const r = applyPayment(sale.payments, sale.totalAmount, input, actor, store.newId('sales'), now)
    tx.update('sales', saleId, {
      payments: r.payments,
      amountCollected: r.paid,
      paymentStatus: r.status,
      updatedAt: now,
    })
  })
}

export async function voidSaleCollection(
  store: DocumentStore,
  actor: Actor,
  saleId: string,
  paymentId: string,
): Promise<void> {
  await store.runTransaction(async (tx) => {
    await assertAdmin(tx, actor)
    const sale = await tx.get<Sale>('sales', saleId)
    if (!sale) throw new AppError('Sale not found.')
    const now = nowISO()
    const r = voidPaymentEntry(sale.payments, sale.totalAmount, paymentId, actor, now)
    tx.update('sales', saleId, {
      payments: r.payments,
      amountCollected: r.paid,
      paymentStatus: r.status,
      updatedAt: now,
    })
  })
}

