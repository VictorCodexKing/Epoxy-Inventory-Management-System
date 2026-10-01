<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: 'neutral' | 'green' | 'amber' | 'orange' | 'red' | 'blue' | 'dark'
    dot?: boolean
  }>(),
  { tone: 'neutral', dot: false },
)

const tones = {
  neutral: 'bg-stone-100 text-stone-700 ring-stone-200',
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  orange: 'bg-orange-50 text-orange-800 ring-orange-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  blue: 'bg-sky-50 text-sky-800 ring-sky-200',
  dark: 'bg-stone-900 text-stone-50 ring-stone-900',
}
const dots = {
  neutral: 'bg-stone-400',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
  blue: 'bg-sky-500',
  dark: 'bg-resin-400',
}
</script>

<template>
  <span :class="['inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', tones[tone]]">
    <span v-if="dot" :class="['size-1.5 rounded-full', dots[tone]]" aria-hidden="true" />
    <slot />
  </span>
</template>
