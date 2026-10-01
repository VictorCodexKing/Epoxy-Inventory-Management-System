<script setup lang="ts">
import { ref, watch } from 'vue'

/**
 * Numeric input bound to `number | null`. Keeps the raw text while typing (so "12." is not
 * clobbered), accepts thousands separators, and only emits finite numbers.
 */
const props = withDefaults(
  defineProps<{
    modelValue: number | null
    id?: string
    min?: number
    max?: number
    step?: number | 'any'
    placeholder?: string
    prefix?: string
    suffix?: string
    disabled?: boolean
    invalid?: boolean
    ariaLabel?: string
  }>(),
  { step: 'any', min: 0 },
)
const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()

const text = ref(props.modelValue === null ? '' : String(props.modelValue))

watch(
  () => props.modelValue,
  (v) => {
    const parsed = parse(text.value)
    if (v !== parsed) text.value = v === null ? '' : String(v)
  },
)

function parse(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim()
  if (cleaned === '' || cleaned === '.' || cleaned === '-') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function onInput(e: Event) {
  text.value = (e.target as HTMLInputElement).value
  emit('update:modelValue', parse(text.value))
}
</script>

<template>
  <div class="relative">
    <span v-if="prefix" class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-stone-500">{{ prefix }}</span>
    <input
      :id="id"
      :value="text"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-invalid="invalid || undefined"
      :aria-label="ariaLabel"
      :class="['input num text-right', prefix ? 'pl-10' : '', suffix ? 'pr-12' : '']"
      @input="onInput"
    />
    <span v-if="suffix" class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-xs font-medium text-stone-500">{{ suffix }}</span>
  </div>
</template>
