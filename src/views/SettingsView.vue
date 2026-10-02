<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FlaskConical, Info, MapPin, Pencil, Plus, Trash2, Users } from 'lucide-vue-next'
import { getBackend } from '@/services/backend'
import { deleteUser, setUserRole } from '@/services/operations/users'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useInventoryStore } from '@/stores/inventory'
import { useUiStore } from '@/stores/ui'
import { formatDateTime } from '@/lib/dates'
import { formatQty, UNIT_LABELS } from '@/lib/format'
import { describePackaging } from '@/lib/packaging'
import type { Material, Role, StorageLocation, UserProfile } from '@/types/models'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppButton from '@/components/ui/AppButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import SegmentedTabs from '@/components/ui/SegmentedTabs.vue'
import QtyDisplay from '@/components/domain/QtyDisplay.vue'
import MaterialForm from '@/components/settings/MaterialForm.vue'
import LocationForm from '@/components/settings/LocationForm.vue'

type Tab = 'materials' | 'locations' | 'users'

const auth = useAuthStore()
const data = useDataStore()
const inv = useInventoryStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()

const tab = ref<Tab>((['materials', 'locations', 'users'] as const).find((t) => t === route.query.tab) ?? 'materials')
watch(tab, (t) => void router.replace({ query: t === 'materials' ? {} : { tab: t } }))

const activeUsers = computed(() =>
  data.users.filter((u) => u.status === 'active').sort((a, b) => (a.role === b.role ? a.displayName.localeCompare(b.displayName) : a.role === 'admin' ? -1 : 1)),
)
const removedUsers = computed(() => data.users.filter((u) => u.status === 'deleted'))

const tabs = computed(() => [
  { value: 'materials' as Tab, label: 'Materials', count: data.materials.length },
  { value: 'locations' as Tab, label: 'Locations', count: data.locations.length },
  { value: 'users' as Tab, label: 'Users', count: activeUsers.value.length },
])

// Materials
const materialOpen = ref(false)
const editingMaterialId = ref<string | null>(null)
const editingMaterial = computed(() => data.materials.find((m) => m.id === editingMaterialId.value) ?? null)
function editMaterial(m: Material | null) {
  editingMaterialId.value = m?.id ?? null
  materialOpen.value = true
}

// Locations
const locationOpen = ref(false)
const editingLocationId = ref<string | null>(null)
const editingLocation = computed(() => data.locations.find((l) => l.id === editingLocationId.value) ?? null)
function editLocation(l: StorageLocation | null) {
  editingLocationId.value = l?.id ?? null
  locationOpen.value = true
}
function lotsAt(locationId: string) {
  return inv.stockBatches.filter((b) => b.locationId === locationId).length
}

// Users
const busyUser = ref<string | null>(null)
async function changeRole(u: UserProfile, role: Role) {
  if (role === u.role) return
  const { confirmed } = await ui.confirm({
    title: role === 'admin' ? `Make ${u.displayName} a Super Admin?` : `Change ${u.displayName} to Normal User?`,
    message:
      role === 'admin'
        ? 'They will get full read/write access, including purchasing, sales, financial figures and user management.'
        : 'They will lose access to purchasing, sales, settings and all financial figures, and keep read-only stock access.',
    confirmLabel: 'Change role',
  })
  if (!confirmed) return
  busyUser.value = u.id
  await ui.run(() => setUserRole(getBackend().store, auth.actor, u.id, role), 'Role updated')
  busyUser.value = null
}

async function removeUser(u: UserProfile) {
  const { confirmed } = await ui.confirm({
    title: `Delete ${u.displayName}?`,
    message: `${u.email} will lose all access to EIMS immediately. Records they created keep their name for audit purposes.`,
    confirmLabel: 'Delete user',
    tone: 'danger',
  })
  if (!confirmed) return
  busyUser.value = u.id
  await ui.run(() => deleteUser(getBackend().store, auth.actor, u.id), 'User deleted', `${u.email} can no longer sign in to EIMS.`)
  busyUser.value = null
}
</script>

<template>
  <div>
    <PageHeader title="Settings" description="Catalogue, packaging conversions, storage locations and user access.">
      <template #actions>
        <AppButton v-if="tab === 'materials'" variant="dark" :icon="Plus" @click="editMaterial(null)">New material</AppButton>
        <AppButton v-else-if="tab === 'locations'" variant="dark" :icon="Plus" @click="editLocation(null)">New location</AppButton>
      </template>
    </PageHeader>

    <SegmentedTabs v-model="tab" :options="tabs" class="mb-4" />

    <!-- Materials -->
    <div v-if="tab === 'materials'" class="grid gap-4 lg:grid-cols-2">
      <article v-for="m in inv.sortedMaterials" :key="m.id" class="card flex flex-col p-5" :class="m.active ? '' : 'opacity-70'">
        <header class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h2 class="truncate font-semibold text-stone-900">{{ m.name }}</h2>
              <AppBadge v-if="!m.active">Inactive</AppBadge>
            </div>
            <p class="num mt-0.5 text-xs text-stone-500">{{ m.code }} · base unit {{ UNIT_LABELS[m.baseUnit] }}</p>
          </div>
          <AppButton size="sm" variant="ghost" :icon="Pencil" @click="editMaterial(m)">Edit</AppButton>
        </header>
        <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div class="rounded-lg bg-stone-50 px-3 py-2 ring-1 ring-stone-100">
            <dt class="text-xs text-stone-500">On hand</dt>
            <dd class="mt-0.5"><QtyDisplay :quantity="inv.totalsByMaterial.get(m.id) ?? 0" :material="m" strong /></dd>
          </div>
          <div class="rounded-lg bg-stone-50 px-3 py-2 ring-1 ring-stone-100">
            <dt class="text-xs text-stone-500">Low-stock alert below</dt>
            <dd class="num mt-0.5 text-stone-800">{{ m.lowStockThreshold > 0 ? formatQty(m.lowStockThreshold, m.baseUnit) : 'Off' }}</dd>
          </div>
        </dl>
        <div class="mt-4">
          <p class="eyebrow mb-2">Packaging</p>
          <ul v-if="m.packaging.length" class="space-y-1.5">
            <li v-for="p in m.packaging" :key="p.id" class="flex items-baseline justify-between gap-3 text-sm">
              <span class="font-medium text-stone-800">{{ p.name }}</span>
              <span class="num text-right text-xs text-stone-500">{{ describePackaging(m, p) }}</span>
            </li>
          </ul>
          <p v-else class="text-sm text-stone-500">Base unit only.</p>
        </div>
        <p v-if="m.notes" class="mt-4 border-t border-stone-100 pt-3 text-xs leading-relaxed text-stone-500">{{ m.notes }}</p>
      </article>
      <div v-if="!data.materials.length" class="card lg:col-span-2">
        <EmptyState :icon="FlaskConical" title="No materials yet" description="Add your resins, hardeners and packaging materials.">
          <AppButton variant="dark" :icon="Plus" @click="editMaterial(null)">New material</AppButton>
        </EmptyState>
      </div>
    </div>

    <!-- Locations -->
    <div v-else-if="tab === 'locations'" class="card overflow-hidden">
      <div v-if="data.locations.length" class="overflow-x-auto">
        <table class="table-base">
          <thead>
            <tr>
              <th>Location</th>
              <th>Type</th>
              <th>Address / notes</th>
              <th class="text-right">Lots held</th>
              <th>Status</th>
              <th class="w-px"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in inv.sortedLocations" :key="l.id">
              <td class="font-medium text-stone-900">{{ l.name }}</td>
              <td><AppBadge :tone="l.type === 'vendor' ? 'blue' : 'neutral'">{{ l.type === 'vendor' ? 'Vendor' : 'Internal' }}</AppBadge></td>
              <td class="max-w-72 truncate text-stone-600">{{ l.address || '—' }}</td>
              <td class="num text-right">{{ lotsAt(l.id) }}</td>
              <td><AppBadge :tone="l.active ? 'green' : 'neutral'" dot>{{ l.active ? 'Active' : 'Inactive' }}</AppBadge></td>
              <td><AppButton size="sm" variant="ghost" :icon="Pencil" @click="editLocation(l)">Edit</AppButton></td>
            </tr>
          </tbody>
        </table>
      </div>
      <EmptyState v-else :icon="MapPin" title="No locations yet">
        <AppButton variant="dark" :icon="Plus" @click="editLocation(null)">New location</AppButton>
      </EmptyState>
    </div>

    <!-- Users -->
    <div v-else class="space-y-4">
      <div class="flex gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
        <Info class="mt-0.5 size-4 shrink-0" />
        <p>
          New accounts are created by the project owner in <span class="font-medium">Firebase Console → Authentication</span>. They appear here as
          Normal Users after their first sign-in, and you can then promote them.
        </p>
      </div>
      <div class="card overflow-hidden">
        <div v-if="activeUsers.length" class="overflow-x-auto">
          <table class="table-base">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Since</th>
                <th class="w-px"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in activeUsers" :key="u.id">
                <td>
                  <p class="font-medium text-stone-900">
                    {{ u.displayName }} <span v-if="u.id === auth.user?.uid" class="ml-1 text-xs font-normal text-stone-500">(you)</span>
                  </p>
                  <p class="text-xs text-stone-500">{{ u.email }}</p>
                </td>
                <td>
                  <select
                    :value="u.role"
                    class="input h-9 w-40 py-0"
                    :disabled="u.id === auth.user?.uid || busyUser === u.id"
                    :aria-label="`Role for ${u.displayName}`"
                    @change="(e) => { const el = e.target as HTMLSelectElement; const next = el.value as Role; el.value = u.role; void changeRole(u, next) }"
                  >
                    <option value="admin">Super Admin</option>
                    <option value="user">Normal User</option>
                  </select>
                </td>
                <td class="num text-xs text-stone-500">{{ formatDateTime(u.createdAt) }}</td>
                <td>
                  <AppButton
                    v-if="u.id !== auth.user?.uid"
                    size="sm"
                    variant="ghost"
                    class="text-red-600 hover:bg-red-50 hover:text-red-700"
                    :icon="Trash2"
                    :loading="busyUser === u.id"
                    @click="removeUser(u)"
                  >
                    Delete
                  </AppButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-else :icon="Users" title="No users" />
      </div>
      <details v-if="removedUsers.length" class="card px-5 py-3 text-sm">
        <summary class="cursor-pointer font-medium text-stone-700">Deleted users ({{ removedUsers.length }})</summary>
        <ul class="mt-3 divide-y divide-stone-100">
          <li v-for="u in removedUsers" :key="u.id" class="py-2">
            <p class="text-stone-700">{{ u.displayName }} · {{ u.email }}</p>
            <p class="text-xs text-stone-500">Deleted {{ formatDateTime(u.deletedAt) }} by {{ u.deletedBy }}</p>
          </li>
        </ul>
      </details>
    </div>

    <MaterialForm :open="materialOpen" :material="editingMaterial" @close="materialOpen = false" />
    <LocationForm :open="locationOpen" :location="editingLocation" @close="locationOpen = false" />
  </div>
</template>
