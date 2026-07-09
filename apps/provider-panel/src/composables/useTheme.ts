import { computed, ref, watch } from 'vue'

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'provider-theme'

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
