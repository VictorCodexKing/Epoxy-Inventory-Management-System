/**
 * Firebase backend: Firestore + Firebase Authentication (email / password).
 * Activated with VITE_DATA_BACKEND=firebase and the VITE_FIREBASE_* keys (see .env.example).
 */
import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
} from 'firebase/auth'
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  initializeFirestore,
  limit,
  onSnapshot,
  orderBy,
  query as fsQuery,
  persistentLocalCache,
  persistentMultipleTabManager,
  runTransaction,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'
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

export interface FirebaseConfig {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
}

function fromSnapshot<T>(snap: DocumentSnapshot): T | null {
  return snap.exists() ? ({ ...snap.data(), id: snap.id } as T) : null
}

function stripId(data: DocData): DocData {
  const { id: _ignored, ...rest } = data
  void _ignored
  return rest
}

class FirestoreStore implements DocumentStore {
  constructor(private db: Firestore) {}

  newId(name: CollectionName): string {
    return doc(collection(this.db, name)).id
  }

  async getDoc<T extends { id: string }>(name: CollectionName, id: string): Promise<T | null> {
    return fromSnapshot<T>(await getDoc(doc(this.db, name, id)))
  }

  runTransaction<R>(fn: (tx: Transaction) => Promise<R>): Promise<R> {
    return runTransaction(this.db, async (ftx) => {
      const tx: Transaction = {
        get: async <T extends { id: string }>(name: CollectionName, id: string) =>
          fromSnapshot<T>(await ftx.get(doc(this.db, name, id))),
        set: (name, id, data) => {
          ftx.set(doc(this.db, name, id), stripId(data))
        },
        update: (name, id, patch) => {
          ftx.update(doc(this.db, name, id), stripId(patch))
        },
      }
      return fn(tx)
    }).catch((e: unknown) => {
      throw normaliseFirebaseError(e)
    })
  }

  subscribeCollection<T extends { id: string }>(
    name: CollectionName,
    onData: (docs: T[]) => void,
    onError: (error: Error) => void,
    query?: CollectionQuery,
  ): Unsubscribe {
    const ref = collection(this.db, name)
    const source = query ? fsQuery(ref, orderBy(query.orderBy, query.direction), limit(query.limit)) : ref
    let delivered = false
    return onSnapshot(
      source,
      // Metadata events are needed so we hear when the server confirms an (empty) result that the cache
      // could not answer; without them an empty collection would never leave the loading state.
      { includeMetadataChanges: true },
      (snap) => {
        // Skip an initial *empty* cache-only snapshot (cold cache) so screens don't flash "no data".
        if (!delivered && snap.empty && snap.metadata.fromCache) return
        // After the first delivery, ignore metadata-only events (no documents changed).
        if (delivered && snap.docChanges().length === 0) return
        delivered = true
        onData(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T))
      },
      (err) => onError(normaliseFirebaseError(err)),
    )
  }

  subscribeDoc<T extends { id: string }>(
    name: CollectionName,
    id: string,
    onData: (doc: T | null) => void,
    onError: (error: Error) => void,
  ): Unsubscribe {
    return onSnapshot(
      doc(this.db, name, id),
      { includeMetadataChanges: true },
      (snap) => {
        // With the offline cache, the first event can be a cache miss for a document that DOES exist on
        // the server (e.g. a profile created moments ago). Only report "missing" once the server confirms.
        if (!snap.exists() && snap.metadata.fromCache) return
        onData(fromSnapshot<T>(snap))
      },
      (err) => onError(normaliseFirebaseError(err)),
    )
  }
}

class FirebaseAuthGateway implements AuthGateway {
  private ready: Promise<void>

  constructor(private auth: Auth) {
    this.ready = setPersistence(auth, browserLocalPersistence).catch(() => undefined)
  }

  onAuthStateChanged(cb: (user: AuthUser | null) => void): Unsubscribe {
    return onAuthStateChanged(this.auth, (u) =>
      cb(u ? { uid: u.uid, email: u.email ?? '', displayName: u.displayName } : null),
    )
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.ready
    try {
      await signInWithEmailAndPassword(this.auth, email.trim(), password)
    } catch (e) {
      throw normaliseFirebaseError(e)
    }
  }

  async signOut(): Promise<void> {
    await signOut(this.auth)
  }

  async sendPasswordReset(email: string): Promise<void> {
    try {
      await sendPasswordResetEmail(this.auth, email.trim())
    } catch (e) {
      throw normaliseFirebaseError(e)
    }
  }
}

const FRIENDLY: Record<string, string> = {
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/invalid-login-credentials': 'Incorrect email or password.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/user-not-found': 'Incorrect email or password.',
  'auth/invalid-email': 'That email address is not valid.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
  'permission-denied': 'You do not have permission to perform this action.',
  unavailable: 'The database is unreachable. Check your connection and try again.',
  aborted: 'Another change was saved at the same time. Please try again.',
  'resource-exhausted': 'The free-tier daily quota has been reached. Please try again tomorrow.',
}

export function normaliseFirebaseError(e: unknown): Error {
  if (e instanceof AppError) return e
  if (e instanceof FirebaseError) {
    const msg = FRIENDLY[e.code]
    return msg ? new AppError(msg) : e
  }
  return e instanceof Error ? e : new Error(String(e))
}

export interface EmulatorConfig {
  firestorePort: number
  authPort: number
}

export function createFirebaseBackend(config: FirebaseConfig, emulators: EmulatorConfig | null): Backend {
  const app: FirebaseApp = initializeApp(config)
  const db = initializeFirestore(app, {
    // IndexedDB cache: repeat visits read from disk instead of billing Firestore reads.
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    ignoreUndefinedProperties: true,
  })
  const auth = getAuth(app)
  if (emulators) {
    connectFirestoreEmulator(db, '127.0.0.1', emulators.firestorePort)
    connectAuthEmulator(auth, `http://127.0.0.1:${emulators.authPort}`, { disableWarnings: true })
  }
  return { kind: 'firebase', store: new FirestoreStore(db), auth: new FirebaseAuthGateway(auth) }
}
