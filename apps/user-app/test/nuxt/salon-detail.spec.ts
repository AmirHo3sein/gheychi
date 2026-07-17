import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import SalonDetailPage from '../../app/pages/salons/[slug].vue'

// Same pattern as blog-article.spec.ts / booking-confirm.spec.ts: `$fetch` is a real
// globalThis binding, stubbed directly; useRoute is pinned via mockNuxtImport.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

mockNuxtImport('useRoute', () => () => ({ params: { slug: 'test-salon' }, query: {} }))

const SALON = {
  id: 's1',
  name: 'سالن زیبایی نمونه',
  description: 'توضیح قدیمی سالن',
  address: 'خیابان ولیعصر',
  city: 'تهران',
  ratingAvg: '4.50',
  ratingCount: 3,
  tagline: 'زیبایی با ما',
  about: 'خط اول درباره سالن\nخط دوم درباره سالن',
  instagramHandle: 'nemune.salon',
}

const SERVICES = [
  { id: 'svc1', name: 'کوتاهی مو', description: null, price: 300000, durationMin: 45 },
]

const PORTFOLIO = [
  { id: 'pf1', url: 'http://cdn.example/pf1.jpg', caption: 'رنگ مو', serviceId: 'svc1', sortOrder: 0 },
  { id: 'pf2', url: 'http://cdn.example/pf2.jpg', caption: null, serviceId: null, sortOrder: 1 },
]

/** Route every endpoint the page hits; per-test overrides tweak the salon/portfolio. */
function mockEndpoints(overrides: { salon?: Record<string, unknown>; portfolio?: unknown[] } = {}) {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/salons/test-salon') return { ...SALON, ...overrides.salon }
    if (path === '/salons/test-salon/services') return SERVICES
    if (path === '/salons/test-salon/hours') return []
    if (path === '/salons/test-salon/photos') return []
    if (path === '/salons/s1/reviews') return []
    if (path === '/salons/test-salon/portfolio') return overrides.portfolio ?? PORTFOLIO
    if (path === '/salons/test-salon/stories') return []
    throw new Error(`unexpected fetch path in test: ${path}`)
  })
}

describe('salon detail page', () => {
  // Same unmount-then-clear ritual as blog-article.spec.ts: without it, a previous test's
  // still-mounted instance holds a reactive subscription on the shared useAsyncData payload
  // and clearNuxtData would re-render it against nulled data.
  let wrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    wrapper?.unmount()
    wrapper = undefined
    clearNuxtData('salon-test-salon')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws the standard 404 for an unknown salon slug', async () => {
    fetchMock.mockImplementation(async () => {
      // Shape matches how ofetch surfaces an HTTP error response.
      throw { response: { status: 404 } }
    })

    await expect(mountSuspended(SalonDetailPage)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('renders the tagline, the about section with preserved line breaks, and the instagram chip', async () => {
    mockEndpoints()
    wrapper = await mountSuspended(SalonDetailPage)

    expect(wrapper.get('[data-testid="salon-tagline"]').text()).toBe('زیبایی با ما')

    const about = wrapper.get('[data-testid="salon-about"]')
    expect(about.text()).toContain('درباره سالن')
    const aboutBody = about.get('p')
    expect(aboutBody.classes()).toContain('whitespace-pre-line')
    // Interpolated as plain text -- both lines present, newline intact in the text node.
    expect(aboutBody.text()).toContain('خط اول درباره سالن')
    expect(aboutBody.text()).toContain('خط دوم درباره سالن')

    const chip = wrapper.get('[data-testid="instagram-chip"]')
    expect(chip.attributes('href')).toBe('https://instagram.com/nemune.salon')
    expect(chip.attributes('rel')).toBe('noopener nofollow')
  })

  it('omits tagline, about and instagram chip when the salon has none', async () => {
    mockEndpoints({ salon: { tagline: null, about: null, instagramHandle: null } })
    wrapper = await mountSuspended(SalonDetailPage)

    expect(wrapper.find('[data-testid="salon-tagline"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="salon-about"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="instagram-chip"]').exists()).toBe(false)
  })

  it('renders the portfolio grid with captions', async () => {
    mockEndpoints()
    wrapper = await mountSuspended(SalonDetailPage)

    expect(wrapper.text()).toContain('نمونه کارها')
    expect(wrapper.findAll('[data-testid="portfolio-item"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('رنگ مو')
  })

  it('omits the portfolio section entirely when the salon has no items', async () => {
    mockEndpoints({ portfolio: [] })
    wrapper = await mountSuspended(SalonDetailPage)

    expect(wrapper.text()).not.toContain('نمونه کارها')
    expect(wrapper.find('[data-testid="portfolio-item"]').exists()).toBe(false)
  })

  it('derives the description meta from the about excerpt when present', async () => {
    mockEndpoints()
    wrapper = await mountSuspended(SalonDetailPage)

    // Head DOM writes are debounced by unhead, so poll rather than asserting synchronously.
    await vi.waitFor(() => {
      const meta = document.head.querySelector('meta[name="description"]')
      expect(meta?.getAttribute('content')).toBe('خط اول درباره سالن خط دوم درباره سالن')
    })
  })

  it('walks the description chain down to name—address when about/tagline/description are all null', async () => {
    mockEndpoints({ salon: { about: null, tagline: null, description: null } })
    wrapper = await mountSuspended(SalonDetailPage)

    await vi.waitFor(() => {
      const meta = document.head.querySelector('meta[name="description"]')
      expect(meta?.getAttribute('content')).toBe('سالن زیبایی نمونه — خیابان ولیعصر')
    })
  })
})
