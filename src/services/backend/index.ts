import type { Backend } from './types'
import { createDemoBackend, type DemoBackend } from './demo'

export interface BackendConfigProblem {
  missing: string[]
}

const FIREBASE_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const

export const backendKind: 'demo' | 'firebase' = import.meta.env.VITE_DATA_BACKEND === 'firebase' ? 'firebase' : 'demo'

let backend: Backend | null = null

/** Missing Firebase settings (only relevant when VITE_DATA_BACKEND=firebase). */
export function firebaseConfigProblem(): BackendConfigProblem | null {
  if (backendKind !== 'firebase') return null
  const missing = FIREBASE_KEYS.filter((k) => !import.meta.env[k])
  return missing.length ? { missing } : null
}

/** Initialise the selected backend once. The Firebase SDK is loaded lazily so demo builds stay small. */
export async function initBackend(): Promise<Backend> {
  if (backend) return backend
  if (backendKind === 'firebase') {
    const { createFirebaseBackend } = await import('./firebase')
    const env = import.meta.env
    backend = createFirebaseBackend(
      {
        apiKey: env.VITE_FIREBASE_API_KEY ?? '',
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
        projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
        storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
        messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
        appId: env.VITE_FIREBASE_APP_ID ?? '',
      },
      env.VITE_FIREBASE_USE_EMULATORS === 'true'
        ? {
            firestorePort: Number(env.VITE_FIREBASE_EMULATOR_FIRESTORE_PORT || 8080),
            authPort: Number(env.VITE_FIREBASE_EMULATOR_AUTH_PORT || 9099),
          }
        : null,
    )
  } else {
    const demo = createDemoBackend()
    if (demo.store.isEmpty) {
      const { seedDemoData } = await import('../demo/seed')
      await seedDemoData(demo.store)
    }
    backend = demo
  }
  return backend
}

export function getBackend(): Backend {
  if (!backend) throw new Error('Backend not initialised — call initBackend() first.')
  return backend
}

export function getDemoBackend(): DemoBackend | null {
  return backend?.kind === 'demo' ? (backend as DemoBackend) : null
}

/** Wipe and re-seed demo data (demo mode only). */
export async function resetDemoData(): Promise<void> {
  const demo = getDemoBackend()
  if (!demo) return
  demo.store.reset()
  const { seedDemoData } = await import('../demo/seed')
  await seedDemoData(demo.store)
}
