import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UsersView from './UsersView.vue'
import SuspendUserButton from '@/components/users/SuspendUserButton.vue'
import { useSessionStore } from '@/stores/session'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

interface UserRowFixture {
  id: string
  phone: string
  name: string | null
  role: 'customer' | 'provider' | 'admin'
  status: 'active' | 'suspended'
  createdAt: string
}

const user: UserRowFixture = {
  id: 'u1',
  phone: '09120000001',
  name: 'کاربر نمونه',
  role: 'customer',
  status: 'active',
  createdAt: '2026-07-10T08:00:00.000Z',
}

function signInAs(id: string) {
  useSessionStore().setUser({ id, phone: '09120000000', name: 'مدیر', gender: null, role: 'admin' })
}

function respondWith(items: UserRowFixture[]) {
  fetchMock.mockResolvedValue({ data: { items, total: items.length, page: 1, pageSize: 20 }, error: null })
}

describe('UsersView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock.mockReset()
  })

  it('loads users and renders name, phone, and role', async () => {
    signInAs('admin-1')
    respondWith([{ ...user }])
    const wrapper = mount(UsersView)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/users?page=1&pageSize=20', { silent: true })
    expect(wrapper.text()).toContain('کاربر نمونه')
    expect(wrapper.text()).toContain('09120000001')
    expect(wrapper.text()).toContain('مشتری')
  })

  // The backend rejects a self-targeted status change with a 400, so offering the button on
  // the acting admin's own row is an action that can only ever fail.
  it('replaces the suspend control with a "حساب شما" hint on the acting admin\'s own row', async () => {
    signInAs('admin-1')
    respondWith([{ ...user, id: 'admin-1', name: 'مدیر', role: 'admin' }])
    const wrapper = mount(UsersView)
    await flushPromises()

    expect(wrapper.get('[data-testid="self-row-hint"]').text()).toBe('حساب شما')
    expect(wrapper.findComponent(SuspendUserButton).exists()).toBe(false)
  })

  it('still offers the suspend control on every other row, including other admins', async () => {
    signInAs('admin-1')
    respondWith([
      { ...user, id: 'admin-1', name: 'مدیر', role: 'admin' },
      { ...user, id: 'admin-2', name: 'مدیر دیگر', role: 'admin' },
      { ...user, id: 'u1' },
    ])
    const wrapper = mount(UsersView)
    await flushPromises()

    expect(wrapper.findAll('[data-testid="self-row-hint"]')).toHaveLength(1)
    const buttons = wrapper.findAllComponents(SuspendUserButton)
    expect(buttons).toHaveLength(2)
    expect(buttons.map((b) => b.props('userId'))).toEqual(['admin-2', 'u1'])
  })

  it('keeps every row actionable when the session user is not yet hydrated', async () => {
    respondWith([{ ...user }])
    const wrapper = mount(UsersView)
    await flushPromises()

    // A null session must never accidentally match a row id and hide a real control.
    expect(wrapper.find('[data-testid="self-row-hint"]').exists()).toBe(false)
    expect(wrapper.findComponent(SuspendUserButton).exists()).toBe(true)
  })

  it('shows a distinct error state (not the empty state) when the fetch fails, and retry reloads', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'Something went wrong' } })
    const wrapper = mount(UsersView)
    await flushPromises()

    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('کاربری با این فیلترها یافت نشد.')

    respondWith([{ ...user }])
    await wrapper.get('[data-testid="retry-load"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('کاربر نمونه')
  })
})
