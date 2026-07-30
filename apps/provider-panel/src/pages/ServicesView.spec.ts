import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppSelect from '@/components/ui/AppSelect.vue'
import { resetToast, useToast } from '@/composables/useToast'
import ServicesView from './ServicesView.vue'

// Always handed to a mock as a fresh copy: the component keeps the objects the fetch mock
// returns and writes back to them on a successful save, so sharing this reference would let
// one test's price update leak into the next test's starting state.
const SERVICE = {
  id: 'svc-1',
  categoryId: 1,
  name: 'کوتاهی مو',
  price: 100000,
  durationMin: 30,
  isActive: true,
  discountPercent: null,
}

describe('ServicesView', () => {
  beforeEach(() => {
    resetToast()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not deactivate a service without confirmation, and the row stays untouched', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
    vi.stubGlobal('fetch', fetchMock)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="deactivate-service"]').exists()).toBe(true)
    await wrapper.find('[data-testid="deactivate-service"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(confirmSpy).toHaveBeenCalled()
    // Only the two initial GETs happened -- no DELETE was fired.
    expect(fetchMock.mock.calls.length).toBe(2)
    // The service row is still rendered -- declining the confirm must not remove it.
    expect(wrapper.text()).toContain('کوتاهی مو')
  })

  it('deactivates a service after confirmation, sending a real DELETE and removing the row', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => null }) // DELETE service
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('[data-testid="deactivate-service"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const deleteCall = fetchMock.mock.calls[2]!
    expect(deleteCall[0]).toContain('/salons/mine/services/svc-1')
    expect(deleteCall[1]).toMatchObject({ method: 'DELETE' })
    expect(wrapper.text()).not.toContain('کوتاهی مو')
  })

  it('renders no checkbox for the active state -- deactivation is an explicit danger action, not a bare toggle', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
  })

  it('shows a retry-capable error state when either the services or categories load fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: 'boom' }) }) // GET services fails
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="retry-services"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('هنوز خدمتی ثبت نشده است')
  })

  it('retries both fetches when the retry button is clicked after a load failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: 'boom' }) }) // GET services fails
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services (retry)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories (retry)
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('[data-testid="retry-services"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls.length).toBe(4)
    expect(wrapper.find('[data-testid="retry-services"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('کوتاهی مو')
  })

  it('shows a success toast after updating a price', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ...SERVICE, price: 150000 }) }) // PATCH price
    vi.stubGlobal('fetch', fetchMock)
    // A price change is money-facing and commits on blur, so it now goes through a confirm.
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    // First number input on the page is the service row's price field.
    const input = wrapper.findAll('input[type="number"]')[0]!
    await input.setValue('150000')
    await input.trigger('change')
    await new Promise((r) => setTimeout(r, 0))

    const patchCall = fetchMock.mock.calls[2]!
    expect(patchCall[0]).toContain('/salons/mine/services/svc-1')
    expect(patchCall[1]).toMatchObject({ method: 'PATCH' })
    expect(JSON.parse(patchCall[1].body)).toEqual({ price: 150000 })
    expect(useToast().toasts.value.some((t) => t.message === 'قیمت به‌روزرسانی شد')).toBe(true)
  })

  // A `type="number"` input drops Persian digits entirely, so the natural "select all and
  // retype ۱۸۰۰۰۰" leaves the field empty and fires `change` on blur. That used to PATCH
  // { price: 0 } -- which the API's @Min(0) accepts -- and then report success, publishing a
  // free, bookable service.
  it.each([['', 'empty'], ['0', 'zero'], ['-5', 'negative'], ['۱۸۰۰۰۰', 'Persian digits (dropped by type=number)']])(
    'refuses to save %s (%s) as a price, restores the previous value and warns instead of reporting success',
    async (value) => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      vi.stubGlobal('fetch', fetchMock)
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

      const wrapper = mount(ServicesView)
      await new Promise((r) => setTimeout(r, 0))

      const input = wrapper.findAll('input[type="number"]')[0]!
      await input.setValue(value)
      await input.trigger('change')
      await new Promise((r) => setTimeout(r, 0))

      // Only the two initial GETs happened -- no PATCH was fired.
      expect(fetchMock.mock.calls.length).toBe(2)
      expect(confirmSpy).not.toHaveBeenCalled()
      expect((input.element as HTMLInputElement).value).toBe('100000')
      expect(useToast().toasts.value.some((t) => t.message === 'قیمت باید یک عدد صحیح بزرگ‌تر از صفر باشد.')).toBe(true)
      expect(useToast().toasts.value.some((t) => t.message === 'قیمت به‌روزرسانی شد')).toBe(false)
    },
  )

  it('does not save a price change when the confirm is declined, and puts the field back', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    const input = wrapper.findAll('input[type="number"]')[0]!
    await input.setValue('1')
    await input.trigger('change')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls.length).toBe(2)
    expect((input.element as HTMLInputElement).value).toBe('100000')
    expect(useToast().toasts.value.some((t) => t.message === 'قیمت به‌روزرسانی شد')).toBe(false)
  })

  it('shows an inline error and skips the request when adding a service with an empty price', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.findAll('input[type="text"]').at(-1)!.setValue('رنگ مو')
    // AppSelect wraps vue-multiselect (no native <select> to set), so drive its contract.
    await wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 1)
    // The new-service price field: first number input, since no service rows are rendered.
    await wrapper.findAll('input[type="number"]')[0]!.setValue('')

    const addButton = wrapper.findAll('button').find((b) => b.text().includes('افزودن'))!
    await addButton.trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.text()).toContain('قیمت خدمت باید یک عدد صحیح بزرگ‌تر از صفر باشد')
    // Only the two initial GETs happened -- no POST was fired.
    expect(fetchMock.mock.calls.length).toBe(2)
  })

  // CreateServiceDto is @Min(5)/@Max(600) on durationMin, and clearing the field lands here
  // as 0 (Number('')). The form used to validate only category and name, so the DTO rejection
  // -- an English validator array in a toast -- was the provider's only feedback.
  it.each([['', 'empty'], ['0', 'zero'], ['3', 'below the 5 minute minimum'], ['900', 'above the 600 minute maximum']])(
    'shows an inline Persian error and skips the request when adding a service with duration %s (%s)',
    async (value) => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
      vi.stubGlobal('fetch', fetchMock)

      const wrapper = mount(ServicesView)
      await new Promise((r) => setTimeout(r, 0))

      await wrapper.findAll('input[type="text"]').at(-1)!.setValue('رنگ مو')
      await wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 1)
      // No service rows are rendered, so the create card owns every number input:
      // [0] price, [1] duration, [2] discount.
      const numberInputs = wrapper.findAll('input[type="number"]')
      await numberInputs[0]!.setValue('150000')
      await numberInputs[1]!.setValue(value)

      const addButton = wrapper.findAll('button').find((b) => b.text().includes('افزودن'))!
      await addButton.trigger('click')
      await new Promise((r) => setTimeout(r, 0))

      expect(wrapper.text()).toContain('مدت زمان خدمت باید عددی صحیح بین ۵ تا ۶۰۰ دقیقه باشد.')
      expect(fetchMock.mock.calls.length).toBe(2)
    },
  )

  it('shows an inline Persian error and skips the request when adding a service with an out-of-range discount', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.findAll('input[type="text"]').at(-1)!.setValue('رنگ مو')
    await wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 1)
    const numberInputs = wrapper.findAll('input[type="number"]')
    await numberInputs[0]!.setValue('150000')
    await numberInputs[2]!.setValue('150')

    const addButton = wrapper.findAll('button').find((b) => b.text().includes('افزودن'))!
    await addButton.trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.text()).toContain('درصد تخفیف باید عددی صحیح بین ۱ تا ۱۰۰ باشد.')
    expect(fetchMock.mock.calls.length).toBe(2)
  })

  // The row's `min="1"` attribute never stopped anyone typing 0, and UpdateServiceDto's
  // @Min(1) rejects it -- so a typed 0 used to produce nothing but an English validator array.
  it.each([['0', 'zero'], ['150', 'above 100'], ['-5', 'negative']])(
    'refuses to save %s (%s) as a row discount, restores the field and warns in Persian',
    async (value) => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE, discountPercent: 20 }] }) // GET services
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      vi.stubGlobal('fetch', fetchMock)

      const wrapper = mount(ServicesView)
      await new Promise((r) => setTimeout(r, 0))

      // Row inputs come first: [0] price, [1] discount.
      const discountInput = wrapper.findAll('input[type="number"]')[1]!
      await discountInput.setValue(value)
      await discountInput.trigger('change')
      await new Promise((r) => setTimeout(r, 0))

      expect(fetchMock.mock.calls.length).toBe(2)
      expect((discountInput.element as HTMLInputElement).value).toBe('20')
      expect(useToast().toasts.value.some((t) => t.message === 'درصد تخفیف باید عددی صحیح بین ۱ تا ۱۰۰ باشد.')).toBe(true)
      expect(useToast().toasts.value.some((t) => t.message === 'تخفیف به‌روزرسانی شد')).toBe(false)
    },
  )

  it('saves a valid row discount, and clears it with an explicit null', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...SERVICE }) }) // PATCHes
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    const discountInput = wrapper.findAll('input[type="number"]')[1]!
    await discountInput.setValue('20')
    await discountInput.trigger('change')
    await new Promise((r) => setTimeout(r, 0))

    expect(JSON.parse(fetchMock.mock.calls[2]![1].body)).toEqual({ discountPercent: 20 })
    expect(useToast().toasts.value.some((t) => t.message === 'تخفیف به‌روزرسانی شد')).toBe(true)

    // Emptying the field is the clear path -- null, not 0.
    await discountInput.setValue('')
    await discountInput.trigger('change')
    await new Promise((r) => setTimeout(r, 0))

    expect(JSON.parse(fetchMock.mock.calls[3]![1].body)).toEqual({ discountPercent: null })
  })

  it('shows an inline error and skips the request when adding a service without a category', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    const nameInput = wrapper.findAll('input[type="text"]').at(-1)
    if (nameInput) await nameInput.setValue('رنگ مو')

    const addButton = wrapper.findAll('button').find((b) => b.text().includes('افزودن'))!
    await addButton.trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.text()).toContain('دسته‌بندی خدمت را انتخاب کنید')
    // Only the two initial GETs happened -- no POST was fired.
    expect(fetchMock.mock.calls.length).toBe(2)
  })
})
