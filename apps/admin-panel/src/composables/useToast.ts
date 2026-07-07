import { ref } from 'vue'

export interface Toast {
  id: number
  message: string
}

const toasts = ref<Toast[]>([])
let counter = 0

export function useToast() {
  function push(message: string) {
    const id = counter++
    toasts.value.push({ id, message })
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, 5000)
  }

  return { toasts, push }
}

// Resets the module-level singleton state back to its initial value.
// Vitest only isolates modules per test FILE, not per individual test, so a
// test file with multiple it() blocks that each assert on the toast queue
// needs an explicit reset hook to call from beforeEach -- otherwise toasts
// pushed by an earlier test leak into a later one. Mirrors resetSalon() in
// provider-panel's useSalon.ts.
export function resetToast(): void {
  toasts.value = []
}
