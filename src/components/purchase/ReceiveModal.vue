<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getBackend } from '@/services/backend'
import { receivePurchaseOrder } from '@/services/operations/purchases'
import { useAuthStore } from '@/stores/auth'
import { useInventoryStore } from '@/stores/inventory'
import { useUiStore } from '@/stores/ui'
import { todayMY } from '@/lib/dates'
import { formatQty } from '@/lib/format'
import { EPSILON, roundQty } from '@/lib/numbers'
import { packagingBreakdown } from '@/lib/packaging'
import type { PurchaseOrder } from '@/types/models'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import FormField from '@/components/ui/FormField.vue'
import DateInput from '@/components/ui/DateInput.vue'
import NumberInput from '@/components/ui/NumberInput.vue'

const props = defineProps<{ open: boolean; po: PurchaseOrder | null }>()
const emit = defineEmits<{ close: [] }>()

const auth = useAuthStore()
const inv = useInventoryStore()
const ui = useUiStore()

interface Row {
  lineId: string
  include: boolean
  quantity: number | null
  locationId: string
  batchNo: string
  expiryDate: string
  expiryValid: boolean
}

const receivedDate = ref(todayMY())
const rows = ref<Row[]>([])
const saving = ref(false)
const submitted = ref(false)
const defaultLocation = ref('')

const outstanding = computed(() =>
  (props.po?.lines ?? [])
    .map((l) => ({ line: l, remaining: roundQty(l.quantity - l.receivedQty), material: inv.materialsById.get(l.materialId) }))
    .filter((x) => x.remaining > EPSILON),
)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    submitted.value = false
    receivedDate.value = todayMY()
    defaultLocation.value = inv.activeLocations[0]?.id ?? ''
    rows.value = outstanding.value.map((x) => ({
      lineId: x.line.id,
      include: true,
      quantity: x.remaining,
      locationId: defaultLocation.value,
      batchNo: '',
      expiryDate: '',
      expiryValid: true,
    }))
  },
)

function applyLocationToAll() {
  for (const r of rows.value) r.locationId = defaultLocation.value
}

const rowsView = computed(() =>
  rows.value.flatMap((r) => {
    // A line can stop being outstanding while the dialog is open (just received, or received in another tab).
    const o = outstanding.value.find((x) => x.line.id === r.lineId)
    if (!o) return []
    let qtyError: string | null = null
    if (r.include) {
      if (r.quantity === null || r.quantity <= EPSILON) qtyError = 'Enter a quantity'
      else if (r.quantity > o.remaining + EPSILON) qtyError = `Max ${o.material ? formatQty(o.remaining, o.material.baseUnit) : o.remaining}`
    }
    const locError = r.include && !r.locationId ? 'Choose a location' : null
    const expiryWarn = r.include && r.expiryDate && r.expiryDate < receivedDate.value ? 'This expiry date is before the received date.' : null
    return [{ r, o, qtyError, locError, expiryWarn }]
  }),
)

const errors = computed(() => {
  const e: string[] = []
  if (!receivedDate.value) e.push('Choose the received date.')
  if (!rowsView.value.some((v) => v.r.include)) e.push('Select at least one line to receive.')
  if (rowsView.value.some((v) => v.qtyError || v.locError)) e.push('Fix the highlighted fields.')
  if (rowsView.value.some((v) => v.r.include && !v.r.expiryValid)) e.push('An expiry date is not a valid DD/MM/YYYY date — correct it or clear it.')
  return e
})

async function save() {
  submitted.value = true
  if (errors.value.length || !props.po) return
  saving.value = true
  const po = props.po
  const ok = await ui.run(
    () =>
      receivePurchaseOrder(
        getBackend().store,
        auth.actor,
        po.id,
        rowsView.value
          .map((v) => v.r)
          .filter((r) => r.include)
          .map((r) => ({
            lineId: r.lineId,
            quantity: roundQty(r.quantity!),
            locationId: r.locationId,
            batchNo: r.batchNo,
            expiryDate: r.expiryDate || null,
            receivedDate: receivedDate.value,
          })),
      ),
    'Stock received',
    `${po.poNumber} — inventory updated`,
  )
  saving.value = false
  if (ok) emit('close')
}
</script>

<template>
  <AppModal
    :open="open"
    :title="`Receive ${po?.poNumber ?? ''}`"
    subtitle="Each received line becomes a new batch with its own cost and expiry date."
    size="xl"
    :persistent="saving"
    @close="emit('close')"
  >
    <div class="grid gap-4 sm:grid-cols-[200px_1fr]">
      <FormField label="Received date" for="rcv-date">
        <DateInput id="rcv-date" v-model="receivedDate" :max="todayMY()" />
      </FormField>
      <FormField label="Default location" for="rcv-loc" hint="Applied to every line; you can still change each one below.">
        <div class="flex gap-2">
          <select id="rcv-loc" v-model="defaultLocation" class="input">
            <option v-for="l in inv.activeLocations" :key="l.id" :value="l.id">{{ l.name }} · {{ l.type === 'vendor' ? 'Vendor' : 'Internal' }}</option>
          </select>
          <AppButton variant="secondary" @click="applyLocationToAll">Apply</AppButton>
        </div>
      </FormField>
    </div>

    <div class="mt-5 space-y-3">
      <div
        v-for="v in rowsView"
        :key="v.r.lineId"
        :class="['rounded-xl border p-4 transition', v.r.include ? 'border-stone-200 bg-white' : 'border-dashed border-stone-200 bg-stone-50 opacity-60']"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <label class="inline-flex items-center gap-2.5">
            <input v-model="v.r.include" type="checkbox" class="size-4 rounded border-stone-300 accent-stone-900" />
            <span class="font-medium text-stone-900">{{ v.o.material?.name ?? 'Unknown material' }}</span>
          </label>
          <p class="text-xs text-stone-500">
            Outstanding <span class="num font-medium text-stone-800">{{ v.o.material ? formatQty(v.o.remaining, v.o.material.baseUnit) : v.o.remaining }}</span>
            <template v-if="v.o.material && packagingBreakdown(v.o.material, v.o.remaining)"> ({{ packagingBreakdown(v.o.material, v.o.remaining) }})</template>
          </p>
        </div>
        <div v-if="v.r.include" class="mt-3 grid gap-3 md:grid-cols-4">
          <FormField :label="`Quantity (${v.o.material?.baseUnit ?? ''})`" :for="`rcv-q-${v.r.lineId}`" :error="submitted ? v.qtyError : null">
            <NumberInput :id="`rcv-q-${v.r.lineId}`" v-model="v.r.quantity" :suffix="v.o.material?.baseUnit" :invalid="submitted && !!v.qtyError" />
          </FormField>
          <FormField label="Location" :for="`rcv-l-${v.r.lineId}`" :error="submitted ? v.locError : null">
            <select :id="`rcv-l-${v.r.lineId}`" v-model="v.r.locationId" class="input">
              <option value="" disabled>Select</option>
              <option v-for="l in inv.activeLocations" :key="l.id" :value="l.id">{{ l.name }}</option>
            </select>
          </FormField>
          <FormField label="Batch / lot no." :for="`rcv-b-${v.r.lineId}`" optional hint="Blank = auto from PO no.">
            <input :id="`rcv-b-${v.r.lineId}`" v-model="v.r.batchNo" type="text" maxlength="60" class="input num" />
          </FormField>
          <FormField label="Expiry date" :for="`rcv-e-${v.r.lineId}`" optional :hint="v.expiryWarn ?? 'Leave blank if it does not expire'">
            <DateInput :id="`rcv-e-${v.r.lineId}`" v-model="v.r.expiryDate" v-model:valid="v.r.expiryValid" />
          </FormField>
        </div>
      </div>
    </div>

    <ul v-if="submitted && errors.length" class="mt-4 space-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <li v-for="e in errors" :key="e">{{ e }}</li>
    </ul>

    <template #footer>
      <AppButton variant="ghost" :disabled="saving" @click="emit('close')">Cancel</AppButton>
      <AppButton variant="primary" :loading="saving" @click="save">Receive into stock</AppButton>
    </template>
  </AppModal>
</template>
