import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFeatureFlags, useFeatureFlags } from './useFeatureFlags'

describe('useFeatureFlags', () => {
  beforeEach(() => {
    resetFeatureFlags()
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        reviewsEnabled: true,
        storiesEnabled: false,
        portfolioEnabled: false,
        referralsEnabled: true,
        couponsEnabled: true,
      }),
    }))

    const { flags, ensureLoaded } = useFeatureFlags()
    await ensureLoaded()

    expect(flags.value.storiesEnabled).toBe(false)
    expect(flags.value.portfolioEnabled).toBe(false)
  })

  it('only fetches once, even across multiple calls/composable instances', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        reviewsEnabled: true,
        storiesEnabled: true,
        portfolioEnabled: true,
        referralsEnabled: true,
        couponsEnabled: true,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await useFeatureFlags().ensureLoaded()
    await useFeatureFlags().ensureLoaded()
    await useFeatureFlags().ensureLoaded()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails open (keeps the all-true defaults) on a network error, without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

    const { flags, ensureLoaded } = useFeatureFlags()
    await expect(ensureLoaded()).resolves.toBeUndefined()

    expect(flags.value.reviewsEnabled).toBe(true)
  })

  it('resetFeatureFlags clears state back to the all-true defaults', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        reviewsEnabled: false,
        storiesEnabled: false,
        portfolioEnabled: false,
        referralsEnabled: false,
        couponsEnabled: false,
      }),
    }))

    const { flags, ensureLoaded } = useFeatureFlags()
    await ensureLoaded()
    expect(flags.value.reviewsEnabled).toBe(false)

    resetFeatureFlags()

    expect(flags.value.reviewsEnabled).toBe(true)
  })
})
