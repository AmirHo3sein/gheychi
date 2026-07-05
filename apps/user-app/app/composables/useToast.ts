export interface Toast {
  id: number
  message: string
}

const toasts = ref<Toast[]>([])
let nextId = 1

export function useToast() {
  function push(message: string) {
    const id = nextId++
    toasts.value.push({ id, message })
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, 5000)
  }

  return { toasts, push }
}
