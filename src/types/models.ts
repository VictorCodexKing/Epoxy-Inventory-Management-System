/**
 * EIMS domain model.
 *
 * Every interface below maps 1:1 to a Firestore document (see docs/SCHEMA.md).
 * `id` is the Firestore document id; it is injected on read and is NOT stored inside the document.
 *
 * Conventions
 * - Business dates (order date, expiry date, …) are `YYYY-MM-DD` strings in Malaysia time (Asia/Kuala_Lumpur).
 * - Audit timestamps (`createdAt`, `updatedAt`, …) are ISO-8601 UTC strings.
 * - Quantities are always stored in the material's BASE unit (kg, L or pcs). Packaging is a display/entry aid only.
 * - Money is MYR. Totals are rounded to 2 dp (sen); unit costs/prices per base unit keep up to 6 dp.
 */

export type ISODateTime = string
/** `YYYY-MM-DD` in Malaysia time */
export type BusinessDate = string

// ───────────────────────────── Users ─────────────────────────────

export type Role = 'admin' | 'user'
export type UserStatus = 'active' | 'deleted'

/** `users/{uid}` — uid matches the Firebase Auth uid. */
export interface UserProfile {
  id: string
  email: string
  displayName: string
  role: Role
  status: UserStatus
  createdAt: ISODateTime
  updatedAt: ISODateTime
  deletedAt: ISODateTime | null
  deletedBy: string | null
}

// ─────────────────────────── Catalogue ───────────────────────────

export type BaseUnit = 'kg' | 'L' | 'pcs'

/**
 * A packaging level. `contains` units of `of` make one of this package.
 *   Drum  = { contains: 200, of: 'base' }            → 200 kg
 *   Can   = { contains: 1,   of: 'base' }            → 1 L
 *   Box   = { contains: 12,  of: '<id of Can>' }     → 12 cans → 12 L
 */
export interface PackagingUnit {
  id: string
  name: string
  contains: number
  /** `'base'` or the id of another packaging unit of the same material */
  of: string
}

/** `materials/{id}` */
export interface Material {
  id: string
  code: string
  name: string
  baseUnit: BaseUnit
  packaging: PackagingUnit[]
  /** Low-stock alert when the total across all locations falls below this (base units). 0 = disabled. */
  lowStockThreshold: number
  active: boolean
  notes: string
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export type LocationType = 'internal' | 'vendor'

/** `locations/{id}` */
export interface StorageLocation {
  id: string
  name: string
  type: LocationType
  address: string
  active: boolean
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

// ─────────────────────────── Inventory ───────────────────────────

/**
 * `batches/{lotId}__{locationId}` — the physical quantity of one lot at one location.
 * Readable by every active user. Contains NO cost information.
 * Documents are never deleted; an emptied batch simply has `quantity: 0`.
 */
export interface Batch {
  id: string
  lotId: string
  materialId: string
  locationId: string
  /** Supplier / manufacturer batch number printed on the drum */
  batchNo: string
  expiryDate: BusinessDate | null
  quantity: number
  receivedDate: BusinessDate
  poId: string
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

/** `lotCosts/{lotId}` — admin-only. The landed unit cost of one received lot. */
export interface LotCost {
  id: string
  materialId: string
  poId: string
  poLineId: string
  /** MYR per base unit */
  unitCost: number
  receivedQty: number
  createdAt: ISODateTime
}

// ─────────────────────────── Payments ────────────────────────────

export type PaymentStatus = 'unpaid' | 'partial' | 'paid'

export interface PaymentEntry {
  id: string
  date: BusinessDate
  amount: number
  reference: string
  note: string
  recordedAt: ISODateTime
  recordedBy: string
  voided: boolean
  voidedAt: ISODateTime | null
  voidedBy: string | null
}

// ──────────────────────── Purchase orders ────────────────────────

export type POStatus = 'ordered' | 'partially_received' | 'received' | 'void'

export interface POLine {
  id: string
  materialId: string
  /** Packaging the line was entered in, or null for base units */
  packagingId: string | null
  packageQty: number
  /** MYR per package (or per base unit when packagingId is null) — as entered */
  packagePrice: number
  /** Ordered quantity in base units */
  quantity: number
  /** MYR per base unit */
  unitCost: number
  lineTotal: number
  receivedQty: number
}

export interface POReceipt {
  id: string
  lineId: string
  lotId: string
  batchId: string
  locationId: string
  batchNo: string
  expiryDate: BusinessDate | null
  quantity: number
  receivedDate: BusinessDate
  recordedAt: ISODateTime
  recordedBy: string
}

/** `purchaseOrders/{id}` — admin-only */
export interface PurchaseOrder {
  id: string
  poNumber: string
  supplier: string
  supplierRef: string
  orderDate: BusinessDate
  expectedDate: BusinessDate | null
  lines: POLine[]
  receipts: POReceipt[]
  totalAmount: number
  amountPaid: number
  paymentStatus: PaymentStatus
  payments: PaymentEntry[]
  status: POStatus
  notes: string
  createdAt: ISODateTime
  createdBy: string
  updatedAt: ISODateTime
  voidedAt: ISODateTime | null
  voidedBy: string | null
  voidReason: string | null
}

// ───────────────────────────── Sales ─────────────────────────────

export type SaleStatus = 'completed' | 'void'

export interface SaleAllocation {
  batchId: string
  lotId: string
  locationId: string
  quantity: number
  /** MYR per base unit, copied from lotCosts at the time of sale */
  unitCost: number
}

export interface SaleLine {
  id: string
  materialId: string
  packagingId: string | null
  packageQty: number
  packagePrice: number
  /** Base units */
  quantity: number
  /** MYR per base unit */
  unitPrice: number
  lineRevenue: number
  lineCost: number
  allocations: SaleAllocation[]
}

/** `sales/{id}` — admin-only */
export interface Sale {
  id: string
  saleNumber: string
  customer: string
  /** Customer PO / invoice / delivery-order number */
  customerRef: string
  saleDate: BusinessDate
  lines: SaleLine[]
  totalAmount: number
  totalCost: number
  grossMargin: number
  amountCollected: number
  paymentStatus: PaymentStatus
  payments: PaymentEntry[]
  status: SaleStatus
  notes: string
  createdAt: ISODateTime
  createdBy: string
  updatedAt: ISODateTime
  voidedAt: ISODateTime | null
  voidedBy: string | null
  voidReason: string | null
}

// ─────────────────────────── Transfers ───────────────────────────

export type TransferStatus = 'completed' | 'void'

export interface TransferLine {
  id: string
  materialId: string
  lotId: string
  fromBatchId: string
  toBatchId: string
  quantity: number
}

/** `transfers/{id}` — admin-only */
export interface Transfer {
  id: string
  transferNumber: string
  transferDate: BusinessDate
  fromLocationId: string
  toLocationId: string
  lines: TransferLine[]
  status: TransferStatus
  notes: string
  createdAt: ISODateTime
  createdBy: string
  updatedAt: ISODateTime
  voidedAt: ISODateTime | null
  voidedBy: string | null
  voidReason: string | null
}

// ──────────────────────── Movement ledger ────────────────────────

export type MovementType =
  | 'po_receipt'
  | 'po_void'
  | 'sale'
  | 'sale_void'
  | 'transfer_out'
  | 'transfer_in'
  | 'transfer_void_out'
  | 'transfer_void_in'

export type MovementRefType = 'purchaseOrder' | 'sale' | 'transfer'

/**
 * `movements/{id}` — append-only stock ledger (admin-only). Every change to a batch quantity writes
 * exactly one movement in the same atomic transaction, so Σ movements(batch) === batch.quantity.
 */
export interface Movement {
  id: string
  type: MovementType
  materialId: string
  locationId: string
  lotId: string
  batchId: string
  /** Signed, base units: + into the location, − out of it */
  quantity: number
  refType: MovementRefType
  refId: string
  refNumber: string
  date: BusinessDate
  createdAt: ISODateTime
  createdBy: string
}

/** `counters/{key}` — sequential document numbers, e.g. key `PO-2026` */
export interface Counter {
  id: string
  value: number
}

export interface Actor {
  uid: string
  email: string
}
