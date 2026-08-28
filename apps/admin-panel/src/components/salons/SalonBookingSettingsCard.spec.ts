import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SalonBookingSettingsCard from './SalonBookingSettingsCard.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

// Inherits both timeouts (no per-salon override), manual-approval mode.
const inheritedSettings = {
  salonId: 's1',
  bookingConfirmationMode: 'manual_approval',
  approvalTimeoutOverride: null,
  paymentTimeoutOverride: null,
  approvalTimeoutMinutes: 30,
  paymentTimeoutMinutes: 15,
  globalApprovalTimeoutMinutes: 30,
  globalPaymentTimeoutMinutes: 15,
  approvalTimeoutIsOverridden: false,
  paymentTimeoutIsOverridden: false,
}

// Same global defaults, but this salon carries an explicit approval override of 60 --
// the case where "overridden to 30" vs "inheriting 30" would otherwise be invisible.
const overriddenSettings = {
  ...inheritedSettings,
  approvalTimeoutOverride: 60,
  approvalTimeoutMinutes: 60,
  approvalTimeoutIsOverridden: true,
}

async function mountCard(settings: unknown = inheritedSettings) {
  fetchMock.mockResolvedValueOnce({ data: settings, error: null })
  const wrapper = mount(SalonBookingSettingsCard, { props: { salonId: 's1' } })
  await flushPromises()
  return wrapper
}

describe('SalonBookingSettingsCard', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('loads the salon settings and shows the mode read-only, with no control to change it', async () => {
    const wrapper = await mountCard()

    expect(fetchMock).toHaveBeenCalledWith('/admin/salons/s1/booking-settings', { silent: true })
    expect(wrapper.get('[data-testid="booking-settings-mode"]').text()).toContain('تایید دستی آرایشگاه')
    // HARD product rule: the owner picks the mode. Nothing here may edit it.
    expect(wrapper.findAll('select')).toHaveLength(0)
    expect(wrapper.text()).toContain('حالت تایید را آرایشگاه‌دار انتخاب می‌کند')
  })

  it('shows each effective value with its provenance', async () => {
    const wrapper = await mountCard(overriddenSettings)

    // Overridden: the number alone, no global-default qualifier.
    const approval = wrapper.get('[data-testid="booking-settings-effective-approval"]').text()
    expect(approval).toContain('۶۰ دقیقه')
    expect(approval).not.toContain('پیش‌فرض سراسری')
    // Inherited: the same number shape, explicitly marked as coming from the global default.
    const payment = wrapper.get('[data-testid="booking-settings-effective-payment"]').text()
    expect(payment).toContain('۱۵ دقیقه')
    expect(payment).toContain('پیش‌فرض سراسری')
  })

  it('prefills only the fields that actually carry an override', async () => {
    const wrapper = await mountCard(overriddenSettings)

    expect((wrapper.get('[data-testid="booking-settings-input-approval"]').element as HTMLInputElement).value).toBe('60')
    // An inherited value must leave the box empty rather than showing the global as if it
    // were this salon's own override.
    expect((wrapper.get('[data-testid="booking-settings-input-payment"]').element as HTMLInputElement).value).toBe('')
  })

  it('disables save until something changes, and never opens the confirm screen on a no-op', async () => {
    const wrapper = await mountCard()

    expect(wrapper.get('[data-testid="booking-settings-save-button"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="booking-settings-save-button"]').trigger('click')
    expect(wrapper.find('[data-testid="booking-settings-confirm-summary"]').exists()).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('confirms before PATCHing, sending only the changed timeout', async () => {
    const wrapper = await mountCard()

    await wrapper.get('[data-testid="booking-settings-input-approval"]').setValue(90)
    await wrapper.get('[data-testid="booking-settings-save-button"]').trigger('click')

    // No PATCH fired yet -- only the confirm screen appeared.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const rows = wrapper.findAll('[data-testid="booking-settings-confirm-row"]')
    expect(rows).toHaveLength(1)
    // «از پیش‌فرض سراسری (۳۰ دقیقه) به ۹۰ دقیقه» -- Farsi digits, like every other number here.
    expect(rows[0]!.text()).toContain('مهلت تایید درخواست')
    expect(rows[0]!.text()).toContain('۳۰ دقیقه')
    expect(rows[0]!.text()).toContain('۹۰ دقیقه')

    fetchMock.mockResolvedValueOnce({
      data: { ...inheritedSettings, approvalTimeoutOverride: 90, approvalTimeoutMinutes: 90, approvalTimeoutIsOverridden: true },
      error: null,
    })
    await wrapper.get('[data-testid="booking-settings-confirm-submit"]').trigger('click')
    await flushPromises()

    // The untouched payment timeout is absent from the body entirely (undefined = leave
    // alone), NOT rewritten to its own current value.
    expect(fetchMock).toHaveBeenCalledWith('/admin/salons/s1/booking-settings', {
      method: 'PATCH',
      body: { approvalTimeoutMinutes: 90 },
    })
    expect(wrapper.find('[data-testid="booking-settings-confirm-summary"]').exists()).toBe(false)
    // The PATCH response re-resolves the effective value, so provenance updates in place.
    const approval = wrapper.get('[data-testid="booking-settings-effective-approval"]').text()
    expect(approval).toContain('۹۰ دقیقه')
    expect(approval).not.toContain('پیش‌فرض سراسری')
  })

  it('clears an override by sending an explicit null, not by omitting the key', async () => {
    const wrapper = await mountCard(overriddenSettings)

    await wrapper.get('[data-testid="booking-settings-clear-approval"]').trigger('click')
    expect((wrapper.get('[data-testid="booking-settings-input-approval"]').element as HTMLInputElement).value).toBe('')

    await wrapper.get('[data-testid="booking-settings-save-button"]').trigger('click')
    // The summary must state what the salon falls back to, not a bare dash.
    expect(wrapper.get('[data-testid="booking-settings-confirm-row"]').text()).toContain('پیش‌فرض سراسری')

    fetchMock.mockResolvedValueOnce({ data: inheritedSettings, error: null })
    await wrapper.get('[data-testid="booking-settings-confirm-submit"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/salons/s1/booking-settings', {
      method: 'PATCH',
      body: { approvalTimeoutMinutes: null },
    })
    expect(wrapper.get('[data-testid="booking-settings-effective-approval"]').text()).toContain('پیش‌فرض سراسری')
  })

  it('emptying a field that never had an override is not a change', async () => {
    const wrapper = await mountCard()

    // Already empty (inherited) -- retyping nothing must not enable save.
    await wrapper.get('[data-testid="booking-settings-input-payment"]').setValue('')

    expect(wrapper.get('[data-testid="booking-settings-save-button"]').attributes('disabled')).toBeDefined()
  })

  it('blocks save on an out-of-range or non-integer value', async () => {
    const wrapper = await mountCard()
    const input = wrapper.get('[data-testid="booking-settings-input-approval"]')

    await input.setValue(0)
    expect(wrapper.get('[data-testid="booking-settings-save-button"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('باید بین ۱ تا ۱۴۴۰ دقیقه باشد')

    await input.setValue(1441)
    expect(wrapper.get('[data-testid="booking-settings-save-button"]').attributes('disabled')).toBeDefined()

    await input.setValue(10.5)
    expect(wrapper.get('[data-testid="booking-settings-save-button"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('مقدار باید عدد صحیح باشد')

    await wrapper.get('[data-testid="booking-settings-save-button"]').trigger('click')
    expect(wrapper.find('[data-testid="booking-settings-confirm-summary"]').exists()).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1) // only the initial GET -- nothing reached PATCH

    // ...and a valid value recovers, re-enabling save.
    await input.setValue(45)
    expect(wrapper.get('[data-testid="booking-settings-save-button"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).not.toContain('باید بین ۱ تا ۱۴۴۰ دقیقه باشد')
  })

  it('cancelling the confirm screen fires no PATCH and keeps the in-progress edit', async () => {
    const wrapper = await mountCard()

    await wrapper.get('[data-testid="booking-settings-input-approval"]').setValue(45)
    await wrapper.get('[data-testid="booking-settings-save-button"]').trigger('click')
    expect(wrapper.find('[data-testid="booking-settings-confirm-summary"]').exists()).toBe(true)

    await wrapper.get('[data-testid="booking-settings-confirm-cancel"]').trigger('click')

    expect(wrapper.find('[data-testid="booking-settings-confirm-summary"]').exists()).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="booking-settings-save-button"]').attributes('disabled')).toBeUndefined()
  })

  it('keeps the confirm screen open when the PATCH fails, so the change is not silently lost', async () => {
    const wrapper = await mountCard()

    await wrapper.get('[data-testid="booking-settings-input-approval"]').setValue(45)
    await wrapper.get('[data-testid="booking-settings-save-button"]').trigger('click')

    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'boom' } })
    await wrapper.get('[data-testid="booking-settings-confirm-submit"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="booking-settings-confirm-summary"]').exists()).toBe(true)
    // Nothing was optimistically applied: backing out still shows the inherited value in
    // force, and the edit is still pending.
    await wrapper.get('[data-testid="booking-settings-confirm-cancel"]').trigger('click')
    expect(wrapper.get('[data-testid="booking-settings-effective-approval"]').text()).toContain('پیش‌فرض سراسری')
    expect(wrapper.get('[data-testid="booking-settings-effective-approval"]').text()).toContain('۳۰ دقیقه')
    expect((wrapper.get('[data-testid="booking-settings-input-approval"]').element as HTMLInputElement).value).toBe('45')
  })

  it('notes that the approval timeout is currently unused while the salon is on automatic mode', async () => {
    const wrapper = await mountCard({ ...inheritedSettings, bookingConfirmationMode: 'automatic' })

    expect(wrapper.get('[data-testid="booking-settings-mode"]').text()).toContain('تایید خودکار')
    expect(wrapper.find('[data-testid="booking-settings-automatic-note"]').exists()).toBe(true)
  })

  it('shows a loading state, then a retry-capable error state when the initial load fails', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'boom' } })
    const wrapper = mount(SalonBookingSettingsCard, { props: { salonId: 's1' } })

    expect(wrapper.find('[data-testid="booking-settings-loading"]').exists()).toBe(true)
    await flushPromises()

    expect(wrapper.find('[data-testid="booking-settings-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="booking-settings-save-button"]').exists()).toBe(false)

    fetchMock.mockResolvedValueOnce({ data: inheritedSettings, error: null })
    await wrapper.get('[data-testid="booking-settings-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="booking-settings-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="booking-settings-save-button"]').exists()).toBe(true)
  })

  it('moves focus onto the confirm heading on opening the confirm screen, and back to save on cancel', async () => {
    fetchMock.mockResolvedValueOnce({ data: inheritedSettings, error: null })
    const wrapper = mount(SalonBookingSettingsCard, { props: { salonId: 's1' }, attachTo: document.body })
    await flushPromises()

    await wrapper.get('[data-testid="booking-settings-input-approval"]').setValue(45)
    await wrapper.get('[data-testid="booking-settings-save-button"]').trigger('click')
    await nextTick()
    await flushPromises()

    expect(document.activeElement?.textContent).toContain('این تغییرات روی مهلت‌های رزروهای بعدی')

    await wrapper.get('[data-testid="booking-settings-confirm-cancel"]').trigger('click')
    await nextTick()
    await flushPromises()

    expect(document.activeElement?.getAttribute('data-testid')).toBe('booking-settings-save-button')

    wrapper.unmount()
  })
})
