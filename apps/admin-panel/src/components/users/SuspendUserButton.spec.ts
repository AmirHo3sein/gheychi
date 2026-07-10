import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SuspendUserButton from './SuspendUserButton.vue'

const fetchMock = vi.fn()
const pushMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ push: pushMock }),
}))

describe('SuspendUserButton', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    pushMock.mockReset()
  })

  it('shows a suspend action for an active user and calls the status endpoint', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'u1', status: 'suspended' }, error: null })
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'active', role: 'customer' } })

    expect(wrapper.find('[data-testid="suspend-user"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="unsuspend-user"]').exists()).toBe(false)

    await wrapper.get('[data-testid="suspend-user"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/users/u1/status', { method: 'PATCH', body: { status: 'suspended' } })
    expect(wrapper.emitted('updated')?.[0]).toEqual([{ id: 'u1', status: 'suspended' }])
  })

  it('shows an unsuspend action for a suspended user and calls the status endpoint', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'u1', status: 'active' }, error: null })
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'suspended', role: 'customer' } })

    expect(wrapper.find('[data-testid="unsuspend-user"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="suspend-user"]').exists()).toBe(false)

    await wrapper.get('[data-testid="unsuspend-user"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/users/u1/status', { method: 'PATCH', body: { status: 'active' } })
  })

  it('toasts the salon cascade when suspending a provider', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'u1', status: 'suspended' }, error: null })
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'active', role: 'provider' } })

    await wrapper.get('[data-testid="suspend-user"]').trigger('click')
    await flushPromises()

    expect(pushMock).toHaveBeenCalledWith('کاربر معلق شد؛ آرایشگاه او نیز از دسترس عموم خارج شد.')
  })

  it('toasts the salon restore when reactivating a provider', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'u1', status: 'active' }, error: null })
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'suspended', role: 'provider' } })

    await wrapper.get('[data-testid="unsuspend-user"]').trigger('click')
    await flushPromises()

    expect(pushMock).toHaveBeenCalledWith('کاربر فعال شد؛ آرایشگاهی که به دلیل تعلیق او معلق شده بود بازگردانده شد.')
  })

  it('uses a plain toast without cascade wording for non-providers', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'u1', status: 'suspended' }, error: null })
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'active', role: 'customer' } })

    await wrapper.get('[data-testid="suspend-user"]').trigger('click')
    await flushPromises()

    expect(pushMock).toHaveBeenCalledWith('کاربر معلق شد.')
  })

  it('resets submitting without emitting updated or toasting when the request fails', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 409, message: 'boom' } })
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'active', role: 'provider' } })

    const suspendButton = wrapper.get('[data-testid="suspend-user"]')
    await suspendButton.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('updated')).toBeUndefined()
    expect(pushMock).not.toHaveBeenCalled()
    expect((suspendButton.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('disables the action button while a request is in flight', async () => {
    let resolveFetch!: (value: { data: { id: string; status: string }; error: null }) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'active', role: 'customer' } })

    const suspendButton = wrapper.get('[data-testid="suspend-user"]')
    await suspendButton.trigger('click')

    expect((suspendButton.element as HTMLButtonElement).disabled).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // A second click while still in flight must not fire a duplicate request.
    await suspendButton.trigger('click')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch({ data: { id: 'u1', status: 'suspended' }, error: null })
    await flushPromises()

    expect((suspendButton.element as HTMLButtonElement).disabled).toBe(false)
  })
})
