export type ThemePreference = 'light' | 'dark' | 'system'

export function useTheme() {
  const preference = useCookie<ThemePreference>('theme', { default: () => 'system' })

  function apply() {
    if (import.meta.server) return
    // Keep this dark-mode decision rule in sync with the inline anti-flash script
    // registered in nuxt.config.ts (app.head.script) -- that script duplicates this
    // logic to apply the class before first paint, before Vue/this composable exists.
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
