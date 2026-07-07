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
})
