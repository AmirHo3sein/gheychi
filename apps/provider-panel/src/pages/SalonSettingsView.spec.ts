import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetToast, useToast } from '@/composables/useToast'
import SalonSettingsView from './SalonSettingsView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const validSalon = {
  id: 's1',
  name: 'سالن قدیمی',
  description: '',
  genderTarget: 'women',
  address: 'خیابان آزادی',
  city: 'تهران',
  capacity: 2,
  lat: 35.7,
  lng: 51.4,
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

    fetchMock.mockResolvedValueOnce({ data: { id: 's1' }, error: null })
    await wrapper.get('[data-testid="salon-name"]').setValue('سالن جدید')
    await wrapper.get('[data-testid="save-button"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/salons/mine', {
      method: 'PATCH',
      body: expect.objectContaining({ name: 'سالن جدید' }),
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
