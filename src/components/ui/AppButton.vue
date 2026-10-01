<script setup lang="ts">
import { computed, type Component } from 'vue'

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark'
    size?: 'sm' | 'md'
    type?: 'button' | 'submit'
    loading?: boolean
    disabled?: boolean
    icon?: Component
    block?: boolean
  }>(),
  { variant: 'secondary', size: 'md', type: 'button', loading: false, disabled: false, block: false },
)

const classes = computed(() => [
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition select-none',
  'disabled:cursor-not-allowed disabled:opacity-50',
  props.size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-10 px-4 text-sm',
  props.block ? 'w-full' : '',
  {
    primary: 'bg-resin-500 text-stone-950 shadow-sm shadow-resin-900/10 hover:bg-resin-400 active:bg-resin-600',
    secondary: 'border border-stone-300 bg-white text-stone-800 shadow-xs hover:border-stone-400 hover:bg-stone-50',
    ghost: 'text-stone-600 hover:bg-stone-100 hover:text-stone-900',
    danger: 'bg-red-600 text-white shadow-sm hover:bg-red-500 active:bg-red-700',
    dark: 'bg-stone-900 text-white shadow-sm hover:bg-stone-800 active:bg-stone-950',
  }[props.variant],
])
</script>

<template>
  <button :type="type" :class="classes" :disabled="disabled || loading" :aria-busy="loading || undefined">
    <svg v-if="loading" class="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity="0.25" stroke-width="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
    </svg>
    <component :is="icon" v-else-if="icon" class="size-4 shrink-0" aria-hidden="true" />
    <slot />
  </button>
</template>
