import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SalonHandleCard from './SalonHandleCard.vue'

const fetchMock = vi.fn()
const pushToastMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ push: pushToastMock, toasts: [] }),
}))

describe('SalonHandleCard', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    pushToastMock.mockReset()
  })

  function mountCard() {
    return mount(SalonHandleCard, { props: { salonId: 's1', slug: 'current-handle' } })
  }

  it('shows the current handle read-only by default', () => {
    const wrapper = mountCard()
    expect(wrapper.get('[data-testid="handle-value"]').text()).toBe('/salons/current-handle')
    expect(wrapper.find('[data-testid="handle-input"]').exists()).toBe(false)
  })

  it('rejects an invalid handle client-side without calling the API', async () => {
    const wrapper = mountCard()
    await wrapper.get('[data-testid="edit-handle-button"]').trigger('click')
    await wrapper.get('[data-testid="handle-input"]').setValue('Not Valid!')
    await wrapper.get('[data-testid="save-handle-button"]').trigger('click')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('آدرس فقط می‌تواند شامل حروف انگلیسی کوچک')
  })

  it('saves a valid handle and emits the update', async () => {
    fetchMock.mockResolvedValueOnce({ data: { slug: 'new-handle' }, error: null })

    const wrapper = mountCard()
    await wrapper.get('[data-testid="edit-handle-button"]').trigger('click')
    await wrapper.get('[data-testid="handle-input"]').setValue('new-handle')
    await wrapper.get('[data-testid="save-handle-button"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(fetchMock).toHaveBeenCalledWith('/admin/salons/s1/handle', { method: 'PATCH', body: { handle: 'new-handle' } })
    expect(wrapper.emitted('updated')).toEqual([['new-handle']]);
    expect(wrapper.find('[data-testid="handle-input"]').exists()).toBe(false)
  })

  it('leaves the edit form open and emits nothing when the API rejects the handle', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 409, message: 'قبلا استفاده شده' } })

    const wrapper = mountCard()
    await wrapper.get('[data-testid="edit-handle-button"]').trigger('click')
    await wrapper.get('[data-testid="handle-input"]').setValue('taken')
    await wrapper.get('[data-testid="save-handle-button"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('updated')).toBeUndefined()
    expect(wrapper.find('[data-testid="handle-input"]').exists()).toBe(true)
  })
})
