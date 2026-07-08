// apps/admin-panel/src/composables/useTheme.ts
// Mirrors user-app's useTheme.ts (same preference model, same .dark class mechanism), but
// backed by localStorage instead of a cookie since this is a plain SPA with no SSR to
// coordinate with. Kept as its own copy per this repo's cross-app isolation convention.
import { computed, ref, watch } from 'vue'

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'admin-theme'
const preference = ref<ThemePreference>((localStorage.getItem(STORAGE_KEY) as ThemePreference | null) ?? 'system')
const isDark = computed(
  () => preference.value === 'dark' || (preference.value === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches),
)

function apply() {
  document.documentElement.classList.toggle('dark', isDark.value)
}

watch(preference, (pref) => {
  localStorage.setItem(STORAGE_KEY, pref)
  apply()
})

apply()

export function useTheme() {
  function setPreference(pref: ThemePreference) {
    preference.value = pref
  }

  return { preference, isDark, setPreference }
}
