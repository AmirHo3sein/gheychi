import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ModerateWorkerRatingButton from './ModerateWorkerRatingButton.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

describe('ModerateWorkerRatingButton', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('shows a reject trigger for a published rating, reveals a confirm strip, and calls the moderate endpoint on confirm', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'wr1', status: 'rejected' }, error: null })
    const wrapper = mount(ModerateWorkerRatingButton, { props: { ratingId: 'wr1', status: 'published', reviewStatus: 'published' } })

    expect(wrapper.find('[data-testid="reject-worker-rating"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="republish-worker-rating"]').exists()).toBe(false)

    await wrapper.get('[data-testid="reject-worker-rating"]').trigger('click')

    // First click reveals the confirm strip only -- no API call yet.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="reject-worker-rating"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="reject-worker-rating-confirm"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="reject-worker-rating-cancel"]').exists()).toBe(true)

    await wrapper.get('[data-testid="reject-worker-rating-confirm"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/worker-ratings/wr1/status', { method: 'PATCH', body: { status: 'rejected' } })
    expect(wrapper.emitted('updated')?.[0]).toEqual([{ id: 'wr1', status: 'rejected' }])
  })

  it('shows a republish trigger for a rejected rating, reveals a confirm strip, and calls the moderate endpoint on confirm', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'wr1', status: 'published' }, error: null })
    const wrapper = mount(ModerateWorkerRatingButton, { props: { ratingId: 'wr1', status: 'rejected', reviewStatus: 'published' } })

    expect(wrapper.find('[data-testid="republish-worker-rating"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="reject-worker-rating"]').exists()).toBe(false)

    await wrapper.get('[data-testid="republish-worker-rating"]').trigger('click')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="republish-worker-rating-confirm"]').exists()).toBe(true)

    await wrapper.get('[data-testid="republish-worker-rating-confirm"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/worker-ratings/wr1/status', { method: 'PATCH', body: { status: 'published' } })
  })

  it('cancelling the confirm strip does not call the API and returns to the trigger view', async () => {
    const wrapper = mount(ModerateWorkerRatingButton, { props: { ratingId: 'wr1', status: 'published', reviewStatus: 'published' } })

    await wrapper.get('[data-testid="reject-worker-rating"]').trigger('click')
    expect(wrapper.find('[data-testid="reject-worker-rating-confirm"]').exists()).toBe(true)

    await wrapper.get('[data-testid="reject-worker-rating-cancel"]').trigger('click')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="reject-worker-rating"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="reject-worker-rating-confirm"]').exists()).toBe(false)
  })

  // A 'rejected' rating whose parent review the customer deleted is NOT an admin
  // rejection to reverse -- ReviewsService.moderateWorkerRating() 409s on it, so the
  // republish control must not be offered at all (clicking it would otherwise appear to
  // resurrect a rating the customer deleted).
  it('offers no moderation control for a rating whose parent review the customer withdrew', async () => {
    const wrapper = mount(ModerateWorkerRatingButton, {
      props: { ratingId: 'wr1', status: 'rejected', reviewStatus: 'withdrawn' },
    })

    expect(wrapper.find('[data-testid="withdrawn-notice"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="republish-worker-rating"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="reject-worker-rating"]').exists()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('disables the confirm button while a request is in flight', async () => {
    let resolveFetch!: (value: { data: { id: string; status: string }; error: null }) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    const wrapper = mount(ModerateWorkerRatingButton, { props: { ratingId: 'wr1', status: 'published', reviewStatus: 'published' } })

    await wrapper.get('[data-testid="reject-worker-rating"]').trigger('click')
    const confirmButton = wrapper.get('[data-testid="reject-worker-rating-confirm"]')
    await confirmButton.trigger('click')

    expect((confirmButton.element as HTMLButtonElement).disabled).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // A second click while still in flight must not fire a duplicate request.
    await confirmButton.trigger('click')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch({ data: { id: 'wr1', status: 'rejected' }, error: null })
    await flushPromises()

    expect(wrapper.find('[data-testid="reject-worker-rating"]').exists()).toBe(true)
    expect((wrapper.get('[data-testid="reject-worker-rating"]').element as HTMLButtonElement).disabled).toBe(false)
  })
})
