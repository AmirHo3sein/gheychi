import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import AdminFeaturedPage from '../../app/pages/admin/featured.vue'

// Same pattern as bookings-list.spec.ts: this page loads via onMounted (not a
// top-level useAsyncData await), so every test mounts then awaits flushPromises()
// before asserting. $fetch is a real globalThis binding, not an unimport-tracked
// auto-import, so it's stubbed directly.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

const SALON_NOT_FEATURED = { id: 's1', name: 'سالن الف', city: 'تهران', isFeatured: false, featuredUntil: null }
const SALON_FEATURED = { id: 's2', name: 'سالن ب', city: 'مشهد', isFeatured: true, featuredUntil: '2026-08-01T00:00:00.000Z' }

// The page only ever lists APPROVED salons -- is_featured on any other status is a flag
// SearchService.search() can never surface, and /admin/salons defaults to status=pending
// when the param is omitted. PAGE_SIZE is the endpoint's own @Max(100) cap.
const LIST_PATH = '/admin/salons?status=approved&page=1&pageSize=100'

// GET /admin/salons returns a paginated envelope in real usage (AdminSalonsController.list()
// -- { items, total, page, pageSize }), never a bare array, so the mock must match that shape.
function stub(salons: unknown[], total = salons.length) {
  fetchMock.mockImplementation(async (path: string) => {
    if (path.startsWith('/admin/salons?')) return { items: salons, total, page: 1, pageSize: 100 }
    throw new Error(`unexpected fetch path in test: ${path}`)
  })
}

describe('admin featured page', () => {
  let wrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    wrapper?.unmount()
    wrapper = undefined
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a loading state before the initial load resolves', async () => {
    let resolveFetch: (value: unknown) => void = () => {}
    fetchMock.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve }))

    wrapper = await mountSuspended(AdminFeaturedPage)
    expect(wrapper.text()).toContain('در حال بارگذاری')

    resolveFetch({ items: [], total: 0, page: 1, pageSize: 100 })
    await flushPromises()
    expect(wrapper.text()).not.toContain('در حال بارگذاری')
  })

  // The P1 case: with no status param, /admin/salons serves PENDING salons, and a
  // pending salon can never appear in search (SearchService.search() is approved-only) --
  // so every row on the screen was un-featurable and the toggle silently did nothing.
  it('requests only approved salons, at the endpoint-capped page size', async () => {
    stub([SALON_NOT_FEATURED])
    wrapper = await mountSuspended(AdminFeaturedPage)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(LIST_PATH, expect.objectContaining({ method: 'GET' }))
  })

  it('renders each salon row with its featured badge', async () => {
    stub([SALON_NOT_FEATURED, SALON_FEATURED])
    wrapper = await mountSuspended(AdminFeaturedPage)
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="featured-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('سالن الف')
    expect(rows[0]!.find('[data-testid="featured-badge"]').text()).toBe('خیر')
    expect(rows[1]!.find('[data-testid="featured-badge"]').text()).toBe('بله')
  })

  // An approved-salon list is unbounded, so page 1 is not the whole platform: without a
  // pager, a salon past the first 100 could never be featured from this screen at all.
  it('hides the pager on a single page and pages through a larger result set', async () => {
    stub([SALON_NOT_FEATURED], 1)
    wrapper = await mountSuspended(AdminFeaturedPage)
    await flushPromises()
    expect(wrapper.find('[data-testid="featured-pager"]').exists()).toBe(false)

    // 150 approved salons -> two pages.
    stub([SALON_NOT_FEATURED], 150)
    wrapper.unmount()
    wrapper = await mountSuspended(AdminFeaturedPage)
    await flushPromises()

    expect(wrapper.find('[data-testid="featured-pager"]').exists()).toBe(true)
    expect((wrapper.get('[data-testid="featured-prev"]').element as HTMLButtonElement).disabled).toBe(true)

    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/admin/salons?status=approved&page=2&pageSize=100') {
        return { items: [SALON_FEATURED], total: 150, page: 2, pageSize: 100 }
      }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    await wrapper.get('[data-testid="featured-next"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="featured-row"]').text()).toContain('سالن ب')
    expect((wrapper.get('[data-testid="featured-next"]').element as HTMLButtonElement).disabled).toBe(true)
    expect((wrapper.get('[data-testid="featured-prev"]').element as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows an empty state when there are no salons', async () => {
    stub([])
    wrapper = await mountSuspended(AdminFeaturedPage)
    await flushPromises()

    expect(wrapper.find('[data-testid="featured-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="featured-row"]').exists()).toBe(false)
  })

  it('toggles featured status and PATCHes with the entered date, then reloads', async () => {
    stub([SALON_NOT_FEATURED])
    wrapper = await mountSuspended(AdminFeaturedPage)
    await flushPromises()

    const dateInput = wrapper.get('[data-testid="featured-until-input"]')
    await dateInput.setValue('2026-09-01')

    fetchMock.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === '/admin/salons/s1/featured' && opts?.method === 'PATCH') return {}
      if (path === LIST_PATH) {
        return { items: [{ ...SALON_NOT_FEATURED, isFeatured: true }], total: 1, page: 1, pageSize: 100 }
      }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })

    await wrapper.get('[data-testid="toggle-featured-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/admin/salons/s1/featured',
      expect.objectContaining({
        method: 'PATCH',
        body: { isFeatured: true, featuredUntil: new Date('2026-09-01').toISOString() },
      }),
    )
  })

  it('shows the per-row loading state only on the salon being saved', async () => {
    stub([SALON_NOT_FEATURED, SALON_FEATURED])
    wrapper = await mountSuspended(AdminFeaturedPage)
    await flushPromises()

    let resolvePatch: (value: unknown) => void = () => {}
    fetchMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === '/admin/salons/s1/featured' && opts?.method === 'PATCH') {
        return new Promise((resolve) => { resolvePatch = resolve })
      }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })

    const buttons = wrapper.findAll('[data-testid="toggle-featured-button"]')
    await buttons[0]!.trigger('click')
    await flushPromises()

    expect(buttons[0]!.attributes('aria-busy')).toBe('true')
    expect(buttons[1]!.attributes('aria-busy')).toBe('false')

    fetchMock.mockImplementation(async (path: string) => {
      if (path === LIST_PATH) {
        return { items: [SALON_NOT_FEATURED, SALON_FEATURED], total: 2, page: 1, pageSize: 100 }
      }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    resolvePatch({})
    await flushPromises()
  })
})
