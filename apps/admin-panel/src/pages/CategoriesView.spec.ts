import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CategoriesView from './CategoriesView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const categories = [
  { id: 1, name: 'اصلاح مو', icon: 'scissors' },
  { id: 2, name: 'رنگ مو', icon: 'palette' },
]

async function mountView() {
  const wrapper = mount(CategoriesView)
  await flushPromises()
  return wrapper
}

describe('CategoriesView delete', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    // Fresh copies per test -- the component mutates its local array on delete.
    fetchMock.mockResolvedValueOnce({ data: categories.map((c) => ({ ...c })), error: null })
  })

  it('expands to an inline confirm without deleting anything yet', async () => {
    const wrapper = await mountView()

    await wrapper.findAll('[data-testid="delete-category"]')[0].trigger('click')

    expect(wrapper.find('[data-testid="confirm-delete"]').exists()).toBe(true)
    // Only the initial GET /categories has fired.
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await wrapper.get('[data-testid="cancel-delete"]').trigger('click')
    expect(wrapper.find('[data-testid="confirm-delete"]').exists()).toBe(false)
  })

  it('deletes on confirm and removes the row on success', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: null }) // 204
    const wrapper = await mountView()

    await wrapper.findAll('[data-testid="delete-category"]')[0].trigger('click')
    await wrapper.get('[data-testid="confirm-delete"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/categories/1', { method: 'DELETE' })
    expect(wrapper.text()).not.toContain('اصلاح مو')
    expect(wrapper.text()).toContain('رنگ مو')
  })

  it('keeps the row when the API answers 409 (category in use)', async () => {
    fetchMock.mockResolvedValueOnce({
      data: null,
      error: { status: 409, message: 'این دسته‌بندی توسط خدمات سالن‌ها استفاده می‌شود و قابل حذف نیست' },
    })
    const wrapper = await mountView()

    await wrapper.findAll('[data-testid="delete-category"]')[0].trigger('click')
    await wrapper.get('[data-testid="confirm-delete"]').trigger('click')
    await flushPromises()

    // The toast comes from the real useApi (not silent); here we only assert the row survives
    // and the confirm strip collapsed.
    expect(wrapper.text()).toContain('اصلاح مو')
    expect(wrapper.find('[data-testid="confirm-delete"]').exists()).toBe(false)
  })
})
