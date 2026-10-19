import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import UserDetailView from './UserDetailView.vue'
import SuspendUserButton from '@/components/users/SuspendUserButton.vue'
import { useSessionStore } from '@/stores/session'

const fetchMock = vi.fn()
vi.mock('@/composables/useApi', () => ({ useApi: () => ({ apiFetch: fetchMock }) }))

const DETAIL = {
  user: { id: 'u1', phone: '09120000001', name: 'مشتری نمونه', gender: 'female', role: 'customer', status: 'active', createdAt: '2026-07-10T08:00:00.000Z' },
  salon: null,
  workerAt: [{ salonId: 's2', salonName: 'سالن همکار', active: false }],
  bookings: {
    total: 12,
    byStatus: { completed: 9, cancelled_by_user: 3 },
    recent: [{ id: 'b1', startsAt: '2026-10-01T07:00:00.000Z', status: 'completed', salonId: 's1', salonName: 'سالن ستاره', serviceName: 'کوتاهی', priceSnapshot: 450000 }],
  },
  wallet: { toman: 50000, points: 0 },
  reviewsCount: 2,
  activity: [
    { id: 'a1', action: 'user.status.set', success: true, createdAt: '2026-10-02T07:00:00.000Z', actor: { id: 'adm', name: 'مدیر یک', phone: '09129999999' }, status: 'suspended', amount: null, reason: null },
    { id: 'a2', action: 'wallet.adjust', success: true, createdAt: '2026-10-01T07:00:00.000Z', actor: { id: 'adm', name: null, phone: '09129999999' }, status: null, amount: -20000, currency: 'toman', reason: 'اصلاح' },
    { id: 'a3', action: 'wallet.adjust', success: true, createdAt: '2026-09-30T07:00:00.000Z', actor: { id: 'adm', name: null, phone: '09129999999' }, status: null, amount: 500, currency: 'points', reason: null },
  ],
}

async function mountAt(id = 'u1') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/users/:id', component: UserDetailView }],
  })
  router.push(`/users/${id}`)
  await router.isReady()
  const wrapper = mount(UserDetailView, { global: { plugins: [router], stubs: { RouterLink: RouterLinkStub } } })
  await flushPromises()
  return wrapper
}

describe('UserDetailView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock.mockReset()
    useSessionStore().setUser({ id: 'adm', phone: '09129999999', name: 'مدیر', gender: null, role: 'admin' })
  })

  it('renders the account, its bookings, salons, wallet and admin activity from the API', async () => {
    fetchMock.mockResolvedValue({ data: DETAIL, error: null })
    const wrapper = await mountAt()

    expect(fetchMock).toHaveBeenCalledWith('/admin/users/u1', { silent: true })
    expect(wrapper.get('[data-testid="user-name"]').text()).toBe('مشتری نمونه')
    expect(wrapper.get('[data-testid="user-wallet"]').text()).toContain('۵۰٬۰۰۰')
    expect(wrapper.get('[data-testid="user-bookings"]').text()).toContain('انجام شده: ۹')
    expect(wrapper.findAll('[data-testid="user-booking-row"]')).toHaveLength(1)
    const links = wrapper.findAllComponents(RouterLinkStub).map((l) => l.props('to'))
    expect(links).toContainEqual({ name: 'booking-timeline', params: { id: 'b1' } })
    expect(links).toContainEqual({ name: 'bookings', query: { userId: 'u1' } })
    expect(links).toContain('/salons/s2')
    expect(wrapper.get('[data-testid="user-salons"]').text()).toContain('کارمند (غیرفعال)')

    const rows = wrapper.findAll('[data-testid="user-activity-row"]')
    expect(rows[0]!.text()).toContain('معلق')
    expect(rows[0]!.text()).toContain('مدیر یک')
    expect(rows[1]!.text()).toContain('کاهش ۲۰٬۰۰۰ تومان — اصلاح')
    // Points are points, never presented as money.
    expect(rows[2]!.text()).toContain('افزایش ۵۰۰ امتیاز')
    expect(rows[2]!.text()).not.toContain('تومان')
    expect(wrapper.findComponent(SuspendUserButton).exists()).toBe(true)
  })

  it('offers no status control on the admin\'s own account', async () => {
    fetchMock.mockResolvedValue({ data: { ...DETAIL, user: { ...DETAIL.user, id: 'adm', role: 'admin' } }, error: null })
    const wrapper = await mountAt('adm')
    expect(wrapper.findComponent(SuspendUserButton).exists()).toBe(false)
    expect(wrapper.find('[data-testid="self-hint"]').exists()).toBe(true)
  })

  it('says «not found» for an unknown id and offers a retry for any other failure', async () => {
    fetchMock.mockResolvedValue({ data: null, error: { status: 404, message: 'x' } })
    expect((await mountAt()).find('[data-testid="user-not-found"]').exists()).toBe(true)

    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'x' } }).mockResolvedValueOnce({ data: DETAIL, error: null })
    const wrapper = await mountAt()
    await wrapper.get('[data-testid="user-load-retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="user-name"]').text()).toBe('مشتری نمونه')
  })

  it('shows a plain line instead of a list when there are no bookings', async () => {
    fetchMock.mockResolvedValue({ data: { ...DETAIL, bookings: { total: 0, byStatus: {}, recent: [] } }, error: null })
    const wrapper = await mountAt()
    expect(wrapper.get('[data-testid="user-bookings"]').text()).toContain('هنوز نوبتی نگرفته')
    expect(wrapper.find('[data-testid="user-bookings-all"]').exists()).toBe(false)
  })
})
