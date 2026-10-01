/**
 * Demo backend: a faithful in-browser stand-in for Firestore + Firebase Auth.
 *
 * - Data persists in localStorage, so the demo survives reloads and syncs across tabs.
 * - Transactions are serialised and atomic, and (like Firestore) reject reads after writes.
 * - Demo accounts are fixed; there is intentionally no sign-up (admins cannot create users).
 */
import { randomId } from '@/lib/ids'
import {
  AppError,
  type AuthGateway,
  type AuthUser,
  type Backend,
  type CollectionName,
  type CollectionQuery,
  type DocData,
  type DocumentStore,
  type Transaction,
  type Unsubscribe,
} from './types'

const DB_KEY = 'eims.demo.db.v1'
const SESSION_KEY = 'eims.demo.session.v1'

type Collections = Partial<Record<CollectionName, Record<string, DocData>>>

export interface DemoAccount {
  uid: string
  email: string
  password: string
  displayName: string
}

/** Fixed demo logins. Profiles (roles) for these live in the `users` collection created by the seed. */
export const DEMO_ACCOUNTS: DemoAccount[] = [
  { uid: 'demo-admin', email: 'admin@eims.demo', password: 'admin123', displayName: 'Aisyah Rahman' },
  { uid: 'demo-user', email: 'user@eims.demo', password: 'user123', displayName: 'Daniel Wong' },
  { uid: 'demo-store', email: 'store@eims.demo', password: 'store123', displayName: 'Kumar Selvam' },
]

const clone = <T>(v: T): T => structuredClone(v)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

class DemoStore implements DocumentStore {
  private data: Collections
  private collectionListeners = new Map<CollectionName, Set<() => void>>()
  private queue: Promise<unknown> = Promise.resolve()

  constructor() {
    this.data = this.load()
    window.addEventListener('storage', (e) => {
      if (e.key !== DB_KEY) return
      this.data = this.load()
      for (const name of this.collectionListeners.keys()) this.emit(name)
    })
  }

  get isEmpty(): boolean {
    return Object.keys(this.data).length === 0
  }

  /**
   * Wipe all data. Listeners are intentionally NOT notified here: the caller re-seeds immediately and each
   * seeded collection notifies its listeners, so the signed-in session never sees a transient "no profile".
   */
  reset(): void {
    this.data = {}
    localStorage.removeItem(DB_KEY)
  }

  private load(): Collections {
    try {
      const raw = localStorage.getItem(DB_KEY)
      return raw ? (JSON.parse(raw) as Collections) : {}
    } catch {
      return {}
    }
  }

  private persist(): void {
    localStorage.setItem(DB_KEY, JSON.stringify(this.data))
  }

  private read<T>(collection: CollectionName, id: string): T | null {
    const doc = this.data[collection]?.[id]
    return doc ? ({ ...clone(doc), id } as T) : null
  }

  private list<T>(collection: CollectionName): T[] {
    const col = this.data[collection] ?? {}
    return Object.entries(col).map(([id, doc]) => ({ ...clone(doc), id }) as T)
  }

  private emit(collection: CollectionName): void {
    this.collectionListeners.get(collection)?.forEach((fn) => fn())
  }

  private listen(collection: CollectionName, fn: () => void): Unsubscribe {
    let set = this.collectionListeners.get(collection)
    if (!set) {
      set = new Set()
      this.collectionListeners.set(collection, set)
    }
    set.add(fn)
    return () => set.delete(fn)
  }

  newId(): string {
    return randomId()
  }

  async getDoc<T extends { id: string }>(collection: CollectionName, id: string): Promise<T | null> {
    await wait(0)
    return this.read<T>(collection, id)
  }

  runTransaction<R>(fn: (tx: Transaction) => Promise<R>): Promise<R> {
    // Serialise transactions so concurrent operations can never interleave reads and writes.
    const run = async (): Promise<R> => {
      type Write = { kind: 'set' | 'update'; collection: CollectionName; id: string; data: DocData }
      const writes: Write[] = []
      let writing = false
      const tx: Transaction = {
        get: async <T extends { id: string }>(collection: CollectionName, id: string) => {
          if (writing) throw new Error('Transaction reads must happen before writes (Firestore rule).')
          return this.read<T>(collection, id)
        },
        set: (collection, id, data) => {
          writing = true
          writes.push({ kind: 'set', collection, id, data: stripId(data) })
        },
        update: (collection, id, patch) => {
          writing = true
          writes.push({ kind: 'update', collection, id, data: stripId(patch) })
        },
      }
      const result = await fn(tx)

      // Validate everything first, then apply — all or nothing.
      const next: Collections = clone(this.data)
      for (const w of writes) {
        const col = (next[w.collection] ??= {})
        if (w.kind === 'update') {
          const existing = col[w.id]
          if (!existing) throw new AppError(`Document ${w.collection}/${w.id} does not exist.`)
          col[w.id] = { ...existing, ...clone(w.data) }
        } else {
          col[w.id] = clone(w.data)
        }
      }
      this.data = next
      this.persist()
      for (const name of new Set(writes.map((w) => w.collection))) this.emit(name)
      return result
    }
    const p = this.queue.then(run, run)
    this.queue = p.catch(() => undefined)
    return p
  }

  subscribeCollection<T extends { id: string }>(
    collection: CollectionName,
    onData: (docs: T[]) => void,
    _onError: (error: Error) => void,
    query?: CollectionQuery,
  ): Unsubscribe {
    let active = true
    const push = () => active && onData(applyQuery(this.list<T>(collection), query))
    queueMicrotask(push)
    const off = this.listen(collection, push)
    return () => {
      active = false
      off()
    }
  }

  subscribeDoc<T extends { id: string }>(
    collection: CollectionName,
    id: string,
    onData: (doc: T | null) => void,
  ): Unsubscribe {
    let active = true
    const push = () => active && onData(this.read<T>(collection, id))
    queueMicrotask(push)
    const off = this.listen(collection, push)
    return () => {
      active = false
      off()
    }
  }
}

function applyQuery<T>(docs: T[], query?: CollectionQuery): T[] {
  if (!query) return docs
  const key = query.orderBy as keyof T
  const dir = query.direction === 'asc' ? 1 : -1
  return [...docs]
    .sort((a, b) => (a[key] === b[key] ? 0 : (a[key] as never) < (b[key] as never) ? -dir : dir))
    .slice(0, query.limit)
}

function stripId(data: DocData): DocData {
  const { id: _ignored, ...rest } = data
  void _ignored
  return rest
}

class DemoAuth implements AuthGateway {
  private listeners = new Set<(u: AuthUser | null) => void>()

  private current(): AuthUser | null {
    const uid = localStorage.getItem(SESSION_KEY)
    const acct = DEMO_ACCOUNTS.find((a) => a.uid === uid)
    return acct ? { uid: acct.uid, email: acct.email, displayName: acct.displayName } : null
  }

  private emit(): void {
    const u = this.current()
    this.listeners.forEach((fn) => fn(u))
  }

  onAuthStateChanged(cb: (user: AuthUser | null) => void): Unsubscribe {
    this.listeners.add(cb)
    queueMicrotask(() => cb(this.current()))
    return () => this.listeners.delete(cb)
  }

  async signIn(email: string, password: string): Promise<void> {
    await wait(350)
    const acct = DEMO_ACCOUNTS.find((a) => a.email.toLowerCase() === email.trim().toLowerCase())
    if (!acct || acct.password !== password) throw new AppError('Incorrect email or password.')
    localStorage.setItem(SESSION_KEY, acct.uid)
    this.emit()
  }

  async signOut(): Promise<void> {
    localStorage.removeItem(SESSION_KEY)
    this.emit()
  }

  async sendPasswordReset(): Promise<void> {
    await wait(300)
    throw new AppError('Password reset emails are not sent in demo mode.')
  }
}

export interface DemoBackend extends Backend {
  kind: 'demo'
  store: DemoStore
}

export function createDemoBackend(): DemoBackend {
  return { kind: 'demo', store: new DemoStore(), auth: new DemoAuth() }
}

export type { DemoStore }
