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

  it('shows a suspend trigger for an active user, reveals a confirm strip, and calls the status endpoint on confirm', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'u1', status: 'suspended' }, error: null })
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'active', role: 'customer' } })

    expect(wrapper.find('[data-testid="suspend-user"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="unsuspend-user"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="suspend-user-confirm"]').exists()).toBe(false)

    await wrapper.get('[data-testid="suspend-user"]').trigger('click')

    // First click reveals the confirm strip only -- no API call yet.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="suspend-user"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="suspend-user-confirm"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="suspend-user-cancel"]').exists()).toBe(true)

    await wrapper.get('[data-testid="suspend-user-confirm"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/users/u1/status', { method: 'PATCH', body: { status: 'suspended' } })
    expect(wrapper.emitted('updated')?.[0]).toEqual([{ id: 'u1', status: 'suspended' }])
  })

  it('shows an unsuspend trigger for a suspended user, reveals a confirm strip, and calls the status endpoint on confirm', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'u1', status: 'active' }, error: null })
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'suspended', role: 'customer' } })

    expect(wrapper.find('[data-testid="unsuspend-user"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="suspend-user"]').exists()).toBe(false)

    await wrapper.get('[data-testid="unsuspend-user"]').trigger('click')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="unsuspend-user-confirm"]').exists()).toBe(true)

    await wrapper.get('[data-testid="unsuspend-user-confirm"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/users/u1/status', { method: 'PATCH', body: { status: 'active' } })
  })

  it('cancelling the confirm strip does not call the API and returns to the trigger view', async () => {
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'active', role: 'customer' } })

    await wrapper.get('[data-testid="suspend-user"]').trigger('click')
    expect(wrapper.find('[data-testid="suspend-user-confirm"]').exists()).toBe(true)

    await wrapper.get('[data-testid="suspend-user-cancel"]').trigger('click')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="suspend-user"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="suspend-user-confirm"]').exists()).toBe(false)
  })

  it('surfaces the provider-salon cascade note in the confirm strip before suspending', async () => {
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'active', role: 'provider' } })

    await wrapper.get('[data-testid="suspend-user"]').trigger('click')

    expect(wrapper.text()).toContain('آرایشگاه تاییدشدهٔ او (در صورت وجود)')
  })

  it('toasts the salon cascade when suspending a provider', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'u1', status: 'suspended' }, error: null })
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'active', role: 'provider' } })

    await wrapper.get('[data-testid="suspend-user"]').trigger('click')
    await wrapper.get('[data-testid="suspend-user-confirm"]').trigger('click')
    await flushPromises()

    expect(pushMock).toHaveBeenCalledWith('کاربر معلق شد؛ آرایشگاه تاییدشدهٔ او (در صورت وجود) نیز از دسترس عموم خارج شد.')
  })

  it('toasts the salon restore when reactivating a provider', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'u1', status: 'active' }, error: null })
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'suspended', role: 'provider' } })

    await wrapper.get('[data-testid="unsuspend-user"]').trigger('click')
    await wrapper.get('[data-testid="unsuspend-user-confirm"]').trigger('click')
    await flushPromises()

    expect(pushMock).toHaveBeenCalledWith('کاربر فعال شد؛ آرایشگاهی که به دلیل تعلیق او معلق شده بود (در صورت وجود) بازگردانده شد.')
  })

  it('uses a plain toast without cascade wording for non-providers', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'u1', status: 'suspended' }, error: null })
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'active', role: 'customer' } })

    await wrapper.get('[data-testid="suspend-user"]').trigger('click')
    await wrapper.get('[data-testid="suspend-user-confirm"]').trigger('click')
    await flushPromises()

    expect(pushMock).toHaveBeenCalledWith('کاربر معلق شد.')
  })

  it('resets submitting and returns to the trigger view without emitting updated or toasting when the request fails', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 409, message: 'boom' } })
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'active', role: 'provider' } })

    await wrapper.get('[data-testid="suspend-user"]').trigger('click')
    const confirmButton = wrapper.get('[data-testid="suspend-user-confirm"]')
    await confirmButton.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('updated')).toBeUndefined()
    expect(pushMock).not.toHaveBeenCalled()
    // Failure resets `confirming` back to the trigger view (mirrors submitting reset).
    expect(wrapper.find('[data-testid="suspend-user"]').exists()).toBe(true)
    const suspendButton = wrapper.get('[data-testid="suspend-user"]')
    expect((suspendButton.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('disables the confirm button while a request is in flight', async () => {
    let resolveFetch!: (value: { data: { id: string; status: string }; error: null }) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'active', role: 'customer' } })

    await wrapper.get('[data-testid="suspend-user"]').trigger('click')
    const confirmButton = wrapper.get('[data-testid="suspend-user-confirm"]')
    await confirmButton.trigger('click')

    expect((confirmButton.element as HTMLButtonElement).disabled).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // A second click while still in flight must not fire a duplicate request.
    await confirmButton.trigger('click')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch({ data: { id: 'u1', status: 'suspended' }, error: null })
    await flushPromises()

    expect(wrapper.find('[data-testid="suspend-user"]').exists()).toBe(true)
    expect((wrapper.get('[data-testid="suspend-user"]').element as HTMLButtonElement).disabled).toBe(false)
  })
})
