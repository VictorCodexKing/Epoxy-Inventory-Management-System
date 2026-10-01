<script setup lang="ts">
withDefaults(defineProps<{ rows?: number }>(), { rows: 4 })
</script>

<template>
  <div class="animate-pulse space-y-3 p-5" aria-busy="true" aria-label="Loading">
    <div v-for="i in rows" :key="i" class="h-4 rounded bg-stone-200/80" :style="{ width: `${92 - ((i * 17) % 40)}%` }" />
  </div>
</template>
