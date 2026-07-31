import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppInput from './AppInput.vue'

describe('AppInput', () => {
  // LoginView focuses the OTP field via `codeInputRef.value?.$el?.querySelector('input')`.
  // That only works while this component has exactly ONE root node: add a sibling at the
  // template root -- even a plain HTML comment -- and Vue renders it as a fragment, `$el`
  // becomes the fragment's anchor node, and the focus call silently throws instead.
  it('exposes a single root element, so $el can be queried for the inner input', () => {
    const wrapper = mount(AppInput, { props: { modelValue: '' } })
    const el = wrapper.vm.$el as HTMLElement
    expect(el.nodeType).toBe(Node.ELEMENT_NODE)
    expect(el.querySelector('input')).not.toBeNull()
  })

  // A flex/grid item's automatic minimum size is its content, and an <input>'s content-based
  // width comes from its `size` attribute (~11rem) -- without this the field cannot shrink
  // and overflows narrow rows instead (ReferralSettingsView's paired value/cap fields, the
  // blog editor's two-column meta grid).
  it('lets its root shrink below the input\'s intrinsic width', () => {
    const wrapper = mount(AppInput, { props: { modelValue: '' } })
    expect(wrapper.classes()).toContain('min-w-0')
  })

  it('renders the error message with a non-collapsing icon', () => {
    const wrapper = mount(AppInput, { props: { modelValue: '', error: 'مقدار نامعتبر است' } })
    expect(wrapper.text()).toContain('مقدار نامعتبر است')
    // The warning glyph must never be squeezed away when a long error wraps to two lines.
    expect(wrapper.find('p svg').classes()).toContain('shrink-0')
  })
})
