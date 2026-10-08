import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppSelect from './AppSelect.vue'

const options = [
  { value: 'a', label: 'الف' },
  { value: 'b', label: 'ب' },
]

function mountSelect(props: Record<string, unknown> = {}) {
  return mount(AppSelect, { props: { modelValue: 'a', options, ...props }, attachTo: document.body })
}

describe('AppSelect accessibility', () => {
  it('never renders a literal "null" id into aria-controls', () => {
    const wrapper = mountSelect({ searchable: true, label: 'شهر' })
    const input = wrapper.get('input')
    expect(input.attributes('id')).toBeTruthy()
    expect(input.attributes('aria-controls')).toBe(`listbox-${input.attributes('id')}`)
    expect(input.attributes('aria-controls')).not.toContain('null')
  })

  it('keeps aria-controls resolvable while the dropdown is closed', () => {
    const wrapper = mountSelect({ searchable: true, label: 'شهر' })
    const controls = wrapper.get('input').attributes('aria-controls')!
    expect(document.getElementById(controls)).not.toBeNull()
    wrapper.unmount()
  })

  it('gives every instance within an app its own id', () => {
    const wrapper = mount(
      {
        components: { AppSelect },
        props: ['options'],
        template: '<div><AppSelect :model-value="\'a\'" :options="options" searchable label="الف" /><AppSelect :model-value="\'a\'" :options="options" searchable label="ب" /></div>',
      },
      { props: { options } },
    )
    const [a, b] = wrapper.findAll('input').map((i) => i.attributes('id'))
    expect(a).toBeTruthy()
    expect(a).not.toBe(b)
  })

  it('names the combobox from its visible label', () => {
    const wrapper = mountSelect({ label: 'وضعیت' })
    const label = wrapper.get('label')
    expect(wrapper.get('[role="combobox"]').attributes('aria-labelledby')).toBe(label.attributes('id'))
    expect(wrapper.get('[role="combobox"]').attributes('aria-label')).toBeUndefined()
  })

  it('falls back to ariaLabel when there is no visible label', () => {
    const wrapper = mountSelect({ ariaLabel: 'دسته‌بندی' })
    expect(wrapper.find('label').exists()).toBe(false)
    expect(wrapper.get('[role="combobox"]').attributes('aria-label')).toBe('دسته‌بندی')
  })
})
