import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppMoneyInput from './AppMoneyInput.vue'

function input(wrapper: ReturnType<typeof mount>) {
  return wrapper.get('input')
}

// Vue Test Utils' setValue() doesn't give control over caret position (it just sets .value and
// dispatches 'input'), but that's exactly what this component's caret math needs to be tested
// against -- so these drive the DOM directly, matching what a real browser hands the native
// 'input' listener: .value already holds the post-keystroke string, .selectionStart already
// holds the post-keystroke caret.
async function typeRaw(wrapper: ReturnType<typeof mount>, raw: string, caret: number) {
  const el = input(wrapper).element as HTMLInputElement
  el.value = raw
  el.selectionStart = caret
  el.selectionEnd = caret
  await input(wrapper).trigger('input')
  await wrapper.vm.$nextTick()
}

describe('AppMoneyInput', () => {
  it('shows the value comma-grouped in Farsi digits', () => {
    const wrapper = mount(AppMoneyInput, { props: { modelValue: '3000000' } })
    expect(input(wrapper).element.value).toBe('۳٬۰۰۰٬۰۰۰')
  })

  // The whole point of this component: comma grouping appears LIVE, while typing -- not only
  // once the field blurs (a real defect reported against an earlier version of this component,
  // which only reformatted on blur).
  it('reformats live as the user types, with no blur required', async () => {
    const wrapper = mount(AppMoneyInput, { props: { modelValue: '' } })

    await typeRaw(wrapper, '3', 1)
    expect(input(wrapper).element.value).toBe('۳')

    await typeRaw(wrapper, '30', 2)
    expect(input(wrapper).element.value).toBe('۳۰')

    await typeRaw(wrapper, '3000', 4)
    expect(input(wrapper).element.value).toBe('۳٬۰۰۰')

    await typeRaw(wrapper, '3000000', 7)
    expect(input(wrapper).element.value).toBe('۳٬۰۰۰٬۰۰۰')
  })

  // Caret placement is the actual hard part of "format as you type": inserting a digit that
  // pushes the string across a new thousands-comma must not shove the caret away from where
  // the user just typed. Here a "5" is inserted right before the final "0" of 3,000,000 (i.e.
  // at the position that reads "3,000,00|0"), producing 3,000,0050 raw -> 30,000,050 grouped
  // -- one extra comma appears, entirely to the RIGHT of where the user typed, so the caret
  // must land immediately after that "5", not at the string's end.
  it('keeps the caret immediately after the digit just typed when a new comma appears to its right', async () => {
    const wrapper = mount(AppMoneyInput, { props: { modelValue: '3000000' } })

    await typeRaw(wrapper, '3,000,0050', 9)

    const el = input(wrapper).element as HTMLInputElement
    expect(el.value).toBe('۳۰٬۰۰۰٬۰۵۰')
    expect(el.selectionStart).toBe(9)
  })

  it('emits a clean digit-only string, even when the display shows commas', async () => {
    const wrapper = mount(AppMoneyInput, { props: { modelValue: '' } })

    await typeRaw(wrapper, '200000', 6)
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual(['200000'])
  })

  // A pasted, already-formatted price (or a stray non-digit keystroke) must collapse to the
  // clean digit string this component's v-model promises callers -- they parse it with
  // Number(...) directly (this app's existing price-field validation), unchanged by this
  // component's own comma-grouped display.
  it('strips non-digit characters from pasted or typed input', async () => {
    const wrapper = mount(AppMoneyInput, { props: { modelValue: '' } })

    await typeRaw(wrapper, '3,000,000', 9)
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual(['3000000'])
  })

  // Iranian keyboards/IMEs commonly default to Persian numerals -- this field replaces a
  // native type="number" input specifically because that silently discards them, leaving the
  // field empty on blur. A bare non-digit strip would repeat that same bug for a different
  // reason (Persian ۰-۹ isn't matched by \d), so normalization has to run first.
  it('normalizes Persian digits instead of discarding them', async () => {
    const wrapper = mount(AppMoneyInput, { props: { modelValue: '' } })

    await typeRaw(wrapper, '۱۸۰۰۰۰', 6)
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual(['180000'])
  })

  // This field doesn't decide whether a negative amount is valid -- the caller's own
  // Number(...) validation does. Dropping the sign would silently turn an obviously-invalid
  // "-5" into an accepted "5" instead of letting that check reject it.
  it('keeps a leading minus sign instead of silently dropping it', async () => {
    const wrapper = mount(AppMoneyInput, { props: { modelValue: '' } })

    await typeRaw(wrapper, '-5', 2)
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual(['-5'])
  })

  it('leaves an empty field empty', () => {
    const wrapper = mount(AppMoneyInput, { props: { modelValue: '' } })
    expect(input(wrapper).element.value).toBe('')
  })

  // Regression guard: without a real (even no-op) @update:model-value listener on the inner
  // AppInput, Vue's defineModel falls back to local-only mode after the first keystroke and
  // silently stops reflecting external resets pushed down through :model-value -- e.g.
  // ServicesView.vue restoring the previous price after an invalid edit is rejected. A real
  // v-model consumer (a genuine 'onUpdate:modelValue' listener that writes the prop back, same
  // shape as every actual call site in this codebase) is required to exercise this -- a bare
  // modelValue prop with no listener at all would trip the very same local-fallback mode this
  // test exists to catch, one level up, and pass for the wrong reason.
  it('reflects an external reset of the model value after the user has already typed', async () => {
    let current = '100000'
    const wrapper = mount(AppMoneyInput, {
      props: {
        modelValue: current,
        'onUpdate:modelValue': (v: string) => {
          current = v
          wrapper.setProps({ modelValue: current })
        },
      },
    })

    await typeRaw(wrapper, '', 0)
    expect(current).toBe('')

    // Simulates the caller rejecting the edit and restoring the previous value.
    current = '100000'
    await wrapper.setProps({ modelValue: current })
    expect(input(wrapper).element.value).toBe('۱۰۰٬۰۰۰')
  })

  it('passes through label, error, and disabled to the underlying field', () => {
    const wrapper = mount(AppMoneyInput, {
      props: { modelValue: '1000', label: 'قیمت (تومان)', error: 'قیمت نامعتبر است', disabled: true },
    })
    expect(wrapper.text()).toContain('قیمت (تومان)')
    expect(wrapper.text()).toContain('قیمت نامعتبر است')
    expect(input(wrapper).attributes('disabled')).toBeDefined()
  })
})
