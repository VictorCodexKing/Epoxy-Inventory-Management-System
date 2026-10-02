# EIMS — Epoxy Inventory Management System

Batch-level inventory for chemical raw materials and packaging: purchase orders, receiving, transfers between internal and vendor warehouses, expiry tracking, and sales dispatch, with real-time valuation and margins in MYR.

**Stack:** Vue 3 (Composition API, `<script setup>`) · Vite · TypeScript · Pinia · Tailwind CSS v4 · Firebase Auth + Firestore · Vercel.

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in your Firebase keys
npm run dev                  # http://localhost:5173
```

The app runs on **Firebase Auth + Firestore**. Create a project, add the six `VITE_FIREBASE_*` keys to `.env.local`, and deploy `firestore.rules`. The full walkthrough — including creating the first Super Admin and running locally against the Firebase Emulator Suite — is in **[docs/FIREBASE_SETUP.md](docs/FIREBASE_SETUP.md)**.

## What it does

| Page | Super Admin | Normal User |
| --- | --- | --- |
| **Dashboard** `/dashboard` | Inventory value, supplier payables, customer receivables, 30-day gross margin, low-stock and expiry alerts, recent movements | Stock totals per unit, low-stock and expiry alerts |
| **Inventory** `/inventory` | Material × location matrix, batches in FEFO order with cost and value, stock transfers and voids | Matrix and batches, quantities only |
| **Purchase Orders** `/purchase` | Create and edit POs, receive into batches (lot no., expiry, location), record and void payments, void PO | — |
| **Sales** `/sales` | Dispatch with FEFO batch pre-selection that admins can override, revenue/cost/margin, collections, void sale | — |
| **Settings** `/settings` | Materials with nested packaging, low-stock thresholds, locations, user roles and deletion | — |

**Inventory rules:**

- **Base units:** each material has its own base unit (kg, L or pcs). Quantities are never converted between kg and L.
- **Packaging:** sizes are set per material and can be nested, e.g. Box = 12 × Can = 12 L. Stock is also shown as physical packages, e.g. `430 kg = 2 Drum + 1 Pail + 10 kg`.
- **Cost:** each received PO line becomes a batch with its own cost and expiry.
  - Inventory value = Σ quantity × batch cost.
  - Margin = sale price − the actual cost of the batches used.
- **Corrections:** nothing is hard-deleted. Mistakes are voided with reversing ledger entries.
- **Atomic writes:** every PO receipt, sale, transfer and void is a single all-or-nothing Firestore transaction.
- **Alerts:**
  - Low stock is checked per material, across all locations.
  - Expiry warnings appear at 30, 60 and 90 days.
- **Formats:** money as `RM 1,234.56`, dates as DD/MM/YYYY, Malaysia time zone.

## Security model

Roles are enforced by **Firestore Security Rules**, not just hidden in the UI:

- Physical stock (`batches`) is in a different collection from costs (`lotCosts`), so a Normal User has no way to read cost data.
- Normal Users can read only `materials`, `locations` and `batches`.
- Ledgers are append-only, lot costs are immutable, and no document can be deleted.
- Admins cannot create accounts; the project owner creates them in Firebase Console. Admins can promote, demote and delete users, but cannot change their own role or delete themselves.

The schema and invariants are documented in **[docs/SCHEMA.md](docs/SCHEMA.md)**.

## Architecture

```
src/
  types/models.ts            Firestore document types (single source of truth)
  lib/                       Pure helpers: rounding, MYT dates, MYR/qty formatting, packaging maths, FEFO
  services/
    backend/types.ts         Tiny DocumentStore + AuthGateway interface (Firestore-shaped transactions)
    backend/firebase.ts      Firestore + Firebase Auth implementation
    operations/              ALL business logic, written once against the interface
  stores/                    Pinia: auth, data (realtime cache), inventory (derived views), ui
  views/ components/ layouts/
firestore.rules              Role enforcement
```

The business logic is written once against the `DocumentStore` interface, keeping all Firestore specifics in `backend/firebase.ts`. Every write path (receipts, sales, transfers, voids) runs as a single atomic transaction with reads before writes.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Type-check (`vue-tsc`) + production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | Type-check only |

## Deployment (Vercel)

Import the repo in Vercel; it detects Vite automatically. Add the `VITE_*` environment variables, and SPA rewrites are already configured in `vercel.json`. Details: [docs/FIREBASE_SETUP.md](docs/FIREBASE_SETUP.md#5-deploy-on-vercel).
