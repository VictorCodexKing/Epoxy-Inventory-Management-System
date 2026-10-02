import type { Backend } from './types'

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

let backend: Backend | null = null

/** Missing Firebase settings, if any. Returned so the app can show a clear setup screen. */
export function firebaseConfigProblem(): BackendConfigProblem | null {
  const missing = FIREBASE_KEYS.filter((k) => !import.meta.env[k])
  return missing.length ? { missing } : null
}

/** Initialise the Firebase backend once. The SDK is loaded lazily to keep the initial bundle small. */
export async function initBackend(): Promise<Backend> {
  if (backend) return backend
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
  return backend
}

export function getBackend(): Backend {
  if (!backend) throw new Error('Backend not initialised — call initBackend() first.')
  return backend
}
