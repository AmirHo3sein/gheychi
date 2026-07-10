import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SalonStatusActions from './SalonStatusActions.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

describe('SalonStatusActions', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('approves with no reason required', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 's1', status: 'approved' }, error: null })
    const wrapper = mount(SalonStatusActions, { props: { salonId: 's1', status: 'pending' } })

    await wrapper.get('[data-testid="approve-button"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/salons/s1/status', {
      method: 'PATCH',
      body: { status: 'approved' },
    })
    expect(wrapper.emitted('updated')?.[0]).toEqual([{ id: 's1', status: 'approved' }])
  })

  it('does not submit a reject with an empty reason', async () => {
    const wrapper = mount(SalonStatusActions, { props: { salonId: 's1', status: 'pending' } })

    await wrapper.get('[data-testid="reject-button"]').trigger('click')
    await wrapper.get('[data-testid="reject-submit"]').trigger('click')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="reason-error"]').exists()).toBe(true)
  })

  it('rejects with a reason once one is entered', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 's1', status: 'rejected' }, error: null })
    const wrapper = mount(SalonStatusActions, { props: { salonId: 's1', status: 'pending' } })

    await wrapper.get('[data-testid="reject-button"]').trigger('click')
    await wrapper.get('[data-testid="reason-input"]').setValue('آدرس نامعتبر است')
    await wrapper.get('[data-testid="reject-submit"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/salons/s1/status', {
      method: 'PATCH',
      body: { status: 'rejected', reason: 'آدرس نامعتبر است' },
    })
  })

  it('disables the approve button while a request is in flight', async () => {
    let resolveFetch!: (value: { data: { id: string; status: string }; error: null }) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    const wrapper = mount(SalonStatusActions, { props: { salonId: 's1', status: 'pending' } })

    const approveButton = wrapper.get('[data-testid="approve-button"]')
    await approveButton.trigger('click')

    expect((approveButton.element as HTMLButtonElement).disabled).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // A second click while still in flight must not fire a duplicate request.
    await approveButton.trigger('click')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch({ data: { id: 's1', status: 'approved' }, error: null })
    await flushPromises()

    expect((approveButton.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('only shows a suspend action when the salon is currently approved', () => {
    const pendingWrapper = mount(SalonStatusActions, { props: { salonId: 's1', status: 'pending' } })
    expect(pendingWrapper.find('[data-testid="suspend-button"]').exists()).toBe(false)

    const approvedWrapper = mount(SalonStatusActions, { props: { salonId: 's1', status: 'approved' } })
    expect(approvedWrapper.find('[data-testid="suspend-button"]').exists()).toBe(true)
  })

  it('suspends with a reason', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 's1', status: 'suspended' }, error: null })
    const wrapper = mount(SalonStatusActions, { props: { salonId: 's1', status: 'approved' } })

    await wrapper.get('[data-testid="suspend-button"]').trigger('click')
    await wrapper.get('[data-testid="reason-input"]').setValue('شکایت مشتری')
    await wrapper.get('[data-testid="reject-submit"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/salons/s1/status', {
      method: 'PATCH',
      body: { status: 'suspended', reason: 'شکایت مشتری' },
    })
  })

  it('offers a re-approve action for suspended salons', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 's1', status: 'approved' }, error: null })
    const wrapper = mount(SalonStatusActions, { props: { salonId: 's1', status: 'suspended' } })

    await wrapper.get('[data-testid="reapprove-button"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/salons/s1/status', {
      method: 'PATCH',
      body: { status: 'approved' },
    })
    expect(wrapper.emitted('updated')?.[0]).toEqual([{ id: 's1', status: 'approved' }])
  })

  it('keeps rejected salons on the provider-resubmit-only flow (no admin action)', () => {
    const wrapper = mount(SalonStatusActions, { props: { salonId: 's1', status: 'rejected' } })

    expect(wrapper.find('[data-testid="reapprove-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="approve-button"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('اقدامی برای این وضعیت لازم نیست.')
  })
})
