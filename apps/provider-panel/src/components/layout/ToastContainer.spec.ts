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
})
