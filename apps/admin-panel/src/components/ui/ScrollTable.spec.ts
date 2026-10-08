import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ScrollTable from './ScrollTable.vue'

function mountTable() {
  return mount(ScrollTable, {
    props: { label: 'فهرست آزمایشی' },
    slots: { default: '<table><thead><tr><th scope="col">الف</th></tr></thead></table>' },
    attachTo: document.body,
  })
}

// jsdom has no layout, so the geometry the component reads is defined by hand. RTL scrollLeft
// is 0 at the inline-start (right) edge and negative as you scroll toward the end (left).
function setGeometry(el: HTMLElement, { scrollWidth, clientWidth, scrollLeft }: Record<string, number>) {
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true })
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true })
  el.scrollLeft = scrollLeft
}

describe('ScrollTable', () => {
  it('is a focusable, named region so a keyboard can scroll it', () => {
    const wrapper = mountTable()
    const region = wrapper.get('[role="region"]')
    expect(region.attributes('tabindex')).toBe('0')
    expect(region.attributes('aria-label')).toBe('فهرست آزمایشی')
    expect(region.find('table').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows no edge shadow when everything fits', async () => {
    const wrapper = mountTable()
    const region = wrapper.get('[role="region"]').element as HTMLElement
    setGeometry(region, { scrollWidth: 300, clientWidth: 300, scrollLeft: 0 })
    await wrapper.get('[role="region"]').trigger('scroll')
    expect(wrapper.get('[data-testid="scroll-fade-start"]').isVisible()).toBe(false)
    expect(wrapper.get('[data-testid="scroll-fade-end"]').isVisible()).toBe(false)
    wrapper.unmount()
  })

  it('shows only the end shadow at the start of an overflowing table', async () => {
    const wrapper = mountTable()
    const region = wrapper.get('[role="region"]').element as HTMLElement
    setGeometry(region, { scrollWidth: 800, clientWidth: 300, scrollLeft: 0 })
    await wrapper.get('[role="region"]').trigger('scroll')
    expect(wrapper.get('[data-testid="scroll-fade-start"]').isVisible()).toBe(false)
    expect(wrapper.get('[data-testid="scroll-fade-end"]').isVisible()).toBe(true)
    wrapper.unmount()
  })

  it('shows both shadows mid-scroll and only the start shadow at the far end (RTL negative scrollLeft)', async () => {
    const wrapper = mountTable()
    const region = wrapper.get('[role="region"]').element as HTMLElement
    setGeometry(region, { scrollWidth: 800, clientWidth: 300, scrollLeft: -200 })
    await wrapper.get('[role="region"]').trigger('scroll')
    expect(wrapper.get('[data-testid="scroll-fade-start"]').isVisible()).toBe(true)
    expect(wrapper.get('[data-testid="scroll-fade-end"]').isVisible()).toBe(true)

    setGeometry(region, { scrollWidth: 800, clientWidth: 300, scrollLeft: -500 })
    await wrapper.get('[role="region"]').trigger('scroll')
    expect(wrapper.get('[data-testid="scroll-fade-start"]').isVisible()).toBe(true)
    expect(wrapper.get('[data-testid="scroll-fade-end"]').isVisible()).toBe(false)
    wrapper.unmount()
  })

  it('keeps the shadows decorative', () => {
    const wrapper = mountTable()
    expect(wrapper.get('[data-testid="scroll-fade-start"]').attributes('aria-hidden')).toBe('true')
    expect(wrapper.get('[data-testid="scroll-fade-end"]').attributes('aria-hidden')).toBe('true')
    wrapper.unmount()
  })
})
