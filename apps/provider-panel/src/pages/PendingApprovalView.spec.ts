import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSalon, useSalon } from '@/composables/useSalon'
import PendingApprovalView from './PendingApprovalView.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/pending-approval', name: 'pending-approval', component: PendingApprovalView },
      { path: '/settings', name: 'settings', component: { template: '<div />' } },
    ],
  })
}

describe('PendingApprovalView', () => {
  beforeEach(() => {
    resetSalon()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a pending message for a pending salon', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const router = makeRouter()
    await router.push('/pending-approval')
    await router.isReady()
    const wrapper = mount(PendingApprovalView, {
      global: { provide: {}, plugins: [router] },
      props: {},
    })
    expect(wrapper.text()).toContain('بررسی')
  })

  it('re-fetches the salon when the refresh button is clicked', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 's1', status: 'approved' }) })
    vi.stubGlobal('fetch', fetchMock)

    const router = makeRouter()
    await router.push('/pending-approval')
    await router.isReady()
    const wrapper = mount(PendingApprovalView, { global: { plugins: [router] } })
    await wrapper.find('[data-testid="refresh-status"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/salons/mine'), expect.anything())
  })

  describe('when the salon is rejected', () => {
    it('shows the rejection reason and a resubmit action', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 's1',
          name: 'x',
          slug: 'x',
          status: 'rejected',
          genderTarget: 'women',
          address: 'x',
          city: 'x',
          capacity: 1,
          rejectionReason: 'آدرس نامعتبر است',
        }),
      }))
      const { refetch } = useSalon()
      await refetch()

      const router = makeRouter()
      await router.push('/pending-approval')
      await router.isReady()
      const wrapper = mount(PendingApprovalView, { global: { plugins: [router] } })

      expect(wrapper.text()).toContain('آدرس نامعتبر است')
      expect(wrapper.find('[data-testid="resubmit-button"]').exists()).toBe(true)

      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 's1', status: 'pending' }) })
      vi.stubGlobal('fetch', fetchMock)

      await wrapper.get('[data-testid="resubmit-button"]').trigger('click')
      await new Promise((r) => setTimeout(r, 0))

      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/salons/mine/resubmit'), expect.objectContaining({ method: 'POST' }))
    })
  })
})
