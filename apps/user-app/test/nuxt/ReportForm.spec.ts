import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import ReportForm from '../../app/components/salon/ReportForm.vue'

// Same pattern as ReviewPromptModal.spec.ts / useApi.spec.ts: `$fetch` is a real
// globalThis binding, not an unimport-tracked auto-import, so it's stubbed directly.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

const VALID_REASON = 'این سالن اطلاعات نادرستی درج کرده است'

describe('ReportForm', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps submit disabled until the reason is at least 5 characters, and shows a counter', async () => {
    const wrapper = await mountSuspended(ReportForm, { props: { salonId: 's1' } })

    expect(wrapper.find('[data-testid="submit-report-button"]').attributes('disabled')).toBeDefined()

    await wrapper.find('[data-testid="report-reason-input"]').setValue('بد')
    expect(wrapper.find('[data-testid="submit-report-button"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="report-reason-counter"]').text()).toContain('۲')

    await wrapper.find('[data-testid="report-reason-input"]').setValue(VALID_REASON)
    expect(wrapper.find('[data-testid="submit-report-button"]').attributes('disabled')).toBeUndefined()
  })

  it('POSTs a salon-targeted report, toasts success, and emits close', async () => {
    fetchMock.mockResolvedValue({ id: 'rep1' })
    const wrapper = await mountSuspended(ReportForm, { props: { salonId: 's1' } })
    const { toasts } = useToast()
    const before = toasts.value.length

    await wrapper.find('[data-testid="report-reason-input"]').setValue(VALID_REASON)
    await wrapper.find('[data-testid="submit-report-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/reports',
      expect.objectContaining({ method: 'POST', body: { salonId: 's1', reason: VALID_REASON } }),
    )
    expect(toasts.value.length).toBe(before + 1)
    expect(toasts.value.at(-1)?.message).toBe('گزارش شما ثبت شد و توسط تیم پشتیبانی بررسی می‌شود')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('targets the review, not the salon, when reviewId is passed', async () => {
    fetchMock.mockResolvedValue({ id: 'rep1' })
    const wrapper = await mountSuspended(ReportForm, { props: { salonId: 's1', reviewId: 'rev1' } })

    await wrapper.find('[data-testid="report-reason-input"]').setValue(VALID_REASON)
    await wrapper.find('[data-testid="submit-report-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/reports',
      expect.objectContaining({ method: 'POST', body: { reviewId: 'rev1', reason: VALID_REASON } }),
    )
  })

  it('targets the story when storyId is passed', async () => {
    fetchMock.mockResolvedValue({ id: 'rep1' })
    const wrapper = await mountSuspended(ReportForm, { props: { salonId: 's1', storyId: 'st1' } })

    expect(wrapper.get('h2').text()).toBe('گزارش این استوری')

    await wrapper.find('[data-testid="report-reason-input"]').setValue(VALID_REASON)
    await wrapper.find('[data-testid="submit-report-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/reports',
      expect.objectContaining({ method: 'POST', body: { storyId: 'st1', reason: VALID_REASON } }),
    )
  })

  it('targets the portfolio item when portfolioItemId is passed', async () => {
    fetchMock.mockResolvedValue({ id: 'rep1' })
    const wrapper = await mountSuspended(ReportForm, {
      props: { salonId: 's1', portfolioItemId: 'pf1' },
    })

    expect(wrapper.get('h2').text()).toBe('گزارش این نمونه کار')

    await wrapper.find('[data-testid="report-reason-input"]').setValue(VALID_REASON)
    await wrapper.find('[data-testid="submit-report-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/reports',
      expect.objectContaining({ method: 'POST', body: { portfolioItemId: 'pf1', reason: VALID_REASON } }),
    )
  })

  it('shows the duplicate-report toast on a 409 and closes', async () => {
    fetchMock.mockRejectedValue({ response: { status: 409 }, statusMessage: 'Conflict' })
    const wrapper = await mountSuspended(ReportForm, { props: { salonId: 's1' } })
    const { toasts } = useToast()

    await wrapper.find('[data-testid="report-reason-input"]').setValue(VALID_REASON)
    await wrapper.find('[data-testid="submit-report-button"]').trigger('click')
    await flushPromises()

    expect(toasts.value.at(-1)?.message).toBe('گزارش قبلی شما هنوز در حال بررسی است')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('shows the ineligible toast on a 403 and closes', async () => {
    fetchMock.mockRejectedValue({ response: { status: 403 }, statusMessage: 'Forbidden' })
    const wrapper = await mountSuspended(ReportForm, { props: { salonId: 's1' } })
    const { toasts } = useToast()

    await wrapper.find('[data-testid="report-reason-input"]').setValue(VALID_REASON)
    await wrapper.find('[data-testid="submit-report-button"]').trigger('click')
    await flushPromises()

    expect(toasts.value.at(-1)?.message).toBe('فقط مشتریانی با نوبت تکمیل‌شده در این سالن می‌توانند گزارش ثبت کنند')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('keeps the form open with a generic toast on other errors', async () => {
    fetchMock.mockRejectedValue({ response: { status: 500 }, statusMessage: 'Server error' })
    const wrapper = await mountSuspended(ReportForm, { props: { salonId: 's1' } })
    const { toasts } = useToast()

    await wrapper.find('[data-testid="report-reason-input"]').setValue(VALID_REASON)
    await wrapper.find('[data-testid="submit-report-button"]').trigger('click')
    await flushPromises()

    expect(toasts.value.at(-1)?.message).toBe('ثبت گزارش ناموفق بود؛ لطفا دوباره تلاش کنید')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('exposes dialog semantics: role=dialog, aria-modal, and aria-labelledby pointing at its own heading', async () => {
    const wrapper = await mountSuspended(ReportForm, { props: { salonId: 's1' } })

    const dialog = wrapper.find('[role="dialog"]')
    expect(dialog.exists()).toBe(true)
    expect(dialog.attributes('aria-modal')).toBe('true')

    const labelledBy = dialog.attributes('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    const heading = wrapper.get('h2')
    expect(heading.attributes('id')).toBe(labelledBy)
  })

  it('moves focus into the dialog on mount', async () => {
    const wrapper = await mountSuspended(ReportForm, { props: { salonId: 's1' }, attachTo: document.body })
    await nextTick()

    expect(document.activeElement).toBe(wrapper.get('[data-testid="report-reason-input"]').element)
  })

  it('traps Tab focus within the dialog and restores focus to the trigger on close', async () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const wrapper = await mountSuspended(ReportForm, { props: { salonId: 's1' }, attachTo: document.body })
    await nextTick()

    const textarea = wrapper.get('[data-testid="report-reason-input"]').element as HTMLElement
    const closeButton = wrapper.get('[data-testid="report-close-button"]').element as HTMLElement
    // Submit is disabled while the reason is empty, so it's excluded from the trap
    // -- the reachable set is exactly [textarea, close button].
    expect(document.activeElement).toBe(textarea)

    closeButton.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(textarea)

    textarea.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(closeButton)

    wrapper.unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('closes on Escape', async () => {
    const wrapper = await mountSuspended(ReportForm, { props: { salonId: 's1' } })
    await nextTick()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('gives the reason textarea an accessible name and wires the counter as a live region', async () => {
    const wrapper = await mountSuspended(ReportForm, { props: { salonId: 's1' } })

    const textarea = wrapper.get('[data-testid="report-reason-input"]')
    const label = wrapper.get('label')
    expect(label.attributes('for')).toBe(textarea.attributes('id'))
    expect(textarea.attributes('id')).toBeTruthy()

    const counter = wrapper.get('[data-testid="report-reason-counter"]')
    expect(counter.attributes('aria-live')).toBe('polite')
    expect(textarea.attributes('aria-describedby')).toBe(counter.attributes('id'))
  })
})
