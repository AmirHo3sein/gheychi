import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import BlogArticlePage from '../../app/pages/blog/[slug].vue'

// Same pattern as booking-confirm.spec.ts: $fetch is a real globalThis binding, stubbed
// directly; useRoute is pinned via mockNuxtImport so the page sees a fixed slug param.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

mockNuxtImport('useRoute', () => () => ({ params: { slug: 'healthy-hair-tips' }, query: {} }))

const ARTICLE = {
  id: 'p1',
  title: 'ده نکته برای موی سالم',
  slug: 'healthy-hair-tips',
  excerpt: 'خلاصه مطلب',
  bodyMarkdown: '## شستشوی درست\n\nمتن مقاله\n\n<script>alert(1)</script>',
  coverImageUrl: null,
  categoryName: 'مراقبت مو',
  categorySlug: 'hair',
  authorName: 'تیم آرایشگاه',
  metaDescription: null,
  ogTitle: null,
  publishedAt: '2026-07-01T08:00:00.000Z',
  updatedAt: '2026-07-02T08:00:00.000Z',
}

describe('blog article page', () => {
  // mountSuspended shares one Nuxt app instance across tests in this file, so without
  // unmounting, the first test's still-mounted instance keeps a reactive subscription on
  // the 'blog-post-healthy-hair-tips' useAsyncData payload -- clearNuxtData() in the next
  // test's beforeEach would then retroactively null that ref out from under it and trigger
  // a stray re-render of an already-finished test's component (crashing on the
  // non-null-asserted `post!` template access). Unmounting first, then clearing the cache,
  // avoids both the leak (blog-index.spec.ts's concern) and this dangling-subscription case.
  let wrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    wrapper?.unmount()
    wrapper = undefined
    clearNuxtData('blog-post-healthy-hair-tips')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the article with markdown parsed, raw HTML escaped, byline and fa-IR date', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/blog/posts/healthy-hair-tips') return { ...ARTICLE }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    wrapper = await mountSuspended(BlogArticlePage)

    expect(wrapper.get('h1').text()).toBe('ده نکته برای موی سالم')
    expect(wrapper.text()).toContain('تیم آرایشگاه')
    expect(wrapper.text()).toContain('۱۴۰۵') // fa-IR calendar year for 2026-07-01

    const body = wrapper.get('.article-body').element.innerHTML
    expect(body).toContain('<h2>شستشوی درست</h2>')
    expect(body).toContain('&lt;script&gt;')
    expect(body).not.toContain('<script>')

    // Category chip links back to the filtered index.
    expect(wrapper.find('a[href="/blog?category=hair"]').exists()).toBe(true)
  })

  it('throws the standard 404 for an unknown/unpublished slug', async () => {
    fetchMock.mockImplementation(async () => {
      // Shape matches how ofetch surfaces an HTTP error response.
      throw { response: { status: 404 } }
    })

    await expect(mountSuspended(BlogArticlePage)).rejects.toMatchObject({ statusCode: 404 })
  })
})
