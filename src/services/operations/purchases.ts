import { nowISO } from '@/lib/dates'
import { formatQty } from '@/lib/format'
import { batchIdFor } from '@/lib/ids'
import { gte, isNonNegative, isPositive, lte, roundMoney, roundQty, roundRate, sum } from '@/lib/numbers'
import { packageSize } from '@/lib/packaging'
import { derivePaymentStatus } from '@/lib/stock'
import type {
  Actor,
  Batch,
  LotCost,
  Material,
  Movement,
  POLine,
  POReceipt,
  POStatus,
  PurchaseOrder,
} from '@/types/models'
import { AppError, type DocumentStore, type Transaction } from '../backend/types'
import {
  applyPayment,
  assertAdmin,
  commitCounter,
  optionalDate,
  optionalText,
  readActiveLocation,
  readMaterial,
  readNextNumber,
  requireDate,
  requireText,
  voidPaymentEntry,
  type PaymentInput,
} from './common'

export interface POLineInput {
  id?: string
  materialId: string
  packagingId: string | null
  packageQty: number
  packagePrice: number
}

export interface POInput {
  supplier: string
  supplierRef: string
  orderDate: string
  expectedDate: string | null
  notes: string
  lines: POLineInput[]
}

function buildLines(store: DocumentStore, materials: Map<string, Material>, inputs: POLineInput[]): POLine[] {
  if (inputs.length === 0) throw new AppError('Add at least one line item.')
  return inputs.map((l, i) => {
    const n = i + 1
    const m = materials.get(l.materialId)
    if (!m) throw new AppError(`Line ${n}: select a material.`)
    const size = packageSize(m.packaging, l.packagingId)
    if (size === null) throw new AppError(`Line ${n}: the selected packaging for ${m.name} is invalid.`)
    if (!isPositive(l.packageQty)) throw new AppError(`Line ${n}: quantity must be greater than 0.`)
    if (!isNonNegative(l.packagePrice)) throw new AppError(`Line ${n}: price cannot be negative.`)
    const quantity = roundQty(l.packageQty * size)
    if (!isPositive(quantity)) throw new AppError(`Line ${n}: quantity is too small.`)
    return {
      id: l.id || store.newId('purchaseOrders'),
      materialId: m.id,
      packagingId: l.packagingId,
      packageQty: l.packageQty,
      packagePrice: roundRate(l.packagePrice),
      quantity,
      unitCost: roundRate(l.packagePrice / size),
      lineTotal: roundMoney(l.packageQty * l.packagePrice),
      receivedQty: 0,
    }
  })
}

async function readLineMaterials(
  tx: Transaction,
  lines: POLineInput[],
  requireActive: boolean,
): Promise<Map<string, Material>> {
  const map = new Map<string, Material>()
  for (const id of new Set(lines.map((l) => l.materialId).filter(Boolean))) {
    const m = await readMaterial(tx, id)
    if (requireActive && !m.active) throw new AppError(`Material "${m.name}" is inactive.`)
    map.set(id, m)
  }
  return map
}

export async function createPurchaseOrder(store: DocumentStore, actor: Actor, input: POInput): Promise<string> {
  const supplier = requireText(input.supplier, 'Supplier')
  const orderDate = requireDate(input.orderDate, 'Order date')
  const expectedDate = optionalDate(input.expectedDate, 'Expected date')
  const id = store.newId('purchaseOrders')
  await store.runTransaction(async (tx) => {
    await assertAdmin(tx, actor)
    const materials = await readLineMaterials(tx, input.lines, true)
    const counter = await readNextNumber(tx, 'PO', orderDate)
    const lines = buildLines(store, materials, input.lines)
    const totalAmount = roundMoney(sum(lines.map((l) => l.lineTotal)))
    const now = nowISO()
    const po: Omit<PurchaseOrder, 'id'> = {
      poNumber: counter.number,
      supplier,
      supplierRef: optionalText(input.supplierRef, 'Supplier reference', 100),
      orderDate,
      expectedDate,
      lines,
      receipts: [],
      totalAmount,
      amountPaid: 0,
      paymentStatus: derivePaymentStatus(0, totalAmount),
      payments: [],
      status: 'ordered',
      notes: optionalText(input.notes, 'Notes'),
      createdAt: now,
      createdBy: actor.email,
      updatedAt: now,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
    }
    commitCounter(tx, counter)
    tx.set('purchaseOrders', id, po)
  })
  return id
}

/**
 * Edit a PO. Header fields can always be edited on a non-void PO.
 * Line items can only be changed while nothing has been received.
 */
export async function updatePurchaseOrder(
  store: DocumentStore,
  actor: Actor,
  poId: string,
  input: POInput,
): Promise<void> {
  const supplier = requireText(input.supplier, 'Supplier')
  const orderDate = requireDate(input.orderDate, 'Order date')
  const expectedDate = optionalDate(input.expectedDate, 'Expected date')
  await store.runTransaction(async (tx) => {
    await assertAdmin(tx, actor)
    const po = await tx.get<PurchaseOrder>('purchaseOrders', poId)
    if (!po) throw new AppError('Purchase order not found.')
    if (po.status === 'void') throw new AppError('A voided purchase order cannot be edited.')
    const canEditLines = po.receipts.length === 0
    const materials = canEditLines ? await readLineMaterials(tx, input.lines, false) : new Map<string, Material>()
    const patch: Partial<PurchaseOrder> = {
      supplier,
      supplierRef: optionalText(input.supplierRef, 'Supplier reference', 100),
      orderDate,
      expectedDate,
      notes: optionalText(input.notes, 'Notes'),
      updatedAt: nowISO(),
    }
    if (canEditLines) {
      // Lines that already existed keep their material active-check relaxed; new materials must be active.
      for (const l of input.lines) {
        const m = materials.get(l.materialId)
        const existed = po.lines.some((pl) => pl.materialId === l.materialId)
        if (m && !m.active && !existed) throw new AppError(`Material "${m.name}" is inactive.`)
      }
      const lines = buildLines(store, materials, input.lines)
      const totalAmount = roundMoney(sum(lines.map((l) => l.lineTotal)))
      if (!lte(po.amountPaid, totalAmount)) {
        throw new AppError('The new total is lower than the amount already paid. Void a payment first.')
      }
      patch.lines = lines
      patch.totalAmount = totalAmount
      patch.paymentStatus = derivePaymentStatus(po.amountPaid, totalAmount)
    }
    tx.update('purchaseOrders', poId, patch)
  })
}

export interface ReceiptInput {
  lineId: string
  quantity: number
  locationId: string
  batchNo: string
  expiryDate: string | null
  receivedDate: string
}

/** Receive stock against PO lines. Each receipt creates a new lot (batch + cost) in one atomic write. */
export async function receivePurchaseOrder(
  store: DocumentStore,
  actor: Actor,
  poId: string,
  inputs: ReceiptInput[],
): Promise<void> {
  const receiptsIn = inputs.filter((r) => isPositive(r.quantity))
  if (receiptsIn.length === 0) throw new AppError('Enter a quantity to receive for at least one line.')
  await store.runTransaction(async (tx) => {
    await assertAdmin(tx, actor)
    const po = await tx.get<PurchaseOrder>('purchaseOrders', poId)
    if (!po) throw new AppError('Purchase order not found.')
    if (po.status === 'void') throw new AppError('Cannot receive against a voided purchase order.')
    if (po.status === 'received') throw new AppError('This purchase order has already been fully received.')
    for (const locId of new Set(receiptsIn.map((r) => r.locationId))) {
      if (!locId) throw new AppError('Select a location for every received line.')
      await readActiveLocation(tx, locId)
    }
    const materials = new Map<string, Material>()
    for (const matId of new Set(po.lines.map((l) => l.materialId))) {
      const m = await tx.get<Material>('materials', matId)
      if (m) materials.set(matId, m)
    }

    // ── all reads done; validate and build writes ──
    const now = nowISO()
    const lines = po.lines.map((l) => ({ ...l }))
    const newReceipts: POReceipt[] = []
    for (const r of receiptsIn) {
      const line = lines.find((l) => l.id === r.lineId)
      if (!line) throw new AppError('A receipt refers to a line that is not on this purchase order.')
      const material = materials.get(line.materialId)
      const unit = material?.baseUnit ?? 'kg'
      const qty = roundQty(r.quantity)
      const remaining = roundQty(line.quantity - line.receivedQty)
      if (!lte(qty, remaining)) {
        throw new AppError(
          `${material?.name ?? 'Line'}: receiving ${formatQty(qty, unit)} exceeds the ${formatQty(remaining, unit)} still outstanding.`,
        )
      }
      const receivedDate = requireDate(r.receivedDate, 'Received date')
      const expiryDate = optionalDate(r.expiryDate, 'Expiry date')
      // Supplier batch number is optional; fall back to a traceable PO-based lot number.
      const batchNo =
        optionalText(r.batchNo, 'Batch number', 60) || `${po.poNumber}-L${po.receipts.length + newReceipts.length + 1}`
      line.receivedQty = roundQty(line.receivedQty + qty)

      const lotId = store.newId('lotCosts')
      const batchId = batchIdFor(lotId, r.locationId)
      const batch: Omit<Batch, 'id'> = {
        lotId,
        materialId: line.materialId,
        locationId: r.locationId,
        batchNo,
        expiryDate,
        quantity: qty,
        receivedDate,
        poId,
        createdAt: now,
        updatedAt: now,
      }
      const lotCost: Omit<LotCost, 'id'> = {
        materialId: line.materialId,
        poId,
        poLineId: line.id,
        unitCost: line.unitCost,
        receivedQty: qty,
        createdAt: now,
      }
      const movement: Omit<Movement, 'id'> = {
        type: 'po_receipt',
        materialId: line.materialId,
        locationId: r.locationId,
        lotId,
        batchId,
        quantity: qty,
        refType: 'purchaseOrder',
        refId: poId,
        refNumber: po.poNumber,
        date: receivedDate,
        createdAt: now,
        createdBy: actor.email,
      }
      tx.set('batches', batchId, batch)
      tx.set('lotCosts', lotId, lotCost)
      tx.set('movements', store.newId('movements'), movement)
      newReceipts.push({
        id: store.newId('purchaseOrders'),
        lineId: line.id,
        lotId,
        batchId,
        locationId: r.locationId,
        batchNo,
        expiryDate,
        quantity: qty,
        receivedDate,
        recordedAt: now,
        recordedBy: actor.email,
      })
    }
    const allReceived = lines.every((l) => gte(l.receivedQty, l.quantity))
    const status: POStatus = allReceived ? 'received' : 'partially_received'
    tx.update('purchaseOrders', poId, {
      lines,
      receipts: [...po.receipts, ...newReceipts],
      status,
      updatedAt: now,
    })
  })
}

/**
 * Void a PO. Every lot it created must still be complete and untouched at its receiving location
 * (otherwise void the dependent sales / transfers first). Writes reversing ledger entries.
 */
export async function voidPurchaseOrder(
  store: DocumentStore,
  actor: Actor,
  poId: string,
  reason: string,
): Promise<void> {
  const why = requireText(reason, 'Reason for voiding', 300)
  await store.runTransaction(async (tx) => {
    await assertAdmin(tx, actor)
    const po = await tx.get<PurchaseOrder>('purchaseOrders', poId)
    if (!po) throw new AppError('Purchase order not found.')
    if (po.status === 'void') throw new AppError('This purchase order is already void.')
    const batches = new Map<string, Batch>()
    for (const r of po.receipts) {
      const b = await tx.get<Batch>('batches', r.batchId)
      if (!b) throw new AppError(`Batch ${r.batchNo} could not be found.`)
      batches.set(r.batchId, b)
    }
    for (const r of po.receipts) {
      const b = batches.get(r.batchId)!
      if (!gte(b.quantity, r.quantity)) {
        throw new AppError(
          `Batch ${r.batchNo} has been partly sold or transferred. Void those sales/transfers before voiding this purchase order.`,
        )
      }
    }
    const now = nowISO()
    for (const r of po.receipts) {
      const b = batches.get(r.batchId)!
      tx.update('batches', r.batchId, { quantity: roundQty(b.quantity - r.quantity), updatedAt: now })
      const movement: Omit<Movement, 'id'> = {
        type: 'po_void',
        materialId: b.materialId,
        locationId: b.locationId,
        lotId: b.lotId,
        batchId: b.id,
        quantity: -r.quantity,
        refType: 'purchaseOrder',
        refId: poId,
        refNumber: po.poNumber,
        date: r.receivedDate,
        createdAt: now,
        createdBy: actor.email,
      }
      tx.set('movements', store.newId('movements'), movement)
    }
    tx.update('purchaseOrders', poId, {
      status: 'void',
      voidedAt: now,
      voidedBy: actor.email,
      voidReason: why,
      updatedAt: now,
    })
  })
}

export async function recordPurchasePayment(
  store: DocumentStore,
  actor: Actor,
  poId: string,
  input: PaymentInput,
): Promise<void> {
  await store.runTransaction(async (tx) => {
    await assertAdmin(tx, actor)
    const po = await tx.get<PurchaseOrder>('purchaseOrders', poId)
    if (!po) throw new AppError('Purchase order not found.')
    if (po.status === 'void') throw new AppError('Cannot record a payment on a voided purchase order.')
    const now = nowISO()
    const r = applyPayment(po.payments, po.totalAmount, input, actor, store.newId('purchaseOrders'), now)
    tx.update('purchaseOrders', poId, {
      payments: r.payments,
      amountPaid: r.paid,
      paymentStatus: r.status,
      updatedAt: now,
    })
  })
}

export async function voidPurchasePayment(
  store: DocumentStore,
  actor: Actor,
  poId: string,
  paymentId: string,
): Promise<void> {
  await store.runTransaction(async (tx) => {
    await assertAdmin(tx, actor)
    const po = await tx.get<PurchaseOrder>('purchaseOrders', poId)
    if (!po) throw new AppError('Purchase order not found.')
    const now = nowISO()
    const r = voidPaymentEntry(po.payments, po.totalAmount, paymentId, actor, now)
    tx.update('purchaseOrders', poId, {
      payments: r.payments,
      amountPaid: r.paid,
      paymentStatus: r.status,
      updatedAt: now,
    })
  })
}
