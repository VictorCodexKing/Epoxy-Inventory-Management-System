/**
 * Backend abstraction.
 *
 * All business operations (src/services/operations/*) are written ONCE against this tiny interface.
 * Two implementations exist:
 *   - demo     → src/services/backend/demo.ts      (in-browser, localStorage)
 *   - firebase → src/services/backend/firebase.ts  (Firestore + Firebase Auth)
 *
 * The transaction contract deliberately mirrors Firestore's: every `get` must happen before the first
 * write, and the whole transaction is applied atomically (all writes or none). The demo backend enforces
 * the same rule so logic that works in demo mode works unchanged on Firestore.
 */

export type CollectionName =
  | 'users'
  | 'materials'
  | 'locations'
  | 'batches'
  | 'lotCosts'
  | 'purchaseOrders'
  | 'sales'
  | 'transfers'
  | 'movements'
  | 'counters'

/** Plain document data without the `id` (ids live in the document path). */
export type DocData = Record<string, unknown>

export interface Transaction {
  get<T extends { id: string }>(collection: CollectionName, id: string): Promise<T | null>
  /** Create or overwrite the whole document. `id` keys in `data` are ignored. */
  set(collection: CollectionName, id: string, data: DocData): void
  /** Shallow-merge top-level fields into an existing document. */
  update(collection: CollectionName, id: string, patch: DocData): void
  // No delete: EIMS never hard-deletes records (corrections are made by voiding).
}

export type Unsubscribe = () => void

/** Optional ordering/limit for large append-only collections (e.g. the movement ledger). */
export interface CollectionQuery {
  orderBy: string
  direction: 'asc' | 'desc'
  limit: number
}

export interface DocumentStore {
  newId(collection: CollectionName): string
  runTransaction<R>(fn: (tx: Transaction) => Promise<R>): Promise<R>
  getDoc<T extends { id: string }>(collection: CollectionName, id: string): Promise<T | null>
  subscribeCollection<T extends { id: string }>(
    collection: CollectionName,
    onData: (docs: T[]) => void,
    onError: (error: Error) => void,
    query?: CollectionQuery,
  ): Unsubscribe
  subscribeDoc<T extends { id: string }>(
    collection: CollectionName,
    id: string,
    onData: (doc: T | null) => void,
    onError: (error: Error) => void,
  ): Unsubscribe
}

export interface AuthUser {
  uid: string
  email: string
  displayName: string | null
}

export interface AuthGateway {
  onAuthStateChanged(cb: (user: AuthUser | null) => void): Unsubscribe
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  sendPasswordReset(email: string): Promise<void>
}

export interface Backend {
  kind: 'demo' | 'firebase'
  store: DocumentStore
  auth: AuthGateway
}

/** Error with a user-facing message. Anything else is reported as an unexpected error. */
export class AppError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppError'
  }
}
