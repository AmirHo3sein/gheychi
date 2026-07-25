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

  it('shows a reject trigger for a published review, reveals a confirm strip, and calls the moderate endpoint on confirm', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'r1', status: 'rejected' }, error: null })
    const wrapper = mount(ModerateReviewButton, { props: { reviewId: 'r1', status: 'published' } })

    expect(wrapper.find('[data-testid="reject-review"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="republish-review"]').exists()).toBe(false)

    await wrapper.get('[data-testid="reject-review"]').trigger('click')

    // First click reveals the confirm strip only -- no API call yet.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="reject-review"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="reject-review-confirm"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="reject-review-cancel"]').exists()).toBe(true)

    await wrapper.get('[data-testid="reject-review-confirm"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/reviews/r1', { method: 'PATCH', body: { status: 'rejected' } })
    expect(wrapper.emitted('updated')?.[0]).toEqual([{ id: 'r1', status: 'rejected' }])
  })

  it('shows a republish trigger for a rejected review, reveals a confirm strip, and calls the moderate endpoint on confirm', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'r1', status: 'published' }, error: null })
    const wrapper = mount(ModerateReviewButton, { props: { reviewId: 'r1', status: 'rejected' } })

    expect(wrapper.find('[data-testid="republish-review"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="reject-review"]').exists()).toBe(false)

    await wrapper.get('[data-testid="republish-review"]').trigger('click')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="republish-review-confirm"]').exists()).toBe(true)

    await wrapper.get('[data-testid="republish-review-confirm"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/reviews/r1', { method: 'PATCH', body: { status: 'published' } })
  })

  it('renders variant="secondary" (not accent-filled) for the republish trigger and its confirm button -- The One Seal Rule', async () => {
    const wrapper = mount(ModerateReviewButton, { props: { reviewId: 'r1', status: 'rejected' } })

    const trigger = wrapper.get('[data-testid="republish-review"]')
    expect(trigger.classes()).toContain('bg-(--color-border-soft)')
    expect(trigger.classes()).not.toContain('bg-(--color-accent-strong)')

    await trigger.trigger('click')
    const confirm = wrapper.get('[data-testid="republish-review-confirm"]')
    expect(confirm.classes()).toContain('bg-(--color-border-soft)')
    expect(confirm.classes()).not.toContain('bg-(--color-accent-strong)')
  })

  it('P0: shows a non-actionable notice for a withdrawn review -- no republish/reject control at all', async () => {
    const wrapper = mount(ModerateReviewButton, { props: { reviewId: 'r1', status: 'withdrawn' } })

    expect(wrapper.find('[data-testid="withdrawn-notice"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="republish-review"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="reject-review"]').exists()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancelling the confirm strip does not call the API and returns to the trigger view', async () => {
    const wrapper = mount(ModerateReviewButton, { props: { reviewId: 'r1', status: 'published' } })

    await wrapper.get('[data-testid="reject-review"]').trigger('click')
    expect(wrapper.find('[data-testid="reject-review-confirm"]').exists()).toBe(true)

    await wrapper.get('[data-testid="reject-review-cancel"]').trigger('click')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="reject-review"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="reject-review-confirm"]').exists()).toBe(false)
  })

  it('disables the confirm button while a request is in flight', async () => {
    let resolveFetch!: (value: { data: { id: string; status: string }; error: null }) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    const wrapper = mount(ModerateReviewButton, { props: { reviewId: 'r1', status: 'published' } })

    await wrapper.get('[data-testid="reject-review"]').trigger('click')
    const confirmButton = wrapper.get('[data-testid="reject-review-confirm"]')
    await confirmButton.trigger('click')

    expect((confirmButton.element as HTMLButtonElement).disabled).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // A second click while still in flight must not fire a duplicate request.
    await confirmButton.trigger('click')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch({ data: { id: 'r1', status: 'rejected' }, error: null })
    await flushPromises()

    expect(wrapper.find('[data-testid="reject-review"]').exists()).toBe(true)
    expect((wrapper.get('[data-testid="reject-review"]').element as HTMLButtonElement).disabled).toBe(false)
  })
})
