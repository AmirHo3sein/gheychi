import { computed, ref } from 'vue'
import { useApi } from './useApi'
import type { SelectOption } from '@/components/ui/AppSelect.vue'

interface IranCity {
  name: string
  lat: number
  lng: number
}

// GET /cities is the backend-owned canonical Iranian-city list (apps/api/src/cities) --
// same shared-fetch-per-parent shape as useServiceCategories, for the same reason (avoid
// racing another onMounted fetch on the same mock/network queue). The endpoint also carries
// lat/lng per city (user-app's search page centers its map/radius on the selected city),
// but this app's own city field is name-only, so only `name` is used here.
export function useCities() {
  const { apiFetch } = useApi()
  const cities = ref<IranCity[]>([])
  const cityOptions = computed<SelectOption[]>(() => cities.value.map((c) => ({ value: c.name, label: c.name })))
  const loading = ref(true)
  const error = ref(false)

  async function load() {
    loading.value = true
    error.value = false
    const { data, error: fetchError } = await apiFetch<IranCity[]>('/cities', { silent: true })
    if (fetchError) {
      error.value = true
      loading.value = false
      return
    }
    cities.value = data ?? []
    loading.value = false
  }

  return { cities, cityOptions, loading, error, load }
}
