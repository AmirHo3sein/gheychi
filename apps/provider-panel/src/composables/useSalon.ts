import { ref } from 'vue'
import type { ApiError } from './useApi'
import { useApi } from './useApi'

export interface Salon {
  id: string
  name: string
  slug: string
  status: 'pending' | 'approved' | 'rejected' | 'suspended'
  genderTarget: 'women' | 'men'
  address: string
  city: string
  capacity: number
  rejectionReason: string | null
}

const salon = ref<Salon | null>(null)
const checked = ref(false)

export function useSalon() {
  const { apiFetch } = useApi()

  // Returns the ApiError when the fetch failed with something other than a 404 (a 404
  // legitimately means "no salon yet" and is not surfaced as an error), so callers that
  // want to give feedback on a failed manual refresh (e.g. PendingApprovalView's "بررسی
  // وضعیت" button) can do so -- existing callers that just `await refetch()` and ignore
  // the return value are unaffected.
  async function refetch(): Promise<{ error: ApiError | null }> {
    const { data, error } = await apiFetch<Salon>('/salons/mine', { silent: true, redirectOn401: false })
    if (error && error.status !== 404) {
      // A transient failure (network error, 500, etc.) isn't the same as "confirmed no
      // salon" -- leave salon.value as whatever it already was rather than nulling out a
      // possibly-still-valid previous fetch, so a flaky response can't bounce an already-
      // approved provider into onboarding. `checked` is deliberately left untouched too:
      // if this was the very first probe it stays false, so the router guard re-probes on
      // the next navigation instead of treating `salon: null` as a settled "no salon" for
      // the rest of the tab's session.
      return { error }
    }
    salon.value = data
    checked.value = true
    return { error: null }
  }

  return { salon, checked, refetch }
}

// Resets the module-level singleton state back to its initial values.
// Vitest only isolates modules per test FILE, not per individual test, so
// a test file with multiple it() blocks that each rely on a fresh refetch()
// (e.g. Task 11's router-guard tests) needs an explicit reset hook to call
// from beforeEach -- otherwise `checked` stays true after the first test
// and later tests silently reuse stale state.
export function resetSalon(): void {
  salon.value = null
  checked.value = false
}
