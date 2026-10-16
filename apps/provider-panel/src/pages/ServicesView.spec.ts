import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppMoneyInput from '@/components/ui/AppMoneyInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import { resetToast, useToast } from '@/composables/useToast'
import ServicesView from './ServicesView.vue'
import { autoConfirm } from '@/test-utils/auto-confirm'

// Always handed to a mock as a fresh copy: the component keeps the objects the fetch mock
// returns and writes back to them on a successful save, so sharing this reference would let
// one test's price update leak into the next test's starting state.
const SERVICE = {
  id: 'svc-1',
  categoryId: 1,
  customCategoryId: null,
  name: 'کوتاهی مو',
  description: null,
  pricingType: 'fixed' as const,
  price: 100000,
  priceMax: null,
  durationMin: 30,
  durationMax: null,
  isActive: true,
  discountPercent: null,
}

// ServicesView fires two separate onMounted hooks -- load() (services + categories +
// custom-categories, via Promise.all) and loadCategoryRequests() -- and Vue runs onMounted
// callbacks synchronously in registration order up to each one's first await, so the real
// fetch() call order is always: services, categories, custom-categories, category-requests.
// Every test below queues these as the first 4 responses so later user-triggered calls land
// at the expected index.
const CATEGORY_REQUESTS_EMPTY = { ok: true, status: 200, json: async () => [] }
const CUSTOM_CATEGORIES_EMPTY = { ok: true, status: 200, json: async () => [] }

// The inline fields are drafts; the row's explicit «ذخیره» button is what persists them.
async function saveRowEdits(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('[data-testid="save-service-row"]').trigger('click')
  await new Promise((r) => setTimeout(r, 0))
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
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
    vi.stubGlobal('fetch', fetchMock)
    const confirmSpy = autoConfirm(false)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="deactivate-service"]').exists()).toBe(true)
    await wrapper.find('[data-testid="deactivate-service"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(confirmSpy.calls).toHaveLength(1)
    // Only the three initial GETs happened -- no DELETE was fired.
    expect(fetchMock.mock.calls.length).toBe(4)
    // The service row is still rendered -- declining the confirm must not remove it.
    expect(wrapper.text()).toContain('کوتاهی مو')
  })

  it('deactivates a service after confirmation, sending a real DELETE and removing the row', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => null }) // DELETE service
    vi.stubGlobal('fetch', fetchMock)
    autoConfirm(true)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('[data-testid="deactivate-service"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const deleteCall = fetchMock.mock.calls[4]!
    expect(deleteCall[0]).toContain('/salons/mine/services/svc-1')
    expect(deleteCall[1]).toMatchObject({ method: 'DELETE' })
    expect(wrapper.text()).not.toContain('کوتاهی مو')
  })

  it('renders no checkbox for the active state -- deactivation is an explicit danger action, not a bare toggle', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
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
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
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
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services (retry)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories (retry)
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('[data-testid="retry-services"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls.length).toBe(7)
    expect(wrapper.find('[data-testid="retry-services"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('کوتاهی مو')
  })

  it('shows a success toast after updating a price', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ...SERVICE, price: 150000 }) }) // PATCH price
    vi.stubGlobal('fetch', fetchMock)
    // A price change is money-facing, so saving it goes through a confirm.
    autoConfirm(true)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    const input = wrapper.get('[data-testid="service-price-input"]')
    await input.setValue('150000')
    await saveRowEdits(wrapper)

    const patchCall = fetchMock.mock.calls[4]!
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
        .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
        .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      vi.stubGlobal('fetch', fetchMock)
      const confirmSpy = autoConfirm(true)

      const wrapper = mount(ServicesView)
      await new Promise((r) => setTimeout(r, 0))

      const input = wrapper.get('[data-testid="service-price-input"]')
      await input.setValue(value)
      await saveRowEdits(wrapper)

      // Only the three initial GETs happened -- no PATCH was fired.
      expect(fetchMock.mock.calls.length).toBe(4)
      expect(confirmSpy.calls).toHaveLength(0)
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
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ...SERVICE, price: 180000 }) }) // PATCH price
    vi.stubGlobal('fetch', fetchMock)
    autoConfirm(true)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    const input = wrapper.get('[data-testid="service-price-input"]')
    await input.setValue('۱۸۰۰۰۰')
    await saveRowEdits(wrapper)

    const patchCall = fetchMock.mock.calls[4]!
    expect(JSON.parse(patchCall[1].body)).toEqual({ price: 180000 })
    expect(useToast().toasts.value.some((t) => t.message === 'قیمت به‌روزرسانی شد')).toBe(true)
  })

  it('does not save a price change when the confirm is declined, and puts the field back', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
    vi.stubGlobal('fetch', fetchMock)
    autoConfirm(false)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    const input = wrapper.get('[data-testid="service-price-input"]')
    await input.setValue('1')
    await saveRowEdits(wrapper)

    expect(fetchMock.mock.calls.length).toBe(4)
    expect((input.element as HTMLInputElement).value).toBe('۱۰۰٬۰۰۰')
    expect(useToast().toasts.value.some((t) => t.message === 'قیمت به‌روزرسانی شد')).toBe(false)
  })

  it('ignores a second click on «افزودن» while the create request is still in flight', async () => {
    let resolveCreate!: (value: unknown) => void
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      .mockImplementationOnce(() => new Promise((resolve) => { resolveCreate = resolve })) // POST service -- held open
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services (reload)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories (reload)
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('input[placeholder="نام خدمت"]').setValue('رنگ مو')
    await wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 'sys:1')
    await wrapper.get('[data-testid="new-service-price-input"]').setValue('150000')

    const addButton = wrapper.get('[data-testid="add-service"]')
    await addButton.trigger('click')
    await addButton.trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    // Four initial GETs + exactly ONE POST, and the button is visibly busy meanwhile.
    expect(fetchMock.mock.calls.length).toBe(5)
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
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
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
    expect(fetchMock.mock.calls.length).toBe(4)
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
        .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
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
      expect(fetchMock.mock.calls.length).toBe(4)
    },
  )

  it('shows an inline Persian error and skips the request when adding a service with an out-of-range discount', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
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
    expect(fetchMock.mock.calls.length).toBe(4)
  })

  // The row's `min="1"` attribute never stopped anyone typing 0, and UpdateServiceDto's
  // @Min(1) rejects it -- so a typed 0 used to produce nothing but an English validator array.
  it.each([['0', 'zero'], ['150', 'above 100'], ['-5', 'negative']])(
    'refuses to save %s (%s) as a row discount, restores the field and warns in Persian',
    async (value) => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE, discountPercent: 20 }] }) // GET services
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
        .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
        .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      vi.stubGlobal('fetch', fetchMock)

      const wrapper = mount(ServicesView)
      await new Promise((r) => setTimeout(r, 0))

      // Price is a text field now (AppMoneyInput); the row's discount is the first
      // remaining number input on the page.
      const discountInput = wrapper.findAll('input[type="number"]')[0]!
      await discountInput.setValue(value)
      await saveRowEdits(wrapper)

      expect(fetchMock.mock.calls.length).toBe(4)
      expect((discountInput.element as HTMLInputElement).value).toBe('20')
      expect(useToast().toasts.value.some((t) => t.message === 'درصد تخفیف باید عددی صحیح بین ۱ تا ۱۰۰ باشد.')).toBe(true)
      expect(useToast().toasts.value.some((t) => t.message === 'تخفیف به‌روزرسانی شد')).toBe(false)
    },
  )

  it('saves a valid row discount, and clears it with an explicit null', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...SERVICE }) }) // PATCHes
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    const discountInput = wrapper.findAll('input[type="number"]')[0]!
    await discountInput.setValue('20')
    await saveRowEdits(wrapper)

    expect(JSON.parse(fetchMock.mock.calls[4]![1].body)).toEqual({ discountPercent: 20 })
    expect(useToast().toasts.value.some((t) => t.message === 'تخفیف به‌روزرسانی شد')).toBe(true)

    // Emptying the field is the clear path -- null, not 0.
    await discountInput.setValue('')
    await saveRowEdits(wrapper)

    expect(JSON.parse(fetchMock.mock.calls[5]![1].body)).toEqual({ discountPercent: null })
  })

  it('saves a valid duration change for an existing service, with no confirm dialog', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ...SERVICE, durationMin: 15 }) }) // PATCH
    vi.stubGlobal('fetch', fetchMock)
    const confirmSpy = autoConfirm(true)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    const durationInput = wrapper.get('[data-testid="service-duration-input"]')
    await durationInput.setValue('15')
    await saveRowEdits(wrapper)

    expect(confirmSpy.calls).toHaveLength(0)
    expect(JSON.parse(fetchMock.mock.calls[4]![1].body)).toEqual({ durationMin: 15 })
    expect(useToast().toasts.value.some((t) => t.message === 'مدت زمان به‌روزرسانی شد')).toBe(true)
  })

  it('refuses an out-of-range duration for an existing service, restores the field and warns in Persian', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    const durationInput = wrapper.get('[data-testid="service-duration-input"]')
    await durationInput.setValue('900')
    await saveRowEdits(wrapper)

    expect(fetchMock.mock.calls.length).toBe(4) // no PATCH fired
    expect((durationInput.element as HTMLInputElement).value).toBe('30')
    expect(useToast().toasts.value.some((t) => t.message === 'مدت زمان باید عددی صحیح بین ۵ تا ۶۰۰ دقیقه باشد.')).toBe(true)
  })

  it('sets duration via a one-tap preset button on an existing service, saved with the row button', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ...SERVICE, durationMin: 60 }) }) // PATCH
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.get('[data-testid="service-duration-preset-60"]').trigger('click')
    // A preset only fills the draft -- nothing is persisted until «ذخیره».
    expect(fetchMock.mock.calls.length).toBe(4)
    await saveRowEdits(wrapper)

    expect(JSON.parse(fetchMock.mock.calls[4]![1].body)).toEqual({ durationMin: 60 })
  })

  it('sets the new-service form duration via a preset button', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
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
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...SERVICE }) }) // PATCHes
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    const noteField = wrapper.get('[data-testid="service-description"]')
    await noteField.setValue('این زمان تقریبی است و ممکن است بیشتر طول بکشد')
    await saveRowEdits(wrapper)

    expect(JSON.parse(fetchMock.mock.calls[4]![1].body)).toEqual({
      description: 'این زمان تقریبی است و ممکن است بیشتر طول بکشد',
    })
    expect(useToast().toasts.value.some((t) => t.message === 'توضیحات به‌روزرسانی شد')).toBe(true)

    // Emptying the field is the clear path -- null, not ''.
    await noteField.setValue('')
    await saveRowEdits(wrapper)

    expect(JSON.parse(fetchMock.mock.calls[5]![1].body)).toEqual({ description: null })
  })

  it('sends the duration note when adding a new service, and omits it when left blank', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ ...SERVICE }) }) // POST
      .mockResolvedValue({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // reload
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 'sys:1')
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
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
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
    expect(fetchMock.mock.calls.length).toBe(4)
  })

  it('renders past category requests with their status', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
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
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
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
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
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
    expect(fetchMock.mock.calls.length).toBe(4)
  })

  it('submits a category request, toasts, and reloads the request list', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
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

    const postCall = fetchMock.mock.calls[4]!
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
      .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
      .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ServicesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.get('[data-testid="open-category-request"]').trigger('click')
    await wrapper.get('[data-testid="category-request-name"]').setValue('ماساژ درمانی')
    await wrapper.get('[data-testid="cancel-category-request"]').trigger('click')

    expect(wrapper.find('[data-testid="category-request-name"]').exists()).toBe(false)
    expect(fetchMock.mock.calls.length).toBe(4)
  })

  describe('pricing types', () => {
    it('creates a FROM service with just a starting price, no discount field shown', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
        .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
        .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
        .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ ...SERVICE, id: 'svc-2' }) }) // POST
        .mockResolvedValue({ ok: true, status: 200, json: async () => [] }) // reload
      vi.stubGlobal('fetch', fetchMock)

      const wrapper = mount(ServicesView)
      await new Promise((r) => setTimeout(r, 0))

      await wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 'sys:1')
      await wrapper.find('input[placeholder="نام خدمت"]').setValue('رنگ مو')
      await wrapper.get('[data-testid="new-service-pricing-type-from"] input[type="radio"]').setValue(true)
      // The discount field only makes sense for FIXED -- must disappear once FROM is picked.
      expect(wrapper.find('input[placeholder="٪ تخفیف (اختیاری)"]').exists()).toBe(false)
      await wrapper.get('[data-testid="new-service-price-input"]').setValue('1000000')

      const addButton = wrapper.findAll('button').find((b) => b.text() === 'افزودن')!
      await addButton.trigger('click')
      await new Promise((r) => setTimeout(r, 0))

      const postCall = fetchMock.mock.calls.find((c) => (c[1] as { method?: string })?.method === 'POST')!
      expect(JSON.parse((postCall[1] as { body: string }).body)).toMatchObject({
        pricingType: 'from',
        price: 1000000,
      })
    })

    it('creates a RANGE service with both bounds shown and required', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
        .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
        .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
        .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ ...SERVICE, id: 'svc-2' }) }) // POST
        .mockResolvedValue({ ok: true, status: 200, json: async () => [] }) // reload
      vi.stubGlobal('fetch', fetchMock)

      const wrapper = mount(ServicesView)
      await new Promise((r) => setTimeout(r, 0))

      await wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 'sys:1')
      await wrapper.find('input[placeholder="نام خدمت"]').setValue('کراتین')
      await wrapper.get('[data-testid="new-service-pricing-type-range"] input[type="radio"]').setValue(true)
      expect(wrapper.find('[data-testid="new-service-price-max-input"]').exists()).toBe(true)
      await wrapper.get('[data-testid="new-service-price-input"]').setValue('2000000')
      await wrapper.get('[data-testid="new-service-price-max-input"]').setValue('5000000')

      const addButton = wrapper.findAll('button').find((b) => b.text() === 'افزودن')!
      await addButton.trigger('click')
      await new Promise((r) => setTimeout(r, 0))

      const postCall = fetchMock.mock.calls.find((c) => (c[1] as { method?: string })?.method === 'POST')!
      expect(JSON.parse((postCall[1] as { body: string }).body)).toMatchObject({
        pricingType: 'range',
        price: 2000000,
        priceMax: 5000000,
      })
    })

    it('creates a QUOTE service with no price field at all', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
        .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
        .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
        .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ ...SERVICE, id: 'svc-2' }) }) // POST
        .mockResolvedValue({ ok: true, status: 200, json: async () => [] }) // reload
      vi.stubGlobal('fetch', fetchMock)

      const wrapper = mount(ServicesView)
      await new Promise((r) => setTimeout(r, 0))

      await wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 'sys:1')
      await wrapper.find('input[placeholder="نام خدمت"]').setValue('مشاوره ویژه')
      await wrapper.get('[data-testid="new-service-pricing-type-quote"] input[type="radio"]').setValue(true)
      expect(wrapper.find('[data-testid="new-service-price-input"]').exists()).toBe(false)

      const addButton = wrapper.findAll('button').find((b) => b.text() === 'افزودن')!
      await addButton.trigger('click')
      await new Promise((r) => setTimeout(r, 0))

      const postCall = fetchMock.mock.calls.find((c) => (c[1] as { method?: string })?.method === 'POST')!
      const body = JSON.parse((postCall[1] as { body: string }).body)
      expect(body.pricingType).toBe('quote')
      expect(body.price).toBeUndefined()
    })

    it('shows the pricing-type editor for a non-fixed existing service instead of the bare price input', async () => {
      const fromService = { ...SERVICE, id: 'svc-from', pricingType: 'from' as const, price: 900000 }
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [fromService] }) // GET services
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
        .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
        .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      vi.stubGlobal('fetch', fetchMock)

      const wrapper = mount(ServicesView)
      await new Promise((r) => setTimeout(r, 0))

      expect(wrapper.find('[data-testid="service-price-input"]').exists()).toBe(false)
      expect(wrapper.text()).toContain('از')
      expect(wrapper.find('[data-testid="edit-pricing-type"]').exists()).toBe(true)
    })

    it('switching an existing service to RANGE via the row editor sends both bounds together', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
        .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
        .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ...SERVICE, pricingType: 'range', price: 1000000, priceMax: 3000000, discountPercent: null }) }) // PATCH
      vi.stubGlobal('fetch', fetchMock)

      const wrapper = mount(ServicesView)
      await new Promise((r) => setTimeout(r, 0))

      await wrapper.get('button.text-xs').trigger('click') // "تغییر نوع قیمت‌گذاری"
      const rangeRadio = wrapper.findAll('input[type="radio"][value="range"]')[0]!
      await rangeRadio.setValue(true)

      const moneyComponents = wrapper.findAllComponents(AppMoneyInput)
      const minInput = moneyComponents.find((c) => c.props('label') === 'حداقل قیمت (تومان)')!
      const maxInput = moneyComponents.find((c) => c.props('label') === 'حداکثر قیمت (تومان)')!
      await minInput.vm.$emit('update:modelValue', '1000000')
      await maxInput.vm.$emit('update:modelValue', '3000000')

      await wrapper.get('[data-testid="save-pricing-type"]').trigger('click')
      await new Promise((r) => setTimeout(r, 0))

      const patchCall = fetchMock.mock.calls[4]!
      expect(JSON.parse((patchCall[1] as { body: string }).body)).toMatchObject({
        pricingType: 'range',
        price: 1000000,
        priceMax: 3000000,
      })
    })
  })

  describe('custom categories', () => {
    it('creates a custom category and selects it immediately, with no admin approval step', async () => {
      const newCategory = { id: 'cc-1', name: 'خدمات ویژه' }
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET services
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
        .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
        .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
        .mockResolvedValueOnce({ ok: true, status: 201, json: async () => newCategory }) // POST custom-category
      vi.stubGlobal('fetch', fetchMock)

      const wrapper = mount(ServicesView)
      await new Promise((r) => setTimeout(r, 0))

      await wrapper.get('[data-testid="open-custom-category"]').trigger('click')
      await wrapper.get('[data-testid="custom-category-name"]').setValue('خدمات ویژه')
      await wrapper.get('[data-testid="submit-custom-category"]').trigger('click')
      await new Promise((r) => setTimeout(r, 0))

      const postCall = fetchMock.mock.calls[4]!
      expect(postCall[0]).toContain('/salons/mine/custom-categories')
      expect(JSON.parse((postCall[1] as { body: string }).body)).toEqual({ name: 'خدمات ویژه' })
      // The new category appears in the select immediately -- no reload/approval round-trip.
      expect(wrapper.find('[data-testid="custom-category-name"]').exists()).toBe(false)
    })
  })

  describe('custom category delete', () => {
    const CUSTOM = { id: 'cc-1', name: 'خدمات ویژه' }
    const okJson = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })
    function mountWith(deleteReply: { ok: boolean; status: number; json: () => Promise<unknown> }, services: unknown[] = []) {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(okJson(services)) // GET services
        .mockResolvedValueOnce(okJson([{ id: 1, name: 'مو' }])) // GET categories
        .mockResolvedValueOnce(okJson([{ ...CUSTOM }])) // GET custom-categories
        .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
        .mockResolvedValueOnce(deleteReply) // DELETE custom-category
      vi.stubGlobal('fetch', fetchMock)
      return { fetchMock, wrapper: mount(ServicesView) }
    }

    it('lists custom categories with a delete button that confirms, sends DELETE and removes the chip', async () => {
      const { fetchMock, wrapper } = mountWith({ ok: true, status: 204, json: async () => null })
      const confirmSpy = autoConfirm(true)
      await new Promise((r) => setTimeout(r, 0))

      expect(wrapper.get('[data-testid="custom-category-chip-cc-1"]').text()).toContain('خدمات ویژه')
      await wrapper.get('[data-testid="delete-custom-category-cc-1"]').trigger('click')
      await new Promise((r) => setTimeout(r, 0))

      expect(confirmSpy.calls).toHaveLength(1)
      expect(confirmSpy.calls[0]!.tone).toBe('danger')
      const deleteCall = fetchMock.mock.calls[4]!
      expect(deleteCall[0]).toContain('/salons/mine/custom-categories/cc-1')
      expect(deleteCall[1]).toMatchObject({ method: 'DELETE' })
      expect(wrapper.find('[data-testid="custom-category-chip-cc-1"]').exists()).toBe(false)
      expect(useToast().toasts.value.some((t) => t.message === 'دسته‌بندی سفارشی حذف شد')).toBe(true)
    })

    it('sends nothing when the delete confirm is declined', async () => {
      const { fetchMock, wrapper } = mountWith({ ok: true, status: 204, json: async () => null })
      autoConfirm(false)
      await new Promise((r) => setTimeout(r, 0))

      await wrapper.get('[data-testid="delete-custom-category-cc-1"]').trigger('click')
      await new Promise((r) => setTimeout(r, 0))

      expect(fetchMock.mock.calls).toHaveLength(4)
      expect(wrapper.find('[data-testid="custom-category-chip-cc-1"]').exists()).toBe(true)
    })

    it('keeps the chip and shows the server\'s Persian message inline (not a toast) on a 409 in-use refusal', async () => {
      const message = 'این دسته‌بندی توسط خدماتی از سالن شما استفاده می‌شود و قابل حذف نیست'
      const { wrapper } = mountWith(okJson({ message }, 409), [{ ...SERVICE, categoryId: null, customCategoryId: 'cc-1' }])
      autoConfirm(true)
      await new Promise((r) => setTimeout(r, 0))

      // The active-service usage hint is shown, but deletion is still left to the server
      // (a deactivated service can hold the category too).
      expect(wrapper.get('[data-testid="custom-category-chip-cc-1"]').text()).toContain('۱ خدمت')
      await wrapper.get('[data-testid="delete-custom-category-cc-1"]').trigger('click')
      await new Promise((r) => setTimeout(r, 0))

      expect(wrapper.find('[data-testid="custom-category-chip-cc-1"]').exists()).toBe(true)
      const error = wrapper.get('[data-testid="custom-category-delete-error"]')
      expect(error.attributes('role')).toBe('alert')
      expect(error.text()).toContain(message)
      expect(useToast().toasts.value).toHaveLength(0)
    })
  })

  describe('catalogue list (collapsed rows, expand to edit)', () => {
    // v-show: the editor stays mounted (so a collapse keeps drafts) and is hidden by style.
    const editorHidden = (wrapper: ReturnType<typeof mount>, id: string) =>
      (wrapper.get(`[data-testid="service-editor-${id}"]`).attributes('style') ?? '').includes('display: none')

    function mountList(list: unknown[]) {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => list }) // GET services
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'مو' }] }) // GET categories
        .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
        .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
      vi.stubGlobal('fetch', fetchMock)
      return mount(ServicesView)
    }

    it('renders each service as a collapsed summary row with price label, duration and pricing badge', async () => {
      const wrapper = mountList([
        { ...SERVICE, discountPercent: 10 },
        { ...SERVICE, id: 'svc-from', name: 'رنگ', pricingType: 'from', price: 900000 },
        { ...SERVICE, id: 'svc-quote', name: 'عروس', pricingType: 'quote', price: null, durationMin: 120, durationMax: 180 },
      ])
      await new Promise((r) => setTimeout(r, 0))

      const toggle = wrapper.get('[data-testid="service-toggle-svc-1"]')
      expect(toggle.attributes('aria-expanded')).toBe('false')
      expect(toggle.attributes('aria-controls')).toBe('service-editor-svc-1')
      expect(editorHidden(wrapper, 'svc-1')).toBe(true)
      expect(toggle.text()).toContain('۱۰۰٬۰۰۰ تومان')
      expect(toggle.text()).toContain('۳۰ دقیقه')
      expect(toggle.text()).toContain('۱۰٪ تخفیف')
      expect(toggle.text()).toContain('قیمت ثابت')

      // FROM is never shown as an exact price, QUOTE never as a number.
      const fromPrice = wrapper.get('[data-testid="service-card-svc-from"] [data-testid="service-summary-price"]').text()
      expect(fromPrice).toBe('از ۹۰۰٬۰۰۰ تومان')
      const quoteRow = wrapper.get('[data-testid="service-toggle-svc-quote"]')
      expect(quoteRow.get('[data-testid="service-summary-price"]').text()).toBe('قیمت توافقی')
      expect(quoteRow.text()).toContain('۱۲۰ دقیقه (تا ۱۸۰)')
    })

    it('expands and collapses a row from its summary button', async () => {
      const wrapper = mountList([{ ...SERVICE }])
      await new Promise((r) => setTimeout(r, 0))

      const toggle = wrapper.get('[data-testid="service-toggle-svc-1"]')
      await toggle.trigger('click')
      expect(toggle.attributes('aria-expanded')).toBe('true')
      expect(editorHidden(wrapper, 'svc-1')).toBe(false)

      await toggle.trigger('click')
      expect(toggle.attributes('aria-expanded')).toBe('false')
      expect(editorHidden(wrapper, 'svc-1')).toBe(true)
    })

    it('keeps an unsaved edit across collapse and flags the collapsed row as having unsaved changes', async () => {
      const wrapper = mountList([{ ...SERVICE }])
      await new Promise((r) => setTimeout(r, 0))
      const toggle = wrapper.get('[data-testid="service-toggle-svc-1"]')

      await toggle.trigger('click')
      await wrapper.get('[data-testid="service-duration-input"]').setValue('45')
      await toggle.trigger('click')

      expect(toggle.text()).toContain('تغییرات ذخیره‌نشده')
      await toggle.trigger('click')
      expect((wrapper.get('[data-testid="service-duration-input"]').element as HTMLInputElement).value).toBe('45')
      // Expanded: the save row itself is the cue, so the summary badge goes away.
      expect(toggle.text()).not.toContain('تغییرات ذخیره‌نشده')
      expect(wrapper.find('[data-testid="save-service-row"]').exists()).toBe(true)
    })
  })

  describe('explicit per-row editing', () => {
    function initialFetch() {
      return vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ ...SERVICE }] }) // GET services
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET categories
        .mockResolvedValueOnce(CUSTOM_CATEGORIES_EMPTY) // GET custom-categories
        .mockResolvedValueOnce(CATEGORY_REQUESTS_EMPTY) // GET category-requests
    }

    it('shows «ذخیره» / «انصراف» only while a field differs from what is saved', async () => {
      vi.stubGlobal('fetch', initialFetch())
      const wrapper = mount(ServicesView)
      await new Promise((r) => setTimeout(r, 0))

      expect(wrapper.find('[data-testid="save-service-row"]').exists()).toBe(false)

      await wrapper.get('[data-testid="service-duration-input"]').setValue('45')
      expect(wrapper.find('[data-testid="save-service-row"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="cancel-service-row"]').exists()).toBe(true)

      await wrapper.get('[data-testid="service-duration-input"]').setValue('30')
      expect(wrapper.find('[data-testid="save-service-row"]').exists()).toBe(false)
    })

    it('does not save or ask for confirmation when a field merely loses focus', async () => {
      const fetchMock = initialFetch()
      vi.stubGlobal('fetch', fetchMock)
      const confirmSpy = autoConfirm(true)
      const wrapper = mount(ServicesView)
      await new Promise((r) => setTimeout(r, 0))

      const price = wrapper.get('[data-testid="service-price-input"]')
      await price.setValue('150000')
      await price.trigger('change')
      await price.trigger('blur')
      await wrapper.get('[data-testid="service-duration-input"]').trigger('change')
      await new Promise((r) => setTimeout(r, 0))

      expect(fetchMock.mock.calls.length).toBe(4)
      expect(confirmSpy.calls).toHaveLength(0)
    })

    it('asks about a price change at save time, naming both prices', async () => {
      const fetchMock = initialFetch()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ...SERVICE, price: 150000 }) })
      vi.stubGlobal('fetch', fetchMock)
      const confirmSpy = autoConfirm(true)
      const wrapper = mount(ServicesView)
      await new Promise((r) => setTimeout(r, 0))

      await wrapper.get('[data-testid="service-price-input"]').setValue('150000')
      expect(confirmSpy.calls).toHaveLength(0)
      await saveRowEdits(wrapper)

      expect(confirmSpy.calls).toHaveLength(1)
      expect(confirmSpy.calls[0].title).toContain('کوتاهی مو')
      expect(JSON.parse(fetchMock.mock.calls[4]![1].body)).toEqual({ price: 150000 })
    })

    it('«انصراف» puts every draft back without a request', async () => {
      const fetchMock = initialFetch()
      vi.stubGlobal('fetch', fetchMock)
      const wrapper = mount(ServicesView)
      await new Promise((r) => setTimeout(r, 0))

      const duration = wrapper.get('[data-testid="service-duration-input"]')
      await duration.setValue('90')
      await wrapper.get('[data-testid="cancel-service-row"]').trigger('click')

      expect((duration.element as HTMLInputElement).value).toBe('30')
      expect(wrapper.find('[data-testid="save-service-row"]').exists()).toBe(false)
      expect(fetchMock.mock.calls.length).toBe(4)
    })

    it('guards «ذخیره» while the save is in flight (disabled, no second PATCH)', async () => {
      let resolvePatch!: (value: unknown) => void
      const fetchMock = initialFetch()
        .mockImplementationOnce(() => new Promise((resolve) => { resolvePatch = resolve }))
      vi.stubGlobal('fetch', fetchMock)
      const wrapper = mount(ServicesView)
      await new Promise((r) => setTimeout(r, 0))

      await wrapper.get('[data-testid="service-duration-input"]').setValue('45')
      const save = wrapper.get('[data-testid="save-service-row"]')
      await save.trigger('click')
      await save.trigger('click')
      await new Promise((r) => setTimeout(r, 0))

      expect(fetchMock.mock.calls.length).toBe(5)
      expect(save.attributes('disabled')).toBeDefined()
      expect(wrapper.get('[data-testid="cancel-service-row"]').attributes('disabled')).toBeDefined()

      resolvePatch({ ok: true, status: 200, json: async () => ({ ...SERVICE, durationMin: 45 }) })
      await new Promise((r) => setTimeout(r, 0))
      expect(wrapper.find('[data-testid="save-service-row"]').exists()).toBe(false)
    })
  })

  describe('service image', () => {
    const IMAGE_URL = 'http://localhost:3002/uploads/salons/s1/services/svc-1/old.jpg'
    const NEW_URL = 'http://localhost:3002/uploads/salons/s1/services/svc-1/new.jpg'
    type Reply = { ok: boolean; status: number; json: () => Promise<unknown> }
    const reply = (status: number, body: unknown): Reply => ({ ok: status < 400, status, json: async () => body })

    // Routed by method + path rather than call order: the create flow reloads the list
    // mid-test, and what matters here is which image requests happened, not their index.
    function routedFetch(servicesList: () => unknown[], handle: (method: string, path: string, init: RequestInit) => Reply | Promise<Reply> | undefined) {
      return vi.fn(async (url: string, init: RequestInit = {}) => {
        const method = init.method ?? 'GET'
        const path = url.replace(/^.*\/api/, '')
        const handled = await handle(method, path, init)
        if (handled) return handled
        if (method === 'GET' && path === '/salons/mine/services') return reply(200, servicesList())
        if (method === 'GET' && path === '/categories') return reply(200, [{ id: 1, name: 'مو' }])
        return reply(200, [])
      })
    }
    const callsTo = (fetchMock: ReturnType<typeof vi.fn>, method: string, pathPart: string) =>
      fetchMock.mock.calls.filter((c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === method && String(c[0]).includes(pathPart))
    const imageCalls = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/image'))
    const flush = () => new Promise((r) => setTimeout(r, 0))

    async function pickImage(wrapper: ReturnType<typeof mount>, scope: string, file: File) {
      const input = wrapper.get(`${scope} [data-testid="service-image-input"]`)
      Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
      await input.trigger('change')
    }
    async function fillNewService(wrapper: ReturnType<typeof mount>) {
      await wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 'sys:1')
      await wrapper.find('input[placeholder="نام خدمت"]').setValue('رنگ مو')
      await wrapper.get('[data-testid="new-service-price-input"]').setValue('150000')
    }
    const ADD_FORM = '[data-testid="new-service-image"]'
    const jpeg = () => new File([new Uint8Array(8)], 'photo.jpg', { type: 'image/jpeg' })

    beforeEach(() => {
      let n = 0
      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:preview-${++n}`)
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('shows a placeholder thumbnail for a service without an image and the image for one with', async () => {
      const list = [{ ...SERVICE, imageUrl: null }, { ...SERVICE, id: 'svc-2', name: 'رنگ', imageUrl: IMAGE_URL }]
      vi.stubGlobal('fetch', routedFetch(() => list, () => undefined))
      const wrapper = mount(ServicesView)
      await flush()

      expect(wrapper.find('[data-testid="service-card-svc-1"] [data-testid="service-image-placeholder"]').exists()).toBe(true)
      const img = wrapper.get('[data-testid="service-card-svc-2"] [data-testid="service-image-preview"]')
      expect(img.attributes('src')).toBe(IMAGE_URL)
      expect(img.attributes('alt')).toBe('رنگ')
    })

    it('creating a service without an image sends no image request', async () => {
      const fetchMock = routedFetch(() => [], (method, path) =>
        method === 'POST' && path === '/salons/mine/services' ? reply(201, { ...SERVICE, id: 'svc-2', imageUrl: null }) : undefined)
      vi.stubGlobal('fetch', fetchMock)
      const wrapper = mount(ServicesView)
      await flush()

      await fillNewService(wrapper)
      await wrapper.get('[data-testid="add-service"]').trigger('click')
      await flush()

      expect(callsTo(fetchMock, 'POST', '/salons/mine/services')).toHaveLength(1)
      expect(imageCalls(fetchMock)).toHaveLength(0)
    })

    it('creating with an image POSTs the service first, then the file as FormData field "file" to its image endpoint', async () => {
      let list: unknown[] = []
      const file = jpeg()
      const fetchMock = routedFetch(() => list, (method, path) => {
        if (method === 'POST' && path === '/salons/mine/services') return reply(201, { ...SERVICE, id: 'svc-2', name: 'رنگ مو', imageUrl: null })
        if (method === 'POST' && path === '/salons/mine/services/svc-2/image') {
          list = [{ ...SERVICE, id: 'svc-2', name: 'رنگ مو', imageUrl: NEW_URL }]
          return reply(201, list[0])
        }
        return undefined
      })
      vi.stubGlobal('fetch', fetchMock)
      const wrapper = mount(ServicesView)
      await flush()

      await fillNewService(wrapper)
      await pickImage(wrapper, ADD_FORM, file)
      await wrapper.get('[data-testid="add-service"]').trigger('click')
      await flush()
      await flush()

      const createIdx = fetchMock.mock.calls.findIndex((c) => (c[1] as RequestInit)?.method === 'POST' && String(c[0]).endsWith('/salons/mine/services'))
      const imageIdx = fetchMock.mock.calls.findIndex((c) => String(c[0]).endsWith('/salons/mine/services/svc-2/image'))
      expect(createIdx).toBeGreaterThan(-1)
      expect(imageIdx).toBeGreaterThan(createIdx)
      const body = (fetchMock.mock.calls[imageIdx]![1] as RequestInit).body as FormData
      expect(body).toBeInstanceOf(FormData)
      expect(body.get('file')).toMatchObject({ name: file.name, size: file.size, type: file.type })
      // The create JSON never carries image fields.
      expect(JSON.parse((fetchMock.mock.calls[createIdx]![1] as { body: string }).body)).not.toHaveProperty('imageUrl')

      // Form reset (including its image), and the new row shows the stored image.
      expect((wrapper.find('input[placeholder="نام خدمت"]').element as HTMLInputElement).value).toBe('')
      expect(wrapper.get(`${ADD_FORM} [data-testid="service-image-field"]`).attributes('data-state')).toBe('none')
      expect(wrapper.get('[data-testid="service-card-svc-2"] [data-testid="service-image-preview"]').attributes('src')).toBe(NEW_URL)
    })

    it('keeps «افزودن» disabled while the image upload is in flight, so the service is never created twice', async () => {
      let resolveImage!: (r: Reply) => void
      const fetchMock = routedFetch(() => [], (method, path) => {
        if (method === 'POST' && path === '/salons/mine/services') return reply(201, { ...SERVICE, id: 'svc-2', imageUrl: null })
        if (method === 'POST' && path.endsWith('/image')) return new Promise<Reply>((r) => { resolveImage = r })
        return undefined
      })
      vi.stubGlobal('fetch', fetchMock)
      const wrapper = mount(ServicesView)
      await flush()

      await fillNewService(wrapper)
      await pickImage(wrapper, ADD_FORM, jpeg())
      const addButton = wrapper.get('[data-testid="add-service"]')
      await addButton.trigger('click')
      await flush()
      await addButton.trigger('click')
      await flush()

      expect((addButton.element as HTMLButtonElement).disabled).toBe(true)
      expect(wrapper.get(`${ADD_FORM} [data-testid="service-image-status"]`).text()).toBe('در حال بارگذاری…')
      expect(callsTo(fetchMock, 'POST', '/salons/mine/services').filter((c) => !String(c[0]).endsWith('/image'))).toHaveLength(1)

      resolveImage(reply(201, { ...SERVICE, id: 'svc-2', imageUrl: NEW_URL }))
      await flush()
      await flush()
      expect((addButton.element as HTMLButtonElement).disabled).toBe(false)
    })

    it('an image failure after create keeps the service, moves the staged file onto its row with an error, and «ذخیره» retries only the upload', async () => {
      let list: unknown[] = []
      const file = jpeg()
      let imageAttempts = 0
      const fetchMock = routedFetch(() => list, (method, path) => {
        if (method === 'POST' && path === '/salons/mine/services') {
          list = [{ ...SERVICE, id: 'svc-2', name: 'رنگ مو', imageUrl: null }]
          return reply(201, list[0])
        }
        if (method === 'POST' && path === '/salons/mine/services/svc-2/image') {
          imageAttempts++
          if (imageAttempts === 1) return reply(500, { message: 'boom' })
          return reply(201, { ...SERVICE, id: 'svc-2', name: 'رنگ مو', imageUrl: NEW_URL })
        }
        return undefined
      })
      vi.stubGlobal('fetch', fetchMock)
      const wrapper = mount(ServicesView)
      await flush()

      await fillNewService(wrapper)
      await pickImage(wrapper, ADD_FORM, file)
      await wrapper.get('[data-testid="add-service"]').trigger('click')
      await flush()
      await flush()

      expect(wrapper.get('[data-testid="create-image-notice"]').text()).toContain('خدمت «رنگ مو» ذخیره شد اما تصویر بارگذاری نشد')
      const row = '[data-testid="service-card-svc-2"]'
      expect(wrapper.get(`${row} [data-testid="service-image-field"]`).attributes('data-state')).toBe('staged')
      expect(wrapper.get(`${row} [data-testid="service-image-error"]`).text()).toContain('بارگذاری تصویر ناموفق بود')
      expect(wrapper.get(`${row} [data-testid="service-image-preview"]`).attributes('src')).toMatch(/^blob:/)

      await wrapper.get(`${row} [data-testid="save-service-row"]`).trigger('click')
      await flush()

      // One service create in total; the retry went to the existing service's image endpoint.
      expect(callsTo(fetchMock, 'POST', '/salons/mine/services').filter((c) => !String(c[0]).endsWith('/image'))).toHaveLength(1)
      expect(imageAttempts).toBe(2)
      expect(((imageCalls(fetchMock)[1]![1] as RequestInit).body as FormData).get('file')).toMatchObject({ name: file.name, size: file.size, type: file.type })
      expect(wrapper.get(`${row} [data-testid="service-image-preview"]`).attributes('src')).toBe(NEW_URL)
      expect(wrapper.find('[data-testid="create-image-notice"]').exists()).toBe(false)
    })

    it('a server rejection message (e.g. image too small) is shown inline on the field', async () => {
      const fetchMock = routedFetch(() => [{ ...SERVICE, imageUrl: null }], (method, path) =>
        method === 'POST' && path.endsWith('/image') ? reply(400, { message: 'ابعاد تصویر باید حداقل ۲۰۰ پیکسل باشد.' }) : undefined)
      vi.stubGlobal('fetch', fetchMock)
      const wrapper = mount(ServicesView)
      await flush()

      await pickImage(wrapper, '[data-testid="service-card-svc-1"]', jpeg())
      await saveRowEdits(wrapper)

      expect(wrapper.get('[data-testid="service-image-error"]').text()).toContain('ابعاد تصویر باید حداقل ۲۰۰ پیکسل باشد.')
      expect(wrapper.get('[data-testid="service-image-field"]').attributes('data-state')).toBe('staged')
      // Inline only -- no duplicate error toast.
      expect(useToast().toasts.value.some((t) => t.message.includes('۲۰۰ پیکسل'))).toBe(false)
    })

    it('editing only a text field PATCHes it and never touches the image endpoints, and the thumbnail stays', async () => {
      const fetchMock = routedFetch(() => [{ ...SERVICE, imageUrl: IMAGE_URL }], (method) =>
        method === 'PATCH' ? reply(200, { ...SERVICE, imageUrl: IMAGE_URL, description: 'یادداشت' }) : undefined)
      vi.stubGlobal('fetch', fetchMock)
      const wrapper = mount(ServicesView)
      await flush()

      await wrapper.get('[data-testid="service-description"]').setValue('یادداشت')
      await saveRowEdits(wrapper)

      expect(callsTo(fetchMock, 'PATCH', '/salons/mine/services/svc-1')).toHaveLength(1)
      const patchBody = JSON.parse((callsTo(fetchMock, 'PATCH', '/salons/mine/services/svc-1')[0]![1] as { body: string }).body)
      expect(patchBody).toEqual({ description: 'یادداشت' })
      expect(imageCalls(fetchMock)).toHaveLength(0)
      expect(wrapper.get('[data-testid="service-image-preview"]').attributes('src')).toBe(IMAGE_URL)
      expect(wrapper.find('[data-testid="save-service-row"]').exists()).toBe(false)
    })

    it('replacing an image POSTs only the image (no PATCH) and swaps the thumbnail to the returned url', async () => {
      const file = jpeg()
      const fetchMock = routedFetch(() => [{ ...SERVICE, imageUrl: IMAGE_URL }], (method, path) =>
        method === 'POST' && path === '/salons/mine/services/svc-1/image' ? reply(201, { ...SERVICE, imageUrl: NEW_URL }) : undefined)
      vi.stubGlobal('fetch', fetchMock)
      const wrapper = mount(ServicesView)
      await flush()

      await pickImage(wrapper, '[data-testid="service-card-svc-1"]', file)
      expect(wrapper.get('[data-testid="service-image-field"]').attributes('data-state')).toBe('replacing')
      await saveRowEdits(wrapper)

      expect(callsTo(fetchMock, 'PATCH', '/salons/mine/services')).toHaveLength(0)
      expect(imageCalls(fetchMock)).toHaveLength(1)
      expect(((imageCalls(fetchMock)[0]![1] as RequestInit).body as FormData).get('file')).toMatchObject({ name: file.name, size: file.size, type: file.type })
      expect(wrapper.get('[data-testid="service-image-field"]').attributes('data-state')).toBe('existing')
      expect(wrapper.get('[data-testid="service-image-preview"]').attributes('src')).toBe(NEW_URL)
      expect(wrapper.find('[data-testid="save-service-row"]').exists()).toBe(false)
    })

    it('removing an image sends DELETE to the image endpoint and shows the placeholder afterwards', async () => {
      const fetchMock = routedFetch(() => [{ ...SERVICE, imageUrl: IMAGE_URL }], (method, path) =>
        method === 'DELETE' && path === '/salons/mine/services/svc-1/image' ? reply(200, { ...SERVICE, imageUrl: null }) : undefined)
      vi.stubGlobal('fetch', fetchMock)
      const wrapper = mount(ServicesView)
      await flush()

      await wrapper.get('[data-testid="remove-service-image"]').trigger('click')
      await saveRowEdits(wrapper)

      expect(callsTo(fetchMock, 'DELETE', '/salons/mine/services/svc-1/image')).toHaveLength(1)
      // The service itself is not archived.
      expect(callsTo(fetchMock, 'DELETE', '/salons/mine/services/svc-1').filter((c) => !String(c[0]).endsWith('/image'))).toHaveLength(0)
      expect(wrapper.find('[data-testid="service-image-placeholder"]').exists()).toBe(true)
    })

    it('PATCH succeeds but the image fails: fields saved, image error kept, retry re-sends only the image', async () => {
      let imageAttempts = 0
      const fetchMock = routedFetch(() => [{ ...SERVICE, imageUrl: null }], (method, path) => {
        if (method === 'PATCH') return reply(200, { ...SERVICE, description: 'یادداشت', imageUrl: null })
        if (method === 'POST' && path === '/salons/mine/services/svc-1/image') {
          imageAttempts++
          return imageAttempts === 1 ? reply(500, {}) : reply(201, { ...SERVICE, description: 'یادداشت', imageUrl: NEW_URL })
        }
        return undefined
      })
      vi.stubGlobal('fetch', fetchMock)
      const wrapper = mount(ServicesView)
      await flush()

      await wrapper.get('[data-testid="service-description"]').setValue('یادداشت')
      await pickImage(wrapper, '[data-testid="service-card-svc-1"]', jpeg())
      await saveRowEdits(wrapper)
      await flush()

      expect(callsTo(fetchMock, 'PATCH', '/salons/mine/services/svc-1')).toHaveLength(1)
      expect(wrapper.get('[data-testid="service-image-error"]').text()).toContain('بارگذاری تصویر ناموفق بود')
      expect(wrapper.get('[data-testid="service-image-field"]').attributes('data-state')).toBe('staged')

      await saveRowEdits(wrapper)
      await flush()
      expect(callsTo(fetchMock, 'PATCH', '/salons/mine/services/svc-1')).toHaveLength(1)
      expect(imageAttempts).toBe(2)
      expect(wrapper.get('[data-testid="service-image-preview"]').attributes('src')).toBe(NEW_URL)
      expect(wrapper.find('[data-testid="save-service-row"]').exists()).toBe(false)
    })

    it('double-clicking «ذخیره» while the image request is in flight sends it once, and the field is disabled meanwhile', async () => {
      let resolveDelete!: (r: Reply) => void
      const fetchMock = routedFetch(() => [{ ...SERVICE, imageUrl: IMAGE_URL }], (method, path) =>
        method === 'DELETE' && path.endsWith('/image') ? new Promise<Reply>((r) => { resolveDelete = r }) : undefined)
      vi.stubGlobal('fetch', fetchMock)
      const wrapper = mount(ServicesView)
      await flush()

      await wrapper.get('[data-testid="remove-service-image"]').trigger('click')
      await wrapper.get('[data-testid="save-service-row"]').trigger('click')
      await wrapper.get('[data-testid="save-service-row"]').trigger('click')
      await flush()
      expect(callsTo(fetchMock, 'DELETE', '/image')).toHaveLength(1)
      expect((wrapper.get('[data-testid="undo-service-image"]').element as HTMLButtonElement).disabled).toBe(true)
      expect((wrapper.get('[data-testid="cancel-service-row"]').element as HTMLButtonElement).disabled).toBe(true)

      resolveDelete(reply(200, { ...SERVICE, imageUrl: null }))
      await flush()
      await flush()
      expect(callsTo(fetchMock, 'DELETE', '/image')).toHaveLength(1)
      expect(wrapper.find('[data-testid="service-image-placeholder"]').exists()).toBe(true)
    })

    it('the "image not uploaded" notice goes away once that row no longer holds the failed image (undo / cancel)', async () => {
      let list: unknown[] = []
      const fetchMock = routedFetch(() => list, (method, path) => {
        if (method === 'POST' && path === '/salons/mine/services') {
          list = [{ ...SERVICE, id: 'svc-2', name: 'رنگ مو', imageUrl: null }]
          return reply(201, list[0])
        }
        if (method === 'POST' && path.endsWith('/image')) return reply(500, {})
        return undefined
      })
      vi.stubGlobal('fetch', fetchMock)
      const wrapper = mount(ServicesView)
      await flush()

      await fillNewService(wrapper)
      await pickImage(wrapper, ADD_FORM, jpeg())
      await wrapper.get('[data-testid="add-service"]').trigger('click')
      await flush()
      await flush()
      expect(wrapper.find('[data-testid="create-image-notice"]').exists()).toBe(true)

      await wrapper.get('[data-testid="service-card-svc-2"] [data-testid="cancel-service-row"]').trigger('click')
      expect(wrapper.get('[data-testid="service-card-svc-2"] [data-testid="service-image-field"]').attributes('data-state')).toBe('none')
      // Telling the owner to retry from a card that has nothing to retry is wrong.
      expect(wrapper.find('[data-testid="create-image-notice"]').exists()).toBe(false)
    })

    it('an invalid file picked in the add form does not leave its error behind after the service is created', async () => {
      const fetchMock = routedFetch(() => [], (method, path) =>
        method === 'POST' && path === '/salons/mine/services' ? reply(201, { ...SERVICE, id: 'svc-2', imageUrl: null }) : undefined)
      vi.stubGlobal('fetch', fetchMock)
      const wrapper = mount(ServicesView)
      await flush()

      await fillNewService(wrapper)
      await pickImage(wrapper, ADD_FORM, new File(['x'], 'a.gif', { type: 'image/gif' }))
      expect(wrapper.get(`${ADD_FORM} [data-testid="service-image-error"]`).text()).toContain('فقط تصویر')
      await wrapper.get('[data-testid="add-service"]').trigger('click')
      await flush()
      await flush()

      expect(imageCalls(fetchMock)).toHaveLength(0)
      expect(wrapper.get(`${ADD_FORM} [data-testid="service-image-error"]`).text()).toBe('')
    })

    it('object URLs: every preview created across create-failure handoff, retry and save is revoked', async () => {
      let created = 0
      let revoked = 0
      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:p-${++created}`)
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { revoked++ })
      let list: unknown[] = []
      let imageAttempts = 0
      const fetchMock = routedFetch(() => list, (method, path) => {
        if (method === 'POST' && path === '/salons/mine/services') {
          list = [{ ...SERVICE, id: 'svc-2', name: 'رنگ مو', imageUrl: null }]
          return reply(201, list[0])
        }
        if (method === 'POST' && path.endsWith('/image')) {
          imageAttempts++
          return imageAttempts === 1 ? reply(500, {}) : reply(201, { ...SERVICE, id: 'svc-2', imageUrl: NEW_URL })
        }
        return undefined
      })
      vi.stubGlobal('fetch', fetchMock)
      const wrapper = mount(ServicesView)
      await flush()

      await fillNewService(wrapper)
      await pickImage(wrapper, ADD_FORM, jpeg())
      await wrapper.get('[data-testid="add-service"]').trigger('click')
      await flush()
      await flush()
      await saveRowEdits(wrapper)
      await flush()
      expect(wrapper.get('[data-testid="service-card-svc-2"] [data-testid="service-image-preview"]').attributes('src')).toBe(NEW_URL)
      expect(created).toBeGreaterThan(0)
      expect(revoked).toBe(created)
      wrapper.unmount()
      expect(revoked).toBe(created)
    })

    it('«انصراف» discards a staged replacement or removal without any request', async () => {
      const fetchMock = routedFetch(() => [{ ...SERVICE, imageUrl: IMAGE_URL }], () => undefined)
      vi.stubGlobal('fetch', fetchMock)
      const wrapper = mount(ServicesView)
      await flush()
      const callsAfterLoad = fetchMock.mock.calls.length

      await pickImage(wrapper, '[data-testid="service-card-svc-1"]', jpeg())
      await wrapper.get('[data-testid="cancel-service-row"]').trigger('click')
      expect(wrapper.get('[data-testid="service-image-field"]').attributes('data-state')).toBe('existing')
      expect(wrapper.get('[data-testid="service-image-preview"]').attributes('src')).toBe(IMAGE_URL)

      await wrapper.get('[data-testid="remove-service-image"]').trigger('click')
      await wrapper.get('[data-testid="cancel-service-row"]').trigger('click')
      expect(wrapper.get('[data-testid="service-image-field"]').attributes('data-state')).toBe('existing')

      await flush()
      expect(fetchMock.mock.calls.length).toBe(callsAfterLoad)
      expect(wrapper.find('[data-testid="save-service-row"]').exists()).toBe(false)
    })

    describe('admin takedown notice', () => {
      const REMOVED_AT = '2026-10-09T08:30:00.000Z'
      const NOTICE = '[data-testid="service-image-removed-notice"]'
      const BANNER = '[data-testid="service-images-removed-banner"]'

      it('shows the per-card notice only for a service whose image support removed and that has no image now', async () => {
        const list = [
          { ...SERVICE, imageUrl: null, imageRemovedByAdminAt: REMOVED_AT },
          { ...SERVICE, id: 'svc-2', name: 'رنگ', imageUrl: null, imageRemovedByAdminAt: null },
          { ...SERVICE, id: 'svc-3', name: 'براشینگ', imageUrl: IMAGE_URL, imageRemovedByAdminAt: REMOVED_AT },
        ]
        vi.stubGlobal('fetch', routedFetch(() => list, () => undefined))
        const wrapper = mount(ServicesView)
        await flush()

        const notice = wrapper.get(`[data-testid="service-card-svc-1"] ${NOTICE}`)
        expect(notice.attributes('role')).toBe('status')
        expect(notice.text()).toContain('تصویر این خدمت به دلیل مغایرت با قوانین محتوای قیچی توسط پشتیبانی حذف شد')
        expect(notice.text()).toContain('می‌توانید تصویر دیگری بارگذاری کنید')
        // A service that merely has no image is not a takedown.
        expect(wrapper.find(`[data-testid="service-card-svc-2"] ${NOTICE}`).exists()).toBe(false)
        // One that has an image again needs no notice, whatever the timestamp says.
        expect(wrapper.find(`[data-testid="service-card-svc-3"] ${NOTICE}`).exists()).toBe(false)
      })

      it('shows one summary banner counting the services whose image support removed', async () => {
        const list = [
          { ...SERVICE, imageUrl: null, imageRemovedByAdminAt: REMOVED_AT },
          { ...SERVICE, id: 'svc-2', name: 'رنگ', imageUrl: null, imageRemovedByAdminAt: REMOVED_AT },
          { ...SERVICE, id: 'svc-3', name: 'براشینگ', imageUrl: null, imageRemovedByAdminAt: null },
        ]
        vi.stubGlobal('fetch', routedFetch(() => list, () => undefined))
        const wrapper = mount(ServicesView)
        await flush()

        const banners = wrapper.findAll(BANNER)
        expect(banners).toHaveLength(1)
        expect(banners[0]!.attributes('role')).toBe('status')
        expect(banners[0]!.text()).toContain('تصویر ۲ خدمت توسط پشتیبانی حذف شده است')
      })

      it('shows neither notice nor banner when no image was removed by support', async () => {
        const list = [{ ...SERVICE, imageUrl: null, imageRemovedByAdminAt: null }]
        vi.stubGlobal('fetch', routedFetch(() => list, () => undefined))
        const wrapper = mount(ServicesView)
        await flush()

        expect(wrapper.find(NOTICE).exists()).toBe(false)
        expect(wrapper.find(BANNER).exists()).toBe(false)
      })

      it('drops the notice and banner without a reload once a new upload returns imageRemovedByAdminAt null', async () => {
        const list = [{ ...SERVICE, imageUrl: null, imageRemovedByAdminAt: REMOVED_AT }]
        const fetchMock = routedFetch(() => list, (method, path) =>
          method === 'POST' && path === '/salons/mine/services/svc-1/image'
            ? reply(201, { ...SERVICE, imageUrl: NEW_URL, imageRemovedByAdminAt: null })
            : undefined)
        vi.stubGlobal('fetch', fetchMock)
        const wrapper = mount(ServicesView)
        await flush()
        expect(wrapper.find(NOTICE).exists()).toBe(true)
        expect(wrapper.find(BANNER).exists()).toBe(true)

        await pickImage(wrapper, '[data-testid="service-card-svc-1"]', jpeg())
        await saveRowEdits(wrapper)
        await flush()

        expect(callsTo(fetchMock, 'POST', '/salons/mine/services/svc-1/image')).toHaveLength(1)
        // Only the initial list load -- the notice went away from the upload response alone.
        expect(callsTo(fetchMock, 'GET', '/salons/mine/services')).toHaveLength(1)
        expect(wrapper.find(NOTICE).exists()).toBe(false)
        expect(wrapper.find(BANNER).exists()).toBe(false)
      })

      it('dates the removal in Asia/Tehran, not the browser timezone', async () => {
        // 21:00Z on 9 Oct is already 00:30 on 10 Oct (18 Mehr 1405) in Tehran.
        const list = [{ ...SERVICE, imageUrl: null, imageRemovedByAdminAt: '2026-10-09T21:00:00.000Z' }]
        vi.stubGlobal('fetch', routedFetch(() => list, () => undefined))
        const wrapper = mount(ServicesView)
        await flush()

        expect(wrapper.get(NOTICE).text()).toContain('تاریخ حذف: ۱۸ مهر ۱۴۰۵')
      })

      it('keeps the notice while a replacement is only staged and after its upload fails; the banner count follows saved state', async () => {
        const list = [
          { ...SERVICE, imageUrl: null, imageRemovedByAdminAt: REMOVED_AT },
          { ...SERVICE, id: 'svc-2', name: 'رنگ', imageUrl: null, imageRemovedByAdminAt: REMOVED_AT },
        ]
        let failUpload = true
        const fetchMock = routedFetch(() => list, (method, path) => {
          if (method === 'POST' && path === '/salons/mine/services/svc-1/image') {
            return failUpload ? reply(500, { message: 'x' }) : reply(200, { ...SERVICE, imageUrl: NEW_URL, imageRemovedByAdminAt: null })
          }
          return undefined
        })
        vi.stubGlobal('fetch', fetchMock)
        const wrapper = mount(ServicesView)
        await flush()
        expect(wrapper.get(BANNER).text()).toContain('تصویر ۲ خدمت')

        await pickImage(wrapper, '[data-testid="service-card-svc-1"]', jpeg())
        // Staged, not saved: the image is still gone on the public page.
        expect(wrapper.findAll(`[data-testid="service-card-svc-1"] ${NOTICE}`)).toHaveLength(1)
        expect(wrapper.get(BANNER).text()).toContain('تصویر ۲ خدمت')

        await saveRowEdits(wrapper)
        await flush()
        expect(wrapper.findAll(`[data-testid="service-card-svc-1"] ${NOTICE}`)).toHaveLength(1)
        expect(wrapper.get(BANNER).text()).toContain('تصویر ۲ خدمت')

        failUpload = false
        await saveRowEdits(wrapper)
        await flush()
        expect(wrapper.find(`[data-testid="service-card-svc-1"] ${NOTICE}`).exists()).toBe(false)
        expect(wrapper.findAll(NOTICE)).toHaveLength(1)
        expect(wrapper.findAll(BANNER)).toHaveLength(1)
        expect(wrapper.get(BANNER).text()).toContain('تصویر ۱ خدمت')
      })

      it('an owner removal clears a stale takedown timestamp from the DELETE response, with no reload', async () => {
        // Stale local row (image + timestamp); the owner then removes the image herself.
        const list = [{ ...SERVICE, imageUrl: IMAGE_URL, imageRemovedByAdminAt: REMOVED_AT }]
        const fetchMock = routedFetch(() => list, (method, path) =>
          method === 'DELETE' && path === '/salons/mine/services/svc-1/image'
            ? reply(200, { ...SERVICE, imageUrl: null, imageRemovedByAdminAt: null })
            : undefined)
        vi.stubGlobal('fetch', fetchMock)
        const wrapper = mount(ServicesView)
        await flush()

        await wrapper.get('[data-testid="remove-service-image"]').trigger('click')
        await saveRowEdits(wrapper)
        await flush()

        expect(callsTo(fetchMock, 'DELETE', '/salons/mine/services/svc-1/image')).toHaveLength(1)
        expect(callsTo(fetchMock, 'GET', '/salons/mine/services')).toHaveLength(1)
        expect(wrapper.find(NOTICE).exists()).toBe(false)
        expect(wrapper.find(BANNER).exists()).toBe(false)
      })
    })
  })
})
