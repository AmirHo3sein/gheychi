import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import SalonDetailPage from '../../app/pages/salons/[slug].vue'

/**
 * Handle history: a salon's old public handle is printed onto QR codes that outlive any
 * rename, so `/salons/<old-handle>` must 301 to the salon's current handle rather than 404 --
 * and it must carry the query string across, because `?source=qr` on those printed codes is
 * the entire attribution signal the feature exists to produce.
 *
 * Same stubbing shape as salon-detail.spec.ts ($fetch is a real globalThis binding; useRoute
 * and navigateTo are pinned via mockNuxtImport).
 */
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

let routeQuery: Record<string, string> = {}
mockNuxtImport('useRoute', () => () => ({ params: { slug: 'old-handle' }, query: routeQuery }))

const navigateToMock = vi.fn()
mockNuxtImport('navigateTo', () => (...args: unknown[]) => navigateToMock(...args))

/** The profile 404s under the old handle; the canonical endpoint names the current one. */
function mockMovedHandle(canonical: { slug: string; moved: boolean } | null) {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/salons/old-handle') throw { response: { status: 404 } }
    if (path === '/salons/old-handle/canonical') {
      if (!canonical) throw { response: { status: 404 } }
      return canonical
    }
    throw new Error(`unexpected fetch path in test: ${path}`)
  })
}

describe('salon page — renamed handle redirect', () => {
  let wrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined

  beforeEach(() => {
    fetchMock.mockReset()
    navigateToMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    wrapper?.unmount()
    wrapper = undefined
    routeQuery = {}
    clearNuxtData('salon-old-handle')
    useState('feature-flags').value = {
      reviewsEnabled: true,
      storiesEnabled: true,
      portfolioEnabled: true,
      referralsEnabled: true,
      couponsEnabled: true,
      onlinePaymentEnabled: true,
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('issues a permanent (301) redirect to the salon\'s current handle', async () => {
    mockMovedHandle({ slug: 'new-handle', moved: true })

    // Must NOT throw the 404 the same fetch failure produces for a handle that never existed.
    wrapper = await mountSuspended(SalonDetailPage)

    expect(navigateToMock).toHaveBeenCalledWith(
      { path: '/salons/new-handle', query: {} },
      // 301, not the default 302 -- the old handle is never coming back (it stays reserved to
      // this salon), so the old URL's ranking should transfer rather than be re-checked.
      { redirectCode: 301, replace: true },
    )
  })

  it('preserves the query string, so a printed QR code\'s ?source=qr attribution survives', async () => {
    routeQuery = { source: 'qr' }
    mockMovedHandle({ slug: 'new-handle', moved: true })

    wrapper = await mountSuspended(SalonDetailPage)

    expect(navigateToMock).toHaveBeenCalledWith(
      { path: '/salons/new-handle', query: { source: 'qr' } },
      { redirectCode: 301, replace: true },
    )
  })

  it('still 404s (never redirects) for a handle that was never anyone\'s', async () => {
    mockMovedHandle(null)

    await expect(mountSuspended(SalonDetailPage)).rejects.toMatchObject({ statusCode: 404 })
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  // Defensive: a `moved: false` answer means the API considers this handle already canonical,
  // so redirecting would be a self-redirect loop.
  it('does not redirect when the canonical endpoint reports the handle is already current', async () => {
    mockMovedHandle({ slug: 'old-handle', moved: false })

    await expect(mountSuspended(SalonDetailPage)).rejects.toMatchObject({ statusCode: 404 })
    expect(navigateToMock).not.toHaveBeenCalled()
  })
})
