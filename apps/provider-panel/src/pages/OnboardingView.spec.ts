import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OnboardingView from './OnboardingView.vue'
import AppMultiSelect from '@/components/ui/AppMultiSelect.vue'
import AppSelect from '@/components/ui/AppSelect.vue'

// OnboardingView now owns its own GET /categories and GET /cities fetches (useServiceCategories,
// useCities) for the step-1 pickers, on top of FirstServiceStep's separate GET /categories
// fetch for the step-3 service form -- independent onMounted calls hitting these endpoints.
// This waits out the microtask/macrotask hops of a fetch so the step-1 pickers' options are
// populated before a test selects one.
async function waitForCategoriesToLoad() {
  await new Promise((r) => setTimeout(r, 0))
}

async function selectSalonCategory(wrapper: VueWrapper) {
  await waitForCategoriesToLoad()
  await wrapper.findComponent(AppMultiSelect).vm.$emit('update:modelValue', [1])
}

// AppSelect wraps vue-multiselect, so none of these pickers are native <select>s any more --
// .setValue() can't drive them; emitting the raw value the model expects is the established
// interaction pattern. SalonInfoStep (step 1) renders two AppSelects, in template order:
// [0] مخاطب آرایشگاه (gender-target), [1] شهر (city).
async function selectGenderTarget(wrapper: VueWrapper, genderTarget = 'women') {
  await wrapper.findAllComponents(AppSelect)[0]!.vm.$emit('update:modelValue', genderTarget)
}

async function selectSalonCity(wrapper: VueWrapper, city = 'تهران') {
  await waitForCategoriesToLoad()
  await wrapper.findAllComponents(AppSelect)[1]!.vm.$emit('update:modelValue', city)
}

// Steps are v-if/v-else-if/v-else in OnboardingView, so by the time step 3 is showing,
// FirstServiceStep's category picker is the only AppSelect mounted. Its model is a number
// (or null), so emit the raw id -- not the '1' string the old native <select> produced.
async function selectServiceCategory(wrapper: VueWrapper, categoryId = 1) {
  await wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', categoryId)
}

// SalonPinPicker.vue's map doesn't render meaningfully in jsdom/happy-dom (no real
// layout/getBoundingClientRect), so tests go through its keyboard-accessible lat/lng
// fallback inputs -- a real, user-reachable path (unlike directly poking component
// state), and the exact path a keyboard-only user has to use since Leaflet's own
// keyboard nav never moves the marker.
async function setPinViaFallbackInputs(wrapper: VueWrapper, lat = 35.7, lng = 51.4) {
  await wrapper.find('[data-testid="pin-lat"]').setValue(lat)
  await wrapper.find('[data-testid="pin-lng"]').setValue(lng)
  await wrapper.find('[data-testid="pin-lat"]').trigger('change')
  await wrapper.find('[data-testid="pin-lng"]').trigger('change')
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/onboarding', name: 'onboarding', component: OnboardingView },
      { path: '/pending-approval', name: 'pending-approval', component: { template: '<div />' } },
    ],
  })
}

describe('OnboardingView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the next button disabled until the salon-info step is complete', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ([]) }))
    const router = makeRouter()
    await router.push('/onboarding')
    await router.isReady()
    const wrapper = mount(OnboardingView, { global: { plugins: [router] } })

    const next = wrapper.find('[data-testid="wizard-next"]')
    expect((next.element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.find('[data-testid="salon-name"]').setValue('سالن سارا')
    await selectGenderTarget(wrapper)
    await selectSalonCity(wrapper)
    await wrapper.find('[data-testid="address"]').setValue('خیابان ولیعصر، پلاک ۱')
    // The map itself doesn't render meaningfully in jsdom/happy-dom (no real
    // layout/getBoundingClientRect) -- go through the keyboard-accessible lat/lng
    // fallback inputs instead, the same explicit-commit path a real user would use.
    await setPinViaFallbackInputs(wrapper)
    await selectSalonCategory(wrapper)

    expect((next.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps the next button disabled when capacity is out of the 1-50 range', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ([]) }))
    const router = makeRouter()
    await router.push('/onboarding')
    await router.isReady()
    const wrapper = mount(OnboardingView, { global: { plugins: [router] } })

    await wrapper.find('[data-testid="salon-name"]').setValue('سالن سارا')
    await selectGenderTarget(wrapper)
    await selectSalonCity(wrapper)
    await wrapper.find('[data-testid="address"]').setValue('خیابان ولیعصر، پلاک ۱')
    await wrapper.find('[data-testid="capacity"]').setValue(0)
    await setPinViaFallbackInputs(wrapper)
    await selectSalonCategory(wrapper)

    const next = wrapper.find('[data-testid="wizard-next"]')
    expect((next.element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.find('[data-testid="capacity"]').setValue(5)
    expect((next.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('submits salon, hours, and first service in order, then lands on pending-approval', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ id: 1, name: 'رنگ مو' }]) }) // OnboardingView's own categories (step 1 picker)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ name: 'تهران', lat: 35.6892, lng: 51.389 }]) }) // OnboardingView's own cities (step 1 picker)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ id: 1, name: 'رنگ مو' }]) }) // categories (mounted on step 3)
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 's1' }) }) // POST /salons
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // PUT hours
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'sv1' }) }) // POST services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 's1', status: 'pending' }) }) // refetch salon
    vi.stubGlobal('fetch', fetchMock)

    const router = makeRouter()
    await router.push('/onboarding')
    await router.isReady()
    const wrapper = mount(OnboardingView, { global: { plugins: [router] } })

    await wrapper.find('[data-testid="salon-name"]').setValue('سالن سارا')
    await selectGenderTarget(wrapper)
    await selectSalonCity(wrapper)
    await wrapper.find('[data-testid="address"]').setValue('خیابان ولیعصر، پلاک ۱')
    await setPinViaFallbackInputs(wrapper)
    await selectSalonCategory(wrapper)
    await wrapper.find('[data-testid="wizard-next"]').trigger('click')

    await wrapper.find('[data-testid="day-0"] input[type=checkbox]').setValue(true)
    await wrapper.find('[data-testid="wizard-next"]').trigger('click')
    // FirstServiceStep.vue's category select only renders once its own async
    // GET /categories resolves (a brief loading state precedes it).
    await new Promise((r) => setTimeout(r, 0))

    await selectServiceCategory(wrapper)
    await wrapper.find('[data-testid="service-name"]').setValue('رنگ مو')
    await wrapper.find('[data-testid="service-price"]').setValue('500000')
    await wrapper.find('[data-testid="service-duration"]').setValue('60')
    await wrapper.find('[data-testid="wizard-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await router.isReady()

    expect(fetchMock.mock.calls[3]![0]).toContain('/salons')
    expect(fetchMock.mock.calls[4]![0]).toContain('/salons/mine/hours')
    expect(fetchMock.mock.calls[5]![0]).toContain('/salons/mine/services')
    expect(router.currentRoute.value.name).toBe('pending-approval')
  })

  // A lunch-break split shift is two working_hours rows for the same weekday -- this pins
  // that the wizard actually flattens ScheduleStep's per-day `ranges` array into that shape
  // on submit, not just that the UI lets you add a second range (ScheduleStep.spec.ts's job).
  it('submits a lunch-break split shift as two separate weekday entries', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ id: 1, name: 'رنگ مو' }]) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ name: 'تهران', lat: 35.6892, lng: 51.389 }]) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ id: 1, name: 'رنگ مو' }]) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 's1' }) }) // POST /salons
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // PUT hours
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'sv1' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 's1', status: 'pending' }) })
    vi.stubGlobal('fetch', fetchMock)

    const router = makeRouter()
    await router.push('/onboarding')
    await router.isReady()
    const wrapper = mount(OnboardingView, { global: { plugins: [router] } })

    await wrapper.find('[data-testid="salon-name"]').setValue('سالن سارا')
    await selectGenderTarget(wrapper)
    await selectSalonCity(wrapper)
    await wrapper.find('[data-testid="address"]').setValue('خیابان ولیعصر، پلاک ۱')
    await setPinViaFallbackInputs(wrapper)
    await selectSalonCategory(wrapper)
    await wrapper.find('[data-testid="wizard-next"]').trigger('click')

    await wrapper.find('[data-testid="day-0"] input[type=checkbox]').setValue(true)
    const [openInput, closeInput] = wrapper.findAll('[data-testid="day-0"] input[type=time]')
    await openInput!.setValue('09:00')
    await closeInput!.setValue('13:00')
    await wrapper.find('[data-testid="day-0"] [data-testid="add-range"]').trigger('click')
    const secondRangeInputs = wrapper.findAll('[data-testid="day-0"] input[type=time]').slice(2)
    await secondRangeInputs[0]!.setValue('14:00')
    await secondRangeInputs[1]!.setValue('20:00')

    await wrapper.find('[data-testid="wizard-next"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    await selectServiceCategory(wrapper)
    await wrapper.find('[data-testid="service-name"]').setValue('رنگ مو')
    await wrapper.find('[data-testid="service-price"]').setValue('500000')
    await wrapper.find('[data-testid="service-duration"]').setValue('60')
    await wrapper.find('[data-testid="wizard-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const hoursCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/salons/mine/hours'))!
    const body = JSON.parse((hoursCall[1] as { body: string }).body)
    expect(body.hours).toEqual([
      { weekday: 0, openTime: '09:00', closeTime: '13:00' },
      { weekday: 0, openTime: '14:00', closeTime: '20:00' },
    ])
  })

  it('keeps the submit button disabled when duration or price is out of bounds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'رنگ مو' }] }) // OnboardingView's own categories (step 1 picker)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ name: 'تهران', lat: 35.6892, lng: 51.389 }] }) // OnboardingView's own cities (step 1 picker)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'رنگ مو' }] }) // categories (mounted on step 3)
    vi.stubGlobal('fetch', fetchMock)

    const router = makeRouter()
    await router.push('/onboarding')
    await router.isReady()
    const wrapper = mount(OnboardingView, { global: { plugins: [router] } })

    await wrapper.find('[data-testid="salon-name"]').setValue('سالن سارا')
    await selectGenderTarget(wrapper)
    await selectSalonCity(wrapper)
    await wrapper.find('[data-testid="address"]').setValue('خیابان ولیعصر، پلاک ۱')
    await setPinViaFallbackInputs(wrapper)
    await selectSalonCategory(wrapper)
    await wrapper.find('[data-testid="wizard-next"]').trigger('click')

    await wrapper.find('[data-testid="day-0"] input[type=checkbox]').setValue(true)
    await wrapper.find('[data-testid="wizard-next"]').trigger('click')
    // FirstServiceStep.vue's category select only renders once its own async
    // GET /categories resolves (a brief loading state precedes it).
    await new Promise((r) => setTimeout(r, 0))

    await selectServiceCategory(wrapper)
    await wrapper.find('[data-testid="service-name"]').setValue('رنگ مو')
    await wrapper.find('[data-testid="service-price"]').setValue('500000')
    await wrapper.find('[data-testid="service-duration"]').setValue('900')

    const submit = wrapper.find('[data-testid="wizard-submit"]')
    expect((submit.element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.find('[data-testid="service-duration"]').setValue('60')
    expect((submit.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps the user on the wizard with an error when the post-salon service creation fails, and does not re-POST /salons on retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ id: 1, name: 'رنگ مو' }]) }) // OnboardingView's own categories (step 1 picker)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ name: 'تهران', lat: 35.6892, lng: 51.389 }]) }) // OnboardingView's own cities (step 1 picker)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ id: 1, name: 'رنگ مو' }]) }) // categories (mounted on step 3)
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 's1' }) }) // POST /salons -- succeeds
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // PUT hours -- succeeds
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: 'خطای سرور' }) }) // POST services -- fails
    vi.stubGlobal('fetch', fetchMock)

    const router = makeRouter()
    await router.push('/onboarding')
    await router.isReady()
    const wrapper = mount(OnboardingView, { global: { plugins: [router] } })

    await wrapper.find('[data-testid="salon-name"]').setValue('سالن سارا')
    await selectGenderTarget(wrapper)
    await selectSalonCity(wrapper)
    await wrapper.find('[data-testid="address"]').setValue('خیابان ولیعصر، پلاک ۱')
    await setPinViaFallbackInputs(wrapper)
    await selectSalonCategory(wrapper)
    await wrapper.find('[data-testid="wizard-next"]').trigger('click')

    await wrapper.find('[data-testid="day-0"] input[type=checkbox]').setValue(true)
    await wrapper.find('[data-testid="wizard-next"]').trigger('click')
    // FirstServiceStep.vue's category select only renders once its own async
    // GET /categories resolves (a brief loading state precedes it).
    await new Promise((r) => setTimeout(r, 0))

    await selectServiceCategory(wrapper)
    await wrapper.find('[data-testid="service-name"]').setValue('رنگ مو')
    await wrapper.find('[data-testid="service-price"]').setValue('500000')
    await wrapper.find('[data-testid="service-duration"]').setValue('60')
    await wrapper.find('[data-testid="wizard-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await router.isReady()

    // Salon creation succeeded, but the service creation failure must stop the wizard
    // from proceeding -- not silently navigate to pending-approval as if all was well.
    expect(router.currentRoute.value.name).toBe('onboarding')
    expect(wrapper.text()).toContain('ثبت خدمت ناموفق بود. دوباره تلاش کنید.')
    expect(fetchMock).toHaveBeenCalledTimes(6)

    // Retry: only the hours + services + refetch calls should fire -- /salons must NOT
    // be re-POSTed since it already succeeded (a retry would otherwise 409).
    const retryFetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // PUT hours
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'sv1' }) }) // POST services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 's1', status: 'pending' }) }) // refetch salon
    vi.stubGlobal('fetch', retryFetchMock)

    await wrapper.find('[data-testid="wizard-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await router.isReady()

    expect(retryFetchMock).toHaveBeenCalledTimes(3)
    expect(retryFetchMock.mock.calls[0]![0]).toContain('/salons/mine/hours')
    expect(retryFetchMock.mock.calls[1]![0]).toContain('/salons/mine/services')
    expect(
      retryFetchMock.mock.calls.some(
        (call) => typeof call[0] === 'string' && call[0].endsWith('/salons') && (call[1] as RequestInit)?.method === 'POST',
      ),
    ).toBe(false)
    expect(router.currentRoute.value.name).toBe('pending-approval')
  })

  it('shows a retry option in the service step when categories fail to load', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ id: 1, name: 'رنگ مو' }]) }) // OnboardingView's own categories (step 1 picker) -- succeeds
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ name: 'تهران', lat: 35.6892, lng: 51.389 }]) }) // OnboardingView's own cities (step 1 picker) -- succeeds
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }) // FirstServiceStep's categories (step 3) -- fails
    vi.stubGlobal('fetch', fetchMock)

    const router = makeRouter()
    await router.push('/onboarding')
    await router.isReady()
    const wrapper = mount(OnboardingView, { global: { plugins: [router] } })

    await wrapper.find('[data-testid="salon-name"]').setValue('سالن سارا')
    await selectGenderTarget(wrapper)
    await selectSalonCity(wrapper)
    await wrapper.find('[data-testid="address"]').setValue('خیابان ولیعصر، پلاک ۱')
    await setPinViaFallbackInputs(wrapper)
    await selectSalonCategory(wrapper)
    await wrapper.find('[data-testid="wizard-next"]').trigger('click')

    await wrapper.find('[data-testid="day-0"] input[type=checkbox]').setValue(true)
    await wrapper.find('[data-testid="wizard-next"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="retry-categories"]').exists()).toBe(true)

    const retryFetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1, name: 'رنگ مو' }] })
    vi.stubGlobal('fetch', retryFetchMock)

    await wrapper.find('[data-testid="retry-categories"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(retryFetchMock).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="retry-categories"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="service-category"]').exists()).toBe(true)
  })

  // SalonPinPicker.vue used to emit its default center coordinate the instant it
  // mounted, before the owner clicked or dragged anything -- silently satisfying the
  // required lat/lng check with the wrong city's center for anyone who never touched
  // the map. This pins the fix: mounting alone must never count as "set".
  it('does not auto-commit the map default center on mount -- next stays disabled until the pin is explicitly set', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ([]) }))
    const router = makeRouter()
    await router.push('/onboarding')
    await router.isReady()
    const wrapper = mount(OnboardingView, { global: { plugins: [router] } })

    await wrapper.find('[data-testid="salon-name"]').setValue('سالن سارا')
    await selectGenderTarget(wrapper)
    await selectSalonCity(wrapper)
    await wrapper.find('[data-testid="address"]').setValue('خیابان ولیعصر، پلاک ۱')

    // The map mounted (with its default center visible) but must not have silently
    // emitted that as a committed pin.
    const next = wrapper.find('[data-testid="wizard-next"]')
    expect((next.element as HTMLButtonElement).disabled).toBe(true)
  })

  // The map's required lat/lng field is otherwise unreachable by keyboard -- Leaflet's
  // own keyboard nav pans/zooms but never moves the marker. These plain coordinate
  // inputs are the accessible fallback path, and committing through them (a native
  // `change`, i.e. an explicit edit+blur/Enter) must count exactly like a marker drag.
  it('lets the owner set the map pin via the keyboard-accessible lat/lng fallback inputs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ([]) }))
    const router = makeRouter()
    await router.push('/onboarding')
    await router.isReady()
    const wrapper = mount(OnboardingView, { global: { plugins: [router] } })

    await wrapper.find('[data-testid="salon-name"]').setValue('سالن سارا')
    await selectGenderTarget(wrapper)
    await selectSalonCity(wrapper)
    await wrapper.find('[data-testid="address"]').setValue('خیابان ولیعصر، پلاک ۱')

    const next = wrapper.find('[data-testid="wizard-next"]')
    expect((next.element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.find('[data-testid="pin-lat"]').setValue(35.7)
    await wrapper.find('[data-testid="pin-lng"]').setValue(51.4)
    await wrapper.find('[data-testid="pin-lat"]').trigger('change')
    await wrapper.find('[data-testid="pin-lng"]').trigger('change')
    await selectSalonCategory(wrapper)

    expect((next.element as HTMLButtonElement).disabled).toBe(false)
  })

  // An owner who leaves every day disabled on step 2 would go live completely
  // unbookable with no warning -- next must stay disabled until at least one day is on.
  it('keeps next disabled on the hours step until at least one day is enabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ([]) }))
    const router = makeRouter()
    await router.push('/onboarding')
    await router.isReady()
    const wrapper = mount(OnboardingView, { global: { plugins: [router] } })

    await wrapper.find('[data-testid="salon-name"]').setValue('سالن سارا')
    await selectGenderTarget(wrapper)
    await selectSalonCity(wrapper)
    await wrapper.find('[data-testid="address"]').setValue('خیابان ولیعصر، پلاک ۱')
    await setPinViaFallbackInputs(wrapper)
    await selectSalonCategory(wrapper)
    await wrapper.find('[data-testid="wizard-next"]').trigger('click')

    const next = wrapper.find('[data-testid="wizard-next"]')
    expect((next.element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.find('[data-testid="day-0"] input[type=checkbox]').setValue(true)
    expect((next.element as HTMLButtonElement).disabled).toBe(false)

    await wrapper.find('[data-testid="day-0"] input[type=checkbox]').setValue(false)
    expect((next.element as HTMLButtonElement).disabled).toBe(true)
  })

  // submit() POSTs /salons *before* it PUTs the hours, and the API 400s any
  // openTime >= closeTime -- so an invalid range that gets past step 2 leaves the owner with
  // a created-but-hourless salon that no retry of the same payload can ever fix. Step 2 has
  // to catch it, name the offending day, and say that overnight ranges aren't supported.
  it('keeps next disabled on the hours step when an enabled day closes before it opens', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ([]) }))
    const router = makeRouter()
    await router.push('/onboarding')
    await router.isReady()
    const wrapper = mount(OnboardingView, { global: { plugins: [router] } })

    await wrapper.find('[data-testid="salon-name"]').setValue('سالن سارا')
    await selectGenderTarget(wrapper)
    await selectSalonCity(wrapper)
    await wrapper.find('[data-testid="address"]').setValue('خیابان ولیعصر، پلاک ۱')
    await setPinViaFallbackInputs(wrapper)
    await selectSalonCategory(wrapper)
    await wrapper.find('[data-testid="wizard-next"]').trigger('click')

    // An overnight barbershop: 20:00 -> 02:00, a legitimate business the API can't store.
    await wrapper.find('[data-testid="day-2"] input[type=checkbox]').setValue(true)
    const [openInput, closeInput] = wrapper.findAll('[data-testid="day-2"] input[type=time]')
    await openInput!.setValue('20:00')
    await closeInput!.setValue('02:00')

    const next = wrapper.find('[data-testid="wizard-next"]')
    expect((next.element as HTMLButtonElement).disabled).toBe(true)
    expect(wrapper.find('[data-testid="disabled-hint"]').text()).toContain('بازه شبانه')
    expect(wrapper.find('[data-testid="disabled-hint"]').text()).toContain('سه‌شنبه')
    // The offending day is marked in place, not just described in the hint.
    expect(openInput!.attributes('aria-invalid')).toBe('true')

    await closeInput!.setValue('23:00')
    expect((next.element as HTMLButtonElement).disabled).toBe(false)
    expect(wrapper.find('[data-testid="disabled-hint"]').exists()).toBe(false)
  })
})
