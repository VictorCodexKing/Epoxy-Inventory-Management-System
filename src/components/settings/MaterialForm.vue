<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Lock, Plus, Trash2 } from 'lucide-vue-next'
import { getBackend } from '@/services/backend'
import { saveMaterial } from '@/services/operations/catalog'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'
import { randomId } from '@/lib/ids'
import { formatNumber, UNIT_LABELS, UNIT_NAMES } from '@/lib/format'
import { packageSize, validatePackaging } from '@/lib/packaging'
import type { BaseUnit, Material, PackagingUnit } from '@/types/models'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import FormField from '@/components/ui/FormField.vue'
import NumberInput from '@/components/ui/NumberInput.vue'

const props = defineProps<{ open: boolean; material: Material | null }>()
const emit = defineEmits<{ close: [] }>()

const auth = useAuthStore()
const data = useDataStore()
const ui = useUiStore()

interface PkgDraft {
  id: string
  name: string
  contains: number | null
  of: string
}

const form = reactive({ code: '', name: '', baseUnit: 'kg' as BaseUnit, lowStockThreshold: 0 as number | null, notes: '', active: true })
const packaging = ref<PkgDraft[]>([])
const saving = ref(false)
const submitted = ref(false)

const hasStockHistory = computed(() => !!props.material && data.batches.some((b) => b.materialId === props.material!.id))

watch(
  () => props.open,
  (open) => {
    if (!open) return
    submitted.value = false
    const m = props.material
    if (m) {
      Object.assign(form, { code: m.code, name: m.name, baseUnit: m.baseUnit, lowStockThreshold: m.lowStockThreshold, notes: m.notes, active: m.active })
      packaging.value = m.packaging.map((p) => ({ ...p }))
    } else {
      Object.assign(form, { code: '', name: '', baseUnit: 'kg', lowStockThreshold: 0, notes: '', active: true })
      packaging.value = [{ id: randomId(), name: 'Drum', contains: 200, of: 'base' }]
    }
  },
)

const asUnits = computed<PackagingUnit[]>(() => packaging.value.map((p) => ({ id: p.id, name: p.name, contains: p.contains ?? 0, of: p.of })))
const pkgErrors = computed(() => validatePackaging(asUnits.value))

function sizeOf(id: string) {
  return packageSize(asUnits.value, id)
}

function remove(i: number) {
  const removed = packaging.value[i]!
  packaging.value.splice(i, 1)
  // Anything that was built on the removed level now needs a new parent — point it at the base unit.
  for (const p of packaging.value) if (p.of === removed.id) p.of = 'base'
}

const errors = computed(() => {
  const e: string[] = []
  if (!form.code.trim()) e.push('Enter a material code.')
  if (!form.name.trim()) e.push('Enter a material name.')
  if (form.lowStockThreshold === null || form.lowStockThreshold < 0) e.push('Low-stock threshold must be 0 or more.')
  e.push(...pkgErrors.value)
  return e
})

async function save() {
  submitted.value = true
  if (errors.value.length) return
  saving.value = true
  const ok = await ui.run(
    () =>
      saveMaterial(
        getBackend().store,
        auth.actor,
        props.material?.id ?? null,
        {
          code: form.code,
          name: form.name,
          baseUnit: form.baseUnit,
          packaging: asUnits.value,
          lowStockThreshold: form.lowStockThreshold ?? 0,
          notes: form.notes,
          active: form.active,
        },
        { existing: data.materials.map((m) => ({ id: m.id, name: m.name, code: m.code })), hasStockHistory: hasStockHistory.value },
      ),
    props.material ? 'Material updated' : 'Material added',
    form.name.trim(),
  )
  saving.value = false
  if (ok) emit('close')
}
</script>

<template>
  <AppModal :open="open" :title="material ? `Edit ${material.name}` : 'New material'" size="lg" :persistent="saving" @close="emit('close')">
    <div class="grid gap-4 sm:grid-cols-[140px_1fr]">
      <FormField label="Code" for="mat-code" hint="Short unique code">
        <input id="mat-code" v-model="form.code" type="text" maxlength="30" class="input num uppercase" placeholder="EPX-A" autofocus />
      </FormField>
      <FormField label="Name" for="mat-name">
        <input id="mat-name" v-model="form.name" type="text" maxlength="120" class="input" placeholder="Epoxy Resin (Part A)" />
      </FormField>
    </div>
    <div class="mt-4 grid gap-4 sm:grid-cols-2">
      <FormField
        label="Base unit"
        for="mat-unit"
        :hint="hasStockHistory ? 'Locked — stock has already been recorded in this unit.' : 'All stock is counted in this unit. kg and L are never converted into each other.'"
      >
        <div class="relative">
          <select id="mat-unit" v-model="form.baseUnit" class="input" :disabled="hasStockHistory">
            <option v-for="(label, u) in UNIT_NAMES" :key="u" :value="u">{{ label }}</option>
          </select>
          <Lock v-if="hasStockHistory" class="pointer-events-none absolute top-1/2 right-9 size-3.5 -translate-y-1/2 text-stone-400" />
        </div>
      </FormField>
      <FormField label="Low-stock threshold" for="mat-low" hint="Alert when the total across all locations drops below this. 0 = off.">
        <NumberInput id="mat-low" v-model="form.lowStockThreshold" :suffix="UNIT_LABELS[form.baseUnit]" />
      </FormField>
    </div>

    <div class="mt-6">
      <div class="mb-2 flex items-center justify-between">
        <div>
          <p class="eyebrow">Packaging sizes</p>
          <p class="mt-0.5 text-xs text-stone-500">Levels can nest — e.g. a Box of 12 Cans, each Can 1 L.</p>
        </div>
        <AppButton size="sm" variant="ghost" :icon="Plus" @click="packaging.push({ id: randomId(), name: '', contains: null, of: 'base' })">Add level</AppButton>
      </div>
      <div class="space-y-2">
        <div v-for="(p, i) in packaging" :key="p.id" class="grid items-center gap-2 rounded-lg border border-stone-200 bg-stone-50/50 p-2.5 sm:grid-cols-[minmax(0,1.2fr)_auto_minmax(0,0.8fr)_auto_minmax(0,1.3fr)_auto]">
          <input v-model="p.name" type="text" maxlength="40" class="input" placeholder="e.g. Pail" :aria-label="`Packaging ${i + 1} name`" />
          <span class="text-center text-sm text-stone-500">contains</span>
          <NumberInput v-model="p.contains" :aria-label="`Packaging ${i + 1} quantity`" />
          <span class="text-center text-sm text-stone-500">×</span>
          <select v-model="p.of" class="input" :aria-label="`Packaging ${i + 1} contents`">
            <option value="base">{{ UNIT_LABELS[form.baseUnit] }}</option>
            <option v-for="o in packaging.filter((x) => x.id !== p.id)" :key="o.id" :value="o.id">{{ o.name || 'Unnamed' }}</option>
          </select>
          <div class="flex items-center justify-end gap-2">
            <span class="num text-xs whitespace-nowrap text-stone-500">
              = {{ sizeOf(p.id) !== null ? `${formatNumber(sizeOf(p.id))} ${UNIT_LABELS[form.baseUnit]}` : '?' }}
            </span>
            <button type="button" class="rounded-md p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600" :aria-label="`Remove ${p.name || 'packaging'}`" @click="remove(i)">
              <Trash2 class="size-4" />
            </button>
          </div>
        </div>
        <p v-if="!packaging.length" class="rounded-lg border border-dashed border-stone-200 px-4 py-4 text-center text-sm text-stone-500">
          No packaging — quantities will be entered in {{ UNIT_LABELS[form.baseUnit] }} only.
        </p>
      </div>
    </div>

    <FormField label="Notes" for="mat-notes" optional class="mt-5">
      <textarea id="mat-notes" v-model="form.notes" rows="2" maxlength="1000" class="input resize-none" placeholder="Storage conditions, mix ratio, SDS reference…" />
    </FormField>
    <label class="mt-4 inline-flex items-center gap-2 text-sm text-stone-700">
      <input v-model="form.active" type="checkbox" class="size-4 rounded border-stone-300 accent-stone-900" />
      Active (available for new purchase orders and sales)
    </label>

    <ul v-if="submitted && errors.length" class="mt-4 space-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <li v-for="e in errors" :key="e">{{ e }}</li>
    </ul>

    <template #footer>
      <AppButton variant="ghost" :disabled="saving" @click="emit('close')">Cancel</AppButton>
      <AppButton variant="dark" :loading="saving" @click="save">{{ material ? 'Save changes' : 'Add material' }}</AppButton>
    </template>
  </AppModal>
</template>
