<script setup lang="ts">
import type { Component } from 'vue'
defineProps<{ title: string; description?: string; icon?: Component }>()
</script>

<template>
  <div class="flex flex-col items-center justify-center px-6 py-14 text-center">
    <div v-if="icon" class="mb-4 grid size-11 place-items-center rounded-xl bg-stone-100 text-stone-500 ring-1 ring-stone-200">
      <component :is="icon" class="size-5" />
    </div>
    <p class="text-sm font-semibold text-stone-800">{{ title }}</p>
    <p v-if="description" class="mt-1 max-w-sm text-sm text-stone-500">{{ description }}</p>
    <div v-if="$slots.default" class="mt-5"><slot /></div>
  </div>
</template>
