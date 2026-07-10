import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppSelect from '@/components/ui/AppSelect.vue'
import AuditLogView from './AuditLogView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const mountOptions = { global: { stubs: { RouterLink: RouterLinkStub } } }

const row = {
  id: 'a1',
  actorId: 'u9',
  actorPhone: '09121234567',
  actorName: 'مدیر کل',
  action: 'salon.status.set',
  targetType: 'salon',
  targetId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  success: true,
  createdAt: '2026-07-10T09:30:00.000Z',
}

describe('AuditLogView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('loads page 1 with the default page size and renders rows through the Farsi maps', async () => {
    fetchMock.mockResolvedValue({ data: { items: [row], total: 1, page: 1, pageSize: 20 }, error: null })
    const wrapper = mount(AuditLogView, mountOptions)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/audit-log?page=1&pageSize=20', { silent: true })
    // Action renders as its Farsi label, never the raw dotted enum.
    expect(wrapper.text()).toContain('تغییر وضعیت آرایشگاه')
    expect(wrapper.text()).not.toContain('salon.status.set')
    expect(wrapper.text()).toContain('مدیر کل')
    expect(wrapper.text()).toContain('09121234567')
    expect(wrapper.get('[data-testid="success-badge"]').text()).toBe('موفق')
  })

  it('renders a failure badge for success=false rows', async () => {
    fetchMock.mockResolvedValue({
      data: { items: [{ ...row, id: 'a2', success: false }], total: 1, page: 1, pageSize: 20 },
      error: null,
    })
    const wrapper = mount(AuditLogView, mountOptions)
    await flushPromises()

    expect(wrapper.get('[data-testid="success-badge"]').text()).toBe('ناموفق')
  })

  it('applies the action filter and re-queries from page 1', async () => {
    fetchMock.mockResolvedValue({ data: { items: [], total: 0, page: 1, pageSize: 20 }, error: null })
    const wrapper = mount(AuditLogView, mountOptions)
    await flushPromises()

    wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 'category.delete')
    await flushPromises()

    expect(fetchMock).toHaveBeenLastCalledWith('/admin/audit-log?page=1&pageSize=20&action=category.delete', {
      silent: true,
    })
  })

  it('shows an empty state when nothing matches', async () => {
    fetchMock.mockResolvedValue({ data: { items: [], total: 0, page: 1, pageSize: 20 }, error: null })
    const wrapper = mount(AuditLogView, mountOptions)
    await flushPromises()

    expect(wrapper.text()).toContain('اقدامی با این فیلترها ثبت نشده است.')
  })
})
