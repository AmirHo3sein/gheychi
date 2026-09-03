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
  description: null,
  price: 100000,
  durationMin: 30,
  isActive: true,
  discountPercent: null,
}

// ServicesView fires two separate onMounted hooks -- load() (services + categories, via
// Promise.all) and loadCategoryRequests() -- and Vue runs onMounted callbacks synchronously
// in registration order up to each one's first await, so the real fetch() call order is
// always: services, categories, category-requests. Every test below queues this as the 3rd
// response so later user-triggered calls land at the expected index.
const CATEGORY_REQUESTS_EMPTY = { ok: true, status: 200, json: async () => [] }

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
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
    vi.stubGlobal('fetch', fetchMock)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="deactivate-service"]').exists()).toBe(true)
    await wrapper.find('[data-testid="deactivate-service"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(confirmSpy).toHaveBeenCalled()
    // Only the three initial GETs happened -- no DELETE was fired.
    expect(fetchMock.mock.calls.length).toBe(3)
    // The service row is still rendered -- declining the confirm must not remove it.
    expect(wrapper.text()).toContain('کوتاهی مو')
  })

  it('deactivates a service after confirmation, sending a real DELETE and removing the row', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => null }) // DELETE service
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('[data-testid="deactivate-service"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const deleteCall = fetchMock.mock.calls[3]!
    expect(deleteCall[0]).toContain('/salons/mine/services/svc-1')
    expect(deleteCall[1]).toMatchObject({ method: 'DELETE' })
    expect(wrapper.text()).not.toContain('کوتاهی مو')
  })

  it('renders no checkbox for the active state -- deactivation is an explicit danger action, not a bare toggle', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
  })

  it('shows a retry-capable error state when either the services or categories load fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: 'boom' }) }) // GET services fails
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
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
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services (retry)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories (retry)
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('[data-testid="retry-services"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls.length).toBe(5)
    expect(wrapper.find('[data-testid="retry-services"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('کوتاهی مو')
  })

  it('shows a success toast after updating a price', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ...SERVICE, price: 150000 }) }) // PATCH price
    vi.stubGlobal('fetch', fetchMock)
    // A price change is money-facing and commits on blur, so it now goes through a confirm.
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    const input = wrapper.get('[data-testid="service-price-input"]')
    await input.setValue('150000')
    await input.trigger('change')
    await new Promise((r) => setTimeout(r, 0))

    const patchCall = fetchMock.mock.calls[3]!
    expect(patchCall[0]).toContain('/salons/mine/services/svc-1')
    expect(patchCall[1]).toMatchObject({ method: 'PATCH' })
    expect(JSON.parse(patchCall[1].body)).toEqual({ price: 150000 })
    expect(useToast().toasts.value.some((t) => t.message === 'قیمت به‌روزرسانی شد')).toBe(true)
  })

  it.each([['', 'empty'], ['0', 'zero'], ['-5', 'negative']])(
    'refuses to save %s (%s) as a price, restores the previous value and warns instead of reporting success',
    async (value) => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
        .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      vi.stubGlobal('fetch', fetchMock)
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

      const wrapper = mount(ServicesView)
      await new Promise((r) => setTimeout(r, 0))

      const input = wrapper.get('[data-testid="service-price-input"]')
      await input.setValue(value)
      await input.trigger('change')
      await new Promise((r) => setTimeout(r, 0))

      // Only the three initial GETs happened -- no PATCH was fired.
      expect(fetchMock.mock.calls.length).toBe(3)
      expect(confirmSpy).not.toHaveBeenCalled()
      // AppMoneyInput redraws comma-grouped once it isn't focused (this test never focuses
      // it, matching how the rejection restores the field programmatically, not via a user
      // still typing in it).
      expect((input.element as HTMLInputElement).value).toBe('۱۰۰٬۰۰۰')
      expect(useToast().toasts.value.some((t) => t.message === 'قیمت باید یک عدد صحیح بزرگ‌تر از صفر باشد.')).toBe(true)
      expect(useToast().toasts.value.some((t) => t.message === 'قیمت به‌روزرسانی شد')).toBe(false)
    },
  )

  // AppMoneyInput normalizes Persian digits instead of silently discarding them (the old
  // type="number" field's documented bug -- the natural "select all, retype ۱۸۰۰۰۰" used to
  // leave the field empty and PATCH { price: 0 }, which the API's @Min(0) happily accepted).
  it('accepts a Persian-digit price entry, normalizing it rather than rejecting it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ...SERVICE, price: 180000 }) }) // PATCH price
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    const input = wrapper.get('[data-testid="service-price-input"]')
    await input.setValue('۱۸۰۰۰۰')
    await input.trigger('change')
    await new Promise((r) => setTimeout(r, 0))

    const patchCall = fetchMock.mock.calls[3]!
    expect(JSON.parse(patchCall[1].body)).toEqual({ price: 180000 })
    expect(useToast().toasts.value.some((t) => t.message === 'قیمت به‌روزرسانی شد')).toBe(true)
  })

  it('does not save a price change when the confirm is declined, and puts the field back', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    const input = wrapper.get('[data-testid="service-price-input"]')
    await input.setValue('1')
    await input.trigger('change')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls.length).toBe(3)
    expect((input.element as HTMLInputElement).value).toBe('۱۰۰٬۰۰۰')
    expect(useToast().toasts.value.some((t) => t.message === 'قیمت به‌روزرسانی شد')).toBe(false)
  })

  it('ignores a second click on «افزودن» while the create request is still in flight', async () => {
    let resolveCreate!: (value: unknown) => void
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      .mockImplementationOnce(() => new Promise((resolve) => { resolveCreate = resolve })) // POST service -- held open
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services (reload)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories (reload)
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('input[placeholder="نام خدمت"]').setValue('رنگ مو')
    await wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 1)
    await wrapper.get('[data-testid="new-service-price-input"]').setValue('150000')

    const addButton = wrapper.get('[data-testid="add-service"]')
    await addButton.trigger('click')
    await addButton.trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    // Three initial GETs + exactly ONE POST, and the button is visibly busy meanwhile.
    expect(fetchMock.mock.calls.length).toBe(4)
    expect((addButton.element as HTMLButtonElement).disabled).toBe(true)
    expect(addButton.attributes('aria-busy')).toBe('true')

    resolveCreate({ ok: true, status: 201, json: async () => ({ id: 'svc-2' }) })
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect((addButton.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows an inline error and skips the request when adding a service with an empty price', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('input[placeholder="نام خدمت"]').setValue('رنگ مو')
    // AppSelect wraps vue-multiselect (no native <select> to set), so drive its contract.
    await wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 1)
    await wrapper.get('[data-testid="new-service-price-input"]').setValue('')

    const addButton = wrapper.findAll('button').find((b) => b.text().includes('افزودن'))!
    await addButton.trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.text()).toContain('قیمت خدمت باید یک عدد صحیح بزرگ‌تر از صفر باشد')
    // Only the three initial GETs happened -- no POST was fired.
    expect(fetchMock.mock.calls.length).toBe(3)
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
        .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      vi.stubGlobal('fetch', fetchMock)

      const wrapper = mount(ServicesView)
      await new Promise((r) => setTimeout(r, 0))

      await wrapper.find('input[placeholder="نام خدمت"]').setValue('رنگ مو')
      await wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 1)
      await wrapper.get('[data-testid="new-service-price-input"]').setValue('150000')
      // Price is a text field now (AppMoneyInput); no service rows are rendered, so the
      // create card owns every remaining number input: [0] duration, [1] discount.
      const numberInputs = wrapper.findAll('input[type="number"]')
      await numberInputs[0]!.setValue(value)

      const addButton = wrapper.findAll('button').find((b) => b.text().includes('افزودن'))!
      await addButton.trigger('click')
      await new Promise((r) => setTimeout(r, 0))

      expect(wrapper.text()).toContain('مدت زمان خدمت باید عددی صحیح بین ۵ تا ۶۰۰ دقیقه باشد.')
      expect(fetchMock.mock.calls.length).toBe(3)
    },
  )

  it('shows an inline Persian error and skips the request when adding a service with an out-of-range discount', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('input[placeholder="نام خدمت"]').setValue('رنگ مو')
    await wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 1)
    await wrapper.get('[data-testid="new-service-price-input"]').setValue('150000')
    // Price is a text field now (AppMoneyInput); [0] duration, [1] discount remain.
    const numberInputs = wrapper.findAll('input[type="number"]')
    await numberInputs[1]!.setValue('150')

    const addButton = wrapper.findAll('button').find((b) => b.text().includes('افزودن'))!
    await addButton.trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.text()).toContain('درصد تخفیف باید عددی صحیح بین ۱ تا ۱۰۰ باشد.')
    expect(fetchMock.mock.calls.length).toBe(3)
  })

  // The row's `min="1"` attribute never stopped anyone typing 0, and UpdateServiceDto's
  // @Min(1) rejects it -- so a typed 0 used to produce nothing but an English validator array.
  it.each([['0', 'zero'], ['150', 'above 100'], ['-5', 'negative']])(
    'refuses to save %s (%s) as a row discount, restores the field and warns in Persian',
    async (value) => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE, discountPercent: 20 }] }) // GET services
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
        .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      vi.stubGlobal('fetch', fetchMock)

      const wrapper = mount(ServicesView)
      await new Promise((r) => setTimeout(r, 0))

      // Price is a text field now (AppMoneyInput); the row's discount is the first
      // remaining number input on the page.
      const discountInput = wrapper.findAll('input[type="number"]')[0]!
      await discountInput.setValue(value)
      await discountInput.trigger('change')
      await new Promise((r) => setTimeout(r, 0))

      expect(fetchMock.mock.calls.length).toBe(3)
      expect((discountInput.element as HTMLInputElement).value).toBe('20')
      expect(useToast().toasts.value.some((t) => t.message === 'درصد تخفیف باید عددی صحیح بین ۱ تا ۱۰۰ باشد.')).toBe(true)
      expect(useToast().toasts.value.some((t) => t.message === 'تخفیف به‌روزرسانی شد')).toBe(false)
    },
  )

  it('saves a valid row discount, and clears it with an explicit null', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...SERVICE }) }) // PATCHes
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    const discountInput = wrapper.findAll('input[type="number"]')[0]!
    await discountInput.setValue('20')
    await discountInput.trigger('change')
    await new Promise((r) => setTimeout(r, 0))

    expect(JSON.parse(fetchMock.mock.calls[3]![1].body)).toEqual({ discountPercent: 20 })
    expect(useToast().toasts.value.some((t) => t.message === 'تخفیف به‌روزرسانی شد')).toBe(true)

    // Emptying the field is the clear path -- null, not 0.
    await discountInput.setValue('')
    await discountInput.trigger('change')
    await new Promise((r) => setTimeout(r, 0))

    expect(JSON.parse(fetchMock.mock.calls[4]![1].body)).toEqual({ discountPercent: null })
  })

  it('saves a valid duration change for an existing service, with no confirm dialog', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ...SERVICE, durationMin: 15 }) }) // PATCH
    vi.stubGlobal('fetch', fetchMock)
    const confirmSpy = vi.spyOn(window, 'confirm')

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    const durationInput = wrapper.get('[data-testid="service-duration-input"]')
    await durationInput.setValue('15')
    await durationInput.trigger('change')
    await new Promise((r) => setTimeout(r, 0))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(JSON.parse(fetchMock.mock.calls[3]![1].body)).toEqual({ durationMin: 15 })
    expect(useToast().toasts.value.some((t) => t.message === 'مدت زمان به‌روزرسانی شد')).toBe(true)
  })

  it('refuses an out-of-range duration for an existing service, restores the field and warns in Persian', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    const durationInput = wrapper.get('[data-testid="service-duration-input"]')
    await durationInput.setValue('900')
    await durationInput.trigger('change')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls.length).toBe(3) // no PATCH fired
    expect((durationInput.element as HTMLInputElement).value).toBe('30')
    expect(useToast().toasts.value.some((t) => t.message === 'مدت زمان باید عددی صحیح بین ۵ تا ۶۰۰ دقیقه باشد.')).toBe(true)
  })

  it('sets duration via a one-tap preset button on an existing service', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ...SERVICE, durationMin: 60 }) }) // PATCH
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.get('[data-testid="service-duration-preset-60"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(JSON.parse(fetchMock.mock.calls[3]![1].body)).toEqual({ durationMin: 60 })
  })

  it('sets the new-service form duration via a preset button', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.get('[data-testid="new-service-duration-preset-15"]').trigger('click')

    const durationInput = wrapper.findAll('input[type="number"]')[0]!
    expect((durationInput.element as HTMLInputElement).value).toBe('15')
  })

  it('saves an existing service description, and clears it back to null', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...SERVICE }) }) // PATCHes
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    const noteField = wrapper.get('[data-testid="service-description"]')
    await noteField.setValue('این زمان تقریبی است و ممکن است بیشتر طول بکشد')
    await noteField.trigger('change')
    await new Promise((r) => setTimeout(r, 0))

    expect(JSON.parse(fetchMock.mock.calls[3]![1].body)).toEqual({
      description: 'این زمان تقریبی است و ممکن است بیشتر طول بکشد',
    })
    expect(useToast().toasts.value.some((t) => t.message === 'توضیحات به‌روزرسانی شد')).toBe(true)

    // Emptying the field is the clear path -- null, not ''.
    await noteField.setValue('')
    await noteField.trigger('change')
    await new Promise((r) => setTimeout(r, 0))

    expect(JSON.parse(fetchMock.mock.calls[4]![1].body)).toEqual({ description: null })
  })

  it('sends the duration note when adding a new service, and omits it when left blank', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ ...SERVICE }) }) // POST
      .mockResolvedValue({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // reload
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 1)
    await wrapper.find('input[placeholder="نام خدمت"]').setValue('کوتاهی مو')
    await wrapper.find('textarea').setValue('این خدمت گاهی بیشتر از حد معمول طول می‌کشد')
    await wrapper.get('[data-testid="new-service-price-input"]').setValue('100000')
    const addButton = wrapper.findAll('button').find((b) => b.text() === 'افزودن')!
    await addButton.trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const postCall = fetchMock.mock.calls.find((c) => (c[1] as { method?: string })?.method === 'POST')!
    expect(JSON.parse((postCall[1] as { body: string }).body)).toMatchObject({
      description: 'این خدمت گاهی بیشتر از حد معمول طول می‌کشد',
    })
  })

  it('shows an inline error and skips the request when adding a service without a category', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    const nameInput = wrapper.find('input[placeholder="نام خدمت"]')
    if (nameInput.exists()) await nameInput.setValue('رنگ مو')

    const addButton = wrapper.findAll('button').find((b) => b.text().includes('افزودن'))!
    await addButton.trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.text()).toContain('دسته‌بندی خدمت را انتخاب کنید')
    // Only the three initial GETs happened -- no POST was fired.
    expect(fetchMock.mock.calls.length).toBe(3)
  })

  it('renders past category requests with their status', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          { id: 'cr1', name: 'ماساژ درمانی', note: null, status: 'pending', resolutionNote: null, createdAt: '2026-08-01T00:00:00.000Z' },
          { id: 'cr2', name: 'وکس بدن', note: null, status: 'rejected', resolutionNote: 'قبلاً پوشش داده شده', createdAt: '2026-07-01T00:00:00.000Z' },
        ],
      }) // GET category-requests
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.text()).toContain('ماساژ درمانی')
    expect(wrapper.text()).toContain('در انتظار بررسی')
    expect(wrapper.text()).toContain('وکس بدن')
    expect(wrapper.text()).toContain('رد شد')
    expect(wrapper.text()).toContain('قبلاً پوشش داده شده')
  })

  it('does not render the category-request history card when there are none', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="category-request-row"]').exists()).toBe(false)
  })

  it('shows an inline error and skips the request for a too-short category request name', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.get('[data-testid="open-category-request"]').trigger('click')
    await wrapper.get('[data-testid="category-request-name"]').setValue('م')
    await wrapper.get('[data-testid="submit-category-request"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.text()).toContain('نام دسته‌بندی باید بین ۲ تا ۶۰ حرف باشد.')
    // Only the three initial GETs happened -- no POST was fired.
    expect(fetchMock.mock.calls.length).toBe(3)
  })

  it('submits a category request, toasts, and reloads the request list', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests (initial)
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'cr1' }) }) // POST
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ id: 'cr1', name: 'ماساژ درمانی', note: null, status: 'pending', resolutionNote: null, createdAt: '2026-08-01T00:00:00.000Z' }],
      }) // GET category-requests (reload)
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.get('[data-testid="open-category-request"]').trigger('click')
    await wrapper.get('[data-testid="category-request-name"]').setValue('ماساژ درمانی')
    await wrapper.get('[data-testid="submit-category-request"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const postCall = fetchMock.mock.calls[3]!
    expect(postCall[0]).toContain('/salons/mine/category-requests')
    expect(postCall[1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(postCall[1].body)).toEqual({ name: 'ماساژ درمانی' })
    expect(useToast().toasts.value.some((t) => t.message === 'درخواست دسته‌بندی ارسال شد و در انتظار بررسی مدیر است')).toBe(true)
    expect(wrapper.text()).toContain('ماساژ درمانی')
    // The form collapses back after a successful submit.
    expect(wrapper.find('[data-testid="category-request-name"]').exists()).toBe(false)
  })

  it('cancels the category-request form without sending a request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.get('[data-testid="open-category-request"]').trigger('click')
    await wrapper.get('[data-testid="category-request-name"]').setValue('ماساژ درمانی')
    await wrapper.get('[data-testid="cancel-category-request"]').trigger('click')

    expect(wrapper.find('[data-testid="category-request-name"]').exists()).toBe(false)
    expect(fetchMock.mock.calls.length).toBe(3)
  })
})
