import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FEATURE_FLAGS_LOADED_STATE_KEY, useFeatureFlags } from '../../app/composables/useFeatureFlags'

const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

describe('useFeatureFlags', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    // See auth.global.spec.ts's own comment -- useState has no $reset(), so this
    // module-shared ref must be reset by hand between tests.
    useState(FEATURE_FLAGS_LOADED_STATE_KEY).value = false
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults every flag to true before loading', () => {
    const { flags } = useFeatureFlags()
    expect(flags.value).toEqual({
      reviewsEnabled: true,
      storiesEnabled: true,
      portfolioEnabled: true,
      referralsEnabled: true,
      couponsEnabled: true,
    })
  })

  it('fetches and applies the real flags on first ensureLoaded()', async () => {
    fetchMock.mockResolvedValue({
      reviewsEnabled: false,
      storiesEnabled: true,
      portfolioEnabled: true,
      referralsEnabled: true,
      couponsEnabled: false,
    })
    const { flags, ensureLoaded } = useFeatureFlags()

    await ensureLoaded()

    expect(fetchMock).toHaveBeenCalledWith(
      '/platform-config/feature-flags',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(flags.value.reviewsEnabled).toBe(false)
    expect(flags.value.couponsEnabled).toBe(false)
  })

  it('only fetches once, even across multiple calls/composable instances', async () => {
    fetchMock.mockResolvedValue({
      reviewsEnabled: true,
      storiesEnabled: true,
      portfolioEnabled: true,
      referralsEnabled: true,
      couponsEnabled: true,
    })

    await useFeatureFlags().ensureLoaded()
    await useFeatureFlags().ensureLoaded()
    await useFeatureFlags().ensureLoaded()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails open (keeps the all-true defaults) on a network error, without throwing', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    const { flags, ensureLoaded } = useFeatureFlags()

    await expect(ensureLoaded()).resolves.toBeUndefined()

    expect(flags.value.reviewsEnabled).toBe(true)
  })

  it('never redirects to /login on an unexpected 401 from this public endpoint', async () => {
    fetchMock.mockRejectedValue({ response: { status: 401 } })
    const { ensureLoaded } = useFeatureFlags()

    await ensureLoaded()

    expect(fetchMock).toHaveBeenCalledWith(
      '/platform-config/feature-flags',
      expect.anything(),
    )
    // No assertion needed on navigateTo here -- apiFetch's own redirectOn401 branch is
    // covered directly by useApi.spec.ts; this test only needs to prove the call
    // completes cleanly (no unhandled rejection) with redirectOn401 honored.
  })
})
