<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Plus, SlidersHorizontal, Trash2, TriangleAlert, Wand2 } from 'lucide-vue-next'
import { getBackend } from '@/services/backend'
import { createSale } from '@/services/operations/sales'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useInventoryStore } from '@/stores/inventory'
import { useUiStore } from '@/stores/ui'
import { todayMY } from '@/lib/dates'
import { formatMYR, formatPercent, formatQty, UNIT_LABELS } from '@/lib/format'
import { EPSILON, roundMoney, roundQty } from '@/lib/numbers'
import { packageSize, packagingLabel, packagingOptions } from '@/lib/packaging'
import { allocateFefo, compareFefo, expiryBucket } from '@/lib/stock'
import type { Batch } from '@/types/models'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import FormField from '@/components/ui/FormField.vue'
import DateInput from '@/components/ui/DateInput.vue'
import NumberInput from '@/components/ui/NumberInput.vue'
import ExpiryBadge from '@/components/domain/ExpiryBadge.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; saved: [id: string] }>()

const auth = useAuthStore()
const data = useDataStore()
const inv = useInventoryStore()
const ui = useUiStore()

interface LineDraft {
  key: number
  materialId: string
  packagingId: string | null
  packageQty: number | null
  packagePrice: number | null
  /** '' = any location */
  fromLocationId: string
  manual: boolean
  manualAlloc: Record<string, number | null>
}

let seq = 0
const blankLine = (): LineDraft => ({
  key: ++seq,
  materialId: '',
  packagingId: null,
  packageQty: null,
  packagePrice: null,
  fromLocationId: '',
  manual: false,
  manualAlloc: {},
})

const form = reactive({ customer: '', customerRef: '', saleDate: todayMY(), notes: '' })
const lines = ref<LineDraft[]>([blankLine()])
const saving = ref(false)
const submitted = ref(false)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    submitted.value = false
    Object.assign(form, { customer: '', customerRef: '', saleDate: todayMY(), notes: '' })
    lines.value = [blankLine()]
  },
)

const customers = computed(() => [...new Set(data.sales.map((s) => s.customer))].sort())

function onMaterialChange(line: LineDraft) {
  const m = inv.materialsById.get(line.materialId)
  line.packagingId = m ? (packagingOptions(m)[0]?.id ?? null) : null
  line.manual = false
  line.manualAlloc = {}
  line.fromLocationId = ''
}

function baseQty(line: LineDraft): number | null {
  const m = inv.materialsById.get(line.materialId)
  const size = m ? packageSize(m.packaging, line.packagingId) : null
  return size !== null && line.packageQty !== null && line.packageQty > 0 ? roundQty(line.packageQty * size) : null
}

function candidates(line: LineDraft): Batch[] {
  return inv.stockBatches
    .filter((b) => b.materialId === line.materialId && (!line.fromLocationId || b.locationId === line.fromLocationId))
    .sort(compareFefo)
}

/**
 * Allocation plan for every line, in order. Earlier lines consume batches first, so two lines of the
 * same material never double-book a batch.
 */
const plans = computed(() => {
  const used = new Map<string, number>()
  return lines.value.map((line) => {
    const pool = candidates(line).map((b) => ({ ...b, quantity: roundQty(b.quantity - (used.get(b.id) ?? 0)) }))
    const need = baseQty(line) ?? 0
    let allocs: Array<{ batchId: string; quantity: number }>
    let shortfall = 0
    if (line.manual) {
      allocs = Object.entries(line.manualAlloc)
        .filter(([, q]) => q !== null && q > EPSILON)
        .map(([batchId, q]) => ({ batchId, quantity: roundQty(q as number) }))
    } else {
      const r = allocateFefo(pool, need, inv.today)
      allocs = r.allocations
      shortfall = r.shortfall
    }
    for (const a of allocs) used.set(a.batchId, roundQty((used.get(a.batchId) ?? 0) + a.quantity))
    const allocated = roundQty(allocs.reduce((s, a) => s + a.quantity, 0))
    const cost = roundMoney(allocs.reduce((s, a) => {
      const b = data.batches.find((x) => x.id === a.batchId)
      return s + a.quantity * (b ? (inv.unitCostByLot.get(b.lotId) ?? 0) : 0)
    }, 0))
    const overBatch = allocs.find((a) => {
      const p = pool.find((b) => b.id === a.batchId)
      return !p || a.quantity > p.quantity + EPSILON
    })
    const usesExpired = allocs.some((a) => {
      const b = data.batches.find((x) => x.id === a.batchId)
      return b ? expiryBucket(b.expiryDate, inv.today) === 'expired' : false
    })
    const usableTotal = roundQty(
      pool.filter((b) => expiryBucket(b.expiryDate, inv.today) !== 'expired').reduce((s, b) => s + Math.max(0, b.quantity), 0),
    )
    return { line, pool, need, allocs, allocated, shortfall, cost, overBatch: !!overBatch, usesExpired, usableTotal }
  })
})

function allocatedFor(planIndex: number, batchId: string): number {
  return plans.value[planIndex]?.allocs.find((a) => a.batchId === batchId)?.quantity ?? 0
}

function customise(line: LineDraft, index: number) {
  line.manualAlloc = {}
  for (const a of plans.value[index]?.allocs ?? []) line.manualAlloc[a.batchId] = a.quantity
  line.manual = true
}

function lineErrors(index: number) {
  const p = plans.value[index]!
  const l = p.line
  const e: Record<string, string | null> = {
    material: !l.materialId ? 'Select a material' : null,
    qty: l.packageQty === null || l.packageQty <= EPSILON ? 'Enter a quantity' : null,
    price: l.packagePrice === null || l.packagePrice < 0 ? 'Enter a price' : null,
    alloc: null,
  }
  if (!e.material && !e.qty) {
    const unit = inv.materialsById.get(l.materialId)?.baseUnit ?? 'kg'
    if (!l.manual && p.shortfall > EPSILON) e.alloc = `Not enough unexpired stock — short by ${formatQty(p.shortfall, unit)}.`
    else if (p.overBatch) e.alloc = 'A batch is allocated more than it holds.'
    else if (Math.abs(p.allocated - p.need) > 0.0005) e.alloc = `Allocated ${formatQty(p.allocated, unit)} of ${formatQty(p.need, unit)} needed.`
  }
  return e
}

const totals = computed(() => {
  const revenue = roundMoney(lines.value.reduce((a, l) => a + (l.packageQty !== null && l.packagePrice !== null ? l.packageQty * l.packagePrice : 0), 0))
  const cost = roundMoney(plans.value.reduce((a, p) => a + p.cost, 0))
  return { revenue, cost, margin: roundMoney(revenue - cost) }
})

const formErrors = computed(() => {
  const e: string[] = []
  if (!form.customer.trim()) e.push('Enter the customer.')
  if (!form.saleDate) e.push('Choose the sale date.')
  if (lines.value.some((_, i) => Object.values(lineErrors(i)).some(Boolean))) e.push('Complete or fix every line item.')
  return e
})

async function save() {
  submitted.value = true
  if (formErrors.value.length) return
  saving.value = true
  let id = ''
  const ok = await ui.run(
    async () => {
      id = await createSale(getBackend().store, auth.actor, {
        customer: form.customer,
        customerRef: form.customerRef,
        saleDate: form.saleDate,
        notes: form.notes,
        lines: plans.value.map((p) => ({
          materialId: p.line.materialId,
          packagingId: p.line.packagingId,
          packageQty: p.line.packageQty!,
          packagePrice: p.line.packagePrice!,
          allocations: p.allocs,
        })),
      })
    },
    'Sale recorded',
    'Stock deducted from the allocated batches.',
  )
  saving.value = false
  if (ok) {
    emit('saved', id)
    emit('close')
  }
}

const locationsWithStock = (materialId: string) =>
  inv.sortedLocations.filter((l) => (inv.matrix.get(materialId)?.get(l.id) ?? 0) > EPSILON)
</script>

<template>
  <AppModal :open="open" title="New sale / dispatch" subtitle="Batches are pre-selected first-expiry-first-out. Adjust them if needed." size="xl" :persistent="saving" @close="emit('close')">
    <div class="grid gap-4 md:grid-cols-4">
      <FormField label="Customer" for="so-cust" class="md:col-span-2" :error="submitted && !form.customer.trim() ? 'Enter the customer' : null">
        <input id="so-cust" v-model="form.customer" type="text" list="so-customers" maxlength="200" class="input" :aria-invalid="submitted && !form.customer.trim()" autofocus />
        <datalist id="so-customers"><option v-for="c in customers" :key="c" :value="c" /></datalist>
      </FormField>
      <FormField label="Customer PO / DO no." for="so-ref" optional>
        <input id="so-ref" v-model="form.customerRef" type="text" maxlength="100" class="input" />
      </FormField>
      <FormField label="Sale date" for="so-date">
        <DateInput id="so-date" v-model="form.saleDate" :max="todayMY()" />
      </FormField>
      <FormField label="Notes" for="so-notes" optional class="md:col-span-4">
        <input id="so-notes" v-model="form.notes" type="text" maxlength="1000" class="input" />
      </FormField>
    </div>

    <div class="mt-6">
      <div class="mb-2 flex items-center justify-between">
        <p class="eyebrow">Line items</p>
        <AppButton size="sm" variant="ghost" :icon="Plus" @click="lines.push(blankLine())">Add line</AppButton>
      </div>

      <div class="space-y-4">
        <div v-for="(p, i) in plans" :key="p.line.key" class="rounded-xl border border-stone-200 bg-stone-50/50">
          <div class="grid gap-3 p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1.2fr)_auto] md:items-start">
            <FormField :label="`Material ${i + 1}`" :for="`so-m-${p.line.key}`" :error="submitted ? lineErrors(i).material : null">
              <select :id="`so-m-${p.line.key}`" v-model="p.line.materialId" class="input" @change="onMaterialChange(p.line)">
                <option value="" disabled>Select material</option>
                <option v-for="m in inv.activeMaterials" :key="m.id" :value="m.id" :disabled="(inv.totalsByMaterial.get(m.id) ?? 0) <= 0">
                  {{ m.name }} — {{ formatQty(inv.totalsByMaterial.get(m.id) ?? 0, m.baseUnit) }} on hand
                </option>
              </select>
            </FormField>
            <FormField label="Unit" :for="`so-p-${p.line.key}`">
              <select :id="`so-p-${p.line.key}`" v-model="p.line.packagingId" class="input" :disabled="!p.line.materialId">
                <template v-if="inv.materialsById.get(p.line.materialId)">
                  <option v-for="o in packagingOptions(inv.materialsById.get(p.line.materialId)!)" :key="o.id" :value="o.id">
                    {{ o.name }} ({{ o.size }} {{ UNIT_LABELS[inv.materialsById.get(p.line.materialId)!.baseUnit] }})
                  </option>
                  <option :value="null">{{ UNIT_LABELS[inv.materialsById.get(p.line.materialId)!.baseUnit] }} (base unit)</option>
                </template>
              </select>
            </FormField>
            <FormField label="Quantity" :for="`so-q-${p.line.key}`" :error="submitted ? lineErrors(i).qty : null">
              <NumberInput :id="`so-q-${p.line.key}`" v-model="p.line.packageQty" :invalid="submitted && !!lineErrors(i).qty" />
            </FormField>
            <FormField :label="`Price per ${packagingLabel(inv.materialsById.get(p.line.materialId), p.line.packagingId)}`" :for="`so-pr-${p.line.key}`" :error="submitted ? lineErrors(i).price : null">
              <NumberInput :id="`so-pr-${p.line.key}`" v-model="p.line.packagePrice" prefix="RM" :invalid="submitted && !!lineErrors(i).price" />
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

          <!-- Allocation -->
          <div v-if="p.line.materialId" class="border-t border-stone-200 bg-white px-3 py-3 sm:rounded-b-xl">
            <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <p class="text-xs font-semibold text-stone-700">Batches to deduct</p>
                <AppBadge :tone="p.line.manual ? 'amber' : 'green'">{{ p.line.manual ? 'Manual' : 'FEFO' }}</AppBadge>
              </div>
              <div class="flex items-center gap-2">
                <select v-model="p.line.fromLocationId" class="input h-8 py-0 text-xs sm:w-44" aria-label="Dispatch from location" @change="p.line.manualAlloc = {}">
                  <option value="">From any location</option>
                  <option v-for="l in locationsWithStock(p.line.materialId)" :key="l.id" :value="l.id">From {{ l.name }}</option>
                </select>
                <AppButton v-if="!p.line.manual" size="sm" variant="ghost" :icon="SlidersHorizontal" @click="customise(p.line, i)">Customise</AppButton>
                <AppButton v-else size="sm" variant="ghost" :icon="Wand2" @click="p.line.manual = false">Reset to FEFO</AppButton>
              </div>
            </div>
            <div class="overflow-x-auto">
              <table class="table-base text-[13px]">
                <thead>
                  <tr>
                    <th>Batch</th>
                    <th>Location</th>
                    <th>Expiry</th>
                    <th class="text-right">Available</th>
                    <th class="w-40 text-right">Deduct</th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="b in p.pool" :key="b.id">
                    <tr v-if="p.line.manual || allocatedFor(i, b.id) > 0">
                      <td class="num">{{ b.batchNo }}</td>
                      <td>{{ inv.locationsById.get(b.locationId)?.name }}</td>
                      <td><ExpiryBadge :date="b.expiryDate" compact /></td>
                      <td class="num text-right">{{ formatQty(Math.max(0, b.quantity), inv.materialsById.get(b.materialId)!.baseUnit) }}</td>
                      <td class="text-right">
                        <NumberInput
                          v-if="p.line.manual"
                          :model-value="p.line.manualAlloc[b.id] ?? null"
                          :suffix="inv.materialsById.get(b.materialId)!.baseUnit"
                          :aria-label="`Deduct from batch ${b.batchNo}`"
                          placeholder="0"
                          @update:model-value="(v) => (p.line.manualAlloc[b.id] = v)"
                        />
                        <span v-else class="num font-medium">{{ formatQty(allocatedFor(i, b.id), inv.materialsById.get(b.materialId)!.baseUnit) }}</span>
                      </td>
                    </tr>
                  </template>
                  <tr v-if="!p.pool.length">
                    <td colspan="5" class="py-4 text-center text-stone-500">No stock{{ p.line.fromLocationId ? ' at this location' : '' }}.</td>
                  </tr>
                  <tr v-else-if="!p.line.manual && !p.allocs.length">
                    <td colspan="5" class="py-4 text-center text-stone-500">Enter a quantity to see the FEFO allocation.</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-if="p.usesExpired" class="mt-2 flex items-center gap-1.5 text-xs text-orange-700">
              <TriangleAlert class="size-3.5" /> Includes an expired batch.
            </p>
            <p v-if="(submitted || p.line.manual) && lineErrors(i).alloc" class="mt-2 text-xs text-red-600">{{ lineErrors(i).alloc }}</p>
            <p v-else-if="!p.line.manual && p.shortfall > 0 && p.need > 0" class="mt-2 text-xs text-red-600">{{ lineErrors(i).alloc }}</p>
          </div>
        </div>
      </div>
    </div>

    <ul v-if="submitted && formErrors.length" class="mt-4 space-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <li v-for="e in formErrors" :key="e">{{ e }}</li>
    </ul>

    <template #footer>
      <dl class="mr-auto flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <div><dt class="inline text-stone-500">Revenue </dt><dd class="num inline font-semibold text-stone-900">{{ formatMYR(totals.revenue) }}</dd></div>
        <div><dt class="inline text-stone-500">Cost </dt><dd class="num inline text-stone-700">{{ formatMYR(totals.cost) }}</dd></div>
        <div>
          <dt class="inline text-stone-500">Margin </dt>
          <dd class="num inline font-medium" :class="totals.margin < 0 ? 'text-red-600' : 'text-emerald-700'">
            {{ formatMYR(totals.margin) }}<template v-if="totals.revenue > 0"> ({{ formatPercent(totals.margin / totals.revenue) }})</template>
          </dd>
        </div>
      </dl>
      <AppButton variant="ghost" :disabled="saving" @click="emit('close')">Cancel</AppButton>
      <AppButton variant="primary" :loading="saving" @click="save">Record sale</AppButton>
    </template>
  </AppModal>
</template>
