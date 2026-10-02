<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Boxes, LayoutDashboard, LogOut, Menu, Settings, ShoppingCart, Truck, TriangleAlert, X, Lock } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useInventoryStore } from '@/stores/inventory'
import { useUiStore } from '@/stores/ui'
import BrandMark from '@/components/domain/BrandMark.vue'
import LoadingBlock from '@/components/ui/LoadingBlock.vue'

const auth = useAuthStore()
const data = useDataStore()
const inv = useInventoryStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const drawerOpen = ref(false)

watch(() => route.fullPath, () => (drawerOpen.value = false))

// Shown once when a Normal User hits an admin-only URL.
watch(
  () => route.query.denied,
  (d) => {
    if (d) {
      ui.toast('info', 'Super Admin only', 'That page is restricted to Super Admins.')
      void router.replace({ query: {} })
    }
  },
  { immediate: true },
)

const alertCount = computed(() => inv.lowStock.length + inv.expiryAlerts.length)

const nav = computed(() => [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, badge: alertCount.value || null, show: true },
  { to: '/inventory', label: 'Inventory', icon: Boxes, show: true },
  { to: '/purchase', label: 'Purchase Orders', icon: Truck, show: auth.isAdmin },
  { to: '/sales', label: 'Sales', icon: ShoppingCart, show: auth.isAdmin },
  { to: '/settings', label: 'Settings', icon: Settings, show: auth.isAdmin },
].filter((n) => n.show))

const initials = computed(() =>
  (auth.profile?.displayName ?? auth.user?.email ?? '?')
    .split(/\s+/)
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase(),
)

async function signOut() {
  await auth.signOut()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <div class="min-h-dvh lg:pl-64">
    <!-- Sidebar -->
    <div v-if="drawerOpen" class="fixed inset-0 z-30 bg-stone-950/50 lg:hidden" aria-hidden="true" @click="drawerOpen = false" />
    <aside
      :class="[
        'fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-stone-950 text-stone-300 transition-transform duration-200 lg:translate-x-0',
        drawerOpen ? 'translate-x-0' : '-translate-x-full',
      ]"
      aria-label="Main navigation"
    >
      <div class="flex h-16 items-center justify-between px-5">
        <RouterLink to="/dashboard" class="flex items-center gap-2.5">
          <BrandMark class="size-8" />
          <span class="leading-tight">
            <span class="block text-[15px] font-semibold tracking-tight text-white">EIMS</span>
            <span class="block text-[11px] text-stone-500">Epoxy Inventory</span>
          </span>
        </RouterLink>
        <button type="button" class="rounded p-1 text-stone-500 hover:text-white lg:hidden" aria-label="Close menu" @click="drawerOpen = false">
          <X class="size-5" />
        </button>
      </div>

      <nav class="mt-2 flex-1 space-y-0.5 px-3">
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          :class="[
            'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
            route.path.startsWith(item.to) ? 'bg-white/[0.07] text-white' : 'text-stone-400 hover:bg-white/5 hover:text-stone-100',
          ]"
          :aria-current="route.path.startsWith(item.to) ? 'page' : undefined"
        >
          <component
            :is="item.icon"
            :class="['size-[18px] shrink-0 transition', route.path.startsWith(item.to) ? 'text-resin-400' : 'text-stone-500 group-hover:text-stone-300']"
          />
          <span class="flex-1">{{ item.label }}</span>
          <span v-if="item.badge" class="num rounded-md bg-resin-500/15 px-1.5 py-0.5 text-[11px] font-medium text-resin-300">{{ item.badge }}</span>
        </RouterLink>
        <div v-if="!auth.isAdmin" class="mx-3 mt-6 flex gap-2 rounded-lg border border-white/5 bg-white/[0.03] p-3 text-xs leading-relaxed text-stone-500">
          <Lock class="mt-0.5 size-3.5 shrink-0" />
          <span>Read-only access. Purchasing, sales and settings are for Super Admins.</span>
        </div>
      </nav>

      <div class="border-t border-white/5 p-3">
        <div class="flex items-center gap-3 rounded-lg px-2 py-2">
          <div class="grid size-9 shrink-0 place-items-center rounded-full bg-stone-800 text-xs font-semibold text-stone-200 ring-1 ring-white/10">{{ initials }}</div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-stone-100">{{ auth.profile?.displayName }}</p>
            <p class="truncate text-[11px] text-stone-500">{{ auth.isAdmin ? 'Super Admin' : 'Normal User' }} · {{ auth.profile?.email }}</p>
          </div>
          <button type="button" class="rounded-md p-1.5 text-stone-500 transition hover:bg-white/5 hover:text-white" aria-label="Sign out" title="Sign out" @click="signOut">
            <LogOut class="size-4" />
          </button>
        </div>
      </div>
    </aside>

    <!-- Mobile top bar -->
    <header class="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-stone-200 bg-white/90 px-4 backdrop-blur lg:hidden">
      <button type="button" class="-ml-1 rounded-md p-1.5 text-stone-600 hover:bg-stone-100" aria-label="Open menu" @click="drawerOpen = true">
        <Menu class="size-5" />
      </button>
      <BrandMark class="size-7" />
      <span class="text-sm font-semibold">EIMS</span>
    </header>

    <main class="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
      <div v-if="data.firstError" class="mb-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <TriangleAlert class="mt-0.5 size-4 shrink-0" />
        <div>
          <p class="font-medium">Some data could not be loaded</p>
          <p class="mt-0.5 text-red-700">{{ data.firstError }}</p>
        </div>
      </div>
      <div v-if="!data.ready" class="card"><LoadingBlock :rows="6" /></div>
      <RouterView v-else v-slot="{ Component }">
        <component :is="Component" />
      </RouterView>
    </main>
  </div>
</template>
