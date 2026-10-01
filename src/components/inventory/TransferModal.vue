<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ArrowRight } from 'lucide-vue-next'
import { getBackend } from '@/services/backend'
import { createTransfer } from '@/services/operations/transfers'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useInventoryStore } from '@/stores/inventory'
import { useUiStore } from '@/stores/ui'
import { todayMY } from '@/lib/dates'
import { formatQty } from '@/lib/format'
import { EPSILON, roundQty } from '@/lib/numbers'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import FormField from '@/components/ui/FormField.vue'
import DateInput from '@/components/ui/DateInput.vue'
import NumberInput from '@/components/ui/NumberInput.vue'
import ExpiryBadge from '@/components/domain/ExpiryBadge.vue'
import QtyDisplay from '@/components/domain/QtyDisplay.vue'

const props = defineProps<{ open: boolean; presetBatchId?: string | null }>()
const emit = defineEmits<{ close: [] }>()

const auth = useAuthStore()
const data = useDataStore()
const inv = useInventoryStore()
const ui = useUiStore()

const form = reactive({ transferDate: todayMY(), fromLocationId: '', toLocationId: '', notes: '', materialFilter: '' })
const qty = reactive<Record<string, number | null>>({})
const saving = ref(false)
const submitted = ref(false)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    submitted.value = false
    form.transferDate = todayMY()
    form.notes = ''
    form.materialFilter = ''
    for (const k of Object.keys(qty)) delete qty[k]
    const preset = props.presetBatchId ? data.batches.find((b) => b.id === props.presetBatchId) : undefined
    form.fromLocationId = preset?.locationId ?? sourceLocations.value[0]?.id ?? ''
    form.toLocationId = ''
    if (preset) {
      form.materialFilter = preset.materialId
      qty[preset.id] = preset.quantity
    }
  },
)

watch(
  () => form.fromLocationId,
  () => {
    for (const k of Object.keys(qty)) {
      if (!data.batches.some((b) => b.id === k && b.locationId === form.fromLocationId)) delete qty[k]
    }
    if (form.toLocationId === form.fromLocationId) form.toLocationId = ''
  },
)

/** Any location that currently holds stock can be a source (even if inactive — so it can be emptied). */
const sourceLocations = computed(() => inv.sortedLocations.filter((l) => (inv.stockByLocation.get(l.id) ?? 0) > EPSILON))
const destLocations = computed(() => inv.activeLocations.filter((l) => l.id !== form.fromLocationId))

const available = computed(() =>
  inv.stockBatches.filter((b) => b.locationId === form.fromLocationId && (!form.materialFilter || b.materialId === form.materialFilter)),
)
const materialsAtSource = computed(() => {
  const ids = new Set(inv.stockBatches.filter((b) => b.locationId === form.fromLocationId).map((b) => b.materialId))
  return inv.sortedMaterials.filter((m) => ids.has(m.id))
})

const lines = computed(() =>
  Object.entries(qty)
    .filter(([, q]) => q !== null && q > EPSILON)
    .map(([batchId, q]) => ({ batchId, quantity: roundQty(q as number) })),
)

function lineError(batchId: string): string | null {
  const q = qty[batchId]
  if (q === null || q === undefined) return null
  if (q < 0) return 'Cannot be negative'
  const b = data.batches.find((x) => x.id === batchId)
  if (b && q > b.quantity + EPSILON) return 'More than available'
  return null
}

const errors = computed(() => {
  const e: string[] = []
  if (!form.fromLocationId) e.push('Choose a source location.')
  if (!form.toLocationId) e.push('Choose a destination.')
  if (!form.transferDate) e.push('Choose a transfer date.')
  if (lines.value.length === 0) e.push('Enter a quantity for at least one batch.')
  if (available.value.some((b) => lineError(b.id))) e.push('Fix the highlighted quantities.')
  return e
})

const summary = computed(() => {
  const per = new Map<string, number>()
  for (const l of lines.value) {
    const b = data.batches.find((x) => x.id === l.batchId)
    if (b) per.set(b.materialId, roundQty((per.get(b.materialId) ?? 0) + l.quantity))
  }
  return [...per].map(([mid, q]) => {
    const m = inv.materialsById.get(mid)
    return m ? formatQty(q, m.baseUnit) + ' ' + m.name : ''
  })
})

async function save() {
  submitted.value = true
  if (errors.value.length) return
  saving.value = true
  const ok = await ui.run(
    () =>
      createTransfer(getBackend().store, auth.actor, {
        transferDate: form.transferDate,
        fromLocationId: form.fromLocationId,
        toLocationId: form.toLocationId,
        notes: form.notes,
        lines: lines.value,
      }),
    'Transfer recorded',
    `${inv.locationsById.get(form.fromLocationId)?.name} → ${inv.locationsById.get(form.toLocationId)?.name}`,
  )
  saving.value = false
  if (ok) emit('close')
}
</script>

<template>
  <AppModal :open="open" title="Transfer stock" subtitle="Moves are saved as one all-or-nothing write." size="lg" :persistent="saving" @close="emit('close')">
    <div class="grid gap-4 sm:grid-cols-[1fr_auto_1fr]">
      <FormField label="From" for="tr-from">
        <select id="tr-from" v-model="form.fromLocationId" class="input">
          <option value="" disabled>Select source</option>
          <option v-for="l in sourceLocations" :key="l.id" :value="l.id">{{ l.name }}{{ l.active ? '' : ' (inactive)' }}</option>
        </select>
      </FormField>
      <div class="hidden items-end pb-2.5 sm:flex"><ArrowRight class="size-4 text-stone-400" /></div>
      <FormField label="To" for="tr-to" :error="submitted && !form.toLocationId ? 'Choose a destination' : null">
        <select id="tr-to" v-model="form.toLocationId" class="input" :aria-invalid="submitted && !form.toLocationId">
          <option value="" disabled>Select destination</option>
          <option v-for="l in destLocations" :key="l.id" :value="l.id">{{ l.name }} · {{ l.type === 'vendor' ? 'Vendor' : 'Internal' }}</option>
        </select>
      </FormField>
    </div>
    <div class="mt-4 grid gap-4 sm:grid-cols-2">
      <FormField label="Transfer date" for="tr-date">
        <DateInput id="tr-date" v-model="form.transferDate" :max="todayMY()" />
      </FormField>
      <FormField label="Material" for="tr-mat">
        <select id="tr-mat" v-model="form.materialFilter" class="input">
          <option value="">All materials at source</option>
          <option v-for="m in materialsAtSource" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
      </FormField>
    </div>

    <div class="mt-5 overflow-hidden rounded-xl border border-stone-200">
      <table class="table-base">
        <thead>
          <tr>
            <th>Batch</th>
            <th>Expiry</th>
            <th class="text-right">Available</th>
            <th class="w-44 text-right">Move</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in available" :key="b.id">
            <td>
              <p class="font-medium text-stone-900">{{ inv.materialsById.get(b.materialId)?.name }}</p>
              <p class="num text-xs text-stone-500">{{ b.batchNo }}</p>
            </td>
            <td><ExpiryBadge :date="b.expiryDate" compact /></td>
            <td class="text-right"><QtyDisplay :quantity="b.quantity" :material="inv.materialsById.get(b.materialId)" breakdown /></td>
            <td>
              <div class="flex items-center gap-1.5">
                <NumberInput
                  :model-value="qty[b.id] ?? null"
                  @update:model-value="(v) => (qty[b.id] = v)"
                  :suffix="inv.materialsById.get(b.materialId)?.baseUnit"
                  :invalid="!!lineError(b.id)"
                  :aria-label="`Quantity to move from batch ${b.batchNo}`"
                  placeholder="0"
                />
                <button type="button" class="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-resin-700 hover:bg-resin-50" @click="qty[b.id] = b.quantity">All</button>
              </div>
              <p v-if="lineError(b.id)" class="mt-1 text-right text-[11px] text-red-600">{{ lineError(b.id) }}</p>
            </td>
          </tr>
          <tr v-if="!available.length">
            <td colspan="4" class="py-8 text-center text-sm text-stone-500">No stock at this location{{ form.materialFilter ? ' for this material' : '' }}.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <FormField label="Notes" for="tr-notes" optional class="mt-4">
      <textarea id="tr-notes" v-model="form.notes" rows="2" maxlength="1000" class="input resize-none" placeholder="e.g. Lorry WXY 1234, driver Ali" />
    </FormField>

    <ul v-if="submitted && errors.length" class="mt-4 space-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <li v-for="e in errors" :key="e">{{ e }}</li>
    </ul>

    <template #footer>
      <p v-if="summary.length" class="mr-auto text-xs text-stone-500">Moving <span class="font-medium text-stone-800">{{ summary.join(', ') }}</span></p>
      <AppButton variant="ghost" :disabled="saving" @click="emit('close')">Cancel</AppButton>
      <AppButton variant="dark" :loading="saving" @click="save">Confirm transfer</AppButton>
    </template>
  </AppModal>
</template>
