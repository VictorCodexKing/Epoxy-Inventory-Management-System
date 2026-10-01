<script setup lang="ts">
defineProps<{
  label: string
  for?: string
  hint?: string
  error?: string | null
  optional?: boolean
}>()
</script>

<template>
  <div class="min-w-0">
    <label :for="$props.for" class="mb-1.5 flex items-baseline justify-between gap-2 text-[13px] font-medium text-stone-700">
      <span>{{ label }}</span>
      <span v-if="optional" class="text-xs font-normal text-stone-400">Optional</span>
    </label>
    <slot />
    <p v-if="error" class="mt-1.5 text-xs text-red-600">{{ error }}</p>
    <p v-else-if="hint" class="mt-1.5 text-xs text-stone-500">{{ hint }}</p>
  </div>
</template>
