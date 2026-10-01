<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CalendarDays } from 'lucide-vue-next'
import { formatDate, isValidBusinessDate } from '@/lib/dates'

/**
 * Date field that always reads and writes DD/MM/YYYY, regardless of the browser's locale
 * (native <input type="date"> follows the OS locale and can show MM/DD/YYYY).
 * v-model is `YYYY-MM-DD` or `''` when empty / incomplete / out of range.
 */
const props = defineProps<{
  modelValue: string
  id?: string
  min?: string
  max?: string
  invalid?: boolean
  ariaLabel?: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  /** false while the field contains text that is not a valid date in range (so optional fields can block saving) */
  'update:valid': [valid: boolean]
}>()

const text = ref(props.modelValue ? formatDate(props.modelValue) : '')
const touched = ref(false)
const picker = ref<HTMLInputElement | null>(null)

watch(
  () => props.modelValue,
  (v) => {
    if (v !== parse(text.value)) text.value = v ? formatDate(v) : ''
  },
)

function parse(raw: string): string {
  const m = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\s*$/.exec(raw)
  if (!m) return ''
  const iso = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`
  if (!isValidBusinessDate(iso)) return ''
  if (props.min && iso < props.min) return ''
  if (props.max && iso > props.max) return ''
  return iso
}

const problem = computed(() => {
  if (!touched.value || !text.value.trim()) return null
  const m = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\s*$/.exec(text.value)
  if (!m) return 'Use DD/MM/YYYY'
  const iso = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`
  if (!isValidBusinessDate(iso)) return 'Not a real date'
  if (props.min && iso < props.min) return `On or after ${formatDate(props.min)}`
  if (props.max && iso > props.max) return `On or before ${formatDate(props.max)}`
  return null
})

function publish() {
  const iso = parse(text.value)
  emit('update:modelValue', iso)
  emit('update:valid', !text.value.trim() || iso !== '')
}

function onInput(e: Event) {
  text.value = (e.target as HTMLInputElement).value
  publish()
}

function onBlur() {
  touched.value = true
  const iso = parse(text.value)
  if (iso) text.value = formatDate(iso) // normalise 1/2/2026 → 01/02/2026
}

function openPicker() {
  const el = picker.value
  if (!el) return
  try {
    el.showPicker()
  } catch {
    el.focus()
  }
}

function onPick(e: Event) {
  const v = (e.target as HTMLInputElement).value
  text.value = v ? formatDate(v) : ''
  touched.value = true
  publish()
}
</script>

<template>
  <div>
    <div class="relative">
      <input
        :id="id"
        :value="text"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        placeholder="DD/MM/YYYY"
        maxlength="10"
        :aria-label="ariaLabel"
        :aria-invalid="invalid || !!problem || undefined"
        class="input num pr-10"
        @input="onInput"
        @blur="onBlur"
      />
      <button
        type="button"
        class="absolute inset-y-0 right-0 grid w-10 place-items-center text-stone-400 hover:text-stone-700"
        aria-label="Open calendar"
        tabindex="-1"
        @click="openPicker"
      >
        <CalendarDays class="size-4" />
      </button>
      <input
        ref="picker"
        type="date"
        :value="modelValue"
        :min="min"
        :max="max"
        tabindex="-1"
        aria-hidden="true"
        class="pointer-events-none absolute right-0 bottom-0 h-0 w-0 opacity-0"
        @change="onPick"
      />
    </div>
    <p v-if="problem" class="mt-1 text-xs text-red-600">{{ problem }}</p>
  </div>
</template>
