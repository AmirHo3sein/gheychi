import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SalonSettingsView from './SalonSettingsView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

describe('SalonSettingsView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('loads the current salon info and saves an edit', async () => {
    fetchMock.mockResolvedValueOnce({
      data: {
        id: 's1',
        name: 'سالن قدیمی',
        description: '',
        genderTarget: 'women',
        address: 'خیابان آزادی',
        city: 'تهران',
        capacity: 2,
        lat: 35.7,
        lng: 51.4,
      },
      error: null,
    })
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
})
