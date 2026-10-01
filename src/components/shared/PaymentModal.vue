<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { todayMY } from '@/lib/dates'
import { formatMYR } from '@/lib/format'
import { EPSILON, roundMoney } from '@/lib/numbers'
import type { PaymentInput } from '@/services/operations/common'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import FormField from '@/components/ui/FormField.vue'
import DateInput from '@/components/ui/DateInput.vue'
import NumberInput from '@/components/ui/NumberInput.vue'

const props = defineProps<{
  open: boolean
  title: string
  subtitle?: string
  outstanding: number
  /** Label for the action, e.g. "Record payment" or "Record collection" */
  actionLabel: string
  submit: (input: PaymentInput) => Promise<boolean>
}>()
const emit = defineEmits<{ close: [] }>()

const form = reactive({ date: todayMY(), amount: null as number | null, reference: '', note: '' })
const saving = ref(false)
const submitted = ref(false)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    Object.assign(form, { date: todayMY(), amount: roundMoney(props.outstanding), reference: '', note: '' })
    submitted.value = false
  },
)

const amountError = computed(() => {
  if (form.amount === null || form.amount <= EPSILON) return 'Enter an amount greater than RM 0.00'
  if (roundMoney(form.amount) > roundMoney(props.outstanding) + EPSILON) return `Cannot exceed the outstanding ${formatMYR(props.outstanding)}`
  return null
})
const dateError = computed(() => (form.date ? null : 'Choose a date'))

async function save() {
  submitted.value = true
  if (amountError.value || dateError.value) return
  saving.value = true
  const ok = await props.submit({ date: form.date, amount: roundMoney(form.amount!), reference: form.reference, note: form.note })
  saving.value = false
  if (ok) emit('close')
}
</script>

<template>
  <AppModal :open="open" :title="title" :subtitle="subtitle" size="sm" :persistent="saving" @close="emit('close')">
    <div class="mb-4 flex items-baseline justify-between rounded-lg bg-stone-50 px-4 py-3 ring-1 ring-stone-200">
      <span class="text-sm text-stone-600">Outstanding</span>
      <span class="num text-lg font-semibold text-stone-900">{{ formatMYR(outstanding) }}</span>
    </div>
    <div class="grid gap-4 sm:grid-cols-2">
      <FormField label="Amount" for="pay-amount" :error="submitted ? amountError : null">
        <NumberInput id="pay-amount" v-model="form.amount" prefix="RM" :invalid="submitted && !!amountError" />
      </FormField>
      <FormField label="Date" for="pay-date" :error="submitted ? dateError : null">
        <DateInput id="pay-date" v-model="form.date" :max="todayMY()" />
      </FormField>
    </div>
    <FormField label="Reference" for="pay-ref" optional hint="Cheque, TT, FPX or receipt number" class="mt-4">
      <input id="pay-ref" v-model="form.reference" type="text" maxlength="100" class="input" />
    </FormField>
    <FormField label="Note" for="pay-note" optional class="mt-4">
      <input id="pay-note" v-model="form.note" type="text" maxlength="500" class="input" />
    </FormField>
    <template #footer>
      <AppButton variant="ghost" :disabled="saving" @click="emit('close')">Cancel</AppButton>
      <AppButton variant="dark" :loading="saving" @click="save">{{ actionLabel }}</AppButton>
    </template>
  </AppModal>
</template>
