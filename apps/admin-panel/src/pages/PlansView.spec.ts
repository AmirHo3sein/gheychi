import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PlansView from './PlansView.vue'

const fetchMock = vi.fn()
const pushToastMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ push: pushToastMock, toasts: [] }),
}))

// Factories, not shared constants -- the component mutates plan objects in place
// (toggleActive/setDefault/saveEdit all do Object.assign(plan, data) or direct field
// writes), so a shared object would leak mutations from one test into the next.
function freePlan() {
  return {
    id: 'plan-free', key: 'free', name: 'رایگان', description: null, monthlyPriceToman: 0,
    isActive: true, isDefault: true, sortOrder: 0, entitlements: {},
  }
}
function plusPlan() {
  return {
    id: 'plan-plus', key: 'plus', name: 'پلاس', description: 'برای سالن‌های فعال', monthlyPriceToman: 490000,
    isActive: true, isDefault: false, sortOrder: 1, entitlements: { smsMonthlyQuota: 100 },
  }
}

describe('PlansView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    pushToastMock.mockReset()
  })

  async function mountView() {
    const wrapper = mount(PlansView)
    await flushPromises()
    return wrapper
  }

  it('lists plans with their default/active badges and entitlements', async () => {
    fetchMock.mockResolvedValueOnce({ data: [freePlan(), plusPlan()], error: null })
    const wrapper = await mountView()

    const cards = wrapper.findAll('[data-testid="plan-card"]')
    expect(cards).toHaveLength(2)
    expect(cards[0]!.text()).toContain('رایگان')
    expect(cards[0]!.find('[data-testid="default-badge"]').exists()).toBe(true)
    expect(cards[1]!.text()).toContain('پلاس')
    expect(cards[1]!.find('[data-testid="default-badge"]').exists()).toBe(false)
    expect(cards[1]!.text()).toContain('smsMonthlyQuota')
  })

  it('shows a retryable error state when the initial load fails', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'boom' } })
    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="plans-load-error"]').exists()).toBe(true)

    fetchMock.mockResolvedValueOnce({ data: [freePlan()], error: null })
    await wrapper.get('[data-testid="plans-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="plans-load-error"]').exists()).toBe(false)
  })

  it('shows an empty state when there are no plans at all', async () => {
    fetchMock.mockResolvedValueOnce({ data: [], error: null })
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('هنوز پلنی تعریف نشده است.')
  })

  it('creates a new plan and appends it to the list', async () => {
    fetchMock.mockResolvedValueOnce({ data: [freePlan()], error: null })
    const wrapper = await mountView()

    await wrapper.get('[data-testid="new-plan-button"]').trigger('click')
    await wrapper.get('[data-testid="new-key-input"]').setValue('premium')
    await wrapper.get('[data-testid="new-name-input"]').setValue('پرمیوم')
    await wrapper.get('[data-testid="new-price-input"]').setValue('990000')
    await wrapper.get('[data-testid="new-entitlements-input"]').setValue('{"crmCustomerCap": 500}')

    fetchMock.mockResolvedValueOnce({
      data: {
        id: 'plan-premium', key: 'premium', name: 'پرمیوم', description: null, monthlyPriceToman: 990000,
        isActive: true, isDefault: false, sortOrder: 0, entitlements: { crmCustomerCap: 500 },
      },
      error: null,
    })
    // Clicking a type="submit" button does not trigger form submission under jsdom --
    // trigger the form's own submit event instead, matching this codebase's own convention
    // (LoginView.spec.ts, BlogPostsView.spec.ts).
    await wrapper.get('[data-testid="create-plan-form"] form').trigger('submit')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/plans', {
      method: 'POST',
      body: {
        key: 'premium',
        name: 'پرمیوم',
        description: undefined,
        monthlyPriceToman: 990000,
        entitlements: { crmCustomerCap: 500 },
      },
    })
    expect(wrapper.findAll('[data-testid="plan-card"]')).toHaveLength(2)
    // The form resets and closes after a successful create.
    expect(wrapper.find('[data-testid="create-plan-form"]').exists()).toBe(false)
  })

  it('rejects invalid JSON in the create form without calling the API', async () => {
    fetchMock.mockResolvedValueOnce({ data: [], error: null })
    const wrapper = await mountView()

    await wrapper.get('[data-testid="new-plan-button"]').trigger('click')
    await wrapper.get('[data-testid="new-key-input"]').setValue('premium')
    await wrapper.get('[data-testid="new-name-input"]').setValue('پرمیوم')
    await wrapper.get('[data-testid="new-entitlements-input"]').setValue('not json at all')

    fetchMock.mockClear()
    await wrapper.get('[data-testid="create-plan-form"] form').trigger('submit')

    expect(wrapper.find('[data-testid="new-entitlements-error"]').exists()).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('edits a plan\'s fields in place', async () => {
    fetchMock.mockResolvedValueOnce({ data: [plusPlan()], error: null })
    const wrapper = await mountView()

    await wrapper.get('[data-testid="edit-plan-plus"]').trigger('click')
    await wrapper.get('[data-testid="edit-name-plus"]').setValue('پلاس ویژه')

    fetchMock.mockResolvedValueOnce({ data: { ...plusPlan(), name: 'پلاس ویژه' }, error: null })
    await wrapper.get('[data-testid="save-edit-plus"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('پلاس ویژه')
    expect(pushToastMock).toHaveBeenCalled()
  })

  it('sets a different plan as default through the confirm step', async () => {
    fetchMock.mockResolvedValueOnce({ data: [freePlan(), plusPlan()], error: null })
    const wrapper = await mountView()

    await wrapper.get('[data-testid="set-default-plus"]').trigger('click')
    fetchMock.mockResolvedValueOnce({ data: { ...plusPlan(), isDefault: true }, error: null })
    await wrapper.get('[data-testid="confirm-set-default-plus"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/plans/plan-plus', { method: 'PATCH', body: { isDefault: true } })
    // Local state mirrors the server's atomic unset-then-set.
    const cards = wrapper.findAll('[data-testid="plan-card"]')
    expect(cards[0]!.find('[data-testid="default-badge"]').exists()).toBe(false)
    expect(cards[1]!.find('[data-testid="default-badge"]').exists()).toBe(true)
  })

  it('disables delete for the default plan', async () => {
    fetchMock.mockResolvedValueOnce({ data: [freePlan()], error: null })
    const wrapper = await mountView()

    const deleteButton = wrapper.get('[data-testid="delete-plan-free"]')
    expect((deleteButton.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('deletes a non-default plan through the confirm step and removes it from the list', async () => {
    fetchMock.mockResolvedValueOnce({ data: [freePlan(), plusPlan()], error: null })
    const wrapper = await mountView()

    await wrapper.get('[data-testid="delete-plan-plus"]').trigger('click')
    fetchMock.mockResolvedValueOnce({ data: undefined, error: null })
    await wrapper.get('[data-testid="confirm-delete-plus"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/plans/plan-plus', { method: 'DELETE' })
    expect(wrapper.findAll('[data-testid="plan-card"]')).toHaveLength(1)
  })

  it('keeps a plan in the list when delete fails (e.g. a 409 conflict)', async () => {
    fetchMock.mockResolvedValueOnce({ data: [plusPlan()], error: null })
    const wrapper = await mountView()

    await wrapper.get('[data-testid="delete-plan-plus"]').trigger('click')
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 409, message: 'in use' } })
    await wrapper.get('[data-testid="confirm-delete-plus"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('[data-testid="plan-card"]')).toHaveLength(1)
  })
})
