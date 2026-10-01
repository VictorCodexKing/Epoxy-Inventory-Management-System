<script setup lang="ts">
import { computed } from 'vue'
import { formatQty } from '@/lib/format'
import { packagingBreakdown } from '@/lib/packaging'
import type { Material } from '@/types/models'

const props = defineProps<{ quantity: number; material: Material | undefined; breakdown?: boolean; strong?: boolean }>()
const pack = computed(() => (props.breakdown && props.material ? packagingBreakdown(props.material, props.quantity) : null))
</script>

<template>
  <span class="inline-flex flex-col leading-tight">
    <span :class="['num whitespace-nowrap', strong ? 'font-semibold text-stone-900' : 'text-stone-800']">
      {{ material ? formatQty(quantity, material.baseUnit) : quantity }}
    </span>
    <span v-if="pack" class="mt-0.5 text-[11px] whitespace-nowrap text-stone-500">{{ pack }}</span>
  </span>
</template>
