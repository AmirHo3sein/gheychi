import { ref } from 'vue'

export type ToastTone = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  message: string
  tone: ToastTone
}

// Errors linger longer: they are the ones a person needs time to read, and a failed save they
// missed is a silent data-loss risk. `info` keeps the original 5 s so untoned callers behave
// exactly as before.
const DURATION_MS: Record<ToastTone, number> = { success: 4000, info: 5000, error: 8000 }

const toasts = ref<Toast[]>([])
const timers = new Map<number, ReturnType<typeof setTimeout>>()
let counter = 0

export function useToast() {
  // `tone` is optional so every pre-existing `push(message)` call site keeps working.
  function push(message: string, tone: ToastTone = 'info') {
    const id = counter++
    toasts.value.push({ id, message, tone })
    timers.set(id, setTimeout(() => dismiss(id), DURATION_MS[tone]))
  }

  function dismiss(id: number) {
    const timer = timers.get(id)
    if (timer !== undefined) clearTimeout(timer)
    timers.delete(id)
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  return { toasts, push, dismiss }
}

// Resets the module-level singleton state back to its initial value.
// Vitest only isolates modules per test FILE, not per individual test, so a
// test file with multiple it() blocks that each assert on the toast queue
// needs an explicit reset hook to call from beforeEach -- otherwise toasts
// pushed by an earlier test leak into a later one. Mirrors resetSalon() in
// provider-panel's useSalon.ts.
export function resetToast(): void {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  toasts.value = []
}
