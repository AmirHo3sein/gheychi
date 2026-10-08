import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetToast, useToast } from '@/composables/useToast'
import ToastContainer from './ToastContainer.vue'

describe('ToastContainer', () => {
  beforeEach(() => {
    resetToast()
  })

  it('renders pushed toast messages', async () => {
    const { push } = useToast()
    const wrapper = mount(ToastContainer)

    push('چیزی اشتباه پیش رفت')
    await wrapper.vm.$nextTick()

    const toasts = wrapper.findAll('[data-testid="toast"]')
    expect(toasts).toHaveLength(1)
    expect(wrapper.text()).toContain('چیزی اشتباه پیش رفت')
  })

  it('renders multiple concurrent toasts and drops nothing', async () => {
    const { push } = useToast()
    const wrapper = mount(ToastContainer)

    push('اولین خطا')
    push('دومین خطا')
    await wrapper.vm.$nextTick()

    const toasts = wrapper.findAll('[data-testid="toast"]')
    expect(toasts).toHaveLength(2)
    expect(wrapper.text()).toContain('اولین خطا')
    expect(wrapper.text()).toContain('دومین خطا')
  })

  it('renders an error toast as an alert with the danger tone', async () => {
    const { push } = useToast()
    const wrapper = mount(ToastContainer)

    push('خطا', 'error')
    push('ذخیره شد', 'success')
    await wrapper.vm.$nextTick()

    const [error, success] = wrapper.findAll('[data-testid="toast"]')
    expect(error.attributes('role')).toBe('alert')
    expect(error.attributes('data-tone')).toBe('error')
    expect(error.classes().join(' ')).toContain('--tone-danger-bg')
    expect(success.attributes('role')).toBeUndefined()
    // A single polite live region wraps the whole stack.
    expect(wrapper.attributes('role')).toBe('status')
  })

  it('dismisses a toast from its close button', async () => {
    const { push } = useToast()
    const wrapper = mount(ToastContainer)

    push('یک')
    push('دو')
    await wrapper.vm.$nextTick()

    const close = wrapper.findAll('[data-testid="toast-dismiss"]')[0]
    expect(close.attributes('aria-label')).toBe('بستن')
    await close.trigger('click')

    const left = wrapper.findAll('[data-testid="toast"]')
    expect(left).toHaveLength(1)
    expect(left[0].text()).toContain('دو')
  })
})
