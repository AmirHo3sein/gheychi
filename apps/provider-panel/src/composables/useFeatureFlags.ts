import { ref } from 'vue'
import { useApi } from './useApi'

export interface FeatureFlags {
  reviewsEnabled: boolean
  storiesEnabled: boolean
  portfolioEnabled: boolean
  referralsEnabled: boolean
  couponsEnabled: boolean
  onlinePaymentEnabled: boolean
}

// Fails open (all true) rather than hiding every gated feature on a transient network
// blip -- the API is the real enforcement point (see its own doc comments on each gated
// endpoint), this composable only controls what the UI offers/explains.
const DEFAULT_FLAGS: FeatureFlags = {
  reviewsEnabled: true,
  storiesEnabled: true,
  portfolioEnabled: true,
  referralsEnabled: true,
  couponsEnabled: true,
  onlinePaymentEnabled: true,
}

const flags = ref<FeatureFlags>({ ...DEFAULT_FLAGS })
const loaded = ref(false)

export function useFeatureFlags() {
  const { apiFetch } = useApi()

  async function ensureLoaded(): Promise<void> {
    if (loaded.value) return
    // Public, unauthenticated endpoint -- redirectOn401: false so a stray/unexpected
    // error status here can never trigger an auth-related side effect as a byproduct of
    // fetching unrelated feature flags.
    const { data } = await apiFetch<FeatureFlags>('/platform-config/feature-flags', {
      silent: true,
      redirectOn401: false,
    })
    if (data) flags.value = data
    loaded.value = true
  }

  return { flags, ensureLoaded }
}

// Resets the module-level singleton state -- same reasoning/precedent as useSalon.ts's
// own resetFeatureFlags-equivalent (resetSalon): Vitest isolates modules per test FILE,
// not per it(), so a multi-test file needs this in beforeEach for a fresh ensureLoaded().
export function resetFeatureFlags(): void {
  flags.value = { ...DEFAULT_FLAGS }
  loaded.value = false
}
