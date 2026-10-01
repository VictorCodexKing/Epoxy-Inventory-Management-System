<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Ban, Pencil, Wallet } from 'lucide-vue-next'
import { getBackend } from '@/services/backend'
import { recordSaleCollection, updateSaleDetails, voidSale, voidSaleCollection } from '@/services/operations/sales'
import type { PaymentInput } from '@/services/operations/common'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useInventoryStore } from '@/stores/inventory'
import { useUiStore } from '@/stores/ui'
import { formatDate, formatDateTime } from '@/lib/dates'
import { formatMYR, formatPercent, formatQty, formatRate, UNIT_LABELS } from '@/lib/format'
import { EPSILON, roundMoney } from '@/lib/numbers'
import { packagingLabel } from '@/lib/packaging'
import type { PaymentEntry, Sale } from '@/types/models'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import FormField from '@/components/ui/FormField.vue'
import StatusBadge from '@/components/domain/StatusBadge.vue'
import PaymentModal from '@/components/shared/PaymentModal.vue'
import PaymentHistory from '@/components/shared/PaymentHistory.vue'

const props = defineProps<{ open: boolean; sale: Sale | null }>()
const emit = defineEmits<{ close: [] }>()

const auth = useAuthStore()
const data = useDataStore()
const inv = useInventoryStore()
const ui = useUiStore()

const payOpen = ref(false)
const editOpen = ref(false)
const savingEdit = ref(false)
const edit = reactive({ customer: '', customerRef: '', notes: '' })

const outstanding = computed(() => (props.sale ? roundMoney(props.sale.totalAmount - props.sale.amountCollected) : 0))
const isVoid = computed(() => props.sale?.status === 'void')
const batchNo = (id: string) => data.batches.find((b) => b.id === id)?.batchNo ?? '—'

function openEdit() {
  const s = props.sale!
  Object.assign(edit, { customer: s.customer, customerRef: s.customerRef, notes: s.notes })
  editOpen.value = true
}

async function saveEdit() {
  const s = props.sale!
  savingEdit.value = true
  const ok = await ui.run(() => updateSaleDetails(getBackend().store, auth.actor, s.id, { ...edit }), 'Sale updated')
  savingEdit.value = false
  if (ok) editOpen.value = false
}

async function submitCollection(input: PaymentInput) {
  const s = props.sale!
  return ui.run(() => recordSaleCollection(getBackend().store, auth.actor, s.id, input), 'Collection recorded', `${formatMYR(input.amount)} on ${s.saleNumber}`)
}

async function onVoidPayment(p: PaymentEntry) {
  const s = props.sale!
  const { confirmed } = await ui.confirm({
    title: 'Void this collection?',
    message: `${formatMYR(p.amount)} collected on ${formatDate(p.date)} will no longer count towards ${s.saleNumber}. The entry stays in the history, marked void.`,
    confirmLabel: 'Void collection',
    tone: 'danger',
  })
  if (confirmed) await ui.run(() => voidSaleCollection(getBackend().store, auth.actor, s.id, p.id), 'Collection voided')
}

async function onVoid() {
  const s = props.sale!
  const { confirmed, reason } = await ui.confirm({
    title: `Void ${s.saleNumber}?`,
    message:
      'All dispatched quantities will be returned to their original batches and locations, with reversing ledger entries. ' +
      (s.amountCollected > EPSILON ? `${formatMYR(s.amountCollected)} recorded as collected stays on record for refund follow-up. ` : '') +
      'This cannot be undone.',
    confirmLabel: 'Void sale',
    tone: 'danger',
    requireReason: true,
    reasonLabel: 'Reason for voiding',
  })
  if (confirmed) await ui.run(() => voidSale(getBackend().store, auth.actor, s.id, reason), `${s.saleNumber} voided`, 'Stock returned to inventory.')
}
</script>

<template>
  <AppModal :open="open && !!sale" :title="sale?.saleNumber ?? ''" :subtitle="sale ? `${sale.customer}${sale.customerRef ? ' · ' + sale.customerRef : ''}` : ''" size="xl" @close="emit('close')">
    <template v-if="sale">
      <div class="flex flex-wrap items-center gap-2">
        <StatusBadge :status="sale.status" kind="record" />
        <StatusBadge v-if="!isVoid" :status="sale.paymentStatus" kind="payment" />
        <span class="text-xs text-stone-500">Recorded {{ formatDateTime(sale.createdAt) }} by {{ sale.createdBy }}</span>
      </div>
      <div v-if="isVoid" class="mt-4 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
        Voided {{ formatDateTime(sale.voidedAt) }} by {{ sale.voidedBy }} — “{{ sale.voidReason }}”
      </div>

      <dl class="mt-5 grid grid-cols-2 gap-4 rounded-xl border border-stone-200 p-4 text-sm sm:grid-cols-5">
        <div><dt class="eyebrow">Sale date</dt><dd class="num mt-1">{{ formatDate(sale.saleDate) }}</dd></div>
        <div><dt class="eyebrow">Revenue</dt><dd class="num mt-1 font-semibold">{{ formatMYR(sale.totalAmount) }}</dd></div>
        <div><dt class="eyebrow">Batch cost</dt><dd class="num mt-1">{{ formatMYR(sale.totalCost) }}</dd></div>
        <div>
          <dt class="eyebrow">Gross margin</dt>
          <dd class="num mt-1 font-medium" :class="sale.grossMargin < 0 ? 'text-red-600' : 'text-emerald-700'">
            {{ formatMYR(sale.grossMargin) }}<span v-if="sale.totalAmount > 0" class="text-xs text-stone-500"> · {{ formatPercent(sale.grossMargin / sale.totalAmount) }}</span>
          </dd>
        </div>
        <div>
          <dt class="eyebrow">Collected / due</dt>
          <dd class="num mt-1">{{ formatMYR(sale.amountCollected) }} <span class="text-stone-400">/</span> <span :class="outstanding > 0 ? 'text-red-600' : ''">{{ formatMYR(outstanding) }}</span></dd>
        </div>
        <div v-if="sale.notes" class="col-span-full"><dt class="eyebrow">Notes</dt><dd class="mt-1 text-stone-700">{{ sale.notes }}</dd></div>
      </dl>

      <h3 class="eyebrow mt-6 mb-2">Lines & batches dispatched</h3>
      <div class="space-y-3">
        <div v-for="l in sale.lines" :key="l.id" class="overflow-hidden rounded-xl border border-stone-200">
          <div class="flex flex-wrap items-baseline justify-between gap-2 bg-stone-50 px-4 py-3">
            <div>
              <p class="font-medium text-stone-900">{{ inv.materialsById.get(l.materialId)?.name ?? '—' }}</p>
              <p class="num text-xs text-stone-500">
                {{ l.packageQty }} × {{ packagingLabel(inv.materialsById.get(l.materialId), l.packagingId) }} @ {{ formatMYR(l.packagePrice) }} =
                {{ formatQty(l.quantity, inv.materialsById.get(l.materialId)?.baseUnit ?? 'kg') }}
              </p>
            </div>
            <p class="num text-sm">
              {{ formatMYR(l.lineRevenue) }}
              <span class="text-xs text-stone-500">· cost {{ formatMYR(l.lineCost) }} · margin</span>
              <span :class="l.lineRevenue - l.lineCost < 0 ? 'text-red-600' : 'text-emerald-700'"> {{ formatMYR(l.lineRevenue - l.lineCost) }}</span>
            </p>
          </div>
          <table class="table-base text-[13px]">
            <thead>
              <tr><th>Batch</th><th>From</th><th class="text-right">Quantity</th><th class="text-right">Batch cost</th></tr>
            </thead>
            <tbody>
              <tr v-for="a in l.allocations" :key="a.batchId">
                <td class="num">{{ batchNo(a.batchId) }}</td>
                <td>{{ inv.locationsById.get(a.locationId)?.name ?? '—' }}</td>
                <td class="num text-right">{{ formatQty(a.quantity, inv.materialsById.get(l.materialId)?.baseUnit ?? 'kg') }}</td>
                <td class="num text-right text-stone-600">{{ formatRate(a.unitCost) }}/{{ UNIT_LABELS[inv.materialsById.get(l.materialId)?.baseUnit ?? 'kg'] }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <h3 class="eyebrow mt-6 mb-2">Collections</h3>
      <PaymentHistory :payments="sale.payments" :can-void="!isVoid" empty-label="Nothing collected yet." @void="onVoidPayment" />
    </template>

    <template v-if="sale" #footer>
      <AppButton v-if="!isVoid" variant="ghost" class="mr-auto text-red-600 hover:bg-red-50 hover:text-red-700" :icon="Ban" @click="onVoid">Void sale</AppButton>
      <AppButton v-if="!isVoid" variant="secondary" :icon="Pencil" @click="openEdit">Edit details</AppButton>
      <AppButton v-if="!isVoid && outstanding > EPSILON" variant="primary" :icon="Wallet" @click="payOpen = true">Record collection</AppButton>
    </template>
  </AppModal>

  <PaymentModal
    :open="payOpen"
    :title="`Collect for ${sale?.saleNumber ?? ''}`"
    :subtitle="sale?.customer"
    :outstanding="outstanding"
    action-label="Record collection"
    :submit="submitCollection"
    @close="payOpen = false"
  />

  <AppModal :open="editOpen" :title="`Edit ${sale?.saleNumber ?? ''}`" subtitle="To change quantities or prices, void the sale and record it again." size="sm" :persistent="savingEdit" @close="editOpen = false">
    <div class="space-y-4">
      <FormField label="Customer" for="se-cust">
        <input id="se-cust" v-model="edit.customer" type="text" maxlength="200" class="input" />
      </FormField>
      <FormField label="Customer PO / DO no." for="se-ref" optional>
        <input id="se-ref" v-model="edit.customerRef" type="text" maxlength="100" class="input" />
      </FormField>
      <FormField label="Notes" for="se-notes" optional>
        <textarea id="se-notes" v-model="edit.notes" rows="3" maxlength="1000" class="input resize-none" />
      </FormField>
    </div>
    <template #footer>
      <AppButton variant="ghost" :disabled="savingEdit" @click="editOpen = false">Cancel</AppButton>
      <AppButton variant="dark" :loading="savingEdit" :disabled="!edit.customer.trim()" @click="saveEdit">Save</AppButton>
    </template>
  </AppModal>
</template>
