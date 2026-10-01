import { defineStore } from 'pinia'
import { ref } from 'vue'
import { AppError } from '@/services/backend/types'

export type ToastTone = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  tone: ToastTone
  title: string
  message?: string
}

export interface ConfirmRequest {
  title: string
  message: string
  confirmLabel?: string
  tone?: 'danger' | 'default'
  /** When set, the user must type a reason (used for voids). */
  requireReason?: boolean
  reasonLabel?: string
}

interface PendingConfirm extends ConfirmRequest {
  resolve: (value: { confirmed: boolean; reason: string }) => void
}

export function errorMessage(e: unknown): string {
  if (e instanceof AppError) return e.message
  if (e instanceof Error) return e.message || 'Something went wrong.'
  return 'Something went wrong.'
}

export const useUiStore = defineStore('ui', () => {
  const toasts = ref<Toast[]>([])
  const confirmState = ref<PendingConfirm | null>(null)
  let seq = 0

  function toast(tone: ToastTone, title: string, message?: string) {
    const id = ++seq
    toasts.value.push({ id, tone, title, message })
    setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4000)
  }

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  function confirm(req: ConfirmRequest): Promise<{ confirmed: boolean; reason: string }> {
    return new Promise((resolve) => {
      confirmState.value?.resolve({ confirmed: false, reason: '' })
      confirmState.value = { ...req, resolve }
    })
  }

  function settleConfirm(confirmed: boolean, reason = '') {
    const c = confirmState.value
    confirmState.value = null
    c?.resolve({ confirmed, reason })
  }

  /** Run an action with consistent success/error feedback. Returns true on success. */
  async function run(action: () => Promise<unknown>, successTitle?: string, successMessage?: string): Promise<boolean> {
    try {
      await action()
      if (successTitle) toast('success', successTitle, successMessage)
      return true
    } catch (e) {
      if (!(e instanceof AppError)) console.error(e)
      toast('error', 'Could not save', errorMessage(e))
      return false
    }
  }

  return { toasts, confirmState, toast, dismiss, confirm, settleConfirm, run }
})
