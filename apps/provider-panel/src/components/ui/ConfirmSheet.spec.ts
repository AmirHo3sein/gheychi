import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { resetConfirm, useConfirm } from '@/composables/useConfirm'
import ConfirmSheet from './ConfirmSheet.vue'

describe('ConfirmSheet', () => {
  let trigger: HTMLButtonElement
  // Every mounted host shares the one useConfirm() singleton, so a leftover host from an
  // earlier test would also react (and fight over body scroll) -- always unmount.
  const mounted: VueWrapper[] = []

  beforeEach(() => {
    resetConfirm()
    document.body.innerHTML = ''
    trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
  })
  afterEach(() => {
    mounted.splice(0).forEach((w) => w.unmount())
    document.body.style.overflow = ''
  })

  function mountSheet() {
    const wrapper = mount(ConfirmSheet, { attachTo: document.body })
    mounted.push(wrapper)
    return wrapper
  }

  it('renders nothing until a confirmation is requested', () => {
    const wrapper = mountSheet()
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false)
  })

  it('exposes an accessible alertdialog labelled by its title and described by its message', async () => {
    const wrapper = mountSheet()
    void useConfirm().confirm({ title: 'حذف خدمت؟', message: 'این کار قابل بازگشت نیست.' })
    await nextTick()

    const dialog = wrapper.get('[role="alertdialog"]')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(wrapper.get(`#${dialog.attributes('aria-labelledby')}`).text()).toBe('حذف خدمت؟')
    expect(wrapper.get(`#${dialog.attributes('aria-describedby')}`).text()).toContain('قابل بازگشت نیست')
  })

  it('resolves true on confirm, false on cancel', async () => {
    const wrapper = mountSheet()
    const a = useConfirm().confirm({ title: 'a' })
    await nextTick()
    await wrapper.get('[data-testid="confirm-accept"]').trigger('click')
    await expect(a).resolves.toBe(true)

    const b = useConfirm().confirm({ title: 'b' })
    await nextTick()
    await wrapper.get('[data-testid="confirm-cancel"]').trigger('click')
    await expect(b).resolves.toBe(false)
  })

  it('cancels on Escape and on a backdrop click', async () => {
    const wrapper = mountSheet()
    const a = useConfirm().confirm({ title: 'a' })
    await nextTick()
    await wrapper.get('[data-testid="confirm-root"]').trigger('keydown', { key: 'Escape' })
    await expect(a).resolves.toBe(false)

    const b = useConfirm().confirm({ title: 'b' })
    await nextTick()
    await wrapper.get('[data-testid="confirm-backdrop"]').trigger('click')
    await expect(b).resolves.toBe(false)
  })

  it('uses danger styling only for tone=danger, with touch-sized buttons', async () => {
    const wrapper = mountSheet()
    void useConfirm().confirm({ title: 'a', tone: 'danger', confirmLabel: 'حذف' })
    await nextTick()
    const accept = wrapper.get('[data-testid="confirm-accept"]')
    expect(accept.classes().join(' ')).toContain('--color-danger-strong')
    expect(accept.text()).toBe('حذف')
    expect(accept.classes()).toContain('min-h-11')
    expect(wrapper.get('[data-testid="confirm-cancel"]').classes()).toContain('min-h-11')

    resetConfirm()
    await nextTick()
    void useConfirm().confirm({ title: 'b' })
    await nextTick()
    expect(wrapper.get('[data-testid="confirm-accept"]').classes().join(' ')).not.toContain('--color-danger-strong')
  })

  it('locks body scroll while open and restores it, and returns focus to the trigger', async () => {
    const wrapper = mountSheet()
    const p = useConfirm().confirm({ title: 'a', tone: 'danger' })
    await nextTick()
    await nextTick()
    expect(document.body.style.overflow).toBe('hidden')
    // destructive prompts start on cancel
    expect(document.activeElement).toBe(wrapper.get('[data-testid="confirm-cancel"]').element)

    useConfirm().settle(false)
    await p
    await nextTick()
    expect(document.body.style.overflow).toBe('')
    expect(document.activeElement).toBe(trigger)
  })

  it('traps Tab between the two buttons', async () => {
    const wrapper = mountSheet()
    void useConfirm().confirm({ title: 'a' })
    await nextTick()
    await nextTick()
    const accept = wrapper.get('[data-testid="confirm-accept"]').element as HTMLElement
    const cancel = wrapper.get('[data-testid="confirm-cancel"]').element as HTMLElement
    expect(document.activeElement).toBe(accept)

    cancel.focus()
    await wrapper.get('[data-testid="confirm-root"]').trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(accept)

    await wrapper.get('[data-testid="confirm-root"]').trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(cancel)
  })
})
