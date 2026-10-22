import { afterEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { h } from 'vue'
import BottomSheet from '../../app/components/ui/BottomSheet.vue'

enableAutoUnmount(afterEach)

const q = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const sheet = () => document.body.querySelector<HTMLElement>('[role="dialog"]')

async function mountSheet(open = true) {
  return mountSuspended(BottomSheet, {
    props: { open, title: 'فیلترها' },
    slots: { default: () => h('button', { 'data-testid': 'inside' }, 'داخل') },
  })
}

function pointer(el: HTMLElement, type: string, clientY: number, timeStamp?: number) {
  const e = new PointerEvent(type, { clientY, bubbles: true, pointerId: 1, pointerType: 'touch' })
  if (timeStamp !== undefined) Object.defineProperty(e, 'timeStamp', { value: timeStamp })
  el.dispatchEvent(e)
}

describe('BottomSheet', () => {
  it('renders a labelled modal dialog with its content and locks page scroll while open', async () => {
    const wrapper = await mountSheet()
    await flushPromises()
    const dialog = sheet()!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('فیلترها')
    expect(q('inside')).not.toBeNull()
    expect(document.body.style.overflow).toBe('hidden')

    await wrapper.setProps({ open: false })
    await flushPromises()
    expect(document.body.style.overflow).toBe('')
  })

  it('asks to close from the ✕ button, the backdrop and Escape', async () => {
    const wrapper = await mountSheet()
    await flushPromises()
    q('bottom-sheet-close')!.click()
    q('bottom-sheet-backdrop')!.click()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(3)
  })

  it('closes when dragged down far enough, and springs back from a short slow drag', async () => {
    const wrapper = await mountSheet()
    await flushPromises()
    const handle = q('bottom-sheet-handle')!

    pointer(handle, 'pointerdown', 100, 0)
    pointer(handle, 'pointermove', 140)
    await flushPromises()
    expect(sheet()!.style.transform).toBe('translateY(40px)')
    pointer(handle, 'pointerup', 140, 1000) // 40px over a full second: not a flick
    await flushPromises()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(sheet()!.style.transform).toBe('')

    // Dragging upward never lifts the sheet past its resting place.
    pointer(handle, 'pointerdown', 100, 0)
    pointer(handle, 'pointermove', 40)
    await flushPromises()
    expect(sheet()!.style.transform).toBe('')
    pointer(handle, 'pointerup', 40, 100)

    pointer(handle, 'pointerdown', 100, 0)
    pointer(handle, 'pointermove', 300)
    pointer(handle, 'pointerup', 300, 1000)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('renders nothing while closed', async () => {
    await mountSheet(false)
    await flushPromises()
    expect(sheet()).toBeNull()
    expect(q('bottom-sheet-backdrop')).toBeNull()
  })
})
