<script setup lang="ts">
import { computed } from 'vue'
import type { PaymentStatus, POStatus, SaleStatus, TransferStatus } from '@/types/models'
import AppBadge from '@/components/ui/AppBadge.vue'

const props = defineProps<{ status: PaymentStatus | POStatus | SaleStatus | TransferStatus; kind: 'payment' | 'po' | 'record' }>()

const map = computed(() => {
  if (props.kind === 'payment') {
    return {
      unpaid: { tone: 'red', label: 'Unpaid' },
      partial: { tone: 'amber', label: 'Partial' },
      paid: { tone: 'green', label: 'Paid' },
    } as Record<string, { tone: 'red' | 'amber' | 'green' | 'neutral' | 'blue' | 'dark'; label: string }>
  }
  if (props.kind === 'po') {
    return {
      ordered: { tone: 'blue', label: 'Ordered' },
      partially_received: { tone: 'amber', label: 'Part received' },
      received: { tone: 'green', label: 'Received' },
      void: { tone: 'neutral', label: 'Void' },
    } as Record<string, { tone: 'red' | 'amber' | 'green' | 'neutral' | 'blue' | 'dark'; label: string }>
  }
  return {
    completed: { tone: 'green', label: 'Completed' },
    void: { tone: 'neutral', label: 'Void' },
  } as Record<string, { tone: 'red' | 'amber' | 'green' | 'neutral' | 'blue' | 'dark'; label: string }>
})
const entry = computed(() => map.value[props.status] ?? { tone: 'neutral' as const, label: props.status })
</script>

<template>
  <AppBadge :tone="entry.tone" dot>{{ entry.label }}</AppBadge>
</template>
