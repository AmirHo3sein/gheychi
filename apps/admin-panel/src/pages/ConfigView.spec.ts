import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
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
    // fa-IR locale formatting renders Persian-Indic digits (AdjustBalanceCard.vue's own
    // toLocaleString('fa-IR') convention) -- 20 -> ۲۰, 30 -> ۳۰.
    expect(summary.text()).toContain('۲۰')
    expect(summary.text()).toContain('۳۰')
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

  // deposit_min_toman is the one toman-denominated config key -- it renders Farsi-digit,
  // fa-IR-grouped (formatToman) via AppMoneyInput, matching every other row here (%, hours).
  it('shows the toman-denominated row comma-grouped in Farsi digits, both in the field and the confirm summary', async () => {
    const wrapper = await mountView()

    const tomanInput = wrapper.get('[aria-label="حداقل پیش‌پرداخت"]')
    expect((tomanInput.element as HTMLInputElement).value).toBe('۵۰٬۰۰۰')
    expect((tomanInput.element as HTMLInputElement).type).toBe('text')

    await tomanInput.setValue('80000')
    await wrapper.get('[data-testid="config-save-button"]').trigger('click')

    const summary = wrapper.get('[data-testid="config-confirm-summary"]')
    expect(summary.text()).toContain('۵۰٬۰۰۰')
    expect(summary.text()).toContain('۸۰٬۰۰۰')
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

  it('blocks save when a field is cleared to empty text instead of silently coercing to 0', async () => {
    const wrapper = await mountView()
    const inputs = wrapper.findAll('input[type="number"]')

    await inputs[0].setValue(50) // deposit_percent: a genuine change, 20 -> 50
    // deposit_min_toman is a text field now (AppMoneyInput), so cancellation_window_hours is
    // the second remaining number input on the page.
    await inputs[1].setValue('') // cancellation_window_hours: cleared via select-all-delete

    // Number('') === 0 must never silently win here -- save stays disabled and the row
    // shows a distinguishing error, even though a real change exists elsewhere in the form.
    expect(wrapper.get('[data-testid="config-save-button"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('این مقدار نمی‌تواند خالی باشد')

    await wrapper.get('[data-testid="config-save-button"]').trigger('click')
    expect(wrapper.find('[data-testid="config-confirm-summary"]').exists()).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1) // only the initial GET -- nothing ever reached PATCH
  })

  it('blocks save when a percent-bounded field exceeds its 0-100 range', async () => {
    const wrapper = await mountView()
    const inputs = wrapper.findAll('input[type="number"]')

    await inputs[0].setValue(150) // deposit_percent: capped at 100

    expect(wrapper.get('[data-testid="config-save-button"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('باید بین')

    await wrapper.get('[data-testid="config-save-button"]').trigger('click')
    expect(wrapper.find('[data-testid="config-confirm-summary"]').exists()).toBe(false)
  })

  it('blocks save when a non-percent field goes negative', async () => {
    const wrapper = await mountView()
    const inputs = wrapper.findAll('input[type="number"]')

    // deposit_min_toman is a text field now (AppMoneyInput), so cancellation_window_hours is
    // the second remaining number input on the page.
    await inputs[1].setValue(-5) // cancellation_window_hours: floor is 0, no ceiling

    expect(wrapper.get('[data-testid="config-save-button"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('باید حداقل')
  })

  it('recovers a valid value after an invalid edit, re-enabling save', async () => {
    const wrapper = await mountView()
    const inputs = wrapper.findAll('input[type="number"]')

    await inputs[0].setValue('')
    expect(wrapper.get('[data-testid="config-save-button"]').attributes('disabled')).toBeDefined()

    await inputs[0].setValue(40)
    expect(wrapper.get('[data-testid="config-save-button"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).not.toContain('این مقدار نمی‌تواند خالی باشد')
  })

  it('shows a loading state, then a retry-capable error state when the initial load fails', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'boom' } })
    const wrapper = mount(ConfigView)

    expect(wrapper.find('[data-testid="config-loading"]').exists()).toBe(true)
    await flushPromises()

    expect(wrapper.find('[data-testid="config-load-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="config-save-button"]').exists()).toBe(false)

    fetchMock.mockResolvedValueOnce({ data: CONFIG_ROWS.map((r) => ({ ...r })), error: null })
    await wrapper.get('[data-testid="config-retry-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="config-load-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="config-save-button"]').exists()).toBe(true)
  })

  it('moves focus onto the confirm heading on opening the confirm screen, and back to save on cancel', async () => {
    fetchMock.mockResolvedValueOnce({ data: CONFIG_ROWS.map((r) => ({ ...r })), error: null })
    const wrapper = mount(ConfigView, { attachTo: document.body })
    await flushPromises()

    const inputs = wrapper.findAll('input[type="number"]')
    await inputs[0].setValue(30)
    await wrapper.get('[data-testid="config-save-button"]').trigger('click')
    await nextTick()
    await flushPromises()

    expect(document.activeElement?.textContent).toContain('این تغییرات روی رفتار پلتفرم')

    await wrapper.get('[data-testid="config-confirm-cancel"]').trigger('click')
    await nextTick()
    await flushPromises()

    expect(document.activeElement?.getAttribute('data-testid')).toBe('config-save-button')

    wrapper.unmount()
  })
})
