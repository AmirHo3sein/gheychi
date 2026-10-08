import { describe, it, expect, afterEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import ConfirmDialog from '../../app/components/ui/ConfirmDialog.vue'

let wrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined

async function mountDialog(props: Record<string, unknown> = {}, slots?: Record<string, string>) {
  wrapper = await mountSuspended(ConfirmDialog, {
    props: { title: 'حذف نظر', message: 'این کار قابل بازگشت نیست.', ...props },
    slots,
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.documentElement.style.overflow = ''
  document.body.style.overflow = ''
})

describe('ConfirmDialog', () => {
  it('is an alertdialog labelled by its title and described by its body', async () => {
    const w = await mountDialog()
    const dialog = w.get('[role="alertdialog"]')
    expect(dialog.attributes('aria-modal')).toBe('true')
    const title = document.getElementById(dialog.attributes('aria-labelledby')!)
    expect(title?.textContent).toBe('حذف نظر')
    const body = document.getElementById(dialog.attributes('aria-describedby')!)
    expect(body?.textContent).toContain('این کار قابل بازگشت نیست.')
  })

  it('renders the default slot in place of `message`', async () => {
    const w = await mountDialog({ message: undefined }, { default: '<p data-testid="custom">توضیح سفارشی</p>' })
    expect(w.get('[data-testid="custom"]').text()).toBe('توضیح سفارشی')
  })

  it('has a bottom-sheet layout below sm and centred from sm up', async () => {
    const w = await mountDialog()
    const overlay = w.get('.fixed').classes()
    expect(overlay).toContain('items-end')
    expect(overlay).toContain('sm:items-center')
    expect(w.get('[role="alertdialog"]').classes()).toContain('rounded-t-2xl')
  })

  it('has >=44px buttons, with the danger tone on the confirm action', async () => {
    const w = await mountDialog({ tone: 'danger' })
    const buttons = w.findAll('button')
    expect(buttons).toHaveLength(2)
    for (const b of buttons) expect(b.classes()).toContain('min-h-11')
    expect(buttons[1]!.classes().join(' ')).toContain('bg-(--color-danger-strong)')
  })

  it('emits confirm / cancel from the two buttons, with caller-supplied labels', async () => {
    const w = await mountDialog({ confirmLabel: 'حذف نظر', cancelLabel: 'نگه دار', confirmTestId: 'ok', cancelTestId: 'no' })
    expect(w.get('[data-testid="ok"]').text()).toBe('حذف نظر')
    expect(w.get('[data-testid="no"]').text()).toBe('نگه دار')
    await w.get('[data-testid="ok"]').trigger('click')
    await w.get('[data-testid="no"]').trigger('click')
    expect(w.emitted('confirm')).toHaveLength(1)
    expect(w.emitted('cancel')).toHaveLength(1)
  })

  it('focuses the dismiss button first (safe default) and cancels on Escape', async () => {
    const w = await mountDialog({ cancelTestId: 'no' })
    expect(document.activeElement).toBe(w.get('[data-testid="no"]').element)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('cancel')).toHaveLength(1)
  })

  it('blocks Escape and dismissal while the confirm is in flight', async () => {
    const w = await mountDialog({ loading: true, cancelTestId: 'no' })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('cancel')).toBeUndefined()
    expect(w.get('[data-testid="no"]').attributes('disabled')).toBeDefined()
  })

  it('locks body scroll while open and releases it on unmount', async () => {
    const w = await mountDialog()
    expect(document.body.style.overflow).toBe('hidden')
    w.unmount()
    wrapper = undefined
    expect(document.body.style.overflow).toBe('')
  })

  it('puts extra attributes (data-testid) on the dialog panel, not the overlay', async () => {
    const w = await mountDialog({ 'data-testid': 'my-dialog' })
    expect(w.get('[data-testid="my-dialog"]').attributes('role')).toBe('alertdialog')
  })
})
