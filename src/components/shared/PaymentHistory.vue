<script setup lang="ts">
import { Ban } from 'lucide-vue-next'
import { formatDate, formatDateTime } from '@/lib/dates'
import { formatMYR } from '@/lib/format'
import type { PaymentEntry } from '@/types/models'
import AppButton from '@/components/ui/AppButton.vue'

defineProps<{ payments: PaymentEntry[]; canVoid: boolean; emptyLabel: string }>()
const emit = defineEmits<{ void: [payment: PaymentEntry] }>()
</script>

<template>
  <ul v-if="payments.length" class="divide-y divide-stone-100 rounded-xl border border-stone-200">
    <li v-for="p in payments" :key="p.id" class="flex items-center gap-3 px-4 py-3" :class="p.voided ? 'bg-stone-50 text-stone-400' : ''">
      <div class="min-w-0 flex-1">
        <p class="num text-sm font-medium" :class="p.voided ? 'line-through' : 'text-stone-900'">{{ formatMYR(p.amount) }}</p>
        <p class="truncate text-xs text-stone-500">
          {{ formatDate(p.date) }}<template v-if="p.reference"> · {{ p.reference }}</template><template v-if="p.note"> · {{ p.note }}</template>
        </p>
        <p class="truncate text-[11px] text-stone-400">
          Recorded {{ formatDateTime(p.recordedAt) }} by {{ p.recordedBy }}
          <template v-if="p.voided"> · voided {{ formatDateTime(p.voidedAt) }} by {{ p.voidedBy }}</template>
        </p>
      </div>
      <AppButton v-if="canVoid && !p.voided" size="sm" variant="ghost" :icon="Ban" @click="emit('void', p)">Void</AppButton>
    </li>
  </ul>
  <p v-else class="rounded-xl border border-dashed border-stone-200 px-4 py-6 text-center text-sm text-stone-500">{{ emptyLabel }}</p>
</template>
