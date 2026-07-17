import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  tagline: 'شعار قدیمی',
  about: 'متن درباره سالن',
  instagramHandle: 'old.salon',
}

describe('SalonSettingsView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    resetToast()
  })

  it('loads the current salon info and saves an edit', async () => {
    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null })
    const wrapper = mount(SalonSettingsView)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-testid="salon-name"]').element as HTMLInputElement).toHaveProperty('value', 'سالن قدیمی')

    // The save button must be enabled from the initial load already -- lat/lng are
    // parsed out of the PostGIS `location` field, not read off a nonexistent top-level
    // lat/lng, so isFormValid's null check should already be satisfied here.
    expect((wrapper.get('[data-testid="save-button"]').element as HTMLButtonElement).disabled).toBe(false)

    fetchMock.mockResolvedValueOnce({ data: { id: 's1' }, error: null })
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
    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null })
    const wrapper = mount(SalonSettingsView)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    fetchMock.mockResolvedValueOnce({ data: { id: 's1' }, error: null })
    await wrapper.get('[data-testid="save-button"]').trigger('click')
    await wrapper.vm.$nextTick()

    const { toasts } = useToast()
    expect(toasts.value.some((t) => t.message === 'تغییرات ذخیره شد')).toBe(true)
  })

  it('does not toast and does not call the API when saving is attempted with an invalid form', async () => {
    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null })
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
    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null })
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
    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null })
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

    fetchMock.mockResolvedValueOnce({ data: { id: 's1' }, error: null })
    await wrapper.get('[data-testid="save-button"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/salons/mine', {
      method: 'PATCH',
      body: expect.objectContaining({ tagline: '', about: 'متن تازه\nخط دوم', instagramHandle: 'new.salon' }),
    })
  })

  it('previews tagline and a compact lead of about', async () => {
    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null })
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
    fetchMock.mockResolvedValueOnce({ data: validSalon, error: null })
    const wrapper = mount(SalonSettingsView)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    await wrapper.get('[data-testid="capacity"]').setValue(0)
    expect((wrapper.get('[data-testid="save-button"]').element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.get('[data-testid="capacity"]').setValue(5)
    expect((wrapper.get('[data-testid="save-button"]').element as HTMLButtonElement).disabled).toBe(false)
  })
})
