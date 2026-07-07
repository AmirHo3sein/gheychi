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
