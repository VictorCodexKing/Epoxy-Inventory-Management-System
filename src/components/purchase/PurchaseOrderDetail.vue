<script setup lang="ts">
import { computed, ref } from 'vue'
import { Ban, PackageCheck, Pencil, Wallet } from 'lucide-vue-next'
import { getBackend } from '@/services/backend'
import { recordPurchasePayment, voidPurchaseOrder, voidPurchasePayment } from '@/services/operations/purchases'
import type { PaymentInput } from '@/services/operations/common'
import { useAuthStore } from '@/stores/auth'
import { useInventoryStore } from '@/stores/inventory'
import { useUiStore } from '@/stores/ui'
import { formatDate, formatDateTime } from '@/lib/dates'
import { formatMYR, formatQty, formatRate, UNIT_LABELS } from '@/lib/format'
import { EPSILON, roundMoney } from '@/lib/numbers'
import { packagingLabel } from '@/lib/packaging'
import type { PaymentEntry, PurchaseOrder } from '@/types/models'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import StatusBadge from '@/components/domain/StatusBadge.vue'
import ExpiryBadge from '@/components/domain/ExpiryBadge.vue'
import PaymentModal from '@/components/shared/PaymentModal.vue'
import PaymentHistory from '@/components/shared/PaymentHistory.vue'

const props = defineProps<{ open: boolean; po: PurchaseOrder | null }>()
const emit = defineEmits<{ close: []; edit: [po: PurchaseOrder]; receive: [po: PurchaseOrder] }>()

const auth = useAuthStore()
const inv = useInventoryStore()
const ui = useUiStore()
const payOpen = ref(false)

const outstanding = computed(() => (props.po ? roundMoney(props.po.totalAmount - props.po.amountPaid) : 0))
const isVoid = computed(() => props.po?.status === 'void')
const canReceive = computed(() => !!props.po && (props.po.status === 'ordered' || props.po.status === 'partially_received'))

async function submitPayment(input: PaymentInput) {
  const po = props.po!
  return ui.run(() => recordPurchasePayment(getBackend().store, auth.actor, po.id, input), 'Payment recorded', `${formatMYR(input.amount)} on ${po.poNumber}`)
}

async function onVoidPayment(p: PaymentEntry) {
  const po = props.po!
  const { confirmed } = await ui.confirm({
    title: 'Void this payment?',
    message: `${formatMYR(p.amount)} paid on ${formatDate(p.date)} will no longer count towards ${po.poNumber}. The entry stays in the history, marked void.`,
    confirmLabel: 'Void payment',
    tone: 'danger',
  })
  if (confirmed) await ui.run(() => voidPurchasePayment(getBackend().store, auth.actor, po.id, p.id), 'Payment voided')
}

async function onVoid() {
  const po = props.po!
  const received = po.receipts.length > 0
  const { confirmed, reason } = await ui.confirm({
    title: `Void ${po.poNumber}?`,
    message:
      (received
        ? 'All stock received on this PO will be removed from inventory with reversing ledger entries. This is only possible while none of it has been sold or transferred. '
        : 'The order will be cancelled. ') +
      (po.amountPaid > EPSILON ? `${formatMYR(po.amountPaid)} recorded as paid stays on record for follow-up with the supplier. ` : '') +
      'This cannot be undone.',
    confirmLabel: 'Void purchase order',
    tone: 'danger',
    requireReason: true,
    reasonLabel: 'Reason for voiding',
  })
  if (confirmed) await ui.run(() => voidPurchaseOrder(getBackend().store, auth.actor, po.id, reason), `${po.poNumber} voided`)
}
</script>

<template>
  <AppModal :open="open && !!po" :title="po?.poNumber ?? ''" :subtitle="po ? `${po.supplier}${po.supplierRef ? ' · ' + po.supplierRef : ''}` : ''" size="xl" @close="emit('close')">
    <template v-if="po">
      <div class="flex flex-wrap items-center gap-2">
        <StatusBadge :status="po.status" kind="po" />
        <StatusBadge v-if="!isVoid" :status="po.paymentStatus" kind="payment" />
        <span class="text-xs text-stone-500">Created {{ formatDateTime(po.createdAt) }} by {{ po.createdBy }}</span>
      </div>

      <div v-if="isVoid" class="mt-4 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
        Voided {{ formatDateTime(po.voidedAt) }} by {{ po.voidedBy }} — “{{ po.voidReason }}”
      </div>

      <dl class="mt-5 grid grid-cols-2 gap-4 rounded-xl border border-stone-200 p-4 text-sm sm:grid-cols-4">
        <div><dt class="eyebrow">Order date</dt><dd class="num mt-1">{{ formatDate(po.orderDate) }}</dd></div>
        <div><dt class="eyebrow">Expected</dt><dd class="num mt-1">{{ formatDate(po.expectedDate) }}</dd></div>
        <div><dt class="eyebrow">Total</dt><dd class="num mt-1 font-semibold">{{ formatMYR(po.totalAmount) }}</dd></div>
        <div>
          <dt class="eyebrow">Paid / outstanding</dt>
          <dd class="num mt-1">{{ formatMYR(po.amountPaid) }} <span class="text-stone-400">/</span> <span :class="outstanding > 0 ? 'text-red-600' : ''">{{ formatMYR(outstanding) }}</span></dd>
        </div>
        <div v-if="po.notes" class="col-span-full"><dt class="eyebrow">Notes</dt><dd class="mt-1 text-stone-700">{{ po.notes }}</dd></div>
      </dl>

      <h3 class="eyebrow mt-6 mb-2">Lines</h3>
      <div class="overflow-x-auto rounded-xl border border-stone-200">
        <table class="table-base">
          <thead>
            <tr>
              <th>Material</th>
              <th class="text-right">Ordered</th>
              <th class="text-right">Received</th>
              <th class="text-right">Unit cost</th>
              <th class="text-right">Line total</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in po.lines" :key="l.id">
              <td>
                <p class="font-medium text-stone-900">{{ inv.materialsById.get(l.materialId)?.name ?? '—' }}</p>
                <p class="num text-xs text-stone-500">{{ l.packageQty }} × {{ packagingLabel(inv.materialsById.get(l.materialId), l.packagingId) }} @ {{ formatMYR(l.packagePrice) }}</p>
              </td>
              <td class="num text-right">{{ formatQty(l.quantity, inv.materialsById.get(l.materialId)?.baseUnit ?? 'kg') }}</td>
              <td class="num text-right" :class="l.receivedQty + EPSILON >= l.quantity ? 'text-emerald-700' : 'text-amber-700'">
                {{ formatQty(l.receivedQty, inv.materialsById.get(l.materialId)?.baseUnit ?? 'kg') }}
              </td>
              <td class="num text-right text-stone-600">{{ formatRate(l.unitCost) }}/{{ UNIT_LABELS[inv.materialsById.get(l.materialId)?.baseUnit ?? 'kg'] }}</td>
              <td class="num text-right font-medium">{{ formatMYR(l.lineTotal) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <h3 class="eyebrow mb-2">Receipts (batches created)</h3>
          <ul v-if="po.receipts.length" class="divide-y divide-stone-100 rounded-xl border border-stone-200">
            <li v-for="r in po.receipts" :key="r.id" class="px-4 py-3">
              <div class="flex items-center justify-between gap-2">
                <p class="text-sm font-medium text-stone-900">{{ inv.materialsById.get(po.lines.find((l) => l.id === r.lineId)?.materialId ?? '')?.name }}</p>
                <p class="num text-sm">{{ formatQty(r.quantity, inv.materialsById.get(po.lines.find((l) => l.id === r.lineId)?.materialId ?? '')?.baseUnit ?? 'kg') }}</p>
              </div>
              <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500">
                <span class="num">{{ r.batchNo }}</span> · <span>{{ inv.locationsById.get(r.locationId)?.name }}</span> ·
                <span class="num">{{ formatDate(r.receivedDate) }}</span>
                <ExpiryBadge :date="r.expiryDate" />
              </div>
            </li>
          </ul>
          <p v-else class="rounded-xl border border-dashed border-stone-200 px-4 py-6 text-center text-sm text-stone-500">Nothing received yet.</p>
        </div>
        <div>
          <h3 class="eyebrow mb-2">Payments</h3>
          <PaymentHistory :payments="po.payments" :can-void="!isVoid" empty-label="No payments recorded." @void="onVoidPayment" />
        </div>
      </div>
    </template>

    <template v-if="po" #footer>
      <AppButton v-if="!isVoid" variant="ghost" class="mr-auto text-red-600 hover:bg-red-50 hover:text-red-700" :icon="Ban" @click="onVoid">Void PO</AppButton>
      <AppButton v-if="!isVoid" variant="secondary" :icon="Pencil" @click="emit('edit', po)">Edit</AppButton>
      <AppButton v-if="!isVoid && outstanding > EPSILON" variant="secondary" :icon="Wallet" @click="payOpen = true">Record payment</AppButton>
      <AppButton v-if="canReceive" variant="primary" :icon="PackageCheck" @click="emit('receive', po)">Receive stock</AppButton>
    </template>
  </AppModal>

  <PaymentModal
    :open="payOpen"
    :title="`Pay ${po?.poNumber ?? ''}`"
    :subtitle="po?.supplier"
    :outstanding="outstanding"
    action-label="Record payment"
    :submit="submitPayment"
    @close="payOpen = false"
  />
</template>
