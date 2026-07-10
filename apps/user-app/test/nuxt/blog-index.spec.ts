import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import BlogIndexPage from '../../app/pages/blog/index.vue'

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
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    // mountSuspended shares one Nuxt app instance across tests in this file, so the
    // 'blog-posts'/'blog-categories' useAsyncData payload cache would otherwise leak the
    // first test's response into the second mount instead of re-fetching.
    clearNuxtData(['blog-posts', 'blog-categories'])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders post cards with category chip, byline, fa-IR date, and pagination', async () => {
    stubList([POST], 25)
    const wrapper = await mountSuspended(BlogIndexPage)

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
    const wrapper = await mountSuspended(BlogIndexPage)

    expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="next-page"]').exists()).toBe(false)
  })
})
