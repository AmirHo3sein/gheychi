import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppSelect from '@/components/ui/AppSelect.vue'
import BeautyConceptsView from './BeautyConceptsView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const CATEGORIES = [
  { id: 1, name: 'رنگ مو', icon: 'palette' },
  { id: 2, name: 'ناخن', icon: 'nail' },
]

const CONCEPTS = [
  {
    id: 'c1', key: 'balayage', domain: 'hair_color', nameFa: 'بالیاژ', nameEn: 'Balayage', categoryId: 1,
    keywords: ['بالیاژ', 'balayage'], maintenanceFa: null, isActive: true, sortOrder: 0, createdAt: '2026-10-07T00:00:00.000Z',
  },
  {
    id: 'c2', key: 'chrome', domain: 'nails', nameFa: 'کروم', nameEn: 'Chrome', categoryId: null,
    keywords: [], maintenanceFa: null, isActive: false, sortOrder: 0, createdAt: '2026-10-07T00:00:00.000Z',
  },
]

// load() fires GET /admin/beauty-concepts and GET /categories in parallel, in that order.
async function mountView() {
  fetchMock.mockResolvedValueOnce({ data: CONCEPTS.map((c) => ({ ...c, keywords: [...c.keywords] })), error: null })
  fetchMock.mockResolvedValueOnce({ data: CATEGORIES, error: null })
  const wrapper = mount(BeautyConceptsView)
  await flushPromises()
  return wrapper
}

function selectByLabel(wrapper: Awaited<ReturnType<typeof mountView>>, label: string) {
  return wrapper.findAllComponents(AppSelect).find((c) => c.props('label') === label)!
}

describe('BeautyConceptsView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('lists concepts grouped by Persian domain with key, names, category and keywords', async () => {
    const wrapper = await mountView()

    expect(fetchMock).toHaveBeenCalledWith('/admin/beauty-concepts', { silent: true })
    expect(fetchMock).toHaveBeenCalledWith('/categories', { silent: true })
    const hair = wrapper.get('[data-testid="domain-group-hair_color"]')
    expect(hair.text()).toContain('رنگ مو')
    const balayage = wrapper.get('[data-testid="concept-balayage"]')
    expect(balayage.text()).toContain('بالیاژ (Balayage)')
    expect(balayage.text()).toContain('balayage')
    expect(balayage.get('[data-testid="concept-category"]').text()).toBe('رنگ مو')
    expect(balayage.get('[data-testid="concept-keywords"]').text()).toContain('بالیاژ، balayage')
    expect(balayage.text()).toContain('فعال')
    expect(wrapper.get('[data-testid="domain-group-nails"]').text()).toContain('ناخن')
  })

  it('flags an unmapped concept with a warning badge', async () => {
    const wrapper = await mountView()
    const chrome = wrapper.get('[data-testid="concept-chrome"]')
    expect(chrome.get('[data-testid="concept-unmapped"]').text()).toContain('بدون نگاشت')
    expect(chrome.text()).toContain('غیرفعال')
    expect(wrapper.get('[data-testid="concept-balayage"]').find('[data-testid="concept-unmapped"]').exists()).toBe(false)
  })

  it('filters by domain', async () => {
    const wrapper = await mountView()
    await selectByLabel(wrapper, 'حوزه').vm.$emit('update:modelValue', 'nails')
    expect(wrapper.find('[data-testid="domain-group-hair_color"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="domain-group-nails"]').exists()).toBe(true)
  })

  it('creates a concept, parsing keywords and mapping "no category" to null', async () => {
    const wrapper = await mountView()
    await wrapper.get('[data-testid="new-concept"]').trigger('click')

    const form = wrapper.get('[data-testid="concept-form"]')
    await form.get('input[data-testid="concept-key-input"]').setValue('root_melt')
    await form.get('input[data-testid="concept-name-fa-input"]').setValue('روت ملت')
    await form.get('input[data-testid="concept-name-en-input"]').setValue('Root melt')
    await form.get('input[data-testid="concept-keywords-input"]').setValue('روت ملت، root melt, , root melt')
    await form.get('[data-testid="concept-maintenance-input"]').setValue('  ')

    const created = { ...CONCEPTS[0], id: 'c3', key: 'root_melt', nameFa: 'روت ملت', nameEn: 'Root melt', categoryId: null }
    fetchMock.mockResolvedValueOnce({ data: created, error: null })
    await form.trigger('submit')
    await flushPromises()

    expect(fetchMock).toHaveBeenLastCalledWith('/admin/beauty-concepts', {
      method: 'POST',
      body: {
        key: 'root_melt',
        domain: 'hair_color',
        nameFa: 'روت ملت',
        nameEn: 'Root melt',
        categoryId: null,
        keywords: ['روت ملت', 'root melt'],
        maintenanceFa: null,
        isActive: true,
        sortOrder: 0,
      },
    })
    expect(wrapper.find('[data-testid="concept-root_melt"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="concept-form"]').exists()).toBe(false)
  })

  it('blocks an invalid key client-side without calling the API', async () => {
    const wrapper = await mountView()
    await wrapper.get('[data-testid="new-concept"]').trigger('click')
    const form = wrapper.get('[data-testid="concept-form"]')
    await form.get('input[data-testid="concept-key-input"]').setValue('Bad Key')
    await form.get('input[data-testid="concept-name-fa-input"]').setValue('x')
    await form.get('input[data-testid="concept-name-en-input"]').setValue('x')
    await form.trigger('submit')
    await flushPromises()

    expect(form.get('[data-testid="concept-form-error"]').text()).toContain('کلید')
    expect(fetchMock).toHaveBeenCalledTimes(2) // only the initial loads
  })

  it('keeps the create form open when the API answers 409 (duplicate key)', async () => {
    const wrapper = await mountView()
    await wrapper.get('[data-testid="new-concept"]').trigger('click')
    const form = wrapper.get('[data-testid="concept-form"]')
    await form.get('input[data-testid="concept-key-input"]').setValue('balayage')
    await form.get('input[data-testid="concept-name-fa-input"]').setValue('بالیاژ')
    await form.get('input[data-testid="concept-name-en-input"]').setValue('Balayage')

    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 409, message: 'این کلید قبلاً ثبت شده است' } })
    await form.trigger('submit')
    await flushPromises()

    // Not silent -- useApi itself toasts the 409's Farsi message.
    const [, options] = fetchMock.mock.calls.at(-1)!
    expect(options.silent).toBeUndefined()
    expect(wrapper.find('[data-testid="concept-form"]').exists()).toBe(true)
  })

  it('edits inline without a key field and PATCHes the changed concept, including mapping a category', async () => {
    const wrapper = await mountView()
    await wrapper.get('[data-testid="edit-concept-chrome"]').trigger('click')

    const card = wrapper.get('[data-testid="concept-chrome"]')
    expect(card.find('input[data-testid="concept-key-input"]').exists()).toBe(false)
    await card.get('input[data-testid="concept-name-fa-input"]').setValue('کروم آینه‌ای')
    await card.get('[data-testid="concept-active-input"]').setValue(true)
    await wrapper.findAllComponents(AppSelect).find((c) => c.props('label')?.startsWith('دسته‌بندی'))!
      .vm.$emit('update:modelValue', 2)

    const updated = { ...CONCEPTS[1], nameFa: 'کروم آینه‌ای', isActive: true, categoryId: 2 }
    fetchMock.mockResolvedValueOnce({ data: updated, error: null })
    await card.get('[data-testid="concept-form"]').trigger('submit')
    await flushPromises()

    expect(fetchMock).toHaveBeenLastCalledWith('/admin/beauty-concepts/c2', {
      method: 'PATCH',
      body: {
        domain: 'nails',
        nameFa: 'کروم آینه‌ای',
        nameEn: 'Chrome',
        categoryId: 2,
        keywords: [],
        maintenanceFa: null,
        isActive: true,
        sortOrder: 0,
      },
    })
    const after = wrapper.get('[data-testid="concept-chrome"]')
    expect(after.find('[data-testid="concept-form"]').exists()).toBe(false)
    expect(after.text()).toContain('کروم آینه‌ای')
    expect(after.get('[data-testid="concept-category"]').text()).toBe('ناخن')
  })

  it('shows the cautious-maintenance hint in the form', async () => {
    const wrapper = await mountView()
    await wrapper.get('[data-testid="new-concept"]').trigger('click')
    expect(wrapper.get('[data-testid="concept-form"]').text()).toContain('بدون وعده یا برنامه قطعی')
  })

  it('shows a retry state on a failed load', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'x' } })
    fetchMock.mockResolvedValueOnce({ data: CATEGORIES, error: null })
    const wrapper = mount(BeautyConceptsView)
    await flushPromises()

    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(true)

    fetchMock.mockResolvedValueOnce({ data: CONCEPTS, error: null })
    fetchMock.mockResolvedValueOnce({ data: CATEGORIES, error: null })
    await wrapper.get('[data-testid="retry-load"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="concept-balayage"]').exists()).toBe(true)
  })
})
