<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Plus, Trash2 } from 'lucide-vue-next'
import { getBackend } from '@/services/backend'
import { createPurchaseOrder, updatePurchaseOrder, type POLineInput } from '@/services/operations/purchases'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useInventoryStore } from '@/stores/inventory'
import { useUiStore } from '@/stores/ui'
import { todayMY } from '@/lib/dates'
import { formatMYR, formatQty, formatRate, UNIT_LABELS } from '@/lib/format'
import { roundMoney, roundQty, EPSILON } from '@/lib/numbers'
import { packageSize, packagingOptions, packagingLabel } from '@/lib/packaging'
import type { PurchaseOrder } from '@/types/models'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import FormField from '@/components/ui/FormField.vue'
import DateInput from '@/components/ui/DateInput.vue'
import NumberInput from '@/components/ui/NumberInput.vue'

const props = defineProps<{ open: boolean; po?: PurchaseOrder | null }>()
const emit = defineEmits<{ close: []; saved: [id: string] }>()

const auth = useAuthStore()
const data = useDataStore()
const inv = useInventoryStore()
const ui = useUiStore()

interface LineDraft {
  key: number
  id?: string
  materialId: string
  packagingId: string | null
  packageQty: number | null
  packagePrice: number | null
}

let seq = 0
const blankLine = (): LineDraft => ({ key: ++seq, materialId: '', packagingId: null, packageQty: null, packagePrice: null })

const form = reactive({ supplier: '', supplierRef: '', orderDate: todayMY(), expectedDate: '', notes: '' })
const lines = ref<LineDraft[]>([blankLine()])
const saving = ref(false)
const submitted = ref(false)
const expectedValid = ref(true)

const isEdit = computed(() => !!props.po)
const linesLocked = computed(() => !!props.po && props.po.receipts.length > 0)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    submitted.value = false
    expectedValid.value = true
    const po = props.po
    if (po) {
      Object.assign(form, { supplier: po.supplier, supplierRef: po.supplierRef, orderDate: po.orderDate, expectedDate: po.expectedDate ?? '', notes: po.notes })
      lines.value = po.lines.map((l) => ({ key: ++seq, id: l.id, materialId: l.materialId, packagingId: l.packagingId, packageQty: l.packageQty, packagePrice: l.packagePrice }))
    } else {
      Object.assign(form, { supplier: '', supplierRef: '', orderDate: todayMY(), expectedDate: '', notes: '' })
      lines.value = [blankLine()]
    }
  },
)

const suppliers = computed(() => [...new Set(data.purchaseOrders.map((p) => p.supplier))].sort())

/** Active materials, plus any inactive one already on this PO (so editing never silently drops it). */
const materialChoices = computed(() => {
  const onPo = new Set(props.po?.lines.map((l) => l.materialId) ?? [])
  return inv.sortedMaterials.filter((m) => m.active || onPo.has(m.id))
})

function onMaterialChange(line: LineDraft) {
  const m = inv.materialsById.get(line.materialId)
  // Default to the largest package — that's how chemicals are normally bought.
  line.packagingId = m ? (packagingOptions(m)[0]?.id ?? null) : null
}

function calc(line: LineDraft) {
  const m = inv.materialsById.get(line.materialId)
  const size = m ? packageSize(m.packaging, line.packagingId) : null
  const baseQty = size !== null && line.packageQty !== null ? roundQty(line.packageQty * size) : null
  const total = line.packageQty !== null && line.packagePrice !== null ? roundMoney(line.packageQty * line.packagePrice) : null
  const unitCost = size && line.packagePrice !== null ? line.packagePrice / size : null
  return { m, size, baseQty, total, unitCost }
}

function lineErrors(line: LineDraft) {
  return {
    material: !line.materialId ? 'Select a material' : null,
    qty: line.packageQty === null || line.packageQty <= EPSILON ? 'Enter a quantity' : null,
    price: line.packagePrice === null || line.packagePrice < 0 ? 'Enter a price' : null,
  }
}

const grandTotal = computed(() => roundMoney(lines.value.reduce((a, l) => a + (calc(l).total ?? 0), 0)))

const formErrors = computed(() => {
  const e: string[] = []
  if (!form.supplier.trim()) e.push('Enter the supplier.')
  if (!form.orderDate) e.push('Choose the order date.')
  if (form.expectedDate && form.expectedDate < form.orderDate) e.push('Expected date cannot be before the order date.')
  if (!expectedValid.value) e.push('Expected delivery is not a valid date — correct it or clear it.')
  if (!linesLocked.value) {
    if (lines.value.length === 0) e.push('Add at least one line.')
    if (lines.value.some((l) => Object.values(lineErrors(l)).some(Boolean))) e.push('Complete every line item.')
    if (props.po && grandTotal.value + EPSILON < props.po.amountPaid) e.push(`Total cannot be lower than the ${formatMYR(props.po.amountPaid)} already paid.`)
  }
  return e
})

async function save() {
  submitted.value = true
  if (formErrors.value.length) return
  saving.value = true
  const input = {
    supplier: form.supplier,
    supplierRef: form.supplierRef,
    orderDate: form.orderDate,
    expectedDate: form.expectedDate || null,
    notes: form.notes,
    lines: lines.value.map<POLineInput>((l) => ({
      id: l.id,
      materialId: l.materialId,
      packagingId: l.packagingId,
      packageQty: l.packageQty!,
      packagePrice: l.packagePrice!,
    })),
  }
  const store = getBackend().store
  let id = props.po?.id ?? ''
  const ok = await ui.run(
    async () => {
      if (props.po) await updatePurchaseOrder(store, auth.actor, props.po.id, input)
      else id = await createPurchaseOrder(store, auth.actor, input)
    },
    props.po ? 'Purchase order updated' : 'Purchase order created',
  )
  saving.value = false
  if (ok) {
    emit('saved', id)
    emit('close')
  }
}
</script>

<template>
  <AppModal
    :open="open"
    :title="isEdit ? `Edit ${po?.poNumber}` : 'New purchase order'"
    :subtitle="linesLocked ? 'Stock has been received against this PO, so only the header can be changed.' : 'Stock is added to inventory only when the PO is marked received.'"
    size="xl"
    :persistent="saving"
    @close="emit('close')"
  >
    <div class="grid gap-4 md:grid-cols-4">
      <FormField label="Supplier" for="po-supplier" class="md:col-span-2" :error="submitted && !form.supplier.trim() ? 'Enter the supplier' : null">
        <input id="po-supplier" v-model="form.supplier" type="text" list="po-suppliers" maxlength="200" class="input" :aria-invalid="submitted && !form.supplier.trim()" autofocus />
        <datalist id="po-suppliers"><option v-for="s in suppliers" :key="s" :value="s" /></datalist>
      </FormField>
      <FormField label="Supplier ref / invoice" for="po-ref" optional class="md:col-span-2">
        <input id="po-ref" v-model="form.supplierRef" type="text" maxlength="100" class="input" />
      </FormField>
      <FormField label="Order date" for="po-date">
        <DateInput id="po-date" v-model="form.orderDate" />
      </FormField>
      <FormField label="Expected delivery" for="po-exp" optional>
        <DateInput id="po-exp" v-model="form.expectedDate" v-model:valid="expectedValid" :min="form.orderDate" />
      </FormField>
      <FormField label="Notes" for="po-notes" optional class="md:col-span-2">
        <input id="po-notes" v-model="form.notes" type="text" maxlength="1000" class="input" />
      </FormField>
    </div>

    <div class="mt-6">
      <div class="mb-2 flex items-center justify-between">
        <p class="eyebrow">Line items</p>
        <AppButton v-if="!linesLocked" size="sm" variant="ghost" :icon="Plus" @click="lines.push(blankLine())">Add line</AppButton>
      </div>

      <!-- Locked lines (read-only) -->
      <div v-if="linesLocked && po" class="overflow-x-auto rounded-xl border border-stone-200">
        <table class="table-base">
          <thead>
            <tr><th>Material</th><th class="text-right">Ordered</th><th class="text-right">Price</th><th class="text-right">Line total</th></tr>
          </thead>
          <tbody>
            <tr v-for="l in po.lines" :key="l.id">
              <td class="font-medium">{{ inv.materialsById.get(l.materialId)?.name }}</td>
              <td class="num text-right">{{ l.packageQty }} × {{ packagingLabel(inv.materialsById.get(l.materialId), l.packagingId) }}</td>
              <td class="num text-right">{{ formatMYR(l.packagePrice) }}</td>
              <td class="num text-right">{{ formatMYR(l.lineTotal) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Editable lines -->
      <div v-else class="space-y-3">
        <div v-for="(line, i) in lines" :key="line.key" class="rounded-xl border border-stone-200 bg-stone-50/50 p-3">
          <div class="grid gap-3 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] md:items-start">
            <FormField :label="`Material ${i + 1}`" :for="`po-m-${line.key}`" :error="submitted ? lineErrors(line).material : null">
              <select :id="`po-m-${line.key}`" v-model="line.materialId" class="input" :aria-invalid="submitted && !!lineErrors(line).material" @change="onMaterialChange(line)">
                <option value="" disabled>Select material</option>
                <option v-for="m in materialChoices" :key="m.id" :value="m.id">{{ m.name }} ({{ m.code }})</option>
              </select>
            </FormField>
            <FormField label="Unit" :for="`po-p-${line.key}`">
              <select :id="`po-p-${line.key}`" v-model="line.packagingId" class="input" :disabled="!line.materialId">
                <template v-if="calc(line).m">
                  <option v-for="p in packagingOptions(calc(line).m!)" :key="p.id" :value="p.id">{{ p.name }} ({{ p.size }} {{ UNIT_LABELS[calc(line).m!.baseUnit] }})</option>
                  <option :value="null">{{ UNIT_LABELS[calc(line).m!.baseUnit] }} (base unit)</option>
                </template>
              </select>
            </FormField>
            <FormField label="Quantity" :for="`po-q-${line.key}`" :error="submitted ? lineErrors(line).qty : null">
              <NumberInput :id="`po-q-${line.key}`" v-model="line.packageQty" :invalid="submitted && !!lineErrors(line).qty" />
            </FormField>
            <FormField :label="`Price per ${packagingLabel(calc(line).m, line.packagingId)}`" :for="`po-pr-${line.key}`" :error="submitted ? lineErrors(line).price : null">
              <NumberInput :id="`po-pr-${line.key}`" v-model="line.packagePrice" prefix="RM" :invalid="submitted && !!lineErrors(line).price" />
            </FormField>
            <div class="flex items-end md:pt-6">
              <button
                type="button"
                class="rounded-md p-2 text-stone-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                :disabled="lines.length === 1"
                :aria-label="`Remove line ${i + 1}`"
                @click="lines.splice(i, 1)"
              >
                <Trash2 class="size-4" />
              </button>
            </div>
          </div>
          <p v-if="calc(line).m && calc(line).baseQty !== null" class="mt-2 text-xs text-stone-500">
            = <span class="num font-medium text-stone-700">{{ formatQty(calc(line).baseQty, calc(line).m!.baseUnit) }}</span>
            <template v-if="calc(line).unitCost !== null"> · {{ formatRate(calc(line).unitCost) }}/{{ UNIT_LABELS[calc(line).m!.baseUnit] }}</template>
            <template v-if="calc(line).total !== null"> · line total <span class="num font-medium text-stone-800">{{ formatMYR(calc(line).total) }}</span></template>
          </p>
        </div>
      </div>
    </div>

    <ul v-if="submitted && formErrors.length" class="mt-4 space-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <li v-for="e in formErrors" :key="e">{{ e }}</li>
    </ul>

    <template #footer>
      <p class="mr-auto text-sm text-stone-600">
        Total <span class="num ml-1 text-base font-semibold text-stone-900">{{ formatMYR(linesLocked && po ? po.totalAmount : grandTotal) }}</span>
      </p>
      <AppButton variant="ghost" :disabled="saving" @click="emit('close')">Cancel</AppButton>
      <AppButton variant="dark" :loading="saving" @click="save">{{ isEdit ? 'Save changes' : 'Create purchase order' }}</AppButton>
    </template>
  </AppModal>
</template>
