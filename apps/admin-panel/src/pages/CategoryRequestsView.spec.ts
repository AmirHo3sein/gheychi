import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CategoryRequestsView from './CategoryRequestsView.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import Pagination from '@/components/ui/Pagination.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const mountOptions = { global: { stubs: { RouterLink: RouterLinkStub } } }

const categoryRequest = {
  id: 'cr1',
  requesterId: 'u1',
  salonId: 's1',
  name: 'ماساژ درمانی',
  note: 'مشتریان زیادی این خدمت را می‌خواهند',
  status: 'pending',
  resolutionNote: null,
  resolvedBy: null,
  resolvedAt: null,
  categoryId: null,
  createdAt: '2026-07-10T08:00:00.000Z',
  salonName: 'سالن نمونه',
  requesterPhone: '09121234567',
}

describe('CategoryRequestsView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('loads pending requests by default, rendering the name, salon link, and requester phone', async () => {
    fetchMock.mockResolvedValue({ data: { items: [{ ...categoryRequest }], total: 1, page: 1, pageSize: 10 }, error: null })
    const wrapper = mount(CategoryRequestsView, mountOptions)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/category-requests?status=pending&page=1&pageSize=10', { silent: true })
    expect(wrapper.text()).toContain('ماساژ درمانی')
    expect(wrapper.text()).toContain('مشتریان زیادی این خدمت را می‌خواهند')
    expect(wrapper.text()).toContain('09121234567')
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/salons/s1')
    // Status renders through the Farsi label map.
    expect(wrapper.text()).toContain('در انتظار بررسی')
  })

  it('shows the resolution note on a rejected request, and hides the resolve actions', async () => {
    fetchMock.mockResolvedValue({
      data: {
        items: [{ ...categoryRequest, status: 'rejected', resolutionNote: 'این دسته‌بندی با موارد موجود همپوشانی دارد' }],
        total: 1,
        page: 1,
        pageSize: 10,
      },
      error: null,
    })
    const wrapper = mount(CategoryRequestsView, mountOptions)
    await flushPromises()

    expect(wrapper.text()).toContain('این دسته‌بندی با موارد موجود همپوشانی دارد')
    expect(wrapper.find('[data-testid="open-approve"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="open-reject"]').exists()).toBe(false)
  })

  it('approves a request with the pre-filled name and a chosen icon, then reloads the queue', async () => {
    let items: (typeof categoryRequest)[] = [{ ...categoryRequest }]
    fetchMock.mockImplementation((url: string, options?: { method?: string; body?: unknown }) => {
      if (options?.method === 'PATCH' && url === '/admin/category-requests/cr1/approve') {
        expect(options.body).toEqual({ name: 'ماساژ درمانی', icon: 'sparkles' })
        items = [] // the request is now resolved and drops out of the pending queue
        return Promise.resolve({ data: { id: 'cr1', status: 'approved' }, error: null })
      }
      return Promise.resolve({ data: { items, total: items.length, page: 1, pageSize: 10 }, error: null })
    })
    const wrapper = mount(CategoryRequestsView, mountOptions)
    await flushPromises()

    await wrapper.get('[data-testid="open-approve"]').trigger('click')
    // The name field is pre-filled from the request's own requested name.
    expect((wrapper.get('[data-testid="approve-name-input"]').element as HTMLInputElement).value).toBe('ماساژ درمانی')
    await wrapper.get('[data-testid="approve-icon-input"]').setValue('sparkles')
    await wrapper.get('[data-testid="submit-approve"]').trigger('click')
    await flushPromises()

    const listCalls = fetchMock.mock.calls.filter(([url]) => (url as string).startsWith('/admin/category-requests?'))
    expect(listCalls).toHaveLength(2)
    expect(wrapper.find('[data-testid="category-request-card"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('درخواستی با این وضعیت وجود ندارد.')
  })

  it('disables the approve submit button until both name and icon are filled', async () => {
    fetchMock.mockResolvedValue({ data: { items: [{ ...categoryRequest }], total: 1, page: 1, pageSize: 10 }, error: null })
    const wrapper = mount(CategoryRequestsView, mountOptions)
    await flushPromises()

    await wrapper.get('[data-testid="open-approve"]').trigger('click')
    expect(wrapper.get('[data-testid="submit-approve"]').attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="approve-icon-input"]').setValue('sparkles')
    expect(wrapper.get('[data-testid="submit-approve"]').attributes('disabled')).toBeUndefined()
  })

  it('rejects a request with a required note, then reloads the queue', async () => {
    let items: (typeof categoryRequest)[] = [{ ...categoryRequest }]
    fetchMock.mockImplementation((url: string, options?: { method?: string; body?: unknown }) => {
      if (options?.method === 'PATCH' && url === '/admin/category-requests/cr1/reject') {
        expect(options.body).toEqual({ note: 'این دسته‌بندی خیلی خاص است' })
        items = []
        return Promise.resolve({ data: { id: 'cr1', status: 'rejected' }, error: null })
      }
      return Promise.resolve({ data: { items, total: items.length, page: 1, pageSize: 10 }, error: null })
    })
    const wrapper = mount(CategoryRequestsView, mountOptions)
    await flushPromises()

    await wrapper.get('[data-testid="open-reject"]').trigger('click')
    await wrapper.get('[data-testid="reject-note-input"]').setValue('این دسته‌بندی خیلی خاص است')
    await wrapper.get('[data-testid="submit-reject"]').trigger('click')
    await flushPromises()

    const listCalls = fetchMock.mock.calls.filter(([url]) => (url as string).startsWith('/admin/category-requests?'))
    expect(listCalls).toHaveLength(2)
    expect(wrapper.find('[data-testid="category-request-card"]').exists()).toBe(false)
  })

  it('does not submit a rejection with an empty note', async () => {
    fetchMock.mockResolvedValue({ data: { items: [{ ...categoryRequest }], total: 1, page: 1, pageSize: 10 }, error: null })
    const wrapper = mount(CategoryRequestsView, mountOptions)
    await flushPromises()

    await wrapper.get('[data-testid="open-reject"]').trigger('click')
    expect(wrapper.get('[data-testid="submit-reject"]').attributes('disabled')).toBeDefined()
  })

  it('reloads the list when the PATCH fails (409 lost race), showing the winning state', async () => {
    fetchMock.mockImplementation((url: string, options?: { method?: string }) => {
      if (options?.method === 'PATCH') {
        return Promise.resolve({ data: null, error: { status: 409, message: 'این درخواست قبلاً بررسی شده است' } })
      }
      return Promise.resolve({ data: { items: [{ ...categoryRequest }], total: 1, page: 1, pageSize: 10 }, error: null })
    })
    const wrapper = mount(CategoryRequestsView, mountOptions)
    await flushPromises()

    await wrapper.get('[data-testid="open-approve"]').trigger('click')
    await wrapper.get('[data-testid="approve-icon-input"]').setValue('sparkles')
    await wrapper.get('[data-testid="submit-approve"]').trigger('click')
    await flushPromises()

    const listCalls = fetchMock.mock.calls.filter(([url]) => (url as string).startsWith('/admin/category-requests?'))
    expect(listCalls).toHaveLength(2)
    // The stale form collapsed instead of inviting a doomed retry.
    expect(wrapper.find('[data-testid="submit-approve"]').exists()).toBe(false)
  })

  it('resets to page 1 with a single fetch when the filter changes from page > 1', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({ data: { items: [{ ...categoryRequest }], total: 25, page: 1, pageSize: 10 }, error: null }),
    )
    const wrapper = mount(CategoryRequestsView, mountOptions)
    await flushPromises()

    wrapper.findComponent(Pagination).vm.$emit('update:page', 2)
    await flushPromises()
    expect(fetchMock).toHaveBeenLastCalledWith('/admin/category-requests?status=pending&page=2&pageSize=10', { silent: true })

    fetchMock.mockClear()
    wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 'approved')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/admin/category-requests?status=approved&page=1&pageSize=10', { silent: true })
  })

  it('shows an empty state when the queue is clear', async () => {
    fetchMock.mockResolvedValue({ data: { items: [], total: 0, page: 1, pageSize: 10 }, error: null })
    const wrapper = mount(CategoryRequestsView, mountOptions)
    await flushPromises()

    expect(wrapper.text()).toContain('درخواستی با این وضعیت وجود ندارد.')
  })

  it('shows a distinct error state with retry when the fetch fails, instead of reading as an empty queue', async () => {
    fetchMock.mockResolvedValue({ data: null, error: { status: 500, message: 'Internal error' } })
    const wrapper = mount(CategoryRequestsView, mountOptions)
    await flushPromises()

    expect(wrapper.find('[data-testid="requests-error"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('درخواستی با این وضعیت وجود ندارد.')

    fetchMock.mockResolvedValue({ data: { items: [{ ...categoryRequest }], total: 1, page: 1, pageSize: 10 }, error: null })
    await wrapper.get('[data-testid="requests-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="requests-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="category-request-card"]').exists()).toBe(true)
  })
})
