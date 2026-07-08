import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import SalonDetailView from './SalonDetailView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const salon = {
  id: 's1',
  name: 'سالن نمونه',
  description: null,
  status: 'pending',
  genderTarget: 'women',
  address: 'خیابان اصلی',
  city: 'تهران',
  capacity: 3,
  rejectionReason: null,
}

describe('SalonDetailView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  async function mountWithRouter() {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/salons/:id', name: 'salon-detail', component: SalonDetailView }],
    })
    router.push('/salons/s1')
    await router.isReady()
    const wrapper = mount(SalonDetailView, { global: { plugins: [router] } })
    await flushPromises()
    return wrapper
  }

  it('does not flip to not-found or clear salon state when the post-action refetch fails transiently', async () => {
    fetchMock
      // initial onMounted load
      .mockResolvedValueOnce({ data: salon, error: null })
      // approve PATCH triggered by SalonStatusActions
      .mockResolvedValueOnce({ data: { id: 's1', status: 'approved' }, error: null })
      // refetch triggered by onUpdated -- fails transiently (not a 404)
      .mockResolvedValueOnce({ data: null, error: { status: 0, message: 'Network error' } })

    const wrapper = await mountWithRouter()
    expect(wrapper.text()).toContain('سالن نمونه')

    await wrapper.get('[data-testid="approve-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(wrapper.text()).not.toContain('یافت نشد')
    expect(wrapper.text()).toContain('سالن نمونه')
    // Status renders through the Farsi label map (StatusBadge), not the raw API enum value.
    expect(wrapper.text()).toContain('تایید شده')
  })

  it('shows the not-found message on a confirmed 404', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 404, message: 'Not Found' } })

    const wrapper = await mountWithRouter()

    expect(wrapper.text()).toContain('آرایشگاه یافت نشد')
  })
})
