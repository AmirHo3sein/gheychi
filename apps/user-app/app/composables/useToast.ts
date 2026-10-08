export type ToastTone = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  message: string
  tone: ToastTone
}

// An error toast is read while the user is mid-task, so it stays longer than a passing
// confirmation. All are dismissible (ToastStack renders a close button) so none has to be
// waited out.
const DURATION_MS: Record<ToastTone, number> = { info: 5000, success: 4000, error: 8000 }

export function useToast() {
  // A module-level ref would be a single Node-process-wide singleton -- under SSR that
  // means one request's error toast could leak into a concurrent request's response.
  // useState is Nuxt's request-scoped equivalent (backed by nuxtApp.payload.state), so
  // each request/client gets its own array, while still behaving like a ref after hydration.
  const toasts = useState<Toast[]>('toasts', () => [])

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  // `tone` is optional so every existing `push(message)` call keeps working unchanged.
  function push(message: string, tone: ToastTone = 'info') {
    // Avoids a shared module-level counter, which would have the same cross-request
    // scoping issue as the old module-level `toasts` ref (harmless here since it only
    // affects id uniqueness, but not worth reintroducing).
    const id = Date.now() + Math.random()
    toasts.value.push({ id, message, tone })
    setTimeout(() => dismiss(id), DURATION_MS[tone])
  }

  return { toasts, push, dismiss }
}
