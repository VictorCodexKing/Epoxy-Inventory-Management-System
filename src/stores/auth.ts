import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { getBackend } from '@/services/backend'
import type { AuthUser, Unsubscribe } from '@/services/backend/types'
import { ensureOwnProfile } from '@/services/operations/users'
import type { Actor, UserProfile } from '@/types/models'
import { useDataStore } from './data'

/**
 * - `loading`   → waiting for Firebase Auth / profile
 * - `signedOut` → no session
 * - `ready`     → signed in with an active profile
 * - `noAccess`  → signed in, but the profile was deleted (or could not be created)
 */
export type AuthStatus = 'loading' | 'signedOut' | 'ready' | 'noAccess'

export const useAuthStore = defineStore('auth', () => {
  const status = ref<AuthStatus>('loading')
  const user = ref<AuthUser | null>(null)
  const profile = ref<UserProfile | null>(null)
  const problem = ref<string | null>(null)

  const isAdmin = computed(() => status.value === 'ready' && profile.value?.role === 'admin')
  const actor = computed<Actor>(() => ({ uid: user.value?.uid ?? '', email: user.value?.email ?? '' }))

  let offAuth: Unsubscribe | null = null
  let offProfile: Unsubscribe | null = null
  let resolveFirst: (() => void) | null = null
  const firstResolution = new Promise<void>((r) => (resolveFirst = r))

  function settle(next: AuthStatus) {
    status.value = next
    if (next !== 'loading') {
      resolveFirst?.()
      resolveFirst = null
    }
  }

  function init() {
    if (offAuth) return
    const { auth, store } = getBackend()
    const data = useDataStore()
    offAuth = auth.onAuthStateChanged(async (u) => {
      offProfile?.()
      offProfile = null
      data.stop()
      user.value = u
      profile.value = null
      problem.value = null
      if (!u) {
        settle('signedOut')
        return
      }
      settle('loading')
      try {
        await ensureOwnProfile(store, u)
      } catch (e) {
        // A deleted (tomb-stoned) profile is readable but the self-create is refused — handled below.
        problem.value = e instanceof Error ? e.message : String(e)
      }
      if (user.value?.uid !== u.uid) return // signed out meanwhile
      offProfile = store.subscribeDoc<UserProfile>(
        'users',
        u.uid,
        (p) => {
          const prevRole = profile.value?.role
          profile.value = p
          if (!p || p.status !== 'active') {
            data.stop()
            settle('noAccess')
            return
          }
          if (prevRole !== p.role || !data.running) data.start(p.role === 'admin')
          settle('ready')
        },
        (err) => {
          problem.value = err.message
          data.stop()
          settle('noAccess')
        },
      )
    })
  }

  /** Resolves once the initial auth state is known (used by the router guard). */
  function whenResolved(): Promise<void> {
    return firstResolution
  }

  async function signIn(email: string, password: string) {
    await getBackend().auth.signIn(email, password)
  }

  async function signOut() {
    useDataStore().stop()
    await getBackend().auth.signOut()
  }

  async function sendPasswordReset(email: string) {
    await getBackend().auth.sendPasswordReset(email)
  }

  return { status, user, profile, problem, isAdmin, actor, init, whenResolved, signIn, signOut, sendPasswordReset }
})
