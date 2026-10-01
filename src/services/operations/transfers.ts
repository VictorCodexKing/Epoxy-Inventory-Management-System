import { nowISO } from '@/lib/dates'
import { formatQty } from '@/lib/format'
import { batchIdFor } from '@/lib/ids'
import { EPSILON, gte, isPositive, lte, roundQty } from '@/lib/numbers'
import type { Actor, Batch, Material, Movement, Transfer, TransferLine } from '@/types/models'
import { AppError, type DocumentStore } from '../backend/types'
import {
  assertAdmin,
  commitCounter,
  optionalText,
  readActiveLocation,
  readNextNumber,
  requireDate,
  requireText,
} from './common'

export interface TransferInput {
  transferDate: string
  fromLocationId: string
  toLocationId: string
  notes: string
  lines: Array<{ batchId: string; quantity: number }>
}

/** Move batch quantities between two locations as ONE all-or-nothing write. */
export async function createTransfer(store: DocumentStore, actor: Actor, input: TransferInput): Promise<string> {
  const transferDate = requireDate(input.transferDate, 'Transfer date')
  if (!input.fromLocationId || !input.toLocationId) throw new AppError('Select both a source and a destination.')
  if (input.fromLocationId === input.toLocationId) throw new AppError('Source and destination must be different.')
  const linesIn = input.lines.filter((l) => l.quantity > EPSILON)
  if (linesIn.length === 0) throw new AppError('Enter a quantity for at least one batch.')
  const id = store.newId('transfers')

  await store.runTransaction(async (tx) => {
    await assertAdmin(tx, actor)
    const from = await tx.get<{ id: string; name: string }>('locations', input.fromLocationId)
    if (!from) throw new AppError('Source location no longer exists.')
    const to = await readActiveLocation(tx, input.toLocationId)

    // Merge duplicate rows for the same batch.
    const qtyByBatch = new Map<string, number>()
    for (const l of linesIn) {
      if (!isPositive(l.quantity)) throw new AppError('Transfer quantities must be greater than 0.')
      qtyByBatch.set(l.batchId, roundQty((qtyByBatch.get(l.batchId) ?? 0) + l.quantity))
    }
    const sources = new Map<string, Batch>()
    for (const bid of qtyByBatch.keys()) {
      const b = await tx.get<Batch>('batches', bid)
      if (!b) throw new AppError('A selected batch no longer exists.')
      if (b.locationId !== from.id) throw new AppError(`Batch ${b.batchNo} is not at ${from.name}.`)
      sources.set(bid, b)
    }
    const dests = new Map<string, Batch | null>()
    for (const b of sources.values()) {
      const destId = batchIdFor(b.lotId, to.id)
      dests.set(destId, await tx.get<Batch>('batches', destId))
    }
    const units = new Map<string, Material['baseUnit']>()
    for (const mid of new Set([...sources.values()].map((b) => b.materialId))) {
      const m = await tx.get<Material>('materials', mid)
      units.set(mid, m?.baseUnit ?? 'kg')
    }
    const counter = await readNextNumber(tx, 'TR', transferDate)

    // ── validate ──
    for (const [bid, q] of qtyByBatch) {
      const b = sources.get(bid)!
      if (!lte(q, b.quantity)) {
        const u = units.get(b.materialId) ?? 'kg'
        throw new AppError(
          `Batch ${b.batchNo} only has ${formatQty(b.quantity, u)} at ${from.name} — cannot move ${formatQty(q, u)}.`,
        )
      }
    }

    // ── writes ──
    const now = nowISO()
    const lines: TransferLine[] = []
    for (const [bid, q] of qtyByBatch) {
      const src = sources.get(bid)!
      const destId = batchIdFor(src.lotId, to.id)
      const dest = dests.get(destId) ?? null
      tx.update('batches', bid, { quantity: roundQty(src.quantity - q), updatedAt: now })
      if (dest) {
        tx.update('batches', destId, { quantity: roundQty(dest.quantity + q), updatedAt: now })
      } else {
        const created: Omit<Batch, 'id'> = {
          lotId: src.lotId,
          materialId: src.materialId,
          locationId: to.id,
          batchNo: src.batchNo,
          expiryDate: src.expiryDate,
          quantity: q,
          receivedDate: src.receivedDate,
          poId: src.poId,
          createdAt: now,
          updatedAt: now,
        }
        tx.set('batches', destId, created)
      }
      const base = {
        materialId: src.materialId,
        lotId: src.lotId,
        refType: 'transfer' as const,
        refId: id,
        refNumber: counter.number,
        date: transferDate,
        createdAt: now,
        createdBy: actor.email,
      }
      const out: Omit<Movement, 'id'> = { ...base, type: 'transfer_out', locationId: from.id, batchId: bid, quantity: -q }
      const inn: Omit<Movement, 'id'> = { ...base, type: 'transfer_in', locationId: to.id, batchId: destId, quantity: q }
      tx.set('movements', store.newId('movements'), out)
      tx.set('movements', store.newId('movements'), inn)
      lines.push({ id: store.newId('transfers'), materialId: src.materialId, lotId: src.lotId, fromBatchId: bid, toBatchId: destId, quantity: q })
    }
    const transfer: Omit<Transfer, 'id'> = {
      transferNumber: counter.number,
      transferDate,
      fromLocationId: from.id,
      toLocationId: to.id,
      lines,
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
    tx.set('transfers', id, transfer)
  })
  return id
}

/** Void a transfer: moves the quantities back. The destination must still hold them. */
export async function voidTransfer(store: DocumentStore, actor: Actor, transferId: string, reason: string): Promise<void> {
  const why = requireText(reason, 'Reason for voiding', 300)
  await store.runTransaction(async (tx) => {
    await assertAdmin(tx, actor)
    const t = await tx.get<Transfer>('transfers', transferId)
    if (!t) throw new AppError('Transfer not found.')
    if (t.status === 'void') throw new AppError('This transfer is already void.')
    const docs = new Map<string, Batch>()
    for (const bid of new Set(t.lines.flatMap((l) => [l.fromBatchId, l.toBatchId]))) {
      const b = await tx.get<Batch>('batches', bid)
      if (!b) throw new AppError('A batch from this transfer could not be found.')
      docs.set(bid, b)
    }
    // Net quantity change per batch (handles a batch appearing on several lines).
    const delta = new Map<string, number>()
    for (const l of t.lines) {
      delta.set(l.toBatchId, roundQty((delta.get(l.toBatchId) ?? 0) - l.quantity))
      delta.set(l.fromBatchId, roundQty((delta.get(l.fromBatchId) ?? 0) + l.quantity))
    }
    for (const [bid, d] of delta) {
      const b = docs.get(bid)!
      if (!gte(b.quantity + d, 0)) {
        throw new AppError(
          `Batch ${b.batchNo} no longer has enough stock at the destination to reverse this transfer (it was sold or moved on). Void those records first.`,
        )
      }
    }
    const now = nowISO()
    for (const [bid, d] of delta) {
      const b = docs.get(bid)!
      tx.update('batches', bid, { quantity: roundQty(Math.max(0, b.quantity + d)), updatedAt: now })
    }
    for (const l of t.lines) {
      const base = {
        materialId: l.materialId,
        lotId: l.lotId,
        refType: 'transfer' as const,
        refId: t.id,
        refNumber: t.transferNumber,
        date: t.transferDate,
        createdAt: now,
        createdBy: actor.email,
      }
      const back: Omit<Movement, 'id'> = { ...base, type: 'transfer_void_out', locationId: t.toLocationId, batchId: l.toBatchId, quantity: -l.quantity }
      const ret: Omit<Movement, 'id'> = { ...base, type: 'transfer_void_in', locationId: t.fromLocationId, batchId: l.fromBatchId, quantity: l.quantity }
      tx.set('movements', store.newId('movements'), back)
      tx.set('movements', store.newId('movements'), ret)
    }
    tx.update('transfers', transferId, {
      status: 'void',
      voidedAt: now,
      voidedBy: actor.email,
      voidReason: why,
      updatedAt: now,
    })
  })
}
