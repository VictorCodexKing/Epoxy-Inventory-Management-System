<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { ArrowRight, CalendarClock, CircleCheck, PackageCheck, TriangleAlert, Warehouse } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useInventoryStore, type ExpiryAlert } from '@/stores/inventory'
import { addDays, formatDate, formatDateTime } from '@/lib/dates'
import { formatMYR, formatNumber, formatPercent, formatQty, UNIT_LABELS } from '@/lib/format'
import { roundMoney } from '@/lib/numbers'
import type { BaseUnit, MovementType } from '@/types/models'
import AppBadge from '@/components/ui/AppBadge.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import SegmentedTabs from '@/components/ui/SegmentedTabs.vue'
import ExpiryBadge from '@/components/domain/ExpiryBadge.vue'
import QtyDisplay from '@/components/domain/QtyDisplay.vue'

const auth = useAuthStore()
const data = useDataStore()
const inv = useInventoryStore()

const greeting = computed(() => {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kuala_Lumpur' }).format(new Date()))
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
})
const firstName = computed(() => auth.profile?.displayName.split(' ')[0] ?? '')

// ── Stock totals per unit (never mixing kg and L) ──
const unitTotals = computed(() =>
  (Object.keys(inv.totalsByUnit) as BaseUnit[])
    .filter((u) => data.materials.some((m) => m.baseUnit === u))
    .map((u) => ({ unit: u, qty: inv.totalsByUnit[u] })),
)

// ── Finance (admin) ──
const payables = computed(() =>
  roundMoney(data.purchaseOrders.filter((p) => p.status !== 'void').reduce((a, p) => a + (p.totalAmount - p.amountPaid), 0)),
)
const receivables = computed(() =>
  roundMoney(data.sales.filter((s) => s.status !== 'void').reduce((a, s) => a + (s.totalAmount - s.amountCollected), 0)),
)
// Rolling 30-day window (inclusive of today, Malaysia time).
const windowStart = computed(() => addDays(inv.today, -29))
const monthSales = computed(() => data.sales.filter((s) => s.status !== 'void' && s.saleDate >= windowStart.value && s.saleDate <= inv.today))
const monthRevenue = computed(() => roundMoney(monthSales.value.reduce((a, s) => a + s.totalAmount, 0)))
const monthMargin = computed(() => roundMoney(monthSales.value.reduce((a, s) => a + s.grossMargin, 0)))
const openPOs = computed(() => data.purchaseOrders.filter((p) => p.status === 'ordered' || p.status === 'partially_received').length)

// ── Stock by material ──
const materialRows = computed(() =>
  inv.sortedMaterials
    .map((m) => {
      const total = inv.totalsByMaterial.get(m.id) ?? 0
      const perLoc = inv.sortedLocations
        .map((l) => ({ loc: l, qty: inv.matrix.get(m.id)?.get(l.id) ?? 0 }))
        .filter((x) => x.qty > 0)
      return { m, total, perLoc, value: inv.valuationByMaterial.get(m.id) ?? 0 }
    })
    .filter((r) => r.m.active || r.total > 0),
)

// ── Expiry tabs ──
type Bucket = ExpiryAlert['bucket']
const expiryTab = ref<Bucket | 'all'>('all')
const expiryTabs = computed(() => [
  { value: 'all' as const, label: 'All', count: inv.expiryAlerts.length },
  { value: 'expired' as const, label: 'Expired', count: inv.expiryCounts.expired },
  { value: 'd30' as const, label: '0–30 days', count: inv.expiryCounts.d30 },
  { value: 'd60' as const, label: '31–60', count: inv.expiryCounts.d60 },
  { value: 'd90' as const, label: '61–90', count: inv.expiryCounts.d90 },
])
const visibleExpiry = computed(() =>
  (expiryTab.value === 'all' ? inv.expiryAlerts : inv.expiryAlerts.filter((a) => a.bucket === expiryTab.value)).slice(0, 12),
)

// ── Activity (admin) ──
const movementLabels: Record<MovementType, string> = {
  po_receipt: 'Received',
  po_void: 'PO voided',
  sale: 'Dispatched',
  sale_void: 'Sale voided',
  transfer_out: 'Transferred out',
  transfer_in: 'Transferred in',
  transfer_void_out: 'Transfer reversed',
  transfer_void_in: 'Transfer reversed',
}
const activity = computed(() => data.movements.slice(0, 10))
</script>

<template>
  <div>
    <PageHeader :eyebrow="formatDate(inv.today)" :title="`${greeting}, ${firstName}`" description="Live position across every warehouse." />

    <!-- KPIs -->
    <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <template v-if="auth.isAdmin">
        <div class="card relative overflow-hidden p-5 sm:col-span-2 xl:col-span-1">
          <div class="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full bg-resin-400/20 blur-2xl" aria-hidden="true" />
          <p class="eyebrow">Inventory value</p>
          <p class="num mt-3 text-[28px] leading-none font-semibold tracking-tight text-stone-900">{{ formatMYR(inv.totalValuation) }}</p>
          <p class="mt-2 text-xs text-stone-500">At actual batch cost · {{ formatNumber(inv.stockBatches.length) }} lots on hand</p>
        </div>
        <div class="card p-5">
          <p class="eyebrow">Payable to suppliers</p>
          <p class="num mt-3 text-2xl leading-none font-semibold text-stone-900">{{ formatMYR(payables) }}</p>
          <p class="mt-2 text-xs text-stone-500">{{ openPOs }} purchase {{ openPOs === 1 ? 'order' : 'orders' }} awaiting stock</p>
        </div>
        <div class="card p-5">
          <p class="eyebrow">Receivable from customers</p>
          <p class="num mt-3 text-2xl leading-none font-semibold text-stone-900">{{ formatMYR(receivables) }}</p>
          <p class="mt-2 text-xs text-stone-500">Outstanding on non-void sales</p>
        </div>
        <div class="card p-5">
          <p class="eyebrow">Gross margin · last 30 days</p>
          <p class="num mt-3 text-2xl leading-none font-semibold" :class="monthMargin < 0 ? 'text-red-600' : 'text-stone-900'">{{ formatMYR(monthMargin) }}</p>
          <p class="mt-2 text-xs text-stone-500">
            on {{ formatMYR(monthRevenue) }} revenue
            <template v-if="monthRevenue > 0">· {{ formatPercent(monthMargin / monthRevenue) }}</template>
          </p>
        </div>
      </template>
      <template v-else>
        <div v-for="t in unitTotals" :key="t.unit" class="card p-5">
          <p class="eyebrow">Total stock · {{ UNIT_LABELS[t.unit] }}</p>
          <p class="num mt-3 text-[28px] leading-none font-semibold tracking-tight text-stone-900">{{ formatQty(t.qty, t.unit) }}</p>
          <p class="mt-2 text-xs text-stone-500">All {{ UNIT_LABELS[t.unit] }}-based materials, all locations</p>
        </div>
        <div class="card p-5">
          <p class="eyebrow">Lots on hand</p>
          <p class="num mt-3 text-[28px] leading-none font-semibold text-stone-900">{{ formatNumber(inv.stockBatches.length) }}</p>
          <p class="mt-2 text-xs text-stone-500">Across {{ inv.activeLocations.length }} active locations</p>
        </div>
      </template>
    </section>

    <!-- Alerts -->
    <section class="mt-6 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div class="card flex flex-col">
        <header class="flex items-center justify-between border-b border-stone-100 px-5 py-4">
          <div class="flex items-center gap-2">
            <TriangleAlert class="size-4 text-orange-500" />
            <h2 class="text-sm font-semibold">Low stock</h2>
          </div>
          <AppBadge :tone="inv.lowStock.length ? 'orange' : 'green'">{{ inv.lowStock.length }} {{ inv.lowStock.length === 1 ? 'material' : 'materials' }}</AppBadge>
        </header>
        <ul v-if="inv.lowStock.length" class="divide-y divide-stone-100">
          <li v-for="a in inv.lowStock" :key="a.material.id" class="px-5 py-4">
            <div class="flex items-baseline justify-between gap-3">
              <p class="truncate text-sm font-medium text-stone-900">{{ a.material.name }}</p>
              <p class="num shrink-0 text-xs text-stone-500">
                <span class="font-semibold text-orange-700">{{ formatQty(a.total, a.material.baseUnit) }}</span>
                / {{ formatQty(a.threshold, a.material.baseUnit) }}
              </p>
            </div>
            <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-100">
              <div class="h-full rounded-full bg-gradient-to-r from-red-500 to-orange-400" :style="{ width: `${Math.min(100, (a.total / a.threshold) * 100)}%` }" />
            </div>
          </li>
        </ul>
        <EmptyState v-else :icon="CircleCheck" title="All materials above threshold" description="Thresholds are set per material in Settings." />
      </div>

      <div class="card flex flex-col">
        <header class="flex flex-col gap-3 border-b border-stone-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-center gap-2">
            <CalendarClock class="size-4 text-red-500" />
            <h2 class="text-sm font-semibold">Expiry watch</h2>
          </div>
          <SegmentedTabs v-model="expiryTab" :options="expiryTabs" />
        </header>
        <div v-if="visibleExpiry.length" class="overflow-x-auto">
          <table class="table-base">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Location</th>
                <th class="text-right">Quantity</th>
                <th>Expiry</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in visibleExpiry" :key="a.batch.id">
                <td>
                  <p class="font-medium text-stone-900">{{ a.material?.name ?? 'Unknown material' }}</p>
                  <p class="num text-xs text-stone-500">{{ a.batch.batchNo }}</p>
                </td>
                <td class="text-stone-700">{{ a.location?.name ?? '—' }}</td>
                <td class="text-right"><QtyDisplay :quantity="a.batch.quantity" :material="a.material" /></td>
                <td><ExpiryBadge :date="a.batch.expiryDate" /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-else :icon="CircleCheck" title="Nothing expiring in the next 90 days" />
        <footer v-if="inv.expiryAlerts.length > 12" class="border-t border-stone-100 px-5 py-3 text-right">
          <RouterLink to="/inventory?view=batches" class="inline-flex items-center gap-1 text-sm font-medium text-resin-700 hover:text-resin-800">
            View all batches <ArrowRight class="size-3.5" />
          </RouterLink>
        </footer>
      </div>
    </section>

    <!-- Stock by material -->
    <section class="mt-6 grid gap-6" :class="auth.isAdmin ? 'xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : ''">
      <div class="card overflow-hidden">
        <header class="flex items-center justify-between border-b border-stone-100 px-5 py-4">
          <div class="flex items-center gap-2">
            <Warehouse class="size-4 text-stone-500" />
            <h2 class="text-sm font-semibold">Stock by material</h2>
          </div>
          <RouterLink to="/inventory" class="inline-flex items-center gap-1 text-sm font-medium text-resin-700 hover:text-resin-800">
            Inventory <ArrowRight class="size-3.5" />
          </RouterLink>
        </header>
        <div v-if="materialRows.length" class="overflow-x-auto">
          <table class="table-base">
            <thead>
              <tr>
                <th>Material</th>
                <th>Where</th>
                <th class="text-right">Total</th>
                <th v-if="auth.isAdmin" class="text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in materialRows" :key="r.m.id">
                <td>
                  <p class="font-medium text-stone-900">{{ r.m.name }}</p>
                  <p class="num text-xs text-stone-500">{{ r.m.code }}</p>
                </td>
                <td>
                  <div class="flex flex-wrap gap-1.5">
                    <span v-for="x in r.perLoc" :key="x.loc.id" class="inline-flex items-center gap-1 rounded-md bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                      {{ x.loc.name }} <span class="num text-stone-900">{{ formatNumber(x.qty) }}</span>
                    </span>
                    <span v-if="!r.perLoc.length" class="text-xs text-stone-400">No stock</span>
                  </div>
                </td>
                <td class="text-right"><QtyDisplay :quantity="r.total" :material="r.m" breakdown strong /></td>
                <td v-if="auth.isAdmin" class="num text-right whitespace-nowrap text-stone-800">{{ formatMYR(r.value) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-else :icon="PackageCheck" title="No materials yet" description="Materials are added in Settings." />
      </div>

      <div v-if="auth.isAdmin" class="card flex flex-col">
        <header class="border-b border-stone-100 px-5 py-4">
          <h2 class="text-sm font-semibold">Recent stock movements</h2>
        </header>
        <ul v-if="activity.length" class="divide-y divide-stone-100">
          <li v-for="mv in activity" :key="mv.id" class="flex items-center gap-3 px-5 py-3">
            <span :class="['num w-24 shrink-0 text-right text-sm font-medium whitespace-nowrap', mv.quantity >= 0 ? 'text-emerald-700' : 'text-red-600']">
              {{ mv.quantity >= 0 ? '+' : '−' }}{{ formatNumber(Math.abs(mv.quantity)) }}
              <span class="text-xs font-normal text-stone-400">{{ UNIT_LABELS[inv.materialsById.get(mv.materialId)?.baseUnit ?? 'kg'] }}</span>
            </span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm text-stone-800">
                {{ movementLabels[mv.type] }} · {{ inv.materialsById.get(mv.materialId)?.name ?? '—' }}
              </p>
              <p class="truncate text-xs text-stone-500">
                <span class="num">{{ mv.refNumber }}</span> · {{ inv.locationsById.get(mv.locationId)?.name ?? '—' }} · {{ formatDateTime(mv.createdAt) }}
              </p>
            </div>
          </li>
        </ul>
        <EmptyState v-else title="No movements yet" />
      </div>
    </section>
  </div>
</template>
