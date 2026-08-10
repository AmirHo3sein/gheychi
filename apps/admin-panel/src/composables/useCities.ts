// apps/admin-panel/src/composables/useCities.ts
import { computed, ref } from 'vue'
import { useApi } from './useApi'
import type { SelectOption } from '@/components/ui/AppSelect.vue'

interface IranCity {
  name: string
  lat: number
  lng: number
}

// GET /cities is the backend-owned canonical Iranian-city list (apps/api/src/cities) --
// same live-fetch this endpoint gets in provider-panel's own useCities (see that file's
// comment for the full rationale). admin-panel used to keep a hand-maintained static copy
// of this list (utils/cities.ts) that could silently drift from the backend; SalonsView's
// city filter now fetches it live instead, per this repo's cross-app isolation convention
// (each app owns its own copy of this composable rather than sharing one across apps).
// The endpoint also carries lat/lng per city, unused here since the filter is name-only.
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
