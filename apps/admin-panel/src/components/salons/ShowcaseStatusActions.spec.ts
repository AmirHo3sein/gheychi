import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ShowcaseStatusActions from './ShowcaseStatusActions.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

describe('ShowcaseStatusActions', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('removes a published story with the typed reason', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'st1', status: 'removed' }, error: null })
    const wrapper = mount(ShowcaseStatusActions, { props: { kind: 'stories', itemId: 'st1', status: 'published' } })

    await wrapper.get('[data-testid="remove-button"]').trigger('click')
    await wrapper.get('[data-testid="remove-reason-input"]').setValue('محتوای نامناسب')
    await wrapper.get('[data-testid="remove-submit"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/stories/st1/status', {
      method: 'PATCH',
      body: { status: 'removed', reason: 'محتوای نامناسب' },
    })
    await flushPromises()
    expect(wrapper.emitted('updated')?.[0]).toEqual([{ id: 'st1', status: 'removed' }])
  })

  it('omits the reason from the body when left empty (it is optional)', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'p1', status: 'removed' }, error: null })
    const wrapper = mount(ShowcaseStatusActions, { props: { kind: 'portfolio', itemId: 'p1', status: 'published' } })

    await wrapper.get('[data-testid="remove-button"]').trigger('click')
    await wrapper.get('[data-testid="remove-submit"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/portfolio/p1/status', {
      method: 'PATCH',
      body: { status: 'removed' },
    })
  })

  it('restores a removed item directly, with no reason prompt', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'st1', status: 'published' }, error: null })
    const wrapper = mount(ShowcaseStatusActions, { props: { kind: 'stories', itemId: 'st1', status: 'removed' } })

    expect(wrapper.find('[data-testid="remove-button"]').exists()).toBe(false)
    await wrapper.get('[data-testid="restore-button"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/stories/st1/status', {
      method: 'PATCH',
      body: { status: 'published' },
    })
    await flushPromises()
    expect(wrapper.emitted('updated')?.[0]).toEqual([{ id: 'st1', status: 'published' }])
  })

  it('emits refresh (not updated) and collapses the prompt when the PATCH fails (409 lost race)', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 409, message: 'این مورد قبلاً حذف شده است' } })
    const wrapper = mount(ShowcaseStatusActions, { props: { kind: 'stories', itemId: 'st1', status: 'published' } })

    await wrapper.get('[data-testid="remove-button"]').trigger('click')
    await wrapper.get('[data-testid="remove-submit"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('updated')).toBeUndefined()
    expect(wrapper.emitted('refresh')).toHaveLength(1)
    // The stale reason panel collapsed instead of inviting a doomed retry.
    expect(wrapper.find('[data-testid="remove-submit"]').exists()).toBe(false)
  })
})
