<script setup lang="ts">
import { computed } from 'vue'
import { formatDate } from '@/lib/dates'
import { daysToExpiry, expiryBucket } from '@/lib/stock'
import { useInventoryStore } from '@/stores/inventory'
import AppBadge from '@/components/ui/AppBadge.vue'

const props = defineProps<{ date: string | null; compact?: boolean }>()
const inv = useInventoryStore()

const bucket = computed(() => expiryBucket(props.date, inv.today))
const days = computed(() => daysToExpiry(props.date, inv.today))
const tone = computed(() => ({ expired: 'red', d30: 'red', d60: 'orange', d90: 'amber', ok: 'green', none: 'neutral' } as const)[bucket.value])
const label = computed(() => {
  const d = days.value
  if (d === null) return 'No expiry'
  if (d < 0) return `Expired ${-d}d ago`
  if (d === 0) return 'Expires today'
  return `${d}d left`
})
</script>

<template>
  <span class="inline-flex flex-wrap items-center gap-2">
    <span v-if="!compact && date" class="num text-[13px] text-stone-700">{{ formatDate(date) }}</span>
    <AppBadge :tone="tone" :dot="bucket !== 'none' && bucket !== 'ok'">{{ label }}</AppBadge>
  </span>
</template>
