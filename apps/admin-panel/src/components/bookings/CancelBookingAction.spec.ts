import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CancelBookingAction from './CancelBookingAction.vue'

const fetchMock = vi.fn()
const pushToast = vi.fn()

vi.mock('@/composables/useApi', () => ({ useApi: () => ({ apiFetch: fetchMock }) }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ push: pushToast }) }))

const mounted: Array<{ unmount: () => void }> = []

function mountAction() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const wrapper = mount(CancelBookingAction, {
    props: { bookingId: 'b1' },
    attachTo: host,
    global: { stubs: { teleport: true } },
  })
  mounted.push(wrapper)
  return wrapper
}

async function openDialog(wrapper: ReturnType<typeof mountAction>) {
  await wrapper.get('[data-testid="cancel-booking-button"]').trigger('click')
  await flushPromises()
}

describe('CancelBookingAction', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    pushToast.mockReset()
  })
  afterEach(() => {
    for (const w of mounted.splice(0)) w.unmount()
    document.body.innerHTML = ''
    document.body.style.overflow = ''
  })

  it('opens a dialog stating the real consequences and focuses the reason field', async () => {
    const wrapper = mountAction()
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false)

    await openDialog(wrapper)

    const dialog = wrapper.get('[role="alertdialog"]')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.text()).toContain('مشتری از لغو نوبت مطلع می‌شود')
    expect(dialog.text()).toContain('به‌طور کامل بازگردانده می‌شود')
    expect(dialog.text()).toContain('کیف پول')
    expect(document.activeElement).toBe(wrapper.get('[data-testid="cancel-reason"]').element)
    expect(document.body.style.overflow).toBe('hidden')
  })

  it.each(['', '    ', 'abcd', '  ab  '])('refuses to submit a too-short reason (%j) and shows the error', async (text) => {
    const wrapper = mountAction()
    await openDialog(wrapper)
    await wrapper.get('[data-testid="cancel-reason"]').setValue(text)
    await wrapper.get('[data-testid="cancel-submit"]').trigger('click')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="cancel-reason-error"]').text()).toContain('دست‌کم')
    expect(wrapper.get('[data-testid="cancel-reason"]').attributes('aria-invalid')).toBe('true')
  })

  it('POSTs the trimmed reason, toasts success, closes and emits cancelled', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'b1' }, error: null })
    const wrapper = mountAction()
    await openDialog(wrapper)
    await wrapper.get('[data-testid="cancel-reason"]').setValue('  سالن تعطیل شده است  ')
    await wrapper.get('[data-testid="cancel-submit"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/bookings/b1/cancel', { method: 'POST', body: { reason: 'سالن تعطیل شده است' } })
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('نوبت لغو شد'), 'success')
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false)
    expect(wrapper.emitted('cancelled')).toHaveLength(1)
    expect(document.body.style.overflow).toBe('')
  })

  it('stays open with the typed reason on a generic failure (useApi already toasted the server message)', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'خطا' } })
    const wrapper = mountAction()
    await openDialog(wrapper)
    await wrapper.get('[data-testid="cancel-reason"]').setValue('دلیل کافی')
    await wrapper.get('[data-testid="cancel-submit"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(true)
    expect((wrapper.get('[data-testid="cancel-reason"]').element as HTMLTextAreaElement).value).toBe('دلیل کافی')
    expect(wrapper.emitted('cancelled')).toBeUndefined()
    expect(pushToast).not.toHaveBeenCalled()
  })

  it('closes and asks the parent to refresh on a 409 (booking already moved)', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 409, message: 'این نوبت دیگر قابل لغو نیست' } })
    const wrapper = mountAction()
    await openDialog(wrapper)
    await wrapper.get('[data-testid="cancel-reason"]').setValue('دلیل کافی')
    await wrapper.get('[data-testid="cancel-submit"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false)
    expect(wrapper.emitted('refresh')).toHaveLength(1)
    expect(wrapper.emitted('cancelled')).toBeUndefined()
  })

  it('closes on Escape without calling the API and returns focus to the trigger', async () => {
    const wrapper = mountAction()
    await openDialog(wrapper)
    await wrapper.get('[data-testid="cancel-dialog-root"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(wrapper.get('[data-testid="cancel-booking-button"]').element)
  })

  it('closes from the dismiss button and the backdrop', async () => {
    const wrapper = mountAction()
    await openDialog(wrapper)
    await wrapper.get('[data-testid="cancel-dismiss"]').trigger('click')
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false)

    await openDialog(wrapper)
    await wrapper.get('[data-testid="cancel-backdrop"]').trigger('click')
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false)
  })

  it('traps Tab: from the last control it wraps to the first, and Shift+Tab from the first wraps to the last', async () => {
    const wrapper = mountAction()
    await openDialog(wrapper)
    const root = wrapper.get('[data-testid="cancel-dialog-root"]')
    const textarea = () => wrapper.get('[data-testid="cancel-reason"]').element as HTMLElement
    const dismiss = () => wrapper.get('[data-testid="cancel-dismiss"]').element as HTMLElement

    // Moving focus off the textarea blurs it (touched -> re-render); let that settle first.
    dismiss().focus()
    await flushPromises()
    await root.trigger('keydown', { key: 'Tab' })
    await flushPromises()
    expect(document.activeElement).toBe(textarea())

    await root.trigger('keydown', { key: 'Tab', shiftKey: true })
    await flushPromises()
    expect(document.activeElement).toBe(dismiss())
  })

  it('starts each opening with an empty reason', async () => {
    const wrapper = mountAction()
    await openDialog(wrapper)
    await wrapper.get('[data-testid="cancel-reason"]').setValue('بخشی از دلیل')
    await wrapper.get('[data-testid="cancel-dismiss"]').trigger('click')
    await openDialog(wrapper)
    expect((wrapper.get('[data-testid="cancel-reason"]').element as HTMLTextAreaElement).value).toBe('')
    expect(wrapper.find('[data-testid="cancel-reason-error"]').exists()).toBe(false)
  })
})
