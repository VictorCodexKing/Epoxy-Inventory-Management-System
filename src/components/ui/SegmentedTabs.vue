<script setup lang="ts" generic="T extends string">
defineProps<{ modelValue: T; options: Array<{ value: T; label: string; count?: number }> }>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
</script>

<template>
  <div class="inline-flex rounded-lg bg-stone-200/70 p-0.5" role="tablist">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="tab"
      :aria-selected="modelValue === o.value"
      :class="[
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition',
        modelValue === o.value ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900',
      ]"
      @click="emit('update:modelValue', o.value)"
    >
      {{ o.label }}
      <span v-if="o.count !== undefined" class="num rounded bg-stone-100 px-1.5 text-[11px] text-stone-500">{{ o.count }}</span>
    </button>
  </div>
</template>
