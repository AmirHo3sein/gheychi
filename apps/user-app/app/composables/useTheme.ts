export type ThemePreference = 'light' | 'dark' | 'system'

export function useTheme() {
  const preference = useCookie<ThemePreference>('theme', { default: () => 'system' })
  // The OS scheme, known only in the browser. It starts false on both sides and is filled in by
  // watchSystemScheme() after mount: reading matchMedia during the hydrating render would make
  // the client's first render differ from the server's (a hydration mismatch on the toggle's
  // icon/title whenever the OS is dark and no theme cookie is set). The page colours are not
  // affected -- the inline anti-flash script in nuxt.config.ts has already set the .dark class.
  const systemDark = useState('theme-system-dark', () => false)

  // Mirrors provider-panel's useTheme.ts isDark computed -- the header toggle only ever
  // flips between explicit 'light'/'dark' (see toggle() below), but 'system' remains the
  // default preference value until a user first touches it, so this still has to resolve it.
  const isDark = computed(() => preference.value === 'dark' || (preference.value === 'system' && systemDark.value))

  /** Call from onMounted; returns the cleanup for onBeforeUnmount. Tracks OS scheme changes too. */
  function watchSystemScheme(): () => void {
    if (import.meta.server) return () => {}
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => {
      systemDark.value = mq.matches
      apply()
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }

  function apply() {
    if (import.meta.server) return
    // Keep this dark-mode decision rule in sync with the inline anti-flash script
    // registered in nuxt.config.ts (app.head.script) -- that script duplicates this
    // logic to apply the class before first paint, before Vue/this composable exists.
    document.documentElement.classList.toggle('dark', isDark.value)
  }

  function setPreference(pref: ThemePreference) {
    preference.value = pref
    apply()
  }

  // Single-button header toggle, matching provider-panel's AppLayout.vue: flips between
  // explicit light/dark only, never sets 'system' -- that value stays reachable only as the
  // untouched default, not as a UI destination this button cycles through.
  function toggle() {
    setPreference(isDark.value ? 'light' : 'dark')
  }

  return { preference, isDark, setPreference, toggle, apply, watchSystemScheme }
}
