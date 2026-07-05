export type ThemePreference = 'light' | 'dark' | 'system'

export function useTheme() {
  const preference = useCookie<ThemePreference>('theme', { default: () => 'system' })

  function apply() {
    if (import.meta.server) return
    const isDark =
      preference.value === 'dark' ||
      (preference.value === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', isDark)
  }

  function setPreference(pref: ThemePreference) {
    preference.value = pref
    apply()
  }

  return { preference, setPreference, apply }
}
