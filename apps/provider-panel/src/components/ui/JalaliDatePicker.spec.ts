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
    // The visible label is ellipsised inside narrow triggers, so the full Shamsi date has to
    // stay recoverable.
    expect(trigger.attributes('title')).toBe(trigger.text())
    expect(wrapper.find('button span').classes()).toContain('truncate')
  })

  it('emits the picked day as a Gregorian YYYY-MM-DD string', async () => {
    const wrapper = await openPicker()
    // Day cells are the only buttons carrying `.tnum` (the numeral-alignment utility) --
    // distinguishes them from the month-nav chevrons and the today/clear footer buttons.
    // attributes('disabled') is '' (falsy but present) on a disabled button, not undefined --
    // `!x` would wrongly keep those, so check for the key's absence explicitly.
    const dayButtons = wrapper.findAll('[data-testid="date-popover"] button.tnum').filter((b) => b.attributes('disabled') === undefined)
    await dayButtons[0]!.trigger('click')
    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    expect(emitted![0]![0]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('puts "previous month" on the right (first child, chevron pointing right) and "next" on the left, as 44px targets', async () => {
    const wrapper = await openPicker()
    const [first, , second] = wrapper.get('[data-testid="date-popover"] > div').element.children as unknown as HTMLElement[]

    expect(first.getAttribute('aria-label')).toBe('ماه قبل')
    expect(first.querySelector('svg')?.getAttribute('class')).toContain('rotate-180')
    expect(second.getAttribute('aria-label')).toBe('ماه بعد')
    expect(second.querySelector('svg')?.getAttribute('class') ?? '').not.toContain('rotate-180')
    for (const nav of [first, second]) {
      expect(nav.className).toContain('h-11')
      expect(nav.className).toContain('w-11')
    }
  })

  it('steps to the previous month from the right-hand button', async () => {
    const wrapper = mount(JalaliDatePicker, { props: { modelValue: '2025-05-05' } }) // 15 Ordibehesht 1404
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="date-popover"]').text()).toContain('اردیبهشت')

    await wrapper.get('button[aria-label="ماه قبل"]').trigger('click')
    expect(wrapper.get('[data-testid="date-popover"]').text()).toContain('فروردین')
    await wrapper.get('button[aria-label="ماه بعد"]').trigger('click')
    expect(wrapper.get('[data-testid="date-popover"]').text()).toContain('اردیبهشت')
  })

  it('renders day cells at least 40px tall', async () => {
    const wrapper = await openPicker()
    expect(wrapper.get('[data-testid="date-popover"] button.tnum').classes()).toContain('h-10')
  })

  it('is a labelled dialog, focuses a day on open, closes on Escape and returns focus to the trigger', async () => {
    const wrapper = mount(JalaliDatePicker, { props: { modelValue: '2025-05-05' }, attachTo: document.body })
    const trigger = wrapper.get('button').element as HTMLButtonElement
    trigger.focus()
    await wrapper.get('button').trigger('click')
    await flushPromises()

    const popover = wrapper.get('[data-testid="date-popover"]')
    expect(popover.attributes('role')).toBe('dialog')
    expect(popover.attributes('aria-label')).toBeTruthy()
    // The selected day gets focus.
    expect(document.activeElement?.getAttribute('data-selected')).toBe('true')

    await popover.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[data-testid="date-popover"]').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger)
    wrapper.unmount()
  })
})
