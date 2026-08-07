import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CancelReferralAction from './CancelReferralAction.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

describe('CancelReferralAction', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('requires a non-empty reason before submitting', async () => {
    const wrapper = mount(CancelReferralAction, { props: { referralId: 'r1' } })

    await wrapper.get('[data-testid="cancel-referral-button"]').trigger('click')
    await wrapper.get('[data-testid="cancel-referral-submit"]').trigger('click')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="cancel-reason-error"]').exists()).toBe(true)
  })

  it('cancels with the entered reason', async () => {
    fetchMock.mockResolvedValueOnce({
      data: { id: 'r1', status: 'cancelled', cancelledReason: 'fraud suspected' },
      error: null,
    })
    const wrapper = mount(CancelReferralAction, { props: { referralId: 'r1' } })

    await wrapper.get('[data-testid="cancel-referral-button"]').trigger('click')
    await wrapper.get('[data-testid="cancel-reason-input"]').setValue('fraud suspected')
    // "submit" now advances to the confirm-summary step rather than firing the request directly.
    await wrapper.get('[data-testid="cancel-referral-submit"]').trigger('click')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="cancel-referral-confirm-summary"]').text()).toContain('fraud suspected')
    await wrapper.get('[data-testid="cancel-referral-confirm"]').trigger('click')
    await flushPromises()

    // Deliberately not silent -- a 409 must surface via the standard toast path.
    expect(fetchMock).toHaveBeenCalledWith('/admin/referrals/r1/cancel', {
      method: 'POST',
      body: { reason: 'fraud suspected' },
    })
    expect(wrapper.emitted('cancelled')?.[0]).toEqual([{ id: 'r1', status: 'cancelled', cancelledReason: 'fraud suspected' }])
    // Collapses back to the button after a successful submit.
    expect(wrapper.find('[data-testid="cancel-reason-input"]').exists()).toBe(false)
  })

  it('collapses and emits refresh instead of cancelled when the request fails (409 lost race)', async () => {
    fetchMock.mockResolvedValueOnce({
      data: null,
      error: { status: 409, message: 'این ارجاع دیگر در وضعیت در انتظار رویداد نیست' },
    })
    const wrapper = mount(CancelReferralAction, { props: { referralId: 'r1' } })

    await wrapper.get('[data-testid="cancel-referral-button"]').trigger('click')
    await wrapper.get('[data-testid="cancel-reason-input"]').setValue('too late now')
    await wrapper.get('[data-testid="cancel-referral-submit"]').trigger('click')
    await wrapper.get('[data-testid="cancel-referral-confirm"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="cancel-reason-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="cancel-referral-button"]').exists()).toBe(true)
    expect(wrapper.emitted('cancelled')).toBeUndefined()
    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })

  it('the back button returns to the reason step without losing the typed text', async () => {
    const wrapper = mount(CancelReferralAction, { props: { referralId: 'r1' } })

    await wrapper.get('[data-testid="cancel-referral-button"]').trigger('click')
    await wrapper.get('[data-testid="cancel-reason-input"]').setValue('fraud suspected')
    await wrapper.get('[data-testid="cancel-referral-submit"]').trigger('click')
    await wrapper.get('[data-testid="cancel-referral-back"]').trigger('click')

    expect(fetchMock).not.toHaveBeenCalled()
    const input = wrapper.get('[data-testid="cancel-reason-input"]').element as HTMLTextAreaElement
    expect(input.value).toBe('fraud suspected')
  })

  it('cancelling the panel collapses without a request', async () => {
    const wrapper = mount(CancelReferralAction, { props: { referralId: 'r1' } })

    await wrapper.get('[data-testid="cancel-referral-button"]').trigger('click')
    await wrapper.get('[data-testid="cancel-reason-input"]').setValue('changed my mind')
    await wrapper.get('[data-testid="cancel-referral-dismiss"]').trigger('click')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="cancel-referral-button"]').exists()).toBe(true)
  })

  it('disables submit while the request is in flight and does not fire a duplicate request', async () => {
    let resolveFetch!: (value: { data: { id: string; status: string; cancelledReason: string }; error: null }) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    const wrapper = mount(CancelReferralAction, { props: { referralId: 'r1' } })

    await wrapper.get('[data-testid="cancel-referral-button"]').trigger('click')
    await wrapper.get('[data-testid="cancel-reason-input"]').setValue('fraud suspected')
    await wrapper.get('[data-testid="cancel-referral-submit"]').trigger('click')
    const confirm = wrapper.get('[data-testid="cancel-referral-confirm"]')
    await confirm.trigger('click')

    expect((confirm.element as HTMLButtonElement).disabled).toBe(true)

    await confirm.trigger('click')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch({ data: { id: 'r1', status: 'cancelled', cancelledReason: 'fraud suspected' }, error: null })
    await flushPromises()
  })
})
