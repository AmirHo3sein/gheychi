import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSalon, useSalon } from '@/composables/useSalon'
import { resetToast, useToast } from '@/composables/useToast'
import SalonSettingsView from './SalonSettingsView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

// Matches the real GET /salons/mine response shape (the raw Salon entity): geo data
// comes back as a PostGIS geography column, not top-level lat/lng fields.
const validSalon = {
  id: 's1',
  name: 'سالن قدیمی',
  description: '',
  genderTarget: 'women',
  address: 'خیابان آزادی',
  city: 'تهران',
  capacity: 2,
  location: { type: 'Point', coordinates: [51.4, 35.7] },
  categories: [{ id: 1, name: 'کوتاهی مو', icon: 'scissors' }],
  tagline: 'شعار قدیمی',
  about: 'متن درباره سالن',
  instagramHandle: 'old.salon',
}

const CATEGORIES_RESPONSE = { data: [{ id: 1, name: 'کوتاهی مو', icon: 'scissors' }], error: null }
const CITIES_RESPONSE = {
  data: [{ name: 'تهران', lat: 35.6892, lng: 51.389 }, { name: 'مشهد', lat: 36.2605, lng: 59.6168 }],
  error: null,
}

describe('SalonSettingsView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    resetToast()
    // useSalon's state is a module-level singleton -- save() now refreshes it, so it has to
    // start clean in every test or one test's refetch leaks into the next.
    resetSalon()
  })

  it('loads the current salon info and saves an edit', async () => {
    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null }) // GET /salons/mine
    fetchMock.mockResolvedValueOnce(CATEGORIES_RESPONSE) // GET /categories
    fetchMock.mockResolvedValueOnce(CITIES_RESPONSE) // GET /cities
    const wrapper = mount(SalonSettingsView)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-testid="salon-name"]').element as HTMLInputElement).toHaveProperty('value', 'سالن قدیمی')

    // The save button must be enabled from the initial load already -- lat/lng are
    // parsed out of the PostGIS `location` field, not read off a nonexistent top-level
    // lat/lng, so isFormValid's null check should already be satisfied here.
    expect((wrapper.get('[data-testid="save-button"]').element as HTMLButtonElement).disabled).toBe(false)

    fetchMock.mockResolvedValueOnce({ data: { id: 's1' }, error: null }) // PATCH
    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null }) // useSalon refetch
    await wrapper.get('[data-testid="salon-name"]').setValue('سالن جدید')
    await wrapper.get('[data-testid="save-button"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/salons/mine', {
      method: 'PATCH',
      // Coordinate order flips back to { lat, lng } for the PATCH body -- confirms
      // `location.coordinates` ([lng, lat]) was unpacked correctly, not transposed.
      body: expect.objectContaining({ name: 'سالن جدید', lat: 35.7, lng: 51.4 }),
    })
  })

  it('shows a success toast after a successful save', async () => {
    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null }) // GET /salons/mine
    fetchMock.mockResolvedValueOnce(CATEGORIES_RESPONSE) // GET /categories
    fetchMock.mockResolvedValueOnce(CITIES_RESPONSE) // GET /cities
    const wrapper = mount(SalonSettingsView)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    fetchMock.mockResolvedValueOnce({ data: { id: 's1' }, error: null }) // PATCH
    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null }) // useSalon refetch
    await wrapper.get('[data-testid="save-button"]').trigger('click')
    await wrapper.vm.$nextTick()

    const { toasts } = useToast()
    expect(toasts.value.some((t) => t.message === 'تغییرات ذخیره شد')).toBe(true)
  })

  it('does not toast and does not call the API when saving is attempted with an invalid form', async () => {
    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null }) // GET /salons/mine
    fetchMock.mockResolvedValueOnce(CATEGORIES_RESPONSE) // GET /categories
    fetchMock.mockResolvedValueOnce(CITIES_RESPONSE) // GET /cities
    const wrapper = mount(SalonSettingsView)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    await wrapper.get('[data-testid="capacity"]').setValue(0)
    fetchMock.mockReset()

    const saveButton = wrapper.get('[data-testid="save-button"]')
    expect((saveButton.element as HTMLButtonElement).disabled).toBe(true)

    await saveButton.trigger('click')
    await wrapper.vm.$nextTick()

    expect(fetchMock).not.toHaveBeenCalled()
    const { toasts } = useToast()
    expect(toasts.value.some((t) => t.message === 'تغییرات ذخیره شد')).toBe(false)
  })

  it('shows a Persian inline error and disables save while the instagram handle is invalid', async () => {
    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null }) // GET /salons/mine
    fetchMock.mockResolvedValueOnce(CATEGORIES_RESPONSE) // GET /categories
    fetchMock.mockResolvedValueOnce(CITIES_RESPONSE) // GET /cities
    const wrapper = mount(SalonSettingsView)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="instagram-error"]').exists()).toBe(false)

    await wrapper.get('[data-testid="instagram-handle"]').setValue('سالن من!')
    expect(wrapper.get('[data-testid="instagram-error"]').text()).toContain('آیدی اینستاگرام')
    expect((wrapper.get('[data-testid="save-button"]').element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.get('[data-testid="instagram-handle"]').setValue('my.salon_1')
    expect(wrapper.find('[data-testid="instagram-error"]').exists()).toBe(false)
    expect((wrapper.get('[data-testid="save-button"]').element as HTMLButtonElement).disabled).toBe(false)
  })

  it('sends the three profile fields in the PATCH body, with empty string as the clear signal', async () => {
    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null }) // GET /salons/mine
    fetchMock.mockResolvedValueOnce(CATEGORIES_RESPONSE) // GET /categories
    fetchMock.mockResolvedValueOnce(CITIES_RESPONSE) // GET /cities
    const wrapper = mount(SalonSettingsView)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    // Loaded values are prefilled from GET /salons/mine.
    expect(wrapper.get('[data-testid="tagline"]').element as HTMLInputElement).toHaveProperty('value', 'شعار قدیمی')
    expect(wrapper.get('[data-testid="instagram-handle"]').element as HTMLInputElement).toHaveProperty('value', 'old.salon')

    // Clearing tagline must PATCH '' (the API transforms '' -> null); `|| undefined`
    // omission would make a field impossible to clear.
    await wrapper.get('[data-testid="tagline"]').setValue('')
    await wrapper.get('[data-testid="about"]').setValue('متن تازه\nخط دوم')
    await wrapper.get('[data-testid="instagram-handle"]').setValue('new.salon')

    fetchMock.mockResolvedValueOnce({ data: { id: 's1' }, error: null }) // PATCH
    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null }) // useSalon refetch
    await wrapper.get('[data-testid="save-button"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/salons/mine', {
      method: 'PATCH',
      body: expect.objectContaining({ tagline: '', about: 'متن تازه\nخط دوم', instagramHandle: 'new.salon' }),
    })
  })

  it('previews tagline and a compact lead of about', async () => {
    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null }) // GET /salons/mine
    fetchMock.mockResolvedValueOnce(CATEGORIES_RESPONSE) // GET /categories
    fetchMock.mockResolvedValueOnce(CITIES_RESPONSE) // GET /cities
    const wrapper = mount(SalonSettingsView)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const preview = wrapper.get('[data-testid="profile-preview"]')
    expect(preview.text()).toContain('شعار قدیمی')
    expect(preview.text()).toContain('متن درباره سالن')

    // Preview disappears when both showcase text fields are emptied.
    await wrapper.get('[data-testid="tagline"]').setValue('')
    await wrapper.get('[data-testid="about"]').setValue('')
    expect(wrapper.find('[data-testid="profile-preview"]').exists()).toBe(false)
  })

  it('re-enables the save button once capacity is back in the 1-50 range', async () => {
    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null }) // GET /salons/mine
    fetchMock.mockResolvedValueOnce(CATEGORIES_RESPONSE) // GET /categories
    fetchMock.mockResolvedValueOnce(CITIES_RESPONSE) // GET /cities
    const wrapper = mount(SalonSettingsView)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    await wrapper.get('[data-testid="capacity"]').setValue(0)
    expect((wrapper.get('[data-testid="save-button"]').element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.get('[data-testid="capacity"]').setValue(5)
    expect((wrapper.get('[data-testid="save-button"]').element as HTMLButtonElement).disabled).toBe(false)
  })

  // AppLayout's header reads the salon name off useSalon()'s singleton, which the router
  // guard fills exactly once per SPA session -- a rename used to toast "ذخیره شد" while the
  // header kept the old name until a hard reload.
  it('refreshes the useSalon singleton after a successful save so the header stops showing the old name', async () => {
    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null }) // GET /salons/mine
    fetchMock.mockResolvedValueOnce(CATEGORIES_RESPONSE) // GET /categories
    fetchMock.mockResolvedValueOnce(CITIES_RESPONSE) // GET /cities
    const wrapper = mount(SalonSettingsView)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const { salon } = useSalon()
    fetchMock.mockResolvedValueOnce({ data: { id: 's1' }, error: null }) // PATCH
    fetchMock.mockResolvedValueOnce({ data: { ...validSalon, name: 'سالن جدید' }, error: null }) // useSalon refetch

    await wrapper.get('[data-testid="salon-name"]').setValue('سالن جدید')
    await wrapper.get('[data-testid="save-button"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(fetchMock).toHaveBeenCalledWith('/salons/mine', { silent: true, redirectOn401: false })
    expect(salon.value?.name).toBe('سالن جدید')
  })

  it('does not refresh the salon singleton when the save fails', async () => {
    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null }) // GET /salons/mine
    fetchMock.mockResolvedValueOnce(CATEGORIES_RESPONSE) // GET /categories
    fetchMock.mockResolvedValueOnce(CITIES_RESPONSE) // GET /cities
    const wrapper = mount(SalonSettingsView)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'خطا' } }) // PATCH fails
    await wrapper.get('[data-testid="salon-name"]').setValue('سالن جدید')
    await wrapper.get('[data-testid="save-button"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(fetchMock).not.toHaveBeenCalledWith('/salons/mine', { silent: true, redirectOn401: false })
    expect(useToast().toasts.value.some((t) => t.message === 'تغییرات ذخیره شد')).toBe(false)
  })

  // UpdateSalonDto is @Length(5, 500) on address; a merely non-empty gate let a short
  // value reach a green save button, and the API's English validator array was the
  // provider's only feedback. City no longer has an equivalent case -- it's a select
  // constrained to the backend's known-city list, so "too short" can't occur through the UI.
  it.each([
    ['address', 'خیا', 'آدرس باید حداقل ۵ حرف باشد.'],
  ])('blocks the save and shows a Persian inline error for a too-short %s', async (field, value, message) => {
    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null }) // GET /salons/mine
    fetchMock.mockResolvedValueOnce(CATEGORIES_RESPONSE) // GET /categories
    fetchMock.mockResolvedValueOnce(CITIES_RESPONSE) // GET /cities
    const wrapper = mount(SalonSettingsView)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    await wrapper.get(`[data-testid="${field}"]`).setValue(value)
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain(message)
    expect((wrapper.get('[data-testid="save-button"]').element as HTMLButtonElement).disabled).toBe(true)

    fetchMock.mockClear()
    await wrapper.get('[data-testid="save-button"]').trigger('click')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows a loading state, then a retry option instead of a blank form when the initial load fails', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'خطا' } }) // GET /salons/mine
    fetchMock.mockResolvedValueOnce(CATEGORIES_RESPONSE) // GET /categories
    fetchMock.mockResolvedValueOnce(CITIES_RESPONSE) // GET /cities
    const wrapper = mount(SalonSettingsView)

    // Before the fetch resolves: no blank default form, no error -- a loading state.
    expect(wrapper.find('[data-testid="salon-name"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="retry-settings"]').exists()).toBe(false)

    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="retry-settings"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="salon-name"]').exists()).toBe(false)

    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null })
    await wrapper.get('[data-testid="retry-settings"]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="retry-settings"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="salon-name"]').element as HTMLInputElement).toHaveProperty('value', 'سالن قدیمی')
  })

  // SalonPinPicker.vue is shared with OnboardingView -- this pins that loading an
  // existing salon's real coordinates into the fallback inputs, and correcting them
  // through that same keyboard-accessible path, round-trips correctly rather than the
  // pin silently resetting to a hardcoded default center.
  it('reflects the loaded pin in the lat/lng fallback inputs and saves a correction made through them', async () => {
    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null }) // GET /salons/mine
    fetchMock.mockResolvedValueOnce(CATEGORIES_RESPONSE) // GET /categories
    fetchMock.mockResolvedValueOnce(CITIES_RESPONSE) // GET /cities
    const wrapper = mount(SalonSettingsView)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect((wrapper.get('[data-testid="pin-lat"]').element as HTMLInputElement).value).toBe('35.7')
    expect((wrapper.get('[data-testid="pin-lng"]').element as HTMLInputElement).value).toBe('51.4')

    await wrapper.get('[data-testid="pin-lat"]').setValue(36.1)
    await wrapper.get('[data-testid="pin-lat"]').trigger('change')

    fetchMock.mockResolvedValueOnce({ data: { id: 's1' }, error: null }) // PATCH
    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null }) // useSalon refetch
    await wrapper.get('[data-testid="save-button"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/salons/mine', {
      method: 'PATCH',
      body: expect.objectContaining({ lat: 36.1, lng: 51.4 }),
    })
  })
  // Layout regression. The handle field sits in a `flex ... overflow-hidden` row behind an
  // unbreakable ~130px "instagram.com/" prefix. An <input> has a ~20-character intrinsic
  // minimum width that flex will not shrink past, so at 320px the field was pushed out of
  // the row and CLIPPED by the wrapper -- an unreachable control. min-w-0 is the fix.
  it('lets the instagram handle field shrink behind its prefix instead of being clipped', async () => {
    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null }) // GET /salons/mine
    fetchMock.mockResolvedValueOnce(CATEGORIES_RESPONSE) // GET /categories
    fetchMock.mockResolvedValueOnce(CITIES_RESPONSE) // GET /cities
    const wrapper = mount(SalonSettingsView)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const input = wrapper.get('[data-testid="instagram-handle"]')
    expect(input.classes()).toContain('min-w-0')
    // The prefix keeps its full width; the field takes whatever is left.
    const prefix = input.element.parentElement!.querySelector('span')!
    expect(prefix.className).toContain('shrink-0')
  })
})
