import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppMultiSelect from './AppMultiSelect.vue'
import AppSelect from './AppSelect.vue'

const options = [
  { value: 'a', label: 'الف' },
  { value: 'b', label: 'ب' },
]

// vue-multiselect builds its listbox id from `id` (no id -> "listbox-null") and only mounts the
// listbox while open, so a closed select must not reference it (axe: aria-valid-attr-value).
describe('AppSelect ARIA ids', () => {
  it('gives every instance a unique id and no dangling listbox reference while closed', () => {
    // Two instances inside ONE app -- useId() is only unique per app.
    const both = mount({
      components: { AppSelect },
      data: () => ({ options }),
      template: '<div><AppSelect :model-value="null" :options="options" /><AppSelect :model-value="null" :options="options" /></div>',
    })
    const [one, two] = both.findAll('input.multiselect__input')

    expect(one!.attributes('id')).toBeTruthy()
    expect(one!.attributes('id')).not.toBe(two!.attributes('id'))
    expect(one!.attributes('aria-controls')).toBeUndefined()
    expect(both.findAll('.multiselect')[0]!.attributes('aria-owns')).toBeUndefined()
  })

  it('points aria-controls at the real, non-null listbox while open and drops it on close', async () => {
    const w = mount(AppSelect, { props: { modelValue: null, options, id: 'city' }, attachTo: document.body })
    const input = w.get('input.multiselect__input')

    await input.trigger('focus')
    await w.vm.$nextTick()
    expect(input.attributes('aria-controls')).toBe('listbox-city')
    expect(document.getElementById('listbox-city')).not.toBeNull()

    await input.trigger('keyup.esc')
    await w.vm.$nextTick()
    expect(input.attributes('aria-controls')).toBeUndefined()
    w.unmount()
  })

  it('AppMultiSelect never references listbox-null', () => {
    const w = mount(AppMultiSelect, { props: { modelValue: [], options } })
    expect(w.get('input.multiselect__input').attributes('id')).toBeTruthy()
    expect(w.html()).not.toContain('listbox-null')
  })
})

describe('AppMultiSelect tags', () => {
  it('renders an accessible, non-positive-tabindex remove control that removes the value', async () => {
    const w = mount(AppMultiSelect, { props: { modelValue: ['a', 'b'], options } })
    const icons = w.findAll('.multiselect__tag-icon')

    expect(icons).toHaveLength(2)
    expect(icons[0]!.attributes('aria-label')).toBe('حذف الف')
    expect(icons[0]!.attributes('role')).toBe('button')
    expect(icons.every((i) => Number(i.attributes('tabindex')) <= 0 || i.attributes('tabindex') === '0')).toBe(true)
    expect(w.findAll('[tabindex]').every((e) => Number(e.attributes('tabindex')) <= 0)).toBe(true)

    await icons[0]!.trigger('mousedown')
    expect(w.emitted('update:modelValue')![0]).toEqual([['b']])
  })
})
