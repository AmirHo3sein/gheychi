import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import JalaliDatePicker from './JalaliDatePicker.vue'

// The popover is `position: absolute` with no inset, so it hangs from its trigger's
// inline-start edge and grows toward the inline-END -- which in this RTL app is to the LEFT.
// Overflow in that direction sits *before* the scroll origin and cannot be scrolled back
// into view, so the component measures the rendered box and translates it inside.
// happy-dom returns an all-zero rect by default, so every test here stubs a real one.
function stubRect(rect: { left: number; right: number }) {
  const spy = vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockReturnValue({ ...rect, width: rect.right - rect.left, height: 300, top: 0, bottom: 300, x: rect.left, y: 0, toJSON: () => ({}) } as DOMRect)
  return spy
}

function popoverOf(wrapper: ReturnType<typeof mount>) {
  return wrapper.get('[data-testid="date-popover"]').element as HTMLElement
}

async function openPicker() {
  const wrapper = mount(JalaliDatePicker, { props: { modelValue: '' } })
  await wrapper.find('button').trigger('click')
  await flushPromises()
  return wrapper
}

describe('JalaliDatePicker', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('leaves the popover untranslated when it already fits on screen', async () => {
    stubRect({ left: 400, right: 656 })
    const wrapper = await openPicker()
    expect(popoverOf(wrapper).style.transform).toBe('')
  })

  it('pulls the popover back in when it would escape the inline-end (left) edge', async () => {
    // 24px past the left edge of the viewport, where nothing could scroll it back.
    stubRect({ left: -24, right: 232 })
    const wrapper = await openPicker()
    // Shifted right by the overshoot plus the 8px viewport margin.
    expect(popoverOf(wrapper).style.transform).toBe('translateX(32px)')
  })

  it('pulls the popover back in when it would escape the inline-start (right) edge', async () => {
    window.innerWidth = 1024
    stubRect({ left: 800, right: 1056 })
    const wrapper = await openPicker()
    expect(popoverOf(wrapper).style.transform).toBe('translateX(-40px)')
  })

  it('keeps the selected date reachable as a title when the trigger truncates it', async () => {
    const wrapper = mount(JalaliDatePicker, { props: { modelValue: '2025-05-05' } })
    const trigger = wrapper.find('button')
    // The visible label is ellipsised inside the narrow triggers this is used with, so the
    // full Shamsi date has to stay recoverable.
    expect(trigger.attributes('title')).toBe(trigger.text())
    expect(wrapper.find('button span').classes()).toContain('truncate')
  })

  describe('dialog behaviour', () => {
    it('is a labelled dialog and moves focus to a day when opened', async () => {
      const wrapper = mount(JalaliDatePicker, { props: { modelValue: '' }, attachTo: document.body })
      await wrapper.find('button').trigger('click')
      await flushPromises()
      const dialog = wrapper.get('[data-testid="date-popover"]')
      expect(dialog.attributes('role')).toBe('dialog')
      expect(dialog.attributes('aria-label')).toBe('انتخاب تاریخ')
      expect(dialog.element.contains(document.activeElement)).toBe(true)
      wrapper.unmount()
    })

    it('focuses the selected day when there is one', async () => {
      const wrapper = mount(JalaliDatePicker, { props: { modelValue: '2025-05-05' }, attachTo: document.body })
      await wrapper.find('button').trigger('click')
      await flushPromises()
      expect(document.activeElement?.getAttribute('aria-pressed')).toBe('true')
      wrapper.unmount()
    })

    it('closes on Escape and returns focus to the trigger', async () => {
      const wrapper = mount(JalaliDatePicker, { props: { modelValue: '' }, attachTo: document.body })
      const trigger = wrapper.find('button')
      await trigger.trigger('click')
      await flushPromises()
      await wrapper.get('[data-testid="date-popover"]').trigger('keydown', { key: 'Escape' })
      await flushPromises()
      expect(wrapper.find('[data-testid="date-popover"]').exists()).toBe(false)
      expect(document.activeElement).toBe(trigger.element)
      wrapper.unmount()
    })

    it('returns focus to the trigger after picking a day', async () => {
      const wrapper = mount(JalaliDatePicker, { props: { modelValue: '' }, attachTo: document.body })
      const trigger = wrapper.find('button')
      await trigger.trigger('click')
      await flushPromises()
      await wrapper.get('[data-day]:not(:disabled)').trigger('click')
      await flushPromises()
      expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
      expect(document.activeElement).toBe(trigger.element)
      wrapper.unmount()
    })
  })

  describe('layout', () => {
    it('puts "previous" on the right with a right-pointing chevron, matching Pagination', async () => {
      const wrapper = await openPicker()
      const [first, last] = wrapper.get('[data-testid="date-popover"]').findAll('button').slice(0, 2)
      expect(first!.attributes('aria-label')).toBe('ماه قبل')
      expect(first!.findComponent({ name: 'AppIcon' }).props('name')).toBe('chevron-right')
      expect(last!.attributes('aria-label')).toBe('ماه بعد')
      expect(last!.findComponent({ name: 'AppIcon' }).props('name')).toBe('chevron-left')
    })

    it('keeps month buttons at 44px and day cells at 40px', async () => {
      const wrapper = await openPicker()
      const popover = wrapper.get('[data-testid="date-popover"]')
      for (const nav of popover.findAll('button').slice(0, 2)) expect(nav.classes()).toEqual(expect.arrayContaining(['h-11', 'w-11']))
      expect(popover.get('[data-day]:not(:disabled)').classes()).toContain('h-10')
    })

    it('steps the month in the direction its label says', async () => {
      const wrapper = mount(JalaliDatePicker, { props: { modelValue: '2025-05-05' } })
      await wrapper.find('button').trigger('click')
      const title = () => wrapper.get('[data-testid="date-popover"] p').text()
      const before = title()
      await wrapper.get('[aria-label="ماه بعد"]').trigger('click')
      expect(title()).not.toBe(before)
      await wrapper.get('[aria-label="ماه قبل"]').trigger('click')
      expect(title()).toBe(before)
    })
  })
})
