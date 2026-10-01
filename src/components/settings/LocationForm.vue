<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { getBackend } from '@/services/backend'
import { saveLocation } from '@/services/operations/catalog'
import { useAuthStore } from '@/stores/auth'
import { useDataStore } from '@/stores/data'
import { useInventoryStore } from '@/stores/inventory'
import { useUiStore } from '@/stores/ui'
import type { LocationType, StorageLocation } from '@/types/models'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import FormField from '@/components/ui/FormField.vue'

const props = defineProps<{ open: boolean; location: StorageLocation | null }>()
const emit = defineEmits<{ close: [] }>()

const auth = useAuthStore()
const data = useDataStore()
const inv = useInventoryStore()
const ui = useUiStore()

const form = reactive({ name: '', type: 'internal' as LocationType, address: '', active: true })
const saving = ref(false)
const submitted = ref(false)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    submitted.value = false
    const l = props.location
    Object.assign(form, l ? { name: l.name, type: l.type, address: l.address, active: l.active } : { name: '', type: 'internal', address: '', active: true })
  },
)

const stockHere = computed(() => (props.location ? (inv.stockByLocation.get(props.location.id) ?? 0) : 0))

async function save() {
  submitted.value = true
  if (!form.name.trim()) return
  saving.value = true
  const ok = await ui.run(
    () =>
      saveLocation(getBackend().store, auth.actor, props.location?.id ?? null, { ...form }, {
        existing: data.locations.map((l) => ({ id: l.id, name: l.name })),
        currentStock: stockHere.value,
      }),
    props.location ? 'Location updated' : 'Location added',
    form.name.trim(),
  )
  saving.value = false
  if (ok) emit('close')
}
</script>

<template>
  <AppModal :open="open" :title="location ? `Edit ${location.name}` : 'New location'" size="sm" :persistent="saving" @close="emit('close')">
    <div class="space-y-4">
      <FormField label="Name" for="loc-name" :error="submitted && !form.name.trim() ? 'Enter a name' : null">
        <input id="loc-name" v-model="form.name" type="text" maxlength="80" class="input" placeholder="e.g. Semenyih" autofocus />
      </FormField>
      <fieldset>
        <legend class="mb-1.5 text-[13px] font-medium text-stone-700">Type</legend>
        <div class="grid grid-cols-2 gap-2">
          <label
            v-for="t in [{ v: 'internal', l: 'Internal', d: 'Your own warehouse' }, { v: 'vendor', l: 'Vendor', d: 'Third-party warehouse' }] as const"
            :key="t.v"
            :class="['cursor-pointer rounded-lg border px-3 py-2.5 transition', form.type === t.v ? 'border-stone-900 bg-stone-900/[0.03] ring-1 ring-stone-900' : 'border-stone-200 hover:border-stone-300']"
          >
            <input v-model="form.type" type="radio" name="loc-type" :value="t.v" class="sr-only" />
            <span class="block text-sm font-medium text-stone-900">{{ t.l }}</span>
            <span class="block text-xs text-stone-500">{{ t.d }}</span>
          </label>
        </div>
      </fieldset>
      <FormField label="Address / notes" for="loc-addr" optional>
        <textarea id="loc-addr" v-model="form.address" rows="2" maxlength="300" class="input resize-none" />
      </FormField>
      <label class="inline-flex items-center gap-2 text-sm text-stone-700">
        <input v-model="form.active" type="checkbox" class="size-4 rounded border-stone-300 accent-stone-900" :disabled="!!location && stockHere > 0 && form.active" />
        Active (can receive stock and transfers)
      </label>
      <p v-if="location && stockHere > 0" class="text-xs text-stone-500">This location holds stock, so it cannot be deactivated until it is transferred out.</p>
    </div>
    <template #footer>
      <AppButton variant="ghost" :disabled="saving" @click="emit('close')">Cancel</AppButton>
      <AppButton variant="dark" :loading="saving" @click="save">{{ location ? 'Save changes' : 'Add location' }}</AppButton>
    </template>
  </AppModal>
</template>
