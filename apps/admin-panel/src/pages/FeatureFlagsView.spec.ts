import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FeatureFlagsView from './FeatureFlagsView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const FLAGS = {
  reviewsEnabled: true,
  storiesEnabled: true,
  portfolioEnabled: true,
  referralsEnabled: true,
  couponsEnabled: true,
}

async function mountView() {
  fetchMock.mockResolvedValueOnce({ data: { ...FLAGS }, error: null })
  const wrapper = mount(FeatureFlagsView)
  await flushPromises()
  return wrapper
}

describe('FeatureFlagsView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('loads flags and disables save when nothing changed', async () => {
    const wrapper = await mountView()

    expect(fetchMock).toHaveBeenCalledWith('/admin/feature-flags', { silent: true })
    expect(wrapper.get('[data-testid="feature-flags-save-button"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="feature-flags-save-button"]').trigger('click')
    expect(wrapper.find('[data-testid="feature-flags-confirm-summary"]').exists()).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows a confirm summary of only the changed flags before PATCHing, on clicking save', async () => {
    const wrapper = await mountView()

    await wrapper.get('[data-testid="flag-toggle-storiesEnabled"]').trigger('click')

    await wrapper.get('[data-testid="feature-flags-save-button"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const changedRows = wrapper.findAll('[data-testid="feature-flags-confirm-row"]')
    expect(changedRows).toHaveLength(1)
    expect(changedRows[0]!.text()).toContain('استوری')
    expect(changedRows[0]!.text()).toContain('فعال')
    expect(changedRows[0]!.text()).toContain('غیرفعال')

    fetchMock.mockResolvedValueOnce({ data: null, error: null })
    await wrapper.get('[data-testid="feature-flags-confirm-submit"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/feature-flags', {
      method: 'PATCH',
      body: { storiesEnabled: false },
    })
    expect(wrapper.find('[data-testid="feature-flags-confirm-summary"]').exists()).toBe(false)
  })

  it('discards unsaved toggles on cancel', async () => {
    const wrapper = await mountView()

    await wrapper.get('[data-testid="flag-toggle-couponsEnabled"]').trigger('click')
    await wrapper.get('[data-testid="feature-flags-save-button"]').trigger('click')
    await wrapper.get('[data-testid="feature-flags-confirm-cancel"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledTimes(1) // only the initial load, no PATCH
    expect(wrapper.get('[data-testid="flag-toggle-couponsEnabled"]').attributes('aria-checked')).toBe('true')
    expect(wrapper.get('[data-testid="feature-flags-save-button"]').attributes('disabled')).toBeDefined()
  })

  it('shows a retry state on a failed load', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500 } })
    const wrapper = mount(FeatureFlagsView)
    await flushPromises()

    expect(wrapper.find('[data-testid="feature-flags-load-error"]').exists()).toBe(true)

    fetchMock.mockResolvedValueOnce({ data: { ...FLAGS }, error: null })
    await wrapper.get('[data-testid="feature-flags-retry-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="feature-flags-load-error"]').exists()).toBe(false)
  })
})
