import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import AppShell from '@/layouts/AppShell.vue'

declare module 'vue-router' {
  interface RouteMeta {
    /** Only reachable while signed out */
    guestOnly?: boolean
    /** Requires an active profile */
    requiresAuth?: boolean
    /** Super Admin only */
    requiresAdmin?: boolean
    title?: string
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { guestOnly: true, title: 'Sign in' },
  },
  {
    path: '/no-access',
    name: 'no-access',
    component: () => import('@/views/NoAccessView.vue'),
    meta: { title: 'No access' },
  },
  {
    path: '/',
    component: AppShell,
    meta: { requiresAuth: true },
    children: [
      { path: '', redirect: { name: 'dashboard' } },
      { path: 'dashboard', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { requiresAuth: true, title: 'Dashboard' } },
      { path: 'inventory', name: 'inventory', component: () => import('@/views/InventoryView.vue'), meta: { requiresAuth: true, title: 'Inventory' } },
      { path: 'purchase', name: 'purchase', component: () => import('@/views/PurchaseView.vue'), meta: { requiresAuth: true, requiresAdmin: true, title: 'Purchase Orders' } },
      { path: 'sales', name: 'sales', component: () => import('@/views/SalesView.vue'), meta: { requiresAuth: true, requiresAdmin: true, title: 'Sales' } },
      { path: 'settings', name: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { requiresAuth: true, requiresAdmin: true, title: 'Settings' } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: { name: 'dashboard' } },
]

/** Resolves when auth has finished loading (initial load, sign-in or profile fetch). */
function settled(): Promise<void> {
  const auth = useAuthStore()
  if (auth.status !== 'loading') return Promise.resolve()
  return new Promise((resolve) => {
    const stop = watch(
      () => auth.status,
      (s) => {
        if (s !== 'loading') {
          stop()
          resolve()
        }
      },
    )
  })
}

export function createAppRouter() {
  const router = createRouter({
    history: createWebHistory(),
    routes,
    scrollBehavior: () => ({ top: 0 }),
  })

  router.beforeEach(async (to) => {
    const auth = useAuthStore()
    await auth.whenResolved()
    await settled()

    if (auth.status === 'signedOut') {
      if (to.meta.requiresAuth || to.name === 'no-access') {
        return { name: 'login', query: to.fullPath !== '/' && to.fullPath !== '/dashboard' ? { redirect: to.fullPath } : {} }
      }
      return true
    }
    if (auth.status === 'noAccess') {
      return to.name === 'no-access' ? true : { name: 'no-access' }
    }
    // ready
    if (to.meta.guestOnly || to.name === 'no-access') return { name: 'dashboard' }
    if (to.meta.requiresAdmin && !auth.isAdmin) return { name: 'dashboard', query: { denied: '1' } }
    return true
  })

  router.afterEach((to) => {
    document.title = to.meta.title ? `${to.meta.title} · EIMS` : 'EIMS · Epoxy Inventory'
  })

  return router
}
