<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus, Search, ShoppingCart } from 'lucide-vue-next'
import { useDataStore } from '@/stores/data'
import { useInventoryStore } from '@/stores/inventory'
import { formatDate } from '@/lib/dates'
import { formatMYR, formatPercent } from '@/lib/format'
import { roundMoney } from '@/lib/numbers'
import type { PaymentStatus, Sale } from '@/types/models'
import AppButton from '@/components/ui/AppButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatusBadge from '@/components/domain/StatusBadge.vue'
import SaleDetail from '@/components/sales/SaleDetail.vue'
import SaleForm from '@/components/sales/SaleForm.vue'

const data = useDataStore()
const inv = useInventoryStore()

const search = ref('')
const status = ref<'completed' | 'void' | ''>('')
const payment = ref<PaymentStatus | ''>('')

const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return [...data.sales]
    .filter((s) => !status.value || s.status === status.value)
    .filter((s) => !payment.value || (s.status !== 'void' && s.paymentStatus === payment.value))
    .filter((s) => {
      if (!q) return true
      const mats = s.lines.map((l) => inv.materialsById.get(l.materialId)?.name ?? '').join(' ')
      return `${s.saleNumber} ${s.customer} ${s.customerRef} ${mats}`.toLowerCase().includes(q)
    })
    .sort((a, b) => (a.saleDate === b.saleDate ? b.saleNumber.localeCompare(a.saleNumber) : b.saleDate.localeCompare(a.saleDate)))
})

const live = computed(() => data.sales.filter((s) => s.status !== 'void'))
const stats = computed(() => {
  const revenue = roundMoney(live.value.reduce((a, s) => a + s.totalAmount, 0))
  const margin = roundMoney(live.value.reduce((a, s) => a + s.grossMargin, 0))
  return {
    revenue,
    margin,
    receivable: roundMoney(live.value.reduce((a, s) => a + s.totalAmount - s.amountCollected, 0)),
    collected: roundMoney(live.value.reduce((a, s) => a + s.amountCollected, 0)),
  }
})

const selectedId = ref<string | null>(null)
const selected = computed(() => data.sales.find((s) => s.id === selectedId.value) ?? null)
const formOpen = ref(false)

function itemsSummary(s: Sale) {
  const names = s.lines.map((l) => inv.materialsById.get(l.materialId)?.name ?? '—')
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ')
}
</script>

<template>
  <div>
    <PageHeader title="Sales" description="Outbound ledger. Recording a sale deducts the allocated batches and captures their actual cost.">
      <template #actions>
        <AppButton variant="dark" :icon="Plus" @click="formOpen = true">New sale</AppButton>
      </template>
    </PageHeader>

    <section class="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div class="card p-5">
        <p class="eyebrow">Revenue</p>
        <p class="num mt-2 text-2xl font-semibold">{{ formatMYR(stats.revenue) }}</p>
      </div>
      <div class="card p-5">
        <p class="eyebrow">Gross margin</p>
        <p class="num mt-2 text-2xl font-semibold" :class="stats.margin < 0 ? 'text-red-600' : ''">{{ formatMYR(stats.margin) }}</p>
        <p v-if="stats.revenue > 0" class="mt-1 text-xs text-stone-500">{{ formatPercent(stats.margin / stats.revenue) }} of revenue</p>
      </div>
      <div class="card p-5">
        <p class="eyebrow">Collected</p>
        <p class="num mt-2 text-2xl font-semibold text-emerald-700">{{ formatMYR(stats.collected) }}</p>
      </div>
      <div class="card p-5">
        <p class="eyebrow">Receivable</p>
        <p class="num mt-2 text-2xl font-semibold" :class="stats.receivable > 0 ? 'text-red-600' : ''">{{ formatMYR(stats.receivable) }}</p>
      </div>
    </section>

    <div class="card overflow-hidden">
      <div class="flex flex-col gap-2 border-b border-stone-100 p-3 sm:flex-row sm:items-center">
        <div class="relative flex-1">
          <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
          <input v-model="search" type="search" class="input pl-9" placeholder="Search sale no., customer, material" aria-label="Search sales" />
        </div>
        <select v-model="status" class="input sm:w-40" aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="void">Void</option>
        </select>
        <select v-model="payment" class="input sm:w-40" aria-label="Filter by collection">
          <option value="">Any payment</option>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
        </select>
      </div>

      <div v-if="rows.length" class="overflow-x-auto">
        <table class="table-base">
          <thead>
            <tr>
              <th>Sale</th>
              <th>Customer</th>
              <th>Items</th>
              <th>Payment</th>
              <th class="text-right">Revenue</th>
              <th class="text-right">Margin</th>
              <th class="text-right">Due</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="s in rows"
              :key="s.id"
              class="row-link"
              :class="s.status === 'void' ? 'text-stone-400' : ''"
              tabindex="0"
              @click="selectedId = s.id"
              @keydown.enter="selectedId = s.id"
            >
              <td>
                <p class="num font-medium" :class="s.status === 'void' ? 'line-through' : 'text-stone-900'">{{ s.saleNumber }}</p>
                <p class="num text-xs text-stone-500">{{ formatDate(s.saleDate) }}</p>
              </td>
              <td>
                <p class="max-w-56 truncate" :class="s.status === 'void' ? '' : 'text-stone-800'">{{ s.customer }}</p>
                <p v-if="s.customerRef" class="num text-xs text-stone-500">{{ s.customerRef }}</p>
              </td>
              <td class="max-w-64 truncate text-stone-600">{{ itemsSummary(s) }}</td>
              <td><StatusBadge v-if="s.status !== 'void'" :status="s.paymentStatus" kind="payment" /><StatusBadge v-else status="void" kind="record" /></td>
              <td class="num text-right font-medium">{{ formatMYR(s.totalAmount) }}</td>
              <td class="num text-right" :class="s.status === 'void' ? '' : s.grossMargin < 0 ? 'text-red-600' : 'text-emerald-700'">{{ formatMYR(s.grossMargin) }}</td>
              <td class="num text-right" :class="s.status !== 'void' && s.totalAmount - s.amountCollected > 0.004 ? 'text-red-600' : 'text-stone-400'">
                {{ s.status === 'void' ? '—' : formatMYR(s.totalAmount - s.amountCollected) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <EmptyState
        v-else
        :icon="ShoppingCart"
        :title="data.sales.length ? 'No sales match' : 'No sales yet'"
        :description="data.sales.length ? 'Try clearing the filters.' : 'Record a dispatch to deduct stock and track revenue.'"
      >
        <AppButton v-if="!data.sales.length" variant="dark" :icon="Plus" @click="formOpen = true">New sale</AppButton>
      </EmptyState>
    </div>

    <SaleDetail :open="!!selected" :sale="selected" @close="selectedId = null" />
    <SaleForm :open="formOpen" @close="formOpen = false" @saved="(id) => (selectedId = id)" />
  </div>
</template>
