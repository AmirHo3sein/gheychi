import { ref } from 'vue'

export type ToastTone = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  message: string
  tone: ToastTone
}

// An error carries the information the owner has to act on, so it stays longer than a
// confirmation they only need to glimpse.
const DURATION_MS: Record<ToastTone, number> = { success: 4000, info: 5000, error: 8000 }

const toasts = ref<Toast[]>([])
let counter = 0

export function useToast() {
  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  // `tone` is optional so every existing `push(message)` call keeps working (as 'info').
  function push(message: string, tone: ToastTone = 'info') {
    const id = counter++
    toasts.value.push({ id, message, tone })
    setTimeout(() => dismiss(id), DURATION_MS[tone])
  }

  return { toasts, push, dismiss }
}

// Resets the module-level singleton state back to its initial value.
// Vitest only isolates modules per test FILE, not per individual test, so a
// test file with multiple it() blocks that each assert on the toast queue
// (e.g. ToastContainer.spec.ts) needs an explicit reset hook to call from
// beforeEach -- otherwise toasts pushed by an earlier test (or left over
// from the auto-dismiss timer not yet firing) leak into a later one.
// Mirrors resetSalon() in useSalon.ts.
export function resetToast(): void {
  toasts.value = []
}
