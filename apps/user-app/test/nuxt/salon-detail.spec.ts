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
  location: { type: 'Point', coordinates: [51.389, 35.6892] },
}

const TERMS = { depositPercent: 20, depositMinToman: 50000, cancellationWindowHours: 24 }

const SERVICES = [
  { id: 'svc1', name: 'کوتاهی مو', description: null, price: 300000, durationMin: 45 },
]

const PORTFOLIO = [
  { id: 'pf1', url: 'http://cdn.example/pf1.jpg', caption: 'رنگ مو', serviceId: 'svc1', sortOrder: 0 },
  { id: 'pf2', url: 'http://cdn.example/pf2.jpg', caption: null, serviceId: null, sortOrder: 1 },
]

/** Route every endpoint the page hits; per-test overrides tweak the salon/portfolio/hours. */
function mockEndpoints(overrides: { salon?: Record<string, unknown>; portfolio?: unknown[]; hours?: unknown[]; exceptions?: unknown[]; services?: unknown[] } = {}) {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/salons/test-salon') return { ...SALON, ...overrides.salon }
    if (path === '/salons/test-salon/services') return overrides.services ?? SERVICES
    if (path === '/salons/test-salon/hours') return overrides.hours ?? []
    if (path === '/salons/test-salon/exceptions') return overrides.exceptions ?? []
    if (path === '/salons/test-salon/photos') return []
    if (path === '/salons/s1/reviews') return { items: [], total: 0, page: 1, pageSize: 50 }
    if (path === '/salons/test-salon/portfolio') return overrides.portfolio ?? PORTFOLIO
    if (path === '/salons/test-salon/stories') return []
    if (path === '/salons/test-salon/workers') return []
    if (path === '/platform-config/booking-terms') return TERMS
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

  it('shows the approval badge and a one-line deposit disclosure sourced from booking-terms', async () => {
    mockEndpoints()
    wrapper = await mountSuspended(SalonDetailPage)

    expect(wrapper.get('[data-testid="salon-verified-badge"]').text()).toContain('تایید شده')
    // Every result on this page is already API-gated to status:'approved' -- the
    // disclosure's numbers must come from the fetched terms, not be hardcoded. The percent
    // renders as a Persian digit (matching the rest of the page); the toman amount renders
    // Latin-digit/comma-grouped instead (formatToman), for legibility on large prices.
    expect(wrapper.text()).toContain(`٪${(20).toLocaleString('fa-IR')}`)
    expect(wrapper.text()).toContain((50000).toLocaleString('en-US'))
  })

  // A provider-authored note that the listed duration is a minimum, not a guarantee --
  // must reach the customer, not just live unused in the API response.
  it('shows a service duration note when the provider set one, and omits it when they did not', async () => {
    mockEndpoints({
      services: [
        { id: 'svc1', name: 'کوتاهی مو', description: 'این زمان تقریبی است و ممکن است بیشتر طول بکشد', price: 300000, durationMin: 45 },
        { id: 'svc2', name: 'رنگ مو', description: null, price: 500000, durationMin: 90 },
      ],
    })
    wrapper = await mountSuspended(SalonDetailPage)

    expect(wrapper.text()).toContain('این زمان تقریبی است و ممکن است بیشتر طول بکشد')
    const secondRow = wrapper.findAll('li').find((r: { text: () => string }) => r.text().includes('رنگ مو'))!
    expect(secondRow.text()).not.toContain('تقریبی')
  })

  it('scrolls to the services section when the sticky footer CTA is clicked, without a hash-navigation reload', async () => {
    mockEndpoints()
    // document.getElementById (what the click handler actually queries) only finds
    // anything once the component is attached to the real document -- mountSuspended
    // doesn't do that by default (same reasoning as PortfolioGrid.spec.ts's own usage).
    wrapper = await mountSuspended(SalonDetailPage, { attachTo: document.body })
    const scrollIntoView = vi.fn()
    // scrollIntoView is explicit here (not relying on the browser's native `<a href="#...">`
    // fragment-navigation) precisely because that native path was reported not doing
    // anything in practice -- this pins the click handler actually taking over.
    vi.spyOn(document.getElementById('services')!, 'scrollIntoView').mockImplementation(scrollIntoView)

    await wrapper.get('a[href="#services"]').trigger('click')

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('scrolls to the reviews section when the rating row is clicked', async () => {
    mockEndpoints()
    wrapper = await mountSuspended(SalonDetailPage, { attachTo: document.body })
    const scrollIntoView = vi.fn()
    vi.spyOn(document.getElementById('reviews')!, 'scrollIntoView').mockImplementation(scrollIntoView)

    await wrapper.get('a[href="#reviews"]').trigger('click')

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('renders a single-pin map near the address from the salon location', async () => {
    mockEndpoints()
    wrapper = await mountSuspended(SalonDetailPage)

    expect(wrapper.find('[data-testid="salon-map"]').exists()).toBe(true)
  })

  it('toggles aria-pressed on the favorite button', async () => {
    mockEndpoints()
    wrapper = await mountSuspended(SalonDetailPage)

    const button = wrapper.get('[data-testid="favorite-button"]')
    expect(button.attributes('aria-pressed')).toBe('false')
  })

  it('shows an empty-state instead of a bare header when there are no services', async () => {
    mockEndpoints({ salon: {} })
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/salons/test-salon') return SALON
      if (path === '/salons/test-salon/services') return []
      if (path === '/salons/test-salon/hours') return []
      if (path === '/salons/test-salon/photos') return []
      if (path === '/salons/s1/reviews') return { items: [], total: 0, page: 1, pageSize: 50 }
      if (path === '/salons/test-salon/portfolio') return []
      if (path === '/salons/test-salon/stories') return []
      if (path === '/salons/test-salon/workers') return []
      if (path === '/platform-config/booking-terms') return TERMS
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    wrapper = await mountSuspended(SalonDetailPage)

    expect(wrapper.get('[data-testid="services-empty"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="hours-empty"]').exists()).toBe(true)
  })

  // Iran's week starts شنبه (Saturday), not یکشنبه (Sunday) -- a Sunday-first list read as a
  // foreign week. page.hours can be a partial set (a salon can leave a day unset), so this
  // also confirms sorting works from an out-of-order, non-dense subset, not just a full 0-6 array.
  it('lists working hours starting from Saturday, not Sunday', async () => {
    mockEndpoints({
      hours: [
        { weekday: 0, openTime: '09:00:00', closeTime: '18:00:00' }, // یکشنبه
        { weekday: 3, openTime: '09:00:00', closeTime: '18:00:00' }, // چهارشنبه
        { weekday: 6, openTime: '10:00:00', closeTime: '20:00:00' }, // شنبه
      ],
    })
    wrapper = await mountSuspended(SalonDetailPage)

    const dayNames = wrapper
      .get('[data-testid="hours-list"]')
      .findAll('li')
      .map((li: { text: () => string }) => li.text().split(':')[0]!.trim())
    expect(dayNames).toEqual(['شنبه', 'یکشنبه', 'چهارشنبه'])
  })

  // jsdom's .text() reads DOM/logical order, which stayed "open - close" even in a build
  // that visually swapped the two under RTL bidi reordering (caught only by actually looking
  // at a rendered page, not by this suite) -- this asserts the dir="ltr" isolation that fix
  // depends on, since logical order alone can't tell the two states apart.
  it('isolates each time range as ltr so open/close never visually swap under RTL bidi reordering', async () => {
    mockEndpoints({ hours: [{ weekday: 6, openTime: '09:00:00', closeTime: '20:00:00' }] })
    wrapper = await mountSuspended(SalonDetailPage)

    const timeRange = wrapper.get('[data-testid="hours-list"] li')
    expect(timeRange.text()).toContain('09:00 - 20:00')
    expect(timeRange.find('[dir="ltr"]').exists()).toBe(true)
  })

  // A lunch-break split shift is two working_hours rows for the same weekday -- without
  // grouping, these rendered as two separate <li>s both keyed on the same weekday (a
  // duplicate Vue key) instead of one merged row.
  it('merges a lunch-break split shift into one row instead of two duplicate-keyed ones', async () => {
    mockEndpoints({
      hours: [
        { weekday: 6, openTime: '09:00:00', closeTime: '13:00:00' },
        { weekday: 6, openTime: '14:00:00', closeTime: '20:00:00' },
      ],
    })
    wrapper = await mountSuspended(SalonDetailPage)

    const rows = wrapper.get('[data-testid="hours-list"]').findAll('li')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.text()).toContain('09:00 - 13:00')
    expect(rows[0]!.text()).toContain('14:00 - 20:00')
  })

  it('lists an upcoming closure with its time range and reason', async () => {
    mockEndpoints({
      exceptions: [
        { date: '2030-01-01', startTime: null, endTime: null, reason: null },
        { date: '2030-01-02', startTime: '13:00:00', endTime: '14:00:00', reason: 'تعمیرات' },
      ],
    })
    wrapper = await mountSuspended(SalonDetailPage)

    const closures = wrapper.get('[data-testid="upcoming-closures"]')
    expect(closures.text()).toContain('13:00 تا 14:00')
    expect(closures.text()).toContain('تعمیرات')
  })

  // isOpenNow reads the real system clock (via the same Tehran-wall-clock round-trip trick
  // as the component itself) -- fake timers pin it to Monday 2026-08-03 so these are
  // deterministic regardless of when the suite actually runs.
  describe('open-now status', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('reports open during the SECOND range of a lunch-break split shift, not just the first', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-08-03T11:30:00.000Z')) // 15:00 Tehran, Monday
      mockEndpoints({
        hours: [
          { weekday: 1, openTime: '09:00:00', closeTime: '13:00:00' },
          { weekday: 1, openTime: '14:00:00', closeTime: '20:00:00' },
        ],
      })
      wrapper = await mountSuspended(SalonDetailPage)

      expect(wrapper.get('[data-testid="hours-open-status"]').text()).toBe('باز است')
    })

    it('reports closed during the gap of a lunch-break split shift', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-08-03T10:00:00.000Z')) // 13:30 Tehran, Monday -- inside the lunch gap
      mockEndpoints({
        hours: [
          { weekday: 1, openTime: '09:00:00', closeTime: '13:00:00' },
          { weekday: 1, openTime: '14:00:00', closeTime: '20:00:00' },
        ],
      })
      wrapper = await mountSuspended(SalonDetailPage)

      expect(wrapper.get('[data-testid="hours-open-status"]').text()).toBe('بسته است')
    })

    it('reports closed on a whole-day exception even though the normal hours would be open', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-08-03T07:30:00.000Z')) // 11:00 Tehran, Monday
      mockEndpoints({
        hours: [{ weekday: 1, openTime: '09:00:00', closeTime: '20:00:00' }],
        exceptions: [{ date: '2026-08-03', startTime: null, endTime: null, reason: null }],
      })
      wrapper = await mountSuspended(SalonDetailPage)

      expect(wrapper.get('[data-testid="hours-open-status"]').text()).toBe('بسته است')
    })

    it('reports closed only during a partial-day exception\'s own interval, open outside it', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-08-03T11:00:00.000Z')) // 14:30 Tehran, Monday -- inside the exception
      mockEndpoints({
        hours: [{ weekday: 1, openTime: '09:00:00', closeTime: '20:00:00' }],
        exceptions: [{ date: '2026-08-03', startTime: '14:00:00', endTime: '15:00:00', reason: null }],
      })
      wrapper = await mountSuspended(SalonDetailPage)

      expect(wrapper.get('[data-testid="hours-open-status"]').text()).toBe('بسته است')
    })

    it('reports open outside a partial-day exception\'s interval, on the same date', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-08-03T06:30:00.000Z')) // 10:00 Tehran, Monday -- before the exception starts
      mockEndpoints({
        hours: [{ weekday: 1, openTime: '09:00:00', closeTime: '20:00:00' }],
        exceptions: [{ date: '2026-08-03', startTime: '14:00:00', endTime: '15:00:00', reason: null }],
      })
      wrapper = await mountSuspended(SalonDetailPage)

      expect(wrapper.get('[data-testid="hours-open-status"]').text()).toBe('باز است')
    })
  })
})
