import { ref } from 'vue'

export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 'danger' styles the confirm button destructively (deletes, cancellations). */
  tone?: 'danger' | 'default'
}

interface PendingConfirm {
  options: ConfirmOptions
  resolve: (ok: boolean) => void
}

// Module-level singleton, rendered once by <ConfirmSheet /> in AppLayout. Only one prompt
// can be open at a time; a second request while one is open settles the first as "cancel".
const pending = ref<PendingConfirm | null>(null)

/**
 * Promise-based replacement for `window.confirm`:
 *   const ok = await confirm({ title: 'حذف خدمت؟', tone: 'danger', confirmLabel: 'حذف' })
 */
export function useConfirm() {
  function confirm(options: ConfirmOptions): Promise<boolean> {
    pending.value?.resolve(false)
    return new Promise<boolean>((resolve) => {
      pending.value = { options, resolve }
    })
  }

  function settle(ok: boolean) {
    const current = pending.value
    if (!current) return
    pending.value = null
    current.resolve(ok)
  }

  return { confirm, settle, pending }
}

// Test hook: the singleton outlives a single it() block (see resetToast()).
export function resetConfirm(): void {
  pending.value?.resolve(false)
  pending.value = null
}
