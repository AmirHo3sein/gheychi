import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ModerateReviewButton from './ModerateReviewButton.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

describe('ModerateReviewButton', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('shows a reject action for a published review and calls the moderate endpoint', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'r1', status: 'rejected' }, error: null })
    const wrapper = mount(ModerateReviewButton, { props: { reviewId: 'r1', status: 'published' } })

    expect(wrapper.find('[data-testid="reject-review"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="republish-review"]').exists()).toBe(false)

    await wrapper.get('[data-testid="reject-review"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/reviews/r1', { method: 'PATCH', body: { status: 'rejected' } })
    expect(wrapper.emitted('updated')?.[0]).toEqual([{ id: 'r1', status: 'rejected' }])
  })

  it('shows a republish action for a rejected review and calls the moderate endpoint', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'r1', status: 'published' }, error: null })
    const wrapper = mount(ModerateReviewButton, { props: { reviewId: 'r1', status: 'rejected' } })

    expect(wrapper.find('[data-testid="republish-review"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="reject-review"]').exists()).toBe(false)

    await wrapper.get('[data-testid="republish-review"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/reviews/r1', { method: 'PATCH', body: { status: 'published' } })
  })

  it('disables the action button while a request is in flight', async () => {
    let resolveFetch!: (value: { data: { id: string; status: string }; error: null }) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    const wrapper = mount(ModerateReviewButton, { props: { reviewId: 'r1', status: 'published' } })

    const rejectButton = wrapper.get('[data-testid="reject-review"]')
    await rejectButton.trigger('click')

    expect((rejectButton.element as HTMLButtonElement).disabled).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // A second click while still in flight must not fire a duplicate request.
    await rejectButton.trigger('click')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch({ data: { id: 'r1', status: 'rejected' }, error: null })
    await flushPromises()

    expect((rejectButton.element as HTMLButtonElement).disabled).toBe(false)
  })
})
