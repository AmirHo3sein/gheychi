import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppSelect from '@/components/ui/AppSelect.vue'
import Pagination from '@/components/ui/Pagination.vue'
import BlogPostsView from './BlogPostsView.vue'

const fetchMock = vi.fn()
const pushMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

// The view only needs router.push -- rows and the new-post button navigate imperatively.
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
}))

const categoriesFixture = [
  { id: 1, name: 'مراقبت مو', slug: 'moraghebat-mou' },
  { id: 2, name: 'مراقبت پوست', slug: 'moraghebat-poust' },
]

const draftPost = {
  id: 'p1',
  title: 'راهنمای انتخاب رنگ مو',
  slug: 'rahnamaye-entekhab-rang-mou',
  status: 'draft',
  categoryName: 'مراقبت مو',
  publishedAt: null,
  createdAt: '2026-07-08T08:00:00.000Z',
}

const publishedPost = {
  id: 'p2',
  title: 'ترندهای میکاپ تابستان',
  slug: 'trendhaye-mikap-tabestan',
  status: 'published',
  categoryName: null,
  publishedAt: '2026-07-01T08:00:00.000Z',
  createdAt: '2026-06-20T08:00:00.000Z',
}

let postsResponse: { items: unknown[]; total: number; page: number; pageSize: number }
let categoryMutationResult: { data: unknown; error: { status: number; message: string } | null }

function postListCalls() {
  return fetchMock.mock.calls.filter(([path]) => typeof path === 'string' && path.startsWith('/admin/blog/posts'))
}

function categoryListCalls() {
  return fetchMock.mock.calls.filter(([path]) => path === '/blog/categories')
}

beforeEach(() => {
  fetchMock.mockReset()
  pushMock.mockReset()
  postsResponse = { items: [draftPost, publishedPost], total: 2, page: 1, pageSize: 20 }
  categoryMutationResult = { data: { id: 3, name: 'جدید', slug: 'jadid' }, error: null }

  // Dispatch by URL + method: this view interleaves posts loads, category loads, and
  // category mutations, so an ordered mockResolvedValueOnce chain would be brittle.
  fetchMock.mockImplementation(async (path: string, options: { method?: string } = {}) => {
    const method = options.method ?? 'GET'
    if (method === 'GET' && path === '/blog/categories') {
      return { data: categoriesFixture.map((c) => ({ ...c })), error: null }
    }
    if (method === 'GET' && path.startsWith('/admin/blog/posts?')) {
      return { data: postsResponse, error: null }
    }
    if (path.startsWith('/admin/blog/categories')) {
      return categoryMutationResult
    }
    throw new Error(`unexpected apiFetch: ${method} ${path}`)
  })
})

async function mountView() {
  const wrapper = mount(BlogPostsView)
  await flushPromises()
  return wrapper
}

describe('BlogPostsView list', () => {
  it('loads page 1 silently on mount and renders rows with category, badge, and fa-IR date', async () => {
    const wrapper = await mountView()

    expect(fetchMock).toHaveBeenCalledWith('/admin/blog/posts?status=all&page=1&pageSize=20', { silent: true })
    const rows = wrapper.findAll('[data-testid="post-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('راهنمای انتخاب رنگ مو')
    expect(rows[0].text()).toContain('مراقبت مو')
    expect(rows[0].text()).toContain('پیش‌نویس')
    expect(rows[0].text()).toContain('—') // draft: no publish date yet
    expect(rows[1].text()).toContain('منتشرشده')
    expect(rows[1].text()).toContain('۱۴۰۵') // fa-IR (Persian calendar) year for 2026-07-01
  })

  // Regression guard. The table used to sit directly inside AppCard's overflow-hidden box, so
  // the moment its min-content width exceeded the card the trailing columns were CLIPPED, not
  // scrolled to. This page squeezes it hardest, since the categories side card takes a fixed
  // 20rem out of the row from xl up. The wrapper has to stay the table's DIRECT parent.
  it('keeps the table inside its own horizontal scroll container', async () => {
    const wrapper = await mountView()

    expect(wrapper.get('table').element.parentElement?.className).toContain('overflow-x-auto')
  })

  it('shows an empty state when nothing matches', async () => {
    postsResponse = { items: [], total: 0, page: 1, pageSize: 20 }
    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="post-row"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('مطلبی با این فیلترها یافت نشد.')
  })

  it('resets to page 1 with exactly one request when a filter changes past page 1', async () => {
    postsResponse = { items: [draftPost], total: 45, page: 1, pageSize: 20 }
    const wrapper = await mountView()
    expect(postListCalls()).toHaveLength(1)

    wrapper.getComponent(Pagination).vm.$emit('update:page', 2)
    await flushPromises()
    expect(postListCalls()).toHaveLength(2)
    expect(postListCalls()[1][0]).toContain('page=2')

    // AppSelect order in the template: [0] status, [1] category.
    wrapper.findAllComponents(AppSelect)[0].vm.$emit('update:modelValue', 'draft')
    await flushPromises()

    const calls = postListCalls()
    expect(calls).toHaveLength(3) // one request -- not a reset-then-load double fetch
    expect(calls[2][0]).toContain('status=draft')
    expect(calls[2][0]).toContain('page=1')
  })

  it('reloads directly when a filter changes while already on page 1', async () => {
    const wrapper = await mountView()

    wrapper.findAllComponents(AppSelect)[1].vm.$emit('update:modelValue', 1)
    await flushPromises()

    const calls = postListCalls()
    expect(calls).toHaveLength(2)
    expect(calls[1][0]).toContain('categoryId=1')
    expect(calls[1][0]).toContain('page=1')
  })

  it('navigates to the editor on row click and to create mode from the new-post button', async () => {
    const wrapper = await mountView()

    await wrapper.findAll('[data-testid="post-row"]')[0].trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/blog/p1')

    await wrapper.get('[data-testid="new-post"]').trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/blog/new')
  })
})

describe('BlogPostsView categories card', () => {
  it('lists the categories from the public endpoint', async () => {
    const wrapper = await mountView()

    expect(fetchMock).toHaveBeenCalledWith('/blog/categories', { silent: true })
    expect(wrapper.text()).toContain('مراقبت مو')
    expect(wrapper.text()).toContain('مراقبت پوست')
  })

  it('adds a category and reloads the list from the server instead of patching locally', async () => {
    const wrapper = await mountView()
    expect(categoryListCalls()).toHaveLength(1)

    await wrapper.get('[data-testid="new-category-name"]').setValue('عروس')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/blog/categories', { method: 'POST', body: { name: 'عروس' } })
    expect(categoryListCalls()).toHaveLength(2) // reloaded -- the slug is server-generated
  })

  it('renames via inline edit, then reloads categories AND posts (rows show categoryName)', async () => {
    const wrapper = await mountView()

    await wrapper.findAll('[data-testid="edit-category"]')[0].trigger('click')
    await wrapper.get('[data-testid="edit-category-name"]').setValue('مو و ریش')
    await wrapper.get('[data-testid="save-category"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/blog/categories/1', { method: 'PATCH', body: { name: 'مو و ریش' } })
    expect(categoryListCalls()).toHaveLength(2)
    expect(postListCalls()).toHaveLength(2)
  })

  it('expands an inline confirm without deleting anything yet', async () => {
    const wrapper = await mountView()
    const callsBefore = fetchMock.mock.calls.length

    await wrapper.findAll('[data-testid="delete-category"]')[0].trigger('click')
    expect(wrapper.find('[data-testid="confirm-delete-category"]').exists()).toBe(true)
    expect(fetchMock.mock.calls).toHaveLength(callsBefore)

    await wrapper.get('[data-testid="cancel-delete-category"]').trigger('click')
    expect(wrapper.find('[data-testid="confirm-delete-category"]').exists()).toBe(false)
  })

  it('keeps the row and collapses the confirm strip on a 409 (category in use)', async () => {
    categoryMutationResult = {
      data: null,
      error: { status: 409, message: 'این دسته‌بندی دارای مطلب است و قابل حذف نیست' },
    }
    const wrapper = await mountView()

    await wrapper.findAll('[data-testid="delete-category"]')[0].trigger('click')
    await wrapper.get('[data-testid="confirm-delete-category"]').trigger('click')
    await flushPromises()

    // The Farsi 409 toast comes from the real (non-silent) useApi; here we assert the
    // state outcome: row survives, confirm strip collapsed (no doomed retry form).
    expect(wrapper.text()).toContain('مراقبت مو')
    expect(wrapper.find('[data-testid="confirm-delete-category"]').exists()).toBe(false)
  })

  it('resets the category filter (and reloads unfiltered) when the filtered category is deleted', async () => {
    categoryMutationResult = { data: null, error: null } // 204
    const wrapper = await mountView()

    wrapper.findAllComponents(AppSelect)[1].vm.$emit('update:modelValue', 1)
    await flushPromises()
    expect(postListCalls().at(-1)![0]).toContain('categoryId=1')

    await wrapper.findAll('[data-testid="delete-category"]')[0].trigger('click')
    await wrapper.get('[data-testid="confirm-delete-category"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/blog/categories/1', { method: 'DELETE' })
    const last = postListCalls().at(-1)![0]
    expect(last).not.toContain('categoryId=')
    expect(last).toContain('page=1')
  })
})
