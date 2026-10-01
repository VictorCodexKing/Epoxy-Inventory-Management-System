import { nowISO } from '@/lib/dates'
import type { Actor, Role, UserProfile } from '@/types/models'
import { AppError, type AuthUser, type DocumentStore } from '../backend/types'
import { assertAdmin } from './common'

/**
 * Called after sign-in. If the signed-in account has no profile yet, create one as a read-only
 * Normal User (the only self-service write Security Rules allow). A Super Admin can then promote it.
 * Accounts themselves are created by the project owner in the Firebase Console — never in the app.
 */
export async function ensureOwnProfile(store: DocumentStore, user: AuthUser): Promise<void> {
  const existing = await store.getDoc<UserProfile>('users', user.uid)
  if (existing) return
  await store.runTransaction(async (tx) => {
    const again = await tx.get<UserProfile>('users', user.uid)
    if (again) return
    const now = nowISO()
    const profile: Omit<UserProfile, 'id'> = {
      email: user.email,
      displayName: user.displayName?.trim() || user.email.split('@')[0] || 'User',
      role: 'user',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedBy: null,
    }
    tx.set('users', user.uid, profile)
  })
}

export async function setUserRole(store: DocumentStore, actor: Actor, uid: string, role: Role): Promise<void> {
  if (role !== 'admin' && role !== 'user') throw new AppError('Invalid role.')
  if (uid === actor.uid) throw new AppError('You cannot change your own role.')
  await store.runTransaction(async (tx) => {
    await assertAdmin(tx, actor)
    const target = await tx.get<UserProfile>('users', uid)
    if (!target || target.status !== 'active') throw new AppError('User not found.')
    tx.update('users', uid, { role, updatedAt: nowISO() })
  })
}

/**
 * Remove a user's access. The profile is tomb-stoned (status `deleted`) rather than erased so the
 * account cannot silently re-provision itself on next sign-in and audit trails keep their author.
 * To also delete the login itself, remove it in Firebase Console → Authentication.
 */
export async function deleteUser(store: DocumentStore, actor: Actor, uid: string): Promise<void> {
  if (uid === actor.uid) throw new AppError('You cannot delete your own account.')
  await store.runTransaction(async (tx) => {
    await assertAdmin(tx, actor)
    const target = await tx.get<UserProfile>('users', uid)
    if (!target || target.status !== 'active') throw new AppError('User not found.')
    const now = nowISO()
    tx.update('users', uid, {
      status: 'deleted',
      role: 'user',
      deletedAt: now,
      deletedBy: actor.email,
      updatedAt: now,
    })
  })
}
