# EIMS Firestore schema

All quantities are stored in the material's **base unit** (`kg`, `L` or `pcs`). Packaging (Drum, Pail, Box of Cans…) is used only to enter and display quantities and is never stored as stock. kg and L are never converted into each other.

- Business dates (`orderDate`, `expiryDate`, …): `YYYY-MM-DD` in Malaysia time (Asia/Kuala_Lumpur).
- Audit timestamps (`createdAt`, …): ISO-8601 UTC strings.
- Money: MYR. Totals are rounded to 2 dp. Per-base-unit rates keep up to 6 dp.
- TypeScript definitions for every document: [`src/types/models.ts`](../src/types/models.ts).

## Collections

| Collection | Who can read | Purpose |
| --- | --- | --- |
| `users/{uid}` | self, admins | Profile and role. `uid` = Firebase Auth uid. |
| `materials/{id}` | all active users | Catalogue: name, code, base unit, nested packaging, low-stock threshold. |
| `locations/{id}` | all active users | Warehouses, `internal` or `vendor`. |
| `batches/{lotId}__{locationId}` | all active users | Physical quantity of one lot at one location. **No cost fields.** |
| `lotCosts/{lotId}` | admins | Landed unit cost of a lot. Written once and immutable. |
| `purchaseOrders/{id}` | admins | Inbound ledger: lines, receipts, payments. |
| `sales/{id}` | admins | Outbound ledger: lines, batch allocations with cost at time of sale, collections. |
| `transfers/{id}` | admins | Stock moves between locations. |
| `movements/{id}` | admins | Append-only stock ledger. One entry per change to a batch quantity. |
| `counters/{PREFIX-YEAR}` | admins | Sequential numbers: `PO-2026-0001`, `SO-…`, `TR-…`. |

Costs are kept in separate admin-only collections, so a Normal User cannot read cost data through the SDK at all — not just in the UI.

## Key documents

**materials**
```ts
{ code: 'EPX-A', name: 'Epoxy Resin (Part A)', baseUnit: 'kg',
  packaging: [ { id, name: 'Drum', contains: 200, of: 'base' },
               { id: 'can', name: 'Can', contains: 1, of: 'base' },
               { id, name: 'Box', contains: 12, of: 'can' } ],   // nested: 12 × 1 L = 12 L
  lowStockThreshold: 400, active: true, notes, createdAt, updatedAt }
```

**batches** — the id is deterministic, so transfers can update the destination inside a transaction without running a query.
```ts
{ lotId, materialId, locationId, batchNo, expiryDate | null, quantity, receivedDate, poId, createdAt, updatedAt }
```

**purchaseOrders**
```ts
{ poNumber, supplier, supplierRef, orderDate, expectedDate,
  lines:    [ { id, materialId, packagingId, packageQty, packagePrice, quantity, unitCost, lineTotal, receivedQty } ],
  receipts: [ { id, lineId, lotId, batchId, locationId, batchNo, expiryDate, quantity, receivedDate, recordedAt, recordedBy } ],
  totalAmount, amountPaid, paymentStatus: 'unpaid'|'partial'|'paid',
  payments: [ { id, date, amount, reference, note, recordedAt, recordedBy, voided, voidedAt, voidedBy } ],
  status: 'ordered'|'partially_received'|'received'|'void', notes, createdAt, createdBy, updatedAt,
  voidedAt, voidedBy, voidReason }
```

**sales**
```ts
{ saleNumber, customer, customerRef, saleDate,
  lines: [ { id, materialId, packagingId, packageQty, packagePrice, quantity, unitPrice, lineRevenue, lineCost,
             allocations: [ { batchId, lotId, locationId, quantity, unitCost } ] } ],
  totalAmount, totalCost, grossMargin, amountCollected, paymentStatus, payments, status: 'completed'|'void', … }
```

**movements**
```ts
{ type: 'po_receipt'|'po_void'|'sale'|'sale_void'|'transfer_out'|'transfer_in'|'transfer_void_out'|'transfer_void_in',
  materialId, locationId, lotId, batchId, quantity /* signed */, refType, refId, refNumber, date, createdAt, createdBy }
```

## Invariants

Every operation runs as **one Firestore transaction**: all reads happen first, then all writes, and either everything is applied or nothing is. The code is in [`src/services/operations`](../src/services/operations).

1. **Σ movements(batch) = batch.quantity**, always.
2. **Stock is added only when a PO is received.** Each receipt creates a new lot: a `batches` doc, a `lotCosts` doc and a movement.
3. **Inventory value = Σ batch.quantity × lotCosts[lotId].unitCost.**
4. **Margin = sale revenue − Σ (allocated quantity × that batch's unit cost).** The unit cost is copied onto the sale when it's recorded.
5. **Nothing is hard-deleted.** A wrong PO, sale, transfer or payment is *voided*, which writes reversing movements. A PO can only be voided while all of its lots are still complete at the location they were received into. A transfer can only be voided while the destination still holds the moved quantity.
6. **Users are tomb-stoned, not deleted.** `status: 'deleted'` blocks access and stops the account from creating a new profile for itself.
7. **Base unit is locked** once any batch exists for a material.

Payment status: `paid` when paid ≥ total (or total = 0), `partial` when 0 < paid < total, otherwise `unpaid`. Overpayment is rejected.

Expiry buckets (Malaysia time): `expired` (< 0 days), `d30` (0–30), `d60` (31–60), `d90` (61–90).
