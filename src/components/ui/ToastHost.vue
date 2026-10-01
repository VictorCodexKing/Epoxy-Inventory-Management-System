<script setup lang="ts">
import { CircleCheck, Info, TriangleAlert, X } from 'lucide-vue-next'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const icons = { success: CircleCheck, error: TriangleAlert, info: Info }
const iconTone = { success: 'text-emerald-400', error: 'text-red-400', info: 'text-sky-300' }
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6" aria-live="polite">
    <TransitionGroup
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="translate-y-2 opacity-0"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-for="t in ui.toasts"
        :key="t.id"
        class="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl bg-stone-900 px-4 py-3 text-sm text-stone-100 shadow-xl ring-1 ring-white/10"
        :role="t.tone === 'error' ? 'alert' : 'status'"
      >
        <component :is="icons[t.tone]" :class="['mt-0.5 size-4 shrink-0', iconTone[t.tone]]" />
        <div class="min-w-0 flex-1">
          <p class="font-medium">{{ t.title }}</p>
          <p v-if="t.message" class="mt-0.5 text-stone-300">{{ t.message }}</p>
        </div>
        <button type="button" class="-mr-1 rounded p-0.5 text-stone-400 hover:text-white" aria-label="Dismiss" @click="ui.dismiss(t.id)">
          <X class="size-4" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
