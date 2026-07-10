import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import BlogEditorView from './BlogEditorView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

// Explicitly widened (not left to literal inference) because dispatchFetch's `initial` and
// the publish/unpublish branches below override status/publishedAt with other literals --
// plain inference would narrow them to exactly 'draft' and null.
const POST = {
  id: 'p1',
  title: 'راهنمای رنگ مو',
  slug: 'rang-mou-1a2b',
  excerpt: null as string | null,
  bodyMarkdown: '# سلام',
  coverImageUrl: null as string | null,
  categoryId: null as number | null,
  authorName: null as string | null,
  metaDescription: null as string | null,
  ogTitle: null as string | null,
  status: 'draft' as 'draft' | 'published',
  publishedAt: null as string | null,
}

// Dispatch by URL+method so every flow (initial GET, categories GET, create POST, slug
// PATCH, publish POST, unpublish POST, DELETE) resolves independently of call order.
function dispatchFetch(
  options: { publishError?: { status: number; message: string }; initial?: Partial<typeof POST> } = {},
) {
  let current: Record<string, unknown> = { ...POST, ...options.initial }
  fetchMock.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
    const method = opts?.method ?? 'GET'
    if (method === 'GET' && path === '/blog/categories') {
      return { data: [{ id: 1, name: 'مو', slug: 'mou' }], error: null }
    }
    if (method === 'GET' && path === '/admin/blog/posts/p1') return { data: { ...current }, error: null }
    if (method === 'POST' && path === '/admin/blog/posts') return { data: { ...current }, error: null }
    if (method === 'PATCH' && path === '/admin/blog/posts/p1') {
      current = { ...current, ...(opts?.body as Record<string, unknown>) }
      return { data: { ...current }, error: null }
    }
    if (method === 'POST' && path === '/admin/blog/posts/p1/publish') {
      if (options.publishError) return { data: null, error: options.publishError }
      current = { ...current, status: 'published', publishedAt: '2026-07-10T10:00:00.000Z' }
      return { data: { ...current }, error: null }
    }
    if (method === 'POST' && path === '/admin/blog/posts/p1/unpublish') {
      current = { ...current, status: 'draft' }
      return { data: { ...current }, error: null }
    }
    if (method === 'DELETE' && path === '/admin/blog/posts/p1') return { data: null, error: null }
    throw new Error(`unexpected fetch in test: ${method} ${path}`)
  })
}

async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/blog', component: { template: '<div />' } },
      { path: '/blog/new', component: BlogEditorView },
      { path: '/blog/:id', component: BlogEditorView },
    ],
  })
  router.push(path)
  await router.isReady()
  const wrapper = mount(BlogEditorView, {
    global: { plugins: [router], stubs: { AppSelect: true } },
  })
  await flushPromises()
  return { wrapper, router }
}

// Counts the plain (method-less) GETs of the post -- i.e. initial load + reloads.
function postLoads() {
  return fetchMock.mock.calls.filter(
    ([p, o]) => p === '/admin/blog/posts/p1' && !(o as { method?: string } | undefined)?.method,
  ).length
}

describe('BlogEditorView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    dispatchFetch()
  })

  it('renders the live preview with markdown parsed and raw HTML escaped', async () => {
    const { wrapper } = await mountAt('/blog/new')

    await wrapper.get('[data-testid="body-input"]').setValue('# عنوان تست\n\n<script>alert(1)</script>')

    const preview = wrapper.get('[data-testid="preview"]').element.innerHTML
    expect(preview).toContain('<h1>عنوان تست</h1>')
    expect(preview).toContain('&lt;script&gt;')
    expect(preview).not.toContain('<script>')
  })

  it('creates without sending a slug (auto preview untouched) and routes to /blog/:id', async () => {
    const { wrapper, router } = await mountAt('/blog/new')

    await wrapper.get('[data-testid="title-input"]').setValue('راهنمای مراقبت از مو')
    await wrapper.get('[data-testid="body-input"]').setValue('متن مطلب')
    // The slug field previews the title client-side until manually edited.
    expect((wrapper.get('[data-testid="slug-input"]').element as HTMLInputElement).value).toBe(
      'راهنمای-مراقبت-از-مو',
    )

    await wrapper.get('[data-testid="save-button"]').trigger('click')
    await flushPromises()

    const createCall = fetchMock.mock.calls.find(([p]) => p === '/admin/blog/posts')
    expect(createCall?.[1]).toMatchObject({ method: 'POST' })
    expect((createCall?.[1] as { body: Record<string, unknown> }).body).not.toHaveProperty('slug')
    // No manual slug edit -> no follow-up PATCH.
    expect(
      fetchMock.mock.calls.some(
        ([p, o]) => p === '/admin/blog/posts/p1' && (o as { method?: string })?.method === 'PATCH',
      ),
    ).toBe(false)
    expect(router.currentRoute.value.fullPath).toBe('/blog/p1')
  })

  it('applies a manually edited slug with a follow-up PATCH after create', async () => {
    const { wrapper, router } = await mountAt('/blog/new')

    await wrapper.get('[data-testid="title-input"]').setValue('راهنمای مراقبت از مو')
    await wrapper.get('[data-testid="body-input"]').setValue('متن مطلب')
    await wrapper.get('[data-testid="slug-input"]').setValue('custom-slug')

    await wrapper.get('[data-testid="save-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/blog/posts/p1', {
      method: 'PATCH',
      body: { slug: 'custom-slug' },
    })
    expect(router.currentRoute.value.fullPath).toBe('/blog/p1')
  })

  it('publishes and reloads the post from the server', async () => {
    const { wrapper } = await mountAt('/blog/p1')
    expect(wrapper.text()).toContain('پیش‌نویس')

    await wrapper.get('[data-testid="publish-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/blog/posts/p1/publish', { method: 'POST' })
    expect(postLoads()).toBe(2) // initial load + post-publish reload
    expect(wrapper.text()).toContain('منتشرشده')
  })

  it('on a 409 lost publish race, still reloads instead of patching status locally', async () => {
    dispatchFetch({ publishError: { status: 409, message: 'این مطلب قبلاً منتشر شده است' } })
    const { wrapper } = await mountAt('/blog/p1')

    await wrapper.get('[data-testid="publish-button"]').trigger('click')
    await flushPromises()

    // The Farsi 409 message surfaced via the real useApi toast path (not silent); here we
    // assert the state machine: a reload happened and the badge reflects the server.
    expect(postLoads()).toBe(2)
    expect(wrapper.text()).toContain('پیش‌نویس')
  })

  it('unpublishes and reloads the post from the server', async () => {
    dispatchFetch({ initial: { status: 'published', publishedAt: '2026-07-08T10:00:00.000Z' } })
    const { wrapper } = await mountAt('/blog/p1')
    expect(wrapper.text()).toContain('منتشرشده')

    await wrapper.get('[data-testid="unpublish-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/blog/posts/p1/unpublish', { method: 'POST' })
    expect(postLoads()).toBe(2) // initial load + post-unpublish reload
    expect(wrapper.text()).toContain('پیش‌نویس')
  })

  it('deletes only after the inline confirm, then routes back to /blog', async () => {
    const { wrapper, router } = await mountAt('/blog/p1')

    await wrapper.get('[data-testid="delete-button"]').trigger('click')
    expect(wrapper.find('[data-testid="confirm-delete"]').exists()).toBe(true)
    expect(fetchMock.mock.calls.some(([, o]) => (o as { method?: string } | undefined)?.method === 'DELETE')).toBe(false)

    await wrapper.get('[data-testid="confirm-delete"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/blog/posts/p1', { method: 'DELETE' })
    expect(router.currentRoute.value.fullPath).toBe('/blog')
  })
})
