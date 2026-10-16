import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppSwitch from './AppSwitch.vue'

describe('AppSwitch', () => {
  it('is a labelled switch that emits the flipped value and passes attributes through', async () => {
    const wrapper = mount(AppSwitch, { props: { modelValue: false }, attrs: { 'aria-label': 'فعال‌سازی', 'data-testid': 'sw' } })
    const button = wrapper.get('[data-testid="sw"]')
    expect(button.attributes('role')).toBe('switch')
    expect(button.attributes('aria-checked')).toBe('false')
    expect(button.attributes('aria-label')).toBe('فعال‌سازی')
    await button.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
  })

  // Brand peach track with a charcoal knob when on -- not the old dark-rust filled track.
  it('uses the peach fill and charcoal knob when on, and a bordered blush track when off', async () => {
    const wrapper = mount(AppSwitch, { props: { modelValue: true } })
    const track = wrapper.get('button > span')
    expect(track.classes()).toContain('bg-(--color-accent)')
    expect(track.get('span').classes()).toContain('bg-(--color-fill-text)')
    await wrapper.setProps({ modelValue: false })
    expect(track.classes()).toContain('bg-(--color-surface-subtle)')
    expect(track.classes()).toContain('border-(--color-border-control)')
  })
})
