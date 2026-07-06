import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import ReviewPromptModal from '../../app/components/booking/ReviewPromptModal.vue'

// Same pattern as useApi.spec.ts / booking-confirm.spec.ts: `$fetch` is a real globalThis
// binding, not an unimport-tracked auto-import, so it's stubbed directly.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

describe('ReviewPromptModal', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('emits submitted on a successful review', async () => {
    fetchMock.mockResolvedValue({ id: 'r1' })
    const wrapper = await mountSuspended(ReviewPromptModal, { props: { bookingId: 'b1' } })

    await wrapper.find('[data-testid="submit-review-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('submitted')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('شما قبلا برای این نوبت نظر ثبت کرده‌اید')
  })

  it('on a 409, shows the already-reviewed message instead of emitting submitted', async () => {
    fetchMock.mockRejectedValue({ response: { status: 409 }, statusMessage: 'Conflict' })
    const wrapper = await mountSuspended(ReviewPromptModal, { props: { bookingId: 'b1' } })

    await wrapper.find('[data-testid="submit-review-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('شما قبلا برای این نوبت نظر ثبت کرده‌اید')
    expect(wrapper.emitted('submitted')).toBeUndefined()
  })

  it('on a non-409 error, surfaces a toast instead of silently doing nothing', async () => {
    fetchMock.mockRejectedValue({ response: { status: 500 }, statusMessage: 'Server error' })
    const wrapper = await mountSuspended(ReviewPromptModal, { props: { bookingId: 'b1' } })
    const { toasts } = useToast()
    const before = toasts.value.length

    await wrapper.find('[data-testid="submit-review-button"]').trigger('click')
    await flushPromises()

    expect(toasts.value.length).toBe(before + 1)
    expect(wrapper.emitted('submitted')).toBeUndefined()
    expect(wrapper.text()).not.toContain('شما قبلا برای این نوبت نظر ثبت کرده‌اید')
  })
})
