import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSalon, useSalon } from '@/composables/useSalon'
import { resetToast, useToast } from '@/composables/useToast'
import PendingApprovalView from './PendingApprovalView.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/pending-approval', name: 'pending-approval', component: PendingApprovalView },
      { path: '/settings', name: 'settings', component: { template: '<div />' } },
      { path: '/hours', name: 'hours', component: { template: '<div />' } },
      { path: '/services', name: 'services', component: { template: '<div />' } },
    ],
  })
}

const PENDING_SALON = {
  id: 's1',
  name: 'x',
  slug: 'x',
  status: 'pending',
  genderTarget: 'women',
  address: 'x',
  city: 'x',
  capacity: 1,
}

describe('PendingApprovalView', () => {
  beforeEach(() => {
    resetSalon()
    resetToast()
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

  it('shows a loading state on the refresh button while the status check is in flight, then clears it', async () => {
    const router = makeRouter()
    await router.push('/pending-approval')
    await router.isReady()
    const wrapper = mount(PendingApprovalView, { global: { plugins: [router] } })

    let resolveFetch!: (value: { ok: boolean; status: number; json: () => Promise<unknown> }) => void
    const fetchMock = vi.fn().mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const refreshButton = wrapper.get('[data-testid="refresh-status"]')
    await refreshButton.trigger('click')

    expect((refreshButton.element as HTMLButtonElement).disabled).toBe(true)
    expect(refreshButton.attributes('aria-busy')).toBe('true')

    resolveFetch({ ok: true, status: 200, json: async () => ({ id: 's1', status: 'pending' }) })
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect((refreshButton.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('surfaces a toast when the status check fails instead of failing silently', async () => {
    const router = makeRouter()
    await router.push('/pending-approval')
    await router.isReady()
    const wrapper = mount(PendingApprovalView, { global: { plugins: [router] } })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ message: 'boom' }) }))

    await wrapper.get('[data-testid="refresh-status"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect((wrapper.get('[data-testid="refresh-status"]').element as HTMLButtonElement).disabled).toBe(false)
    expect(useToast().toasts.value.some((t) => t.message === 'بررسی وضعیت با خطا مواجه شد. دوباره تلاش کنید.')).toBe(true)
  })

  // The onboarding wizard creates the salon before it saves the hours and the first service,
  // so a failure on either leaves a pending salon with those missing. This page is where the
  // owner lands after a reload, so it has to be the way back in -- the router opens exactly
  // /hours and /services for a pending salon.
  it('offers a pending salon a way into /hours and /services to finish a half-created onboarding', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => PENDING_SALON }))
    const { refetch } = useSalon()
    await refetch()

    const router = makeRouter()
    await router.push('/pending-approval')
    await router.isReady()
    const wrapper = mount(PendingApprovalView, { global: { plugins: [router] } })

    const hoursLink = wrapper.findAll('a').find((a) => a.attributes('href') === '/hours')!
    expect(wrapper.findAll('a').some((a) => a.attributes('href') === '/services')).toBe(true)

    await hoursLink.trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(router.currentRoute.value.name).toBe('hours')
  })

  it('does not offer those links to a suspended salon -- the router bounces them anyway', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...PENDING_SALON, status: 'suspended' }),
    }))
    const { refetch } = useSalon()
    await refetch()

    const router = makeRouter()
    await router.push('/pending-approval')
    await router.isReady()
    const wrapper = mount(PendingApprovalView, { global: { plugins: [router] } })

    expect(wrapper.findAll('a').length).toBe(0)
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

    it('disables the resubmit button while a request is in flight and ignores a second click', async () => {
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

      let resolveFetch!: (value: { ok: boolean; status: number; json: () => Promise<unknown> }) => void
      const fetchMock = vi.fn().mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
      )
      vi.stubGlobal('fetch', fetchMock)

      const resubmitButton = wrapper.get('[data-testid="resubmit-button"]')
      await resubmitButton.trigger('click')

      expect((resubmitButton.element as HTMLButtonElement).disabled).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      // A second click while still in flight must not fire a duplicate request.
      await resubmitButton.trigger('click')
      expect(fetchMock).toHaveBeenCalledTimes(1)

      resolveFetch({ ok: true, status: 200, json: async () => ({ id: 's1', status: 'pending' }) })
      await new Promise((r) => setTimeout(r, 0))
      await wrapper.vm.$nextTick()

      expect((resubmitButton.element as HTMLButtonElement).disabled).toBe(false)
    })

    it('the "ویرایش اطلاعات آرایشگاه" link is a real, clickable navigation to /settings (not dead text)', async () => {
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

      const settingsLink = wrapper.get('a')
      expect(settingsLink.text()).toBe('ویرایش اطلاعات آرایشگاه')
      await settingsLink.trigger('click')
      // router.push() from a RouterLink click resolves asynchronously -- router.isReady()
      // only tracks the router's *initial* navigation, not this follow-up one, so wait for
      // the microtask queue to drain before asserting on the resulting route.
      await new Promise((r) => setTimeout(r, 0))

      expect(router.currentRoute.value.name).toBe('settings')
    })
  })
})
