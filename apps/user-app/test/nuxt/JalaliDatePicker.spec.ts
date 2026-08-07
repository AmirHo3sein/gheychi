import { describe, it, expect, vi, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import JalaliDatePicker from '../../app/components/ui/JalaliDatePicker.vue'

// The popover is `position: absolute` with no inset, so it hangs from its trigger's
// inline-start edge and grows toward the inline-END -- which in this RTL app is to the LEFT.
// happy-dom returns an all-zero rect by default, so every test here stubs a real one.
function stubRect(rect: { left: number; right: number }) {
  return vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockReturnValue({ ...rect, width: rect.right - rect.left, height: 300, top: 0, bottom: 300, x: rect.left, y: 0, toJSON: () => ({}) } as DOMRect)
}

async function openPicker() {
  const wrapper = await mountSuspended(JalaliDatePicker, { props: { modelValue: '' } })
  await wrapper.find('button').trigger('click')
  await flushPromises()
  return wrapper
}

describe('JalaliDatePicker', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a Shamsi label, not the raw Gregorian string, for a selected date', async () => {
    const wrapper = await mountSuspended(JalaliDatePicker, { props: { modelValue: '2025-05-05' } })
    expect(wrapper.text()).not.toContain('2025-05-05')
    expect(wrapper.text()).toContain('اردیبهشت')
  })

  it('shows the placeholder when no date is selected', async () => {
    const wrapper = await mountSuspended(JalaliDatePicker, { props: { modelValue: '', placeholder: 'بدون انقضا' } })
    expect(wrapper.text()).toContain('بدون انقضا')
  })

  it('emits the picked day as a Gregorian YYYY-MM-DD string', async () => {
    stubRect({ left: 100, right: 356 })
    const wrapper = await openPicker()
    const dayButtons = wrapper.findAll('[data-testid="date-popover"] button.tnum').filter((b) => b.attributes('disabled') === undefined)
    await dayButtons[0]!.trigger('click')
    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    expect(emitted![0]![0]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('clears the value via the "پاک کردن" action', async () => {
    stubRect({ left: 100, right: 356 })
    const wrapper = await mountSuspended(JalaliDatePicker, { props: { modelValue: '2025-05-05' } })
    await wrapper.find('button').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="date-popover"]').findAll('button').find((b) => b.text() === 'پاک کردن')!.trigger('click')
    expect(wrapper.emitted('update:modelValue')![0]![0]).toBe('')
  })
})
