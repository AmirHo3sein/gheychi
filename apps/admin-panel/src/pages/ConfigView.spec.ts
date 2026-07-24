import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ConfigView from './ConfigView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const CONFIG_ROWS = [
  { key: 'deposit_percent', value: 20 },
  { key: 'deposit_min_toman', value: 50000 },
  { key: 'cancellation_window_hours', value: 24 },
]

async function mountView() {
  fetchMock.mockResolvedValueOnce({ data: CONFIG_ROWS.map((r) => ({ ...r })), error: null })
  const wrapper = mount(ConfigView)
  await flushPromises()
  return wrapper
}

describe('ConfigView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('loads rows and disables save when nothing changed', async () => {
    const wrapper = await mountView()

    expect(fetchMock).toHaveBeenCalledWith('/admin/config', { silent: true })
    expect(wrapper.get('[data-testid="config-save-button"]').attributes('disabled')).toBeDefined()
    // Clicking a disabled/no-op save must not open the confirm screen or fire the PATCH.
    await wrapper.get('[data-testid="config-save-button"]').trigger('click')
    expect(wrapper.find('[data-testid="config-confirm-summary"]').exists()).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows a confirm summary of only the changed rows before PATCHing, on clicking save', async () => {
    const wrapper = await mountView()

    const inputs = wrapper.findAll('input[type="number"]')
    await inputs[0].setValue(30) // deposit_percent 20 -> 30
    // cancellation_window_hours (index 2) left untouched.

    await wrapper.get('[data-testid="config-save-button"]').trigger('click')

    // No PATCH fired yet -- only the confirm screen appeared.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const summary = wrapper.get('[data-testid="config-confirm-summary"]')
    const changedRows = wrapper.findAll('[data-testid="config-confirm-row"]')
    expect(changedRows).toHaveLength(1)
    expect(summary.text()).toContain('درصد پیش‌پرداخت')
    expect(summary.text()).toContain('20')
    expect(summary.text()).toContain('30')
    expect(summary.text()).not.toContain('مهلت لغو رزرو')

    fetchMock.mockResolvedValueOnce({ data: null, error: null })
    await wrapper.get('[data-testid="config-confirm-submit"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/config', {
      method: 'PATCH',
      body: {
        updates: [
          { key: 'deposit_percent', value: 30 },
          { key: 'deposit_min_toman', value: 50000 },
          { key: 'cancellation_window_hours', value: 24 },
        ],
      },
    })
    // Confirm screen closes back to the editable list after a successful save.
    expect(wrapper.find('[data-testid="config-confirm-summary"]').exists()).toBe(false)
  })

  it('cancelling the confirm screen does not fire the PATCH', async () => {
    const wrapper = await mountView()

    const inputs = wrapper.findAll('input[type="number"]')
    await inputs[0].setValue(30)
    await wrapper.get('[data-testid="config-save-button"]').trigger('click')
    expect(wrapper.find('[data-testid="config-confirm-summary"]').exists()).toBe(true)

    await wrapper.get('[data-testid="config-confirm-cancel"]').trigger('click')

    expect(wrapper.find('[data-testid="config-confirm-summary"]').exists()).toBe(false)
    // Only the initial GET happened -- no PATCH was ever sent.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalledWith('/admin/config', expect.objectContaining({ method: 'PATCH' }))
    // The edited value survives the cancel so the admin doesn't lose their in-progress edit.
    expect(wrapper.get('[data-testid="config-save-button"]').attributes('disabled')).toBeUndefined()
  })
})
