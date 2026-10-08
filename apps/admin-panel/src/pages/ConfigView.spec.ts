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
    expect(summary.text()).toContain('درصد بیعانه')
    // fa-IR locale formatting renders Persian-Indic digits (AdjustBalanceCard.vue's own
    // toLocaleString('fa-IR') convention) -- 20 -> ۲۰, 30 -> ۳۰.
    expect(summary.text()).toContain('۲۰')
    expect(summary.text()).toContain('۳۰')
    expect(summary.text()).not.toContain('مهلت لغو نوبت')

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

    const tomanInput = wrapper.get('[aria-label="حداقل بیعانه"]')
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

  describe('beauty guide keys', () => {
    const BEAUTY_ROWS = [
      { key: 'beauty_guide_daily_limit_per_user', value: 3 },
      { key: 'beauty_guide_daily_limit_global', value: 300 },
      { key: 'beauty_guide_retention_days', value: 90 },
    ]

    async function mountBeauty() {
      fetchMock.mockResolvedValueOnce({ data: BEAUTY_ROWS.map((r) => ({ ...r })), error: null })
      const wrapper = mount(ConfigView)
      await flushPromises()
      return wrapper
    }

    it('renders Farsi labels for the three beauty-guide keys', async () => {
      const wrapper = await mountBeauty()
      expect(wrapper.text()).toContain('سقف روزانه راهنمای زیبایی برای هر کاربر')
      expect(wrapper.text()).toContain('سقف روزانه کل راهنماهای زیبایی (کنترل هزینه)')
      expect(wrapper.text()).toContain('مدت نگهداری تصاویر راهنمای زیبایی (روز)')
    })

    it('mirrors the server bounds: per-user cap above 1000 is blocked', async () => {
      const wrapper = await mountBeauty()
      await wrapper.findAll('input[type="number"]')[0].setValue(1001)
      expect(wrapper.get('[data-testid="config-save-button"]').attributes('disabled')).toBeDefined()
      expect(wrapper.text()).toContain('باید بین 0 تا 1000')
    })

    it('mirrors the server bounds: global cap accepts 1000000 but not more', async () => {
      const wrapper = await mountBeauty()
      const input = wrapper.findAll('input[type="number"]')[1]
      await input.setValue(1000000)
      expect(wrapper.get('[data-testid="config-save-button"]').attributes('disabled')).toBeUndefined()
      await input.setValue(1000001)
      expect(wrapper.get('[data-testid="config-save-button"]').attributes('disabled')).toBeDefined()
    })

    it('mirrors the server bounds: retention below 1 day is blocked', async () => {
      const wrapper = await mountBeauty()
      await wrapper.findAll('input[type="number"]')[2].setValue(0)
      expect(wrapper.get('[data-testid="config-save-button"]').attributes('disabled')).toBeDefined()
      expect(wrapper.text()).toContain('باید بین 1 تا 3650')
    })

    it('rejects a fractional value for these integer-only keys', async () => {
      const wrapper = await mountBeauty()
      await wrapper.findAll('input[type="number"]')[0].setValue(2.5)
      expect(wrapper.get('[data-testid="config-save-button"]').attributes('disabled')).toBeDefined()
      expect(wrapper.text()).toContain('یک عدد صحیح وارد کنید')
    })
  })

  describe('booking abuse limits and no-show grace', () => {
    async function mountLimits(extra: { key: string; value: number | boolean }[] = []) {
      fetchMock.mockResolvedValueOnce({
        data: [
          { key: 'booking_max_active_per_user', value: 5 },
          { key: 'booking_max_active_per_salon_per_user', value: 2 },
          { key: 'no_show_grace_minutes', value: 30 },
          ...extra,
        ],
        error: null,
      })
      const wrapper = mount(ConfigView)
      await flushPromises()
      return wrapper
    }
    const save = (w: Awaited<ReturnType<typeof mountLimits>>) => w.get('[data-testid="config-save-button"]').attributes('disabled')

    it('labels the three keys in Persian rather than showing raw key names', async () => {
      const wrapper = await mountLimits()
      expect(wrapper.text()).toContain('سقف نوبت‌های فعال هر مشتری')
      expect(wrapper.text()).toContain('مهلت ثبت عدم حضور')
      expect(wrapper.text()).not.toContain('booking_max_active_per_user')
    })

    it.each([
      [0, 0, true],
      [51, 0, true],
      [1, 0, false],
      [50, 0, false],
    ])('per-user cap %s is %s', async (value, _i, blocked) => {
      const wrapper = await mountLimits()
      await wrapper.findAll('input[type="number"]')[0]!.setValue(value)
      expect(save(wrapper) !== undefined).toBe(blocked)
    })

    it.each([
      [0, true],
      [21, true],
      [20, false],
    ])('per-salon cap %s is blocked=%s (1-20)', async (value, blocked) => {
      const wrapper = await mountLimits()
      await wrapper.findAll('input[type="number"]')[1]!.setValue(value)
      expect(save(wrapper) !== undefined).toBe(blocked)
    })

    it.each([
      [0, false],
      [1440, false],
      [1441, true],
      [-1, true],
      [2.5, true],
    ])('no-show grace %s is blocked=%s (0-1440, integer)', async (value, blocked) => {
      const wrapper = await mountLimits()
      await wrapper.findAll('input[type="number"]')[2]!.setValue(value)
      expect(save(wrapper) !== undefined).toBe(blocked)
    })

    it('shows the inline range message for an out-of-range grace value', async () => {
      const wrapper = await mountLimits()
      await wrapper.findAll('input[type="number"]')[2]!.setValue(1441)
      expect(wrapper.text()).toContain('باید بین 0 تا 1440')
    })

    it('never lists or submits a feature flag, even if the list endpoint returned one', async () => {
      const wrapper = await mountLimits([{ key: 'feature_reviews_enabled', value: true }])
      expect(wrapper.text()).not.toContain('feature_reviews_enabled')

      await wrapper.findAll('input[type="number"]')[0]!.setValue(6)
      await wrapper.get('[data-testid="config-save-button"]').trigger('click')
      fetchMock.mockResolvedValueOnce({ data: [], error: null })
      await wrapper.get('[data-testid="config-confirm-submit"]').trigger('click')
      await flushPromises()

      const patch = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')!
      const keys = (patch[1].body.updates as { key: string }[]).map((u) => u.key)
      expect(keys).not.toContain('feature_reviews_enabled')
      expect(keys).toContain('booking_max_active_per_user')
    })
  })
})
