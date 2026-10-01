<script lang="ts">
// Shared across all modal instances so nested dialogs don't unlock page scroll while a parent is open.
let openModals = 0
function lockScroll() {
  openModals++
  document.body.style.overflow = 'hidden'
}
function unlockScroll() {
  openModals = Math.max(0, openModals - 1)
  if (openModals === 0) document.body.style.overflow = ''
}
</script>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    subtitle?: string
    size?: 'sm' | 'md' | 'lg' | 'xl'
    /** Prevent closing via backdrop / Esc (e.g. while saving) */
    persistent?: boolean
    /** `top` renders above every other modal (used by confirmation dialogs) */
    layer?: 'base' | 'top'
  }>(),
  { size: 'md', persistent: false, layer: 'base' },
)
const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)
let previouslyFocused: HTMLElement | null = null
let locked = false

function close() {
  if (!props.persistent) emit('close')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    close()
  } else if (e.key === 'Tab' && panel.value) {
    // Simple focus trap
    const focusable = panel.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    if (focusable.length === 0) return
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open && !locked) {
      locked = true
      previouslyFocused = document.activeElement as HTMLElement | null
      lockScroll()
      await nextTick()
      const target = panel.value?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button:not([data-close])')
      ;(target ?? panel.value)?.focus()
    } else if (!open && locked) {
      locked = false
      unlockScroll()
      previouslyFocused?.focus?.()
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (locked) unlockScroll()
})

const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        :class="['fixed inset-0 flex items-end justify-center p-0 sm:items-center sm:p-6', layer === 'top' ? 'z-[70]' : 'z-50']"
        @keydown="onKey"
      >
        <div class="absolute inset-0 bg-stone-950/50 backdrop-blur-[2px]" aria-hidden="true" @click="close" />
        <div
          ref="panel"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          tabindex="-1"
          :class="[
            'relative flex max-h-[94vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl ring-1 ring-stone-900/10 outline-none sm:rounded-2xl',
            widths[size],
          ]"
        >
          <header class="flex items-start justify-between gap-4 border-b border-stone-100 px-5 py-4 sm:px-6">
            <div class="min-w-0">
              <h2 class="text-base font-semibold text-stone-900">{{ title }}</h2>
              <p v-if="subtitle" class="mt-0.5 text-sm text-stone-500">{{ subtitle }}</p>
            </div>
            <button
              data-close
              type="button"
              class="-mr-1.5 rounded-md p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 disabled:opacity-40"
              :disabled="persistent"
              aria-label="Close"
              @click="close"
            >
              <X class="size-5" />
            </button>
          </header>
          <div class="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            <slot />
          </div>
          <footer
            v-if="$slots.footer"
            class="flex flex-wrap items-center justify-end gap-2 border-t border-stone-100 bg-stone-50/60 px-5 py-3.5 sm:rounded-b-2xl sm:px-6"
          >
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
