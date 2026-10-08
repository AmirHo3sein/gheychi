import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetToast, useToast } from '@/composables/useToast'
import ToastContainer from './ToastContainer.vue'

describe('ToastContainer', () => {
  beforeEach(() => {
    resetToast()
  })

  it('renders a pushed toast message', async () => {
    const { push } = useToast()
    const wrapper = mount(ToastContainer)
    push('چیزی اشتباه پیش رفت')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('چیزی اشتباه پیش رفت')
  })

  it('renders multiple concurrent toasts', async () => {
    const { push } = useToast()
    const wrapper = mount(ToastContainer)
    push('پیام اول')
    push('پیام دوم')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('[data-testid="toast"]')).toHaveLength(2)
  })

  it('announces an error toast as an alert with the danger tone and an icon', async () => {
    const { push } = useToast()
    const wrapper = mount(ToastContainer)
    push('ذخیره نشد', 'error')
    await wrapper.vm.$nextTick()
    const toast = wrapper.get('[data-testid="toast"]')
    expect(toast.attributes('role')).toBe('alert')
    expect(toast.attributes('data-tone')).toBe('error')
    expect(toast.classes().join(' ')).toContain('--tone-danger-bg')
    expect(toast.findComponent({ name: 'AppIcon' }).props('name')).toBe('warning')
  })

  it('renders success and untoned toasts as polite status messages', async () => {
    const { push } = useToast()
    const wrapper = mount(ToastContainer)
    push('ذخیره شد', 'success')
    push('پیام ساده')
    await wrapper.vm.$nextTick()
    const toasts = wrapper.findAll('[data-testid="toast"]')
    expect(toasts.map((t) => t.attributes('role'))).toEqual(['status', 'status'])
    expect(toasts.map((t) => t.attributes('data-tone'))).toEqual(['success', 'info'])
    expect(wrapper.find('[aria-live="polite"]').exists()).toBe(true)
  })

  it('dismisses a toast from its close button', async () => {
    const { push } = useToast()
    const wrapper = mount(ToastContainer)
    push('بسته شود')
    await wrapper.vm.$nextTick()
    const close = wrapper.get('[data-testid="toast-dismiss"]')
    expect(close.attributes('aria-label')).toBe('بستن')
    await close.trigger('click')
    expect(wrapper.findAll('[data-testid="toast"]')).toHaveLength(0)
  })
})
