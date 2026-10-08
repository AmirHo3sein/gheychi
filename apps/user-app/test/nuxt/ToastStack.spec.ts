import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import ToastStack from '../../app/components/layout/ToastStack.vue'

describe('ToastStack', () => {
  beforeEach(() => {
    useState('toasts').value = []
  })

  it('announces errors assertively (role=alert) and everything else politely (role=status)', async () => {
    const wrapper = await mountSuspended(ToastStack)
    const { push } = useToast()
    push('ذخیره شد', 'success')
    push('مشکلی پیش آمد', 'error')
    await nextTick()

    expect(wrapper.get('[role="alert"]').text()).toContain('مشکلی پیش آمد')
    expect(wrapper.get('[role="status"]').text()).toContain('ذخیره شد')
    expect(wrapper.get('[role="status"]').text()).not.toContain('مشکلی پیش آمد')
  })

  it('lets the user dismiss a toast without waiting it out', async () => {
    const wrapper = await mountSuspended(ToastStack)
    useToast().push('پیام تست')
    await nextTick()
    expect(wrapper.findAll('[data-testid="toast"]')).toHaveLength(1)

    await wrapper.get('button[aria-label="بستن"]').trigger('click')
    expect(wrapper.findAll('[data-testid="toast"]')).toHaveLength(0)
  })

  it('keeps push(message) working with no tone (existing call sites)', async () => {
    const { push, toasts } = useToast()
    push('سلام')
    expect(toasts.value.at(-1)).toMatchObject({ message: 'سلام', tone: 'info' })
  })
})
