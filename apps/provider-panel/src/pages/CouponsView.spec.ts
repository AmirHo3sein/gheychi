import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CouponsView from './CouponsView.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'

async function mountCoupons() {
  const wrapper = mount(CouponsView)
  await new Promise((r) => setTimeout(r, 0))
  return wrapper
}

describe('CouponsView', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a retry-capable error state (not the empty-list message) when the initial load fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ message: 'boom' }) })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = await mountCoupons()

    expect(wrapper.text()).not.toContain('هنوز کد تخفیفی ثبت نشده است.')
    expect(wrapper.find('[data-testid="retry-coupons"]').exists()).toBe(true)

    fetchMock.mockClear()
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [] })
    await wrapper.find('[data-testid="retry-coupons"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="retry-coupons"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('هنوز کد تخفیفی ثبت نشده است.')
  })

  it('derives an honest status instead of trusting the raw isActive flag', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 'c-expired',
          code: 'OLD20',
          discountPercent: 20,
          expiresAt: '2020-01-01T00:00:00.000Z',
          maxRedemptions: null,
          isActive: true,
          createdAt: '2020-01-01T00:00:00.000Z',
          redeemedCount: 0,
        },
        {
          id: 'c-exhausted',
          code: 'CAPPED',
          discountPercent: 10,
          expiresAt: null,
          maxRedemptions: 2,
          isActive: true,
          createdAt: '2020-01-01T00:00:00.000Z',
          redeemedCount: 2,
        },
        {
          id: 'c-active',
          code: 'FRESH',
          discountPercent: 15,
          expiresAt: null,
          maxRedemptions: null,
          isActive: true,
          createdAt: '2020-01-01T00:00:00.000Z',
          redeemedCount: 0,
        },
        {
          id: 'c-deactivated',
          code: 'DEAD',
          discountPercent: 5,
          expiresAt: null,
          maxRedemptions: null,
          isActive: false,
          createdAt: '2020-01-01T00:00:00.000Z',
          redeemedCount: 0,
        },
      ],
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = await mountCoupons()
    const text = wrapper.text()

    // An expired-but-still-isActive coupon must not read as "فعال" (success/green).
    expect(text).toContain('منقضی شده')
    // An exhausted-but-still-isActive coupon must not read as "فعال" either.
    expect(text).toContain('به سقف استفاده رسیده')
    // A genuinely usable coupon still reads as active.
    expect(text).toContain('فعال')
    // An explicitly deactivated coupon still reads as inactive.
    expect(text).toContain('غیرفعال')
  })

  it('does not mark a coupon inactive locally when the deactivate request fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 'c-1',
            code: 'SUMMER20',
            discountPercent: 20,
            expiresAt: null,
            maxRedemptions: null,
            isActive: true,
            createdAt: '2020-01-01T00:00:00.000Z',
            redeemedCount: 0,
          },
        ],
      }) // GET coupons
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: 'boom' }) }) // DELETE fails
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const wrapper = await mountCoupons()

    const deactivateButton = wrapper.findAll('button').find((b) => b.text().includes('غیرفعال‌سازی'))!
    await deactivateButton.trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    // The deactivate button is rendered with v-if="c.isActive" -- it must still be
    // present after a failed request, proving isActive was not flipped locally.
    expect(wrapper.findAll('button').find((b) => b.text().includes('غیرفعال‌سازی'))).toBeTruthy()
  })

  it('mutates local state to inactive only after a successful deactivate', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 'c-1',
            code: 'SUMMER20',
            discountPercent: 20,
            expiresAt: null,
            maxRedemptions: null,
            isActive: true,
            createdAt: '2020-01-01T00:00:00.000Z',
            redeemedCount: 0,
          },
        ],
      }) // GET coupons
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => null }) // DELETE succeeds
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const wrapper = await mountCoupons()
    const deactivateButton = wrapper.findAll('button').find((b) => b.text().includes('غیرفعال‌سازی'))!
    await deactivateButton.trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.text()).toContain('غیرفعال')
    expect(wrapper.findAll('button').find((b) => b.text().includes('غیرفعال‌سازی'))).toBeUndefined()
  })

  it('sets an inline error instead of failing silently when required create fields are empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = await mountCoupons()
    const addButton = wrapper.findAll('button').find((b) => b.text() === 'افزودن')!
    await addButton.trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.text()).toContain('کد تخفیف را وارد کنید.')
    // No POST was fired.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects an out-of-range discount percent client-side without calling the API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = await mountCoupons()
    await wrapper.find('input.uppercase').setValue('BIGDISCOUNT')
    const numberInputs = wrapper.findAll('input[type="number"]')
    await numberInputs[0]!.setValue('150')

    const addButton = wrapper.findAll('button').find((b) => b.text() === 'افزودن')!
    await addButton.trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.text()).toContain('درصد تخفیف باید بین ۱ تا ۱۰۰ باشد.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // A bare YYYY-MM-DD parses as UTC midnight, i.e. 03:30 local on the chosen day here, so
  // the coupon used to stop redeeming on the very morning of the expiry date this list still
  // displayed -- and a same-day promo was already expired the moment it was created.
  it('sends the expiry as the end of the chosen local day, not UTC midnight', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET coupons
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          id: 'c-1',
          code: 'SUMMER20',
          discountPercent: 20,
          expiresAt: '2026-08-01T20:29:59.999Z',
          maxRedemptions: null,
          isActive: true,
          createdAt: '2026-07-30T00:00:00.000Z',
        }),
      }) // POST coupon
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = await mountCoupons()
    await wrapper.find('input.uppercase').setValue('SUMMER20')
    await wrapper.findAll('input[type="number"]')[0]!.setValue('20')
    // JalaliDatePicker isn't a native input -- drive its v-model contract directly, same as
    // AppSelect/AppMultiSelect elsewhere in this suite.
    await wrapper.findComponent(JalaliDatePicker).vm.$emit('update:modelValue', '2026-08-01')

    const addButton = wrapper.findAll('button').find((b) => b.text() === 'افزودن')!
    await addButton.trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const sent = new Date(JSON.parse(fetchMock.mock.calls[1]![1].body).expiresAt)
    // Asserted through local getters so the expectation holds in any TZ the suite runs in:
    // the instant must be the last moment of 1 August locally, never its first.
    expect(sent.getFullYear()).toBe(2026)
    expect(sent.getMonth()).toBe(7)
    expect(sent.getDate()).toBe(1)
    expect(sent.getHours()).toBe(23)
    expect(sent.getMinutes()).toBe(59)
    expect(sent.getTime()).toBeGreaterThan(new Date('2026-08-01').getTime())
  })

  it('maps a non-409 create failure to Persian copy rather than the raw backend message', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET coupons
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: 'Internal Server Error: constraint xyz violated' }) }) // POST fails
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = await mountCoupons()
    await wrapper.find('input.uppercase').setValue('WINTER10')
    const numberInputs = wrapper.findAll('input[type="number"]')
    await numberInputs[0]!.setValue('10')

    const addButton = wrapper.findAll('button').find((b) => b.text() === 'افزودن')!
    await addButton.trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.text()).not.toContain('constraint xyz violated')
    expect(wrapper.text()).toContain('افزودن کد تخفیف انجام نشد')
  })
})
