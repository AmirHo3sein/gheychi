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

  it('does not call the API on the first restore click -- it only reveals a confirm strip, with no reason prompt', async () => {
    const wrapper = mount(ShowcaseStatusActions, { props: { kind: 'stories', itemId: 'st1', status: 'removed' } })

    expect(wrapper.find('[data-testid="remove-button"]').exists()).toBe(false)
    await wrapper.get('[data-testid="restore-button"]').trigger('click')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="restore-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="remove-reason-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="restore-confirm"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="restore-cancel"]').exists()).toBe(true)
  })

  it('restores a removed item once the confirm strip is confirmed', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'st1', status: 'published' }, error: null })
    const wrapper = mount(ShowcaseStatusActions, { props: { kind: 'stories', itemId: 'st1', status: 'removed' } })

    await wrapper.get('[data-testid="restore-button"]').trigger('click')
    await wrapper.get('[data-testid="restore-confirm"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/stories/st1/status', {
      method: 'PATCH',
      body: { status: 'published' },
    })
    await flushPromises()
    expect(wrapper.emitted('updated')?.[0]).toEqual([{ id: 'st1', status: 'published' }])
  })

  it('cancelling the restore confirm strip does not call the API and returns to the trigger view', async () => {
    const wrapper = mount(ShowcaseStatusActions, { props: { kind: 'portfolio', itemId: 'p1', status: 'removed' } })

    await wrapper.get('[data-testid="restore-button"]').trigger('click')
    await wrapper.get('[data-testid="restore-cancel"]').trigger('click')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="restore-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="restore-confirm"]').exists()).toBe(false)
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
