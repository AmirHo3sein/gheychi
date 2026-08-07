import { computed, ref } from 'vue'
import { useApi } from './useApi'
import type { SelectOption } from '@/components/ui/AppSelect.vue'

// Shared by every screen that needs the GET /categories catalog for a picker --
// SalonInfoStep's callers (OnboardingView, SalonSettingsView) own their own instance
// of this rather than SalonInfoStep fetching internally, specifically so a screen that
// ALSO fetches its own primary data (e.g. SalonSettingsView's GET /salons/mine) doesn't
// race two independent onMounted fetches against each other.
export function useServiceCategories() {
  const { apiFetch } = useApi()
  const categories = ref<{ id: number; name: string; icon: string }[]>([])
  const categoryOptions = computed<SelectOption[]>(() => categories.value.map((c) => ({ value: c.id, label: c.name })))
  const loading = ref(true)
  const error = ref(false)

  async function load() {
    loading.value = true
    error.value = false
    const { data, error: fetchError } = await apiFetch<{ id: number; name: string; icon: string }[]>('/categories', {
      silent: true,
    })
    if (fetchError) {
      error.value = true
      loading.value = false
      return
    }
    categories.value = data ?? []
    loading.value = false
  }

  return { categories, categoryOptions, loading, error, load }
}
