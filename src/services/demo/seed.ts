/**
 * Demo data. Everything after the user profiles is created through the real business operations,
 * so the seeded ledger is exactly what the app itself would produce.
 */
import { addDays, nowISO, todayMY } from '@/lib/dates'
import { randomId } from '@/lib/ids'
import { allocateFefo } from '@/lib/stock'
import type { Actor, Batch, PurchaseOrder, StorageLocation, UserProfile } from '@/types/models'
import type { CollectionName, DocumentStore } from '../backend/types'
import { DEMO_ACCOUNTS } from '../backend/demo'
import { saveLocation, saveMaterial } from '../operations/catalog'
import { createPurchaseOrder, receivePurchaseOrder, recordPurchasePayment } from '../operations/purchases'
import { createSale, recordSaleCollection } from '../operations/sales'
import { createTransfer } from '../operations/transfers'

function readAll<T extends { id: string }>(store: DocumentStore, name: CollectionName): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const off = store.subscribeCollection<T>(
      name,
      (docs) => {
        queueMicrotask(() => off())
        resolve(docs)
      },
      reject,
    )
  })
}

export async function seedDemoData(store: DocumentStore): Promise<void> {
  const today = todayMY()
  const d = (offset: number) => addDays(today, offset)
  const now = nowISO()
  const roles: Record<string, UserProfile['role']> = { 'demo-admin': 'admin', 'demo-user': 'user', 'demo-store': 'user' }

  await store.runTransaction(async (tx) => {
    for (const a of DEMO_ACCOUNTS) {
      const profile: Omit<UserProfile, 'id'> = {
        email: a.email,
        displayName: a.displayName,
        role: roles[a.uid] ?? 'user',
        status: 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        deletedBy: null,
      }
      tx.set('users', a.uid, profile)
    }
  })
  const admin: Actor = { uid: 'demo-admin', email: 'admin@eims.demo' }

  // ── Materials ──
  const drumA = randomId()
  const pailA = randomId()
  const resin = await saveMaterial(
    store,
    admin,
    null,
    {
      code: 'EPX-A',
      name: 'Epoxy Resin (Part A)',
      baseUnit: 'kg',
      packaging: [
        { id: drumA, name: 'Drum', contains: 200, of: 'base' },
        { id: pailA, name: 'Pail', contains: 20, of: 'base' },
      ],
      lowStockThreshold: 400,
      notes: 'Bisphenol-A base resin. Store 15–30 °C, keep sealed.',
      active: true,
    },
    { existing: [] },
  )
  const can = randomId()
  const box = randomId()
  const drumB = randomId()
  const hardener = await saveMaterial(
    store,
    admin,
    null,
    {
      code: 'HRD-B',
      name: 'Hardener (Part B)',
      baseUnit: 'L',
      packaging: [
        { id: drumB, name: 'Drum', contains: 200, of: 'base' },
        { id: box, name: 'Box', contains: 12, of: can },
        { id: can, name: 'Can', contains: 1, of: 'base' },
      ],
      lowStockThreshold: 150,
      notes: 'Amine curing agent. Mix ratio 2:1 with Part A by volume.',
      active: true,
    },
    { existing: [{ id: resin, name: 'Epoxy Resin (Part A)', code: 'EPX-A' }] },
  )
  const bag = randomId()
  const pallet = randomId()
  const plastics = await saveMaterial(
    store,
    admin,
    null,
    {
      code: 'PLS',
      name: 'Plastics',
      baseUnit: 'kg',
      packaging: [
        { id: pallet, name: 'Pallet', contains: 40, of: bag },
        { id: bag, name: 'Bag', contains: 25, of: 'base' },
      ],
      lowStockThreshold: 500,
      notes: 'HDPE granules for pail moulding.',
      active: true,
    },
    {
      existing: [
        { id: resin, name: 'Epoxy Resin (Part A)', code: 'EPX-A' },
        { id: hardener, name: 'Hardener (Part B)', code: 'HRD-B' },
      ],
    },
  )

  // ── Locations ──
  const locs: Record<string, string> = {}
  const locDefs: Array<[string, StorageLocation['type'], string]> = [
    ['WWRC', 'internal', 'Main warehouse'],
    ['Bintulu', 'vendor', 'Third-party vendor warehouse, Sarawak'],
    ['Semenyih', 'internal', 'Production plant store, Selangor'],
    ['Taman Desa', 'vendor', 'Third-party vendor warehouse, Kuala Lumpur'],
  ]
  for (const [name, type, address] of locDefs) {
    locs[name] = await saveLocation(store, admin, null, { name, type, address, active: true }, {
      existing: Object.entries(locs).map(([n, id]) => ({ id, name: n })),
    })
  }

  const linesOf = async (poId: string) => (await store.getDoc<PurchaseOrder>('purchaseOrders', poId))!.lines

  // ── PO 1: old pail that has now expired (Semenyih) ──
  const po0 = await createPurchaseOrder(store, admin, {
    supplier: 'Resinex Chemicals Sdn Bhd',
    supplierRef: 'INV-RX-88120',
    orderDate: d(-210),
    expectedDate: d(-200),
    notes: '',
    lines: [{ materialId: resin, packagingId: pailA, packageQty: 1, packagePrice: 430 }],
  })
  {
    const [l] = await linesOf(po0)
    await receivePurchaseOrder(store, admin, po0, [
      { lineId: l!.id, quantity: 20, locationId: locs.Semenyih!, batchNo: 'RX-A-2311', expiryDate: d(-5), receivedDate: d(-200) },
    ])
    await recordPurchasePayment(store, admin, po0, { date: d(-180), amount: 430, reference: 'TT-55102', note: '' })
  }

  // ── PO 2: resin drums + hardener boxes, fully received at WWRC, fully paid ──
  const po1 = await createPurchaseOrder(store, admin, {
    supplier: 'Resinex Chemicals Sdn Bhd',
    supplierRef: 'INV-RX-90433',
    orderDate: d(-62),
    expectedDate: d(-55),
    notes: 'Quarterly replenishment.',
    lines: [
      { materialId: resin, packagingId: drumA, packageQty: 6, packagePrice: 4200 },
      { materialId: hardener, packagingId: box, packageQty: 4, packagePrice: 540 },
    ],
  })
  {
    const [l1, l2] = await linesOf(po1)
    await receivePurchaseOrder(store, admin, po1, [
      { lineId: l1!.id, quantity: 1200, locationId: locs.WWRC!, batchNo: 'RX-A-2407', expiryDate: d(25), receivedDate: d(-55) },
      { lineId: l2!.id, quantity: 48, locationId: locs.WWRC!, batchNo: 'RX-B-2407', expiryDate: d(70), receivedDate: d(-55) },
    ])
    await recordPurchasePayment(store, admin, po1, { date: d(-40), amount: 27360, reference: 'TT-56011', note: 'Full settlement' })
  }

  // ── PO 3: partially received at Bintulu, partially paid ──
  const po2 = await createPurchaseOrder(store, admin, {
    supplier: 'Borneo Polymer Supply',
    supplierRef: 'BPS-PO-1182',
    orderDate: d(-21),
    expectedDate: d(-14),
    notes: 'Plastics balance to follow.',
    lines: [
      { materialId: resin, packagingId: pailA, packageQty: 10, packagePrice: 460 },
      { materialId: plastics, packagingId: pallet, packageQty: 1, packagePrice: 5800 },
    ],
  })
  {
    const [l1, l2] = await linesOf(po2)
    await receivePurchaseOrder(store, admin, po2, [
      { lineId: l1!.id, quantity: 200, locationId: locs.Bintulu!, batchNo: 'BPS-A-0912', expiryDate: d(180), receivedDate: d(-14) },
      { lineId: l2!.id, quantity: 250, locationId: locs.Bintulu!, batchNo: 'BPS-P-0912', expiryDate: null, receivedDate: d(-14) },
    ])
    await recordPurchasePayment(store, admin, po2, { date: d(-10), amount: 5000, reference: 'CHQ 004512', note: 'Deposit' })
  }

  // ── PO 4: ordered, not yet received or paid ──
  await createPurchaseOrder(store, admin, {
    supplier: 'Resinex Chemicals Sdn Bhd',
    supplierRef: '',
    orderDate: d(-3),
    expectedDate: d(7),
    notes: '',
    lines: [{ materialId: hardener, packagingId: drumB, packageQty: 1, packagePrice: 8600 }],
  })

  // ── Transfer: 2 drums of resin WWRC → Semenyih ──
  let batches = await readAll<Batch>(store, 'batches')
  const wwrcResin = batches.find((b) => b.materialId === resin && b.locationId === locs.WWRC)!
  await createTransfer(store, admin, {
    transferDate: d(-10),
    fromLocationId: locs.WWRC!,
    toLocationId: locs.Semenyih!,
    notes: 'Production run, week 38.',
    lines: [{ batchId: wwrcResin.id, quantity: 400 }],
  })

  // ── Sales (FEFO allocation) ──
  batches = await readAll<Batch>(store, 'batches')
  const fefo = (materialId: string, qty: number) =>
    allocateFefo(batches.filter((b) => b.materialId === materialId), qty, today).allocations
  const s1 = await createSale(store, admin, {
    customer: 'Tenaga Flooring Works',
    customerRef: 'DO-24117',
    saleDate: d(-7),
    notes: '',
    lines: [{ materialId: resin, packagingId: drumA, packageQty: 2, packagePrice: 6100, allocations: fefo(resin, 400) }],
  })
  await recordSaleCollection(store, admin, s1, { date: d(-2), amount: 6000, reference: 'FPX 772190', note: 'First instalment' })

  batches = await readAll<Batch>(store, 'batches')
  await createSale(store, admin, {
    customer: 'Kuching Marine Coatings',
    customerRef: 'PO-KMC-0291',
    saleDate: d(-2),
    notes: 'Deliver with Part A next week.',
    lines: [
      {
        materialId: hardener,
        packagingId: box,
        packageQty: 2,
        packagePrice: 780,
        allocations: allocateFefo(batches.filter((b) => b.materialId === hardener), 24, today).allocations,
      },
    ],
  })
}
