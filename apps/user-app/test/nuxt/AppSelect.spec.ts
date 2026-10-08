import { defineComponent } from 'vue'
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import Multiselect from 'vue-multiselect'
import AppSelect from '../../app/components/ui/AppSelect.client.vue'

const OPTIONS = [
  { value: 'تهران', label: 'تهران' },
  { value: 'شیراز', label: 'شیراز' },
]

describe('AppSelect', () => {
  it('shows the placeholder when nothing is selected', async () => {
    const wrapper = await mountSuspended(AppSelect, { props: { modelValue: '', options: OPTIONS, placeholder: 'شهر را انتخاب کنید' } })
    expect(wrapper.text()).toContain('شهر را انتخاب کنید')
  })

  it('resolves the selected value to its option and shows the label', async () => {
    const wrapper = await mountSuspended(AppSelect, { props: { modelValue: 'شیراز', options: OPTIONS } })
    expect(wrapper.text()).toContain('شیراز')
  })

  it('emits the picked option\'s value string, not the whole option object', async () => {
    const wrapper = await mountSuspended(AppSelect, { props: { modelValue: '', options: OPTIONS } })
    await wrapper.findComponent(Multiselect).vm.$emit('update:modelValue', OPTIONS[1])
    expect(wrapper.emitted('update:modelValue')).toEqual([['شیراز']])
  })

  it('emits an empty string when cleared', async () => {
    const wrapper = await mountSuspended(AppSelect, { props: { modelValue: 'تهران', options: OPTIONS } })
    await wrapper.findComponent(Multiselect).vm.$emit('update:modelValue', null)
    expect(wrapper.emitted('update:modelValue')).toEqual([['']])
  })

  // The label can't be attached with <label for> -- vue-multiselect's root is a combobox
  // div, not a labelable control -- so aria-labelledby is what makes the field named at all.
  it('names the combobox with aria-labelledby pointing at its own label', async () => {
    const wrapper = await mountSuspended(AppSelect, { props: { modelValue: '', options: OPTIONS, label: 'شهر', required: true } })
    const label = wrapper.get('label')
    expect(label.text()).toBe('شهر')
    expect(wrapper.get('[role="combobox"]').attributes('aria-labelledby')).toBe(label.attributes('id'))
    expect(wrapper.get('[role="combobox"]').attributes('aria-required')).toBe('true')
  })

  it('leaves aria-labelledby off entirely when there is no label to point at', async () => {
    const wrapper = await mountSuspended(AppSelect, { props: { modelValue: '', options: OPTIONS } })
    expect(wrapper.find('label').exists()).toBe(false)
    expect(wrapper.get('[role="combobox"]').attributes('aria-labelledby')).toBeUndefined()
  })

  // An unset id made vue-multiselect emit aria-controls="listbox-null" (invalid ARIA reference).
  it('always keeps the aria-controls target in the DOM, under a real (never null) id', async () => {
    const wrapper = await mountSuspended(AppSelect, { props: { modelValue: '', options: OPTIONS, label: 'شهر' } })
    const controls = wrapper.get('input').attributes('aria-controls')!
    expect(controls).not.toMatch(/null|undefined/)
    // Closed: vue-multiselect has no listbox, so the wrapper's hidden stand-in must resolve it.
    expect(wrapper.element.querySelectorAll(`#${controls}`)).toHaveLength(1)
    await wrapper.findComponent(Multiselect).vm.$emit('open')
    // Open: the stand-in steps aside (the real listbox takes the id), never duplicating it.
    expect(wrapper.element.querySelector('ul[hidden]')).toBeNull()
    await wrapper.findComponent(Multiselect).vm.$emit('close')
    expect(wrapper.element.querySelectorAll(`#${controls}`)).toHaveLength(1)
  })

  it('gives two instances in one app distinct listbox ids', async () => {
    const Pair = defineComponent({
      components: { AppSelect },
      setup: () => ({ OPTIONS }),
      template: '<div><AppSelect model-value="" :options="OPTIONS" /><AppSelect model-value="" :options="OPTIONS" /></div>',
    })
    const wrapper = await mountSuspended(Pair)
    const owns = wrapper.findAll('[role="combobox"]').map((c) => c.attributes('aria-owns'))
    expect(owns).toHaveLength(2)
    expect(owns[0]).not.toBe(owns[1])
  })

  it('renders the error message and marks the field invalid', async () => {
    const wrapper = await mountSuspended(AppSelect, { props: { modelValue: '', options: OPTIONS, error: 'جنسیت را انتخاب کنید' } })
    expect(wrapper.text()).toContain('جنسیت را انتخاب کنید')
    expect(wrapper.get('[role="combobox"]').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('[role="combobox"]').classes()).toContain('app-select--error')
  })
})
