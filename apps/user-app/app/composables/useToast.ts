export interface Toast {
  id: number
  message: string
}

export function useToast() {
  // A module-level ref would be a single Node-process-wide singleton -- under SSR that
  // means one request's error toast could leak into a concurrent request's response.
  // useState is Nuxt's request-scoped equivalent (backed by nuxtApp.payload.state), so
  // each request/client gets its own array, while still behaving like a ref after hydration.
  const toasts = useState<Toast[]>('toasts', () => [])

  function push(message: string) {
    // Avoids a shared module-level counter, which would have the same cross-request
    // scoping issue as the old module-level `toasts` ref (harmless here since it only
    // affects id uniqueness, but not worth reintroducing).
    const id = Date.now() + Math.random()
    toasts.value.push({ id, message })
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, 5000)
  }

  return { toasts, push }
}
