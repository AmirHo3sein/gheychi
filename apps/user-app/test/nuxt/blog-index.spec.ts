import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { reactive, nextTick } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, type DOMWrapper } from '@vue/test-utils'
import BlogIndexPage from '../../app/pages/blog/index.vue'

// The page drives its filter/page state through route.query (chip click / pagination ->
// router.push -> useAsyncData's `watch`). The real Nuxt test router in this harness doesn't
// re-navigate reliably for a query-only push against a component mounted without its route
// registered, so useRoute/useRouter are pinned to a minimal, directly-controllable pair --
// just enough surface for this page's navigation plus the NuxtLink stub's router.resolve().
const mockRoute = reactive<{ query: Record<string, string> }>({ query: {} })
mockNuxtImport('useRoute', () => () => mockRoute)
mockNuxtImport('useRouter', () => () => ({
  push: (to: { query?: Record<string, string> }) => {
    mockRoute.query = to.query ?? {}
    return Promise.resolve()
  },
  replace: (to: { query?: Record<string, string> } | string) => {
    if (typeof to === 'object') mockRoute.query = to.query ?? {}
    return Promise.resolve()
  },
  resolve: (to: string | { path?: string }) => ({ href: typeof to === 'string' ? to : (to.path ?? '/') }),
}))

const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

const CATEGORIES = [{ id: 1, name: 'مراقبت مو', slug: 'hair' }]
const POST = {
  id: 'p1',
  title: 'ده نکته برای موی سالم',
  slug: 'healthy-hair-tips',
  excerpt: 'خلاصه مطلب',
  coverImageUrl: null,
  categoryName: 'مراقبت مو',
  categorySlug: 'hair',
  authorName: 'تیم آرایشگاه',
  publishedAt: '2026-07-01T08:00:00.000Z',
}

// Dispatch by URL -- the page fetches categories and the post list in the same setup.
function stubList(items: unknown[], total: number) {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/blog/categories') return CATEGORIES
    if (path === '/blog/posts') return { items, total, page: 1, pageSize: 12 }
    throw new Error(`unexpected fetch path in test: ${path}`)
  })
}

describe('blog index page', () => {
  let wrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined

  beforeEach(() => {
    // mountSuspended shares one Nuxt app instance across tests in this file. Without an
    // explicit unmount, a previous test's component (and its route-query watcher) stays
    // alive and reacts to mockRoute mutations made by a later test -- since useAsyncData
    // dedupes by key, that leftover watcher can race the current test's own refetch of the
    // shared 'blog-posts'/'blog-categories' entries.
    wrapper?.unmount()
    fetchMock.mockReset()
    mockRoute.query = {}
    vi.stubGlobal('$fetch', fetchStub)
    // The useAsyncData payload cache would otherwise leak the first test's response into
    // the next mount instead of re-fetching.
    clearNuxtData(['blog-posts', 'blog-categories'])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders post cards with category chip, byline, fa-IR date, and pagination', async () => {
    stubList([POST], 25)
    wrapper = await mountSuspended(BlogIndexPage)

    expect(wrapper.text()).toContain('ده نکته برای موی سالم')
    expect(wrapper.text()).toContain('مراقبت مو')
    expect(wrapper.text()).toContain('تیم آرایشگاه')
    expect(wrapper.text()).toContain('۱۴۰۵') // fa-IR calendar year for 2026-07-01
    expect(wrapper.find(`a[href="/blog/${POST.slug}"]`).exists()).toBe(true)
    // 25 results at pageSize 12 -> pagination controls are visible
    expect(wrapper.find('[data-testid="next-page"]').exists()).toBe(true)
  })

  it('shows the empty state (and no pagination) when nothing is published', async () => {
    stubList([], 0)
    wrapper = await mountSuspended(BlogIndexPage)

    expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="empty-state"]').attributes('aria-live')).toBe('polite')
    expect(wrapper.find('[data-testid="next-page"]').exists()).toBe(false)
  })

  it('wraps the page body in a max-width container', async () => {
    stubList([POST], 1)
    wrapper = await mountSuspended(BlogIndexPage)

    expect(wrapper.classes()).toContain('mx-auto')
    expect(wrapper.classes()).toContain('max-w-3xl')
  })

  it('marks the selected category chip with aria-pressed and contrast-safe classes, grouped for a11y', async () => {
    stubList([POST], 1)
    wrapper = await mountSuspended(BlogIndexPage)

    const group = wrapper.find('[role="group"][aria-label="فیلتر دسته‌بندی"]')
    expect(group.exists()).toBe(true)

    const buttons = group.findAll('button')
    const allChip = buttons.find((b: DOMWrapper<Element>) => b.text() === 'همه')!
    const hairChip = buttons.find((b: DOMWrapper<Element>) => b.text() === 'مراقبت مو')!

    // No category selected initially -- "همه" is pressed with the WCAG-AA-safe strong accent.
    expect(allChip.attributes('aria-pressed')).toBe('true')
    expect(allChip.classes()).toContain('bg-(--color-accent-strong)')
    expect(hairChip.attributes('aria-pressed')).toBe('false')
  })

  it('renders the category label on a post card with contrast-safe text color', async () => {
    stubList([POST], 1)
    wrapper = await mountSuspended(BlogIndexPage)

    const label = wrapper.findAll('p').find((p: DOMWrapper<Element>) => p.text() === 'مراقبت مو')!
    expect(label.exists()).toBe(true)
    expect(label.classes()).not.toContain('text-(--color-accent)')
  })

  it('shows a subtle icon in the missing-cover-image placeholder', async () => {
    stubList([POST], 1)
    wrapper = await mountSuspended(BlogIndexPage)

    // POST has coverImageUrl: null -- the placeholder box should render in its place.
    expect(wrapper.find('svg').exists()).toBe(true)
  })

  it('disables category chips and pagination while a refetch is in flight, then re-enables them', async () => {
    stubList([POST], 25)
    wrapper = await mountSuspended(BlogIndexPage)

    // Swap in a hanging /blog/posts response so the pending window is observable.
    let resolvePosts: (v: unknown) => void = () => {}
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/blog/categories') return CATEGORIES
      if (path === '/blog/posts') return new Promise((resolve) => { resolvePosts = resolve })
      throw new Error(`unexpected fetch path in test: ${path}`)
    })

    const hairChip = wrapper.findAll('button').find((b: DOMWrapper<Element>) => b.text() === 'مراقبت مو')!
    await hairChip.trigger('click')
    await flushPromises()
    await nextTick()

    expect(wrapper.find('[data-testid="next-page"]').attributes('disabled')).toBeDefined()
    const chipsMidFlight = wrapper.findAll('button').filter((b: DOMWrapper<Element>) => b.text() === 'همه' || b.text() === 'مراقبت مو')
    for (const chip of chipsMidFlight) {
      expect(chip.attributes('disabled')).toBeDefined()
    }

    resolvePosts({ items: [POST], total: 25, page: 1, pageSize: 12 })
    await flushPromises()
    await nextTick()

    expect(wrapper.find('[data-testid="next-page"]').attributes('disabled')).toBeUndefined()
  })
})
