import { ref } from 'vue'
import { useApi } from './useApi'

export interface Salon {
  id: string
  name: string
  slug: string
  status: 'pending' | 'approved' | 'suspended'
  genderTarget: 'women' | 'men'
  address: string
  city: string
  capacity: number
}

const salon = ref<Salon | null>(null)
const checked = ref(false)

export function useSalon() {
  const { apiFetch } = useApi()

  async function refetch(): Promise<void> {
    const { data } = await apiFetch<Salon>('/salons/mine', { silent: true, redirectOn401: false })
    salon.value = data
    checked.value = true
  }

  return { salon, checked, refetch }
}

// Resets the module-level singleton state back to its initial values.
// Vitest only isolates modules per test FILE, not per individual test, so
// a test file with multiple it() blocks that each rely on a fresh refetch()
// (e.g. Task 11's router-guard tests) needs an explicit reset hook to call
// from beforeEach -- otherwise `checked` stays true after the first test
// and later tests silently reuse stale state.
export function resetSalon(): void {
  salon.value = null
  checked.value = false
}
