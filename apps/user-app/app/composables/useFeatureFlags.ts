export interface FeatureFlags {
  reviewsEnabled: boolean
  storiesEnabled: boolean
  portfolioEnabled: boolean
  referralsEnabled: boolean
  couponsEnabled: boolean
}

// Fails open (all true) rather than hiding every gated feature platform-wide on a
// transient network blip -- the backend is the real enforcement point (see the API's
// own doc comments on each gated endpoint), this composable only controls what the UI
// offers to click into.
const DEFAULT_FLAGS: FeatureFlags = {
  reviewsEnabled: true,
  storiesEnabled: true,
  portfolioEnabled: true,
  referralsEnabled: true,
  couponsEnabled: true,
}

// Exported so a test can reset this shared useState ref between cases (useState has no
// built-in $reset() the way this app's one Pinia store does -- see auth.global.spec.ts).
export const FEATURE_FLAGS_STATE_KEY = 'feature-flags'
export const FEATURE_FLAGS_LOADED_STATE_KEY = 'feature-flags-loaded'

// useState (not a plain module-level ref) so this is SSR-safe and deduped: every
// component calling useFeatureFlags() within the same request/page load shares one
// fetch instead of firing N parallel requests for the same public, rarely-changing data.
export function useFeatureFlags() {
  const flags = useState<FeatureFlags>(FEATURE_FLAGS_STATE_KEY, () => ({ ...DEFAULT_FLAGS }))
  const loaded = useState(FEATURE_FLAGS_LOADED_STATE_KEY, () => false)

  async function ensureLoaded() {
    if (loaded.value) return
    const { apiFetch } = useApi()
    // This is a public, unauthenticated endpoint -- redirectOn401: false so a stray/
    // unexpected error status here can never trigger an auth-related side effect
    // (navigateTo('/login')) as a side effect of fetching unrelated feature flags.
    const { data } = await apiFetch<FeatureFlags>('/platform-config/feature-flags', {
      silent: true,
      redirectOn401: false,
    })
    if (data) flags.value = data
    loaded.value = true
  }

  return { flags, ensureLoaded }
}
