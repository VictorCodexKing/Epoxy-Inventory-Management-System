<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus, Search, Truck } from 'lucide-vue-next'
import { useDataStore } from '@/stores/data'
import { useInventoryStore } from '@/stores/inventory'
import { formatDate } from '@/lib/dates'
import { formatMYR } from '@/lib/format'
import { roundMoney } from '@/lib/numbers'
import type { PaymentStatus, POStatus, PurchaseOrder } from '@/types/models'
import AppButton from '@/components/ui/AppButton.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatusBadge from '@/components/domain/StatusBadge.vue'
import PurchaseOrderDetail from '@/components/purchase/PurchaseOrderDetail.vue'
import PurchaseOrderForm from '@/components/purchase/PurchaseOrderForm.vue'
import ReceiveModal from '@/components/purchase/ReceiveModal.vue'

const data = useDataStore()
const inv = useInventoryStore()

const search = ref('')
const status = ref<POStatus | 'open' | ''>('')
const payment = ref<PaymentStatus | ''>('')

const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return [...data.purchaseOrders]
    .filter((p) => !status.value || (status.value === 'open' ? p.status === 'ordered' || p.status === 'partially_received' : p.status === status.value))
    .filter((p) => !payment.value || (p.status !== 'void' && p.paymentStatus === payment.value))
    .filter((p) => {
      if (!q) return true
      const mats = p.lines.map((l) => inv.materialsById.get(l.materialId)?.name ?? '').join(' ')
      return `${p.poNumber} ${p.supplier} ${p.supplierRef} ${mats}`.toLowerCase().includes(q)
    })
    .sort((a, b) => (a.orderDate === b.orderDate ? b.poNumber.localeCompare(a.poNumber) : b.orderDate.localeCompare(a.orderDate)))
})

const live = computed(() => data.purchaseOrders.filter((p) => p.status !== 'void'))
const stats = computed(() => ({
  open: live.value.filter((p) => p.status !== 'received').length,
  total: roundMoney(live.value.reduce((a, p) => a + p.totalAmount, 0)),
  payable: roundMoney(live.value.reduce((a, p) => a + p.totalAmount - p.amountPaid, 0)),
}))

// Modals — always look the PO up by id so open dialogs reflect realtime updates.
const selectedId = ref<string | null>(null)
const selected = computed(() => data.purchaseOrders.find((p) => p.id === selectedId.value) ?? null)
const formOpen = ref(false)
const editingId = ref<string | null>(null)
const editing = computed(() => data.purchaseOrders.find((p) => p.id === editingId.value) ?? null)
const receiveId = ref<string | null>(null)
const receiving = computed(() => data.purchaseOrders.find((p) => p.id === receiveId.value) ?? null)

function openNew() {
  editingId.value = null
  formOpen.value = true
}
function openEdit(po: PurchaseOrder) {
  editingId.value = po.id
  formOpen.value = true
}
function onSaved(id: string) {
  if (!editingId.value) selectedId.value = id
}

function itemsSummary(p: PurchaseOrder) {
  const names = p.lines.map((l) => inv.materialsById.get(l.materialId)?.name ?? '—')
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ')
}
</script>

<template>
  <div>
    <PageHeader title="Purchase Orders" description="Inbound ledger. Stock is added to inventory only when a PO is received.">
      <template #actions>
        <AppButton variant="dark" :icon="Plus" @click="openNew">New purchase order</AppButton>
      </template>
    </PageHeader>

    <section class="mb-6 grid gap-4 sm:grid-cols-3">
      <div class="card p-5">
        <p class="eyebrow">Awaiting stock</p>
        <p class="num mt-2 text-2xl font-semibold">{{ stats.open }}</p>
      </div>
      <div class="card p-5">
        <p class="eyebrow">Total purchases</p>
        <p class="num mt-2 text-2xl font-semibold">{{ formatMYR(stats.total) }}</p>
      </div>
      <div class="card p-5">
        <p class="eyebrow">Outstanding to suppliers</p>
        <p class="num mt-2 text-2xl font-semibold" :class="stats.payable > 0 ? 'text-red-600' : ''">{{ formatMYR(stats.payable) }}</p>
      </div>
    </section>

    <div class="card overflow-hidden">
      <div class="flex flex-col gap-2 border-b border-stone-100 p-3 sm:flex-row sm:items-center">
        <div class="relative flex-1">
          <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
          <input v-model="search" type="search" class="input pl-9" placeholder="Search PO no., supplier, material" aria-label="Search purchase orders" />
        </div>
        <select v-model="status" class="input sm:w-48" aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="open">Awaiting stock</option>
          <option value="ordered">Ordered</option>
          <option value="partially_received">Part received</option>
          <option value="received">Received</option>
          <option value="void">Void</option>
        </select>
        <select v-model="payment" class="input sm:w-40" aria-label="Filter by payment">
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
              <th>PO</th>
              <th>Supplier</th>
              <th>Items</th>
              <th>Status</th>
              <th>Payment</th>
              <th class="text-right">Total</th>
              <th class="text-right">Outstanding</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in rows"
              :key="p.id"
              class="row-link"
              :class="p.status === 'void' ? 'text-stone-400' : ''"
              tabindex="0"
              @click="selectedId = p.id"
              @keydown.enter="selectedId = p.id"
            >
              <td>
                <p class="num font-medium" :class="p.status === 'void' ? 'line-through' : 'text-stone-900'">{{ p.poNumber }}</p>
                <p class="num text-xs text-stone-500">{{ formatDate(p.orderDate) }}</p>
              </td>
              <td>
                <p class="max-w-56 truncate" :class="p.status === 'void' ? '' : 'text-stone-800'">{{ p.supplier }}</p>
                <p v-if="p.supplierRef" class="num text-xs text-stone-500">{{ p.supplierRef }}</p>
              </td>
              <td class="max-w-64 truncate text-stone-600">{{ itemsSummary(p) }}</td>
              <td><StatusBadge :status="p.status" kind="po" /></td>
              <td><StatusBadge v-if="p.status !== 'void'" :status="p.paymentStatus" kind="payment" /></td>
              <td class="num text-right font-medium">{{ formatMYR(p.totalAmount) }}</td>
              <td class="num text-right" :class="p.status !== 'void' && p.totalAmount - p.amountPaid > 0.004 ? 'text-red-600' : 'text-stone-400'">
                {{ p.status === 'void' ? '—' : formatMYR(p.totalAmount - p.amountPaid) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <EmptyState
        v-else
        :icon="Truck"
        :title="data.purchaseOrders.length ? 'No purchase orders match' : 'No purchase orders yet'"
        :description="data.purchaseOrders.length ? 'Try clearing the filters.' : 'Create one to start receiving stock.'"
      >
        <AppButton v-if="!data.purchaseOrders.length" variant="dark" :icon="Plus" @click="openNew">New purchase order</AppButton>
      </EmptyState>
    </div>

    <!-- Order matters: later modals stack on top of earlier ones. -->
    <PurchaseOrderDetail :open="!!selected" :po="selected" @close="selectedId = null" @edit="openEdit" @receive="(po) => (receiveId = po.id)" />
    <PurchaseOrderForm :open="formOpen" :po="editing" @close="formOpen = false" @saved="onSaved" />
    <ReceiveModal :open="!!receiving" :po="receiving" @close="receiveId = null" />
  </div>
</template>
