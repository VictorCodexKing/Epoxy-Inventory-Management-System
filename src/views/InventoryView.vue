<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeftRight, ArrowRight, Ban, Boxes, Search } from 'lucide-vue-next'
import { getBackend } from '@/services/backend'
import { voidTransfer } from '@/services/operations/transfers'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useInventoryStore } from '@/stores/inventory'
import { useUiStore } from '@/stores/ui'
import { formatDate } from '@/lib/dates'
import { formatMYR, formatNumber, formatQty, formatRate, UNIT_LABELS } from '@/lib/format'
import { EPSILON } from '@/lib/numbers'
import { compareFefo } from '@/lib/stock'
import type { Transfer } from '@/types/models'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppButton from '@/components/ui/AppButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import SegmentedTabs from '@/components/ui/SegmentedTabs.vue'
import ExpiryBadge from '@/components/domain/ExpiryBadge.vue'
import QtyDisplay from '@/components/domain/QtyDisplay.vue'
import StatusBadge from '@/components/domain/StatusBadge.vue'
import TransferModal from '@/components/inventory/TransferModal.vue'

type View = 'matrix' | 'batches' | 'transfers'

const auth = useAuthStore()
const data = useDataStore()
const inv = useInventoryStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()

const view = ref<View>((['matrix', 'batches', 'transfers'] as const).find((v) => v === route.query.view) ?? 'matrix')
const materialId = ref(typeof route.query.material === 'string' ? route.query.material : '')
const locationId = ref(typeof route.query.location === 'string' ? route.query.location : '')
const search = ref('')
const showEmpty = ref(false)

watch([view, materialId, locationId], () => {
  void router.replace({
    query: { view: view.value === 'matrix' ? undefined : view.value, material: materialId.value || undefined, location: locationId.value || undefined },
  })
})
watch(
  () => auth.isAdmin,
  (admin) => {
    if (!admin && view.value === 'transfers') view.value = 'matrix'
  },
  { immediate: true },
)

const viewOptions = computed(() => [
  { value: 'matrix' as View, label: 'Stock matrix' },
  { value: 'batches' as View, label: 'Batches', count: inv.stockBatches.length },
  ...(auth.isAdmin ? [{ value: 'transfers' as View, label: 'Transfers', count: data.transfers.length }] : []),
])

// ── Matrix ──
const matrixLocations = computed(() =>
  inv.sortedLocations.filter((l) => (!locationId.value || l.id === locationId.value) && (l.active || (inv.stockByLocation.get(l.id) ?? 0) > 0)),
)
const matrixMaterials = computed(() =>
  inv.sortedMaterials.filter(
    (m) =>
      (!materialId.value || m.id === materialId.value) &&
      (m.active || (inv.totalsByMaterial.get(m.id) ?? 0) > 0) &&
      (!search.value || `${m.name} ${m.code}`.toLowerCase().includes(search.value.toLowerCase())),
  ),
)
function cell(mid: string, lid: string) {
  return inv.matrix.get(mid)?.get(lid) ?? 0
}
function rowTotal(mid: string) {
  return matrixLocations.value.reduce((a, l) => a + cell(mid, l.id), 0)
}
function rowValue(mid: string) {
  return inv.stockBatches
    .filter((b) => b.materialId === mid && (!locationId.value || b.locationId === locationId.value))
    .reduce((a, b) => a + inv.batchValue(b), 0)
}
const lowIds = computed(() => new Set(inv.lowStock.map((a) => a.material.id)))

// ── Batches ──
const batchRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return data.batches
    .filter((b) => showEmpty.value || b.quantity > EPSILON)
    .filter((b) => !materialId.value || b.materialId === materialId.value)
    .filter((b) => !locationId.value || b.locationId === locationId.value)
    .filter((b) => {
      if (!q) return true
      const m = inv.materialsById.get(b.materialId)
      return `${b.batchNo} ${m?.name ?? ''} ${m?.code ?? ''}`.toLowerCase().includes(q)
    })
    .sort(compareFefo)
})
const filteredValue = computed(() => batchRows.value.reduce((a, b) => a + inv.batchValue(b), 0))

// ── Transfers ──
const transferRows = computed(() =>
  [...data.transfers]
    .filter((t) => !locationId.value || t.fromLocationId === locationId.value || t.toLocationId === locationId.value)
    .filter((t) => !materialId.value || t.lines.some((l) => l.materialId === materialId.value))
    .filter((t) => !search.value || t.transferNumber.toLowerCase().includes(search.value.toLowerCase()))
    .sort((a, b) => (a.transferDate === b.transferDate ? b.createdAt.localeCompare(a.createdAt) : b.transferDate.localeCompare(a.transferDate))),
)
function transferSummary(t: Transfer) {
  const per = new Map<string, number>()
  for (const l of t.lines) per.set(l.materialId, (per.get(l.materialId) ?? 0) + l.quantity)
  return [...per].map(([mid, q]) => {
    const m = inv.materialsById.get(mid)
    return `${m?.name ?? '—'} · ${m ? formatQty(q, m.baseUnit) : formatNumber(q)}`
  })
}

// ── Actions ──
const transferOpen = ref(false)
const presetBatch = ref<string | null>(null)
function openTransfer(batchId: string | null = null) {
  presetBatch.value = batchId
  transferOpen.value = true
}

async function onVoidTransfer(t: Transfer) {
  const { confirmed, reason } = await ui.confirm({
    title: `Void ${t.transferNumber}?`,
    message: 'The quantities will be moved back to the source location and reversing entries written to the ledger. This cannot be undone.',
    confirmLabel: 'Void transfer',
    tone: 'danger',
    requireReason: true,
    reasonLabel: 'Reason for voiding',
  })
  if (!confirmed) return
  await ui.run(() => voidTransfer(getBackend().store, auth.actor, t.id, reason), `${t.transferNumber} voided`)
}
</script>

<template>
  <div>
    <PageHeader title="Inventory" description="Physical stock by material, location and batch. Quantities are in each material's base unit.">
      <template #actions>
        <AppButton v-if="auth.isAdmin" variant="dark" :icon="ArrowLeftRight" @click="openTransfer()">Transfer stock</AppButton>
      </template>
    </PageHeader>

    <!-- Toolbar -->
    <div class="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <SegmentedTabs v-model="view" :options="viewOptions" />
      <div class="flex flex-col gap-2 sm:flex-row">
        <div class="relative">
          <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
          <input v-model="search" type="search" class="input pl-9 sm:w-56" :placeholder="view === 'transfers' ? 'Transfer no.' : 'Search material or batch'" aria-label="Search" />
        </div>
        <select v-model="materialId" class="input sm:w-52" aria-label="Filter by material">
          <option value="">All materials</option>
          <option v-for="m in inv.sortedMaterials" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
        <select v-model="locationId" class="input sm:w-44" aria-label="Filter by location">
          <option value="">All locations</option>
          <option v-for="l in inv.sortedLocations" :key="l.id" :value="l.id">{{ l.name }}</option>
        </select>
      </div>
    </div>

    <!-- Matrix -->
    <div v-if="view === 'matrix'" class="card overflow-hidden">
      <div v-if="matrixMaterials.length && matrixLocations.length" class="overflow-x-auto">
        <table class="table-base">
          <thead>
            <tr>
              <th class="min-w-56">Material</th>
              <th v-for="l in matrixLocations" :key="l.id" class="text-right">
                <span class="block">{{ l.name }}</span>
                <span class="block text-[10px] font-normal tracking-normal text-stone-400 normal-case">{{ l.type === 'vendor' ? 'Vendor' : 'Internal' }}</span>
              </th>
              <th class="bg-stone-100/80 text-right">Total</th>
              <th v-if="auth.isAdmin" class="text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in matrixMaterials" :key="m.id">
              <td>
                <div class="flex items-center gap-2">
                  <p class="font-medium text-stone-900">{{ m.name }}</p>
                  <AppBadge v-if="lowIds.has(m.id)" tone="orange">Low</AppBadge>
                  <AppBadge v-if="!m.active" tone="neutral">Inactive</AppBadge>
                </div>
                <p class="num text-xs text-stone-500">{{ m.code }} · {{ UNIT_LABELS[m.baseUnit] }}</p>
              </td>
              <td v-for="l in matrixLocations" :key="l.id" class="text-right">
                <button
                  v-if="cell(m.id, l.id) > 0"
                  type="button"
                  class="rounded px-1 text-right hover:bg-resin-50"
                  :title="`See batches of ${m.name} at ${l.name}`"
                  @click="((materialId = m.id), (locationId = l.id), (view = 'batches'))"
                >
                  <QtyDisplay :quantity="cell(m.id, l.id)" :material="m" breakdown />
                </button>
                <span v-else class="text-stone-300">—</span>
              </td>
              <td class="bg-stone-50/80 text-right"><QtyDisplay :quantity="rowTotal(m.id)" :material="m" strong /></td>
              <td v-if="auth.isAdmin" class="num text-right text-stone-800">{{ formatMYR(rowValue(m.id)) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <EmptyState v-else :icon="Boxes" title="Nothing to show" description="Add materials and locations in Settings, then receive a purchase order." />
    </div>

    <!-- Batches -->
    <div v-else-if="view === 'batches'" class="card overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-5 py-3">
        <label class="inline-flex items-center gap-2 text-sm text-stone-600">
          <input v-model="showEmpty" type="checkbox" class="size-4 rounded border-stone-300 accent-stone-900" />
          Show emptied batches
        </label>
        <p class="text-xs text-stone-500">
          {{ formatNumber(batchRows.length) }} batches · first-expiry-first-out order
          <template v-if="auth.isAdmin"> · <span class="num font-medium text-stone-800">{{ formatMYR(filteredValue) }}</span></template>
        </p>
      </div>
      <div v-if="batchRows.length" class="overflow-x-auto">
        <table class="table-base">
          <thead>
            <tr>
              <th>Material / batch</th>
              <th>Location</th>
              <th>Received</th>
              <th>Expiry</th>
              <th class="text-right">On hand</th>
              <th v-if="auth.isAdmin" class="text-right">Unit cost</th>
              <th v-if="auth.isAdmin" class="text-right">Value</th>
              <th v-if="auth.isAdmin" class="w-px"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="b in batchRows" :key="b.id" :class="b.quantity <= EPSILON ? 'opacity-50' : ''">
              <td>
                <p class="font-medium text-stone-900">{{ inv.materialsById.get(b.materialId)?.name ?? '—' }}</p>
                <p class="num text-xs text-stone-500">{{ b.batchNo }}</p>
              </td>
              <td class="whitespace-nowrap text-stone-700">{{ inv.locationsById.get(b.locationId)?.name ?? '—' }}</td>
              <td class="num whitespace-nowrap text-stone-600">{{ formatDate(b.receivedDate) }}</td>
              <td><ExpiryBadge :date="b.expiryDate" /></td>
              <td class="text-right"><QtyDisplay :quantity="b.quantity" :material="inv.materialsById.get(b.materialId)" breakdown strong /></td>
              <td v-if="auth.isAdmin" class="num text-right whitespace-nowrap text-stone-600">
                {{ formatRate(inv.unitCostByLot.get(b.lotId) ?? 0) }}<span class="text-stone-400">/{{ UNIT_LABELS[inv.materialsById.get(b.materialId)?.baseUnit ?? 'kg'] }}</span>
              </td>
              <td v-if="auth.isAdmin" class="num text-right whitespace-nowrap text-stone-900">{{ formatMYR(inv.batchValue(b)) }}</td>
              <td v-if="auth.isAdmin">
                <AppButton v-if="b.quantity > EPSILON" size="sm" variant="ghost" :icon="ArrowLeftRight" @click="openTransfer(b.id)">Move</AppButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <EmptyState v-else :icon="Boxes" title="No batches match these filters" />
    </div>

    <!-- Transfers -->
    <div v-else class="card overflow-hidden">
      <div v-if="transferRows.length" class="overflow-x-auto">
        <table class="table-base">
          <thead>
            <tr>
              <th>Transfer</th>
              <th>Route</th>
              <th>Items</th>
              <th>Status</th>
              <th class="w-px"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in transferRows" :key="t.id" :class="t.status === 'void' ? 'text-stone-400' : ''">
              <td>
                <p class="num font-medium" :class="t.status === 'void' ? 'line-through' : 'text-stone-900'">{{ t.transferNumber }}</p>
                <p class="num text-xs text-stone-500">{{ formatDate(t.transferDate) }} · {{ t.createdBy }}</p>
              </td>
              <td class="whitespace-nowrap">
                <span class="inline-flex items-center gap-1.5">
                  {{ inv.locationsById.get(t.fromLocationId)?.name ?? '—' }}
                  <ArrowRight class="size-3.5 text-stone-400" />
                  {{ inv.locationsById.get(t.toLocationId)?.name ?? '—' }}
                </span>
              </td>
              <td>
                <p v-for="s in transferSummary(t)" :key="s" class="text-sm">{{ s }}</p>
                <p v-if="t.notes" class="mt-0.5 text-xs text-stone-500">{{ t.notes }}</p>
                <p v-if="t.status === 'void'" class="mt-0.5 text-xs text-stone-500">Voided by {{ t.voidedBy }}: {{ t.voidReason }}</p>
              </td>
              <td><StatusBadge :status="t.status" kind="record" /></td>
              <td>
                <AppButton v-if="t.status !== 'void'" size="sm" variant="ghost" :icon="Ban" @click="onVoidTransfer(t)">Void</AppButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <EmptyState v-else :icon="ArrowLeftRight" title="No transfers yet" description="Use “Transfer stock” to move batches between locations.">
        <AppButton variant="dark" :icon="ArrowLeftRight" @click="openTransfer()">Transfer stock</AppButton>
      </EmptyState>
    </div>

    <TransferModal v-if="auth.isAdmin" :open="transferOpen" :preset-batch-id="presetBatch" @close="transferOpen = false" />
  </div>
</template>
