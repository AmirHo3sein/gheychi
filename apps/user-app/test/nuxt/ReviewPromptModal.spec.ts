import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import ReviewPromptModal from '../../app/components/booking/ReviewPromptModal.vue'

// Same pattern as useApi.spec.ts / booking-confirm.spec.ts: `$fetch` is a real globalThis
// binding, not an unimport-tracked auto-import, so it's stubbed directly.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

describe('ReviewPromptModal', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('emits submitted on a successful review', async () => {
    fetchMock.mockResolvedValue({ id: 'r1' })
    const wrapper = await mountSuspended(ReviewPromptModal, { props: { bookingId: 'b1' } })

    await wrapper.find('[data-testid="submit-review-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('submitted')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('شما قبلا برای این نوبت نظر ثبت کرده‌اید')
  })

  it('on a 409, shows the already-reviewed message instead of emitting submitted', async () => {
    fetchMock.mockRejectedValue({ response: { status: 409 }, statusMessage: 'Conflict' })
    const wrapper = await mountSuspended(ReviewPromptModal, { props: { bookingId: 'b1' } })

    await wrapper.find('[data-testid="submit-review-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('شما قبلا برای این نوبت نظر ثبت کرده‌اید')
    expect(wrapper.emitted('submitted')).toBeUndefined()
  })

  it('on a non-409 error, surfaces a toast instead of silently doing nothing', async () => {
    fetchMock.mockRejectedValue({ response: { status: 500 }, statusMessage: 'Server error' })
    const wrapper = await mountSuspended(ReviewPromptModal, { props: { bookingId: 'b1' } })
    const { toasts } = useToast()
    const before = toasts.value.length

    await wrapper.find('[data-testid="submit-review-button"]').trigger('click')
    await flushPromises()

    expect(toasts.value.length).toBe(before + 1)
    expect(wrapper.emitted('submitted')).toBeUndefined()
    expect(wrapper.text()).not.toContain('شما قبلا برای این نوبت نظر ثبت کرده‌اید')
  })

  it('shows a worker rating input and includes it in the request when the booking has a worker', async () => {
    fetchMock.mockResolvedValue({ id: 'r1', rating: 5, comment: null })
    const wrapper = await mountSuspended(ReviewPromptModal, { props: { bookingId: 'b1', workerName: 'سارا محمدی' } })

    expect(wrapper.text()).toContain('امتیاز به سارا محمدی')
    expect(wrapper.find('[data-testid="worker-rating-stars"]').exists()).toBe(true)

    await wrapper.find('[data-testid="submit-review-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/reviews',
      expect.objectContaining({ body: expect.objectContaining({ workerRating: 5 }) }),
    )
  })

  it('omits workerRating from the request when the booking has no worker', async () => {
    fetchMock.mockResolvedValue({ id: 'r1', rating: 5, comment: null })
    const wrapper = await mountSuspended(ReviewPromptModal, { props: { bookingId: 'b1' } })

    expect(wrapper.find('[data-testid="worker-rating-stars"]').exists()).toBe(false)

    await wrapper.find('[data-testid="submit-review-button"]').trigger('click')
    await flushPromises()

    const [, options] = fetchMock.mock.calls[0]!
    expect(options.body).not.toHaveProperty('workerRating')
  })

  it('after a successful submit, shows edit/delete actions instead of closing, and PATCHes on save', async () => {
    fetchMock.mockImplementation(async (_path: string, options: { method?: string; body?: unknown }) => {
      if (options?.method === 'POST') return { id: 'r1', rating: 5, comment: null }
      if (options?.method === 'PATCH') return { id: 'r1', rating: 2, comment: null }
      throw new Error(`unexpected call: ${options?.method}`)
    })
    const wrapper = await mountSuspended(ReviewPromptModal, { props: { bookingId: 'b1', workerName: 'سارا محمدی' } })

    await wrapper.find('[data-testid="submit-review-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="edit-review-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="delete-review-button"]').exists()).toBe(true)

    await wrapper.find('[data-testid="edit-review-button"]').trigger('click')
    const editStars = wrapper.findAll('[data-testid="edit-salon-rating-stars"] button')
    await editStars[1]!.trigger('click') // rating -> 2

    await wrapper.find('[data-testid="save-edit-review-button"]').trigger('click')
    await flushPromises()

    const patchCall = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH')
    expect(patchCall![0]).toBe('/reviews/r1')
    expect(patchCall![1]).toMatchObject({ body: expect.objectContaining({ rating: 2, workerRating: 5 }) })

    const starIcons = wrapper.find('[data-testid="view-salon-rating-stars"]').findAll('svg')
    expect(starIcons).toHaveLength(5)
    const filled = starIcons.filter((icon) => icon.classes().some((c) => c.includes('accent-strong')))
    expect(filled).toHaveLength(2)
  })

  it('deletes the review after confirmation and shows the deleted message', async () => {
    vi.stubGlobal('confirm', () => true)
    fetchMock.mockImplementation(async (_path: string, options: { method?: string }) => {
      if (options?.method === 'POST') return { id: 'r1', rating: 5, comment: null }
      if (options?.method === 'DELETE') return null
      throw new Error(`unexpected call: ${options?.method}`)
    })
    const wrapper = await mountSuspended(ReviewPromptModal, { props: { bookingId: 'b1' } })

    await wrapper.find('[data-testid="submit-review-button"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="delete-review-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('نظر شما حذف شد')
  })

  it('does not delete when the confirm dialog is dismissed', async () => {
    vi.stubGlobal('confirm', () => false)
    fetchMock.mockImplementation(async (_path: string, options: { method?: string }) => {
      if (options?.method === 'POST') return { id: 'r1', rating: 5, comment: null }
      throw new Error(`unexpected call: ${options?.method}`)
    })
    const wrapper = await mountSuspended(ReviewPromptModal, { props: { bookingId: 'b1' } })

    await wrapper.find('[data-testid="submit-review-button"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="delete-review-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('نظر شما حذف شد')
    expect(wrapper.find('[data-testid="edit-review-button"]').exists()).toBe(true)
  })

  // The 72h edit/delete window was unreachable until the screens could hand an existing
  // review in: the component only ever learned a reviewId from its own POST response.
  it('opens straight into the existing review, pre-filled, when one is passed in', async () => {
    const wrapper = await mountSuspended(ReviewPromptModal, {
      props: {
        bookingId: 'b1',
        workerName: 'سارا محمدی',
        review: { id: 'rev-1', rating: 3, comment: 'خوب بود', workerRating: 2, canEdit: true },
      },
    })

    expect(wrapper.find('[data-testid="submit-review-button"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('خوب بود')

    const filled = wrapper
      .find('[data-testid="view-salon-rating-stars"]')
      .findAll('svg')
      .filter((icon) => icon.classes().some((c) => c.includes('accent-strong')))
    expect(filled).toHaveLength(3)

    await wrapper.find('[data-testid="edit-review-button"]').trigger('click')
    const editStars = wrapper.findAll('[data-testid="edit-salon-rating-stars"] button')
    await editStars[4]!.trigger('click') // rating -> 5

    fetchMock.mockResolvedValue({ id: 'rev-1', rating: 5, comment: 'خوب بود' })
    await wrapper.find('[data-testid="save-edit-review-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/reviews/rev-1',
      expect.objectContaining({ method: 'PATCH', body: expect.objectContaining({ rating: 5, workerRating: 2 }) }),
    )
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('deletes a pre-filled review without ever creating one first', async () => {
    vi.stubGlobal('confirm', () => true)
    fetchMock.mockResolvedValue(null)
    const wrapper = await mountSuspended(ReviewPromptModal, {
      props: { bookingId: 'b1', review: { id: 'rev-1', rating: 3, comment: null, workerRating: null, canEdit: true } },
    })

    await wrapper.find('[data-testid="delete-review-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/reviews/rev-1', expect.objectContaining({ method: 'DELETE' }))
    expect(wrapper.text()).toContain('نظر شما حذف شد')
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  // canEdit is the server's own verdict (platform_config's review_edit_window_hours),
  // so the controls disappear exactly when PATCH/DELETE would 403.
  it('hides the edit/delete controls, with a reason, for a review past its edit window', async () => {
    const wrapper = await mountSuspended(ReviewPromptModal, {
      props: { bookingId: 'b1', review: { id: 'rev-1', rating: 3, comment: null, workerRating: null, canEdit: false } },
    })

    expect(wrapper.find('[data-testid="edit-review-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="delete-review-button"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="edit-window-closed"]').text()).toContain('مهلت ویرایش این نظر به پایان رسیده است')
  })

  it('exposes dialog semantics: role=dialog, aria-modal, and aria-labelledby pointing at the active phase heading', async () => {
    const wrapper = await mountSuspended(ReviewPromptModal, { props: { bookingId: 'b1' } })

    const dialog = wrapper.find('[role="dialog"]')
    expect(dialog.exists()).toBe(true)
    expect(dialog.attributes('aria-modal')).toBe('true')

    const labelledBy = dialog.attributes('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    const heading = wrapper.get('h2')
    expect(heading.attributes('id')).toBe(labelledBy)
    // Exactly one accessible label active at a time.
    expect(wrapper.findAll('h2')).toHaveLength(1)
  })

  it('moves focus into the dialog on mount', async () => {
    const wrapper = await mountSuspended(ReviewPromptModal, { props: { bookingId: 'b1' }, attachTo: document.body })
    await nextTick()

    const firstStar = wrapper.findAll('[data-testid="salon-rating-stars"] button')[0]!.element
    expect(document.activeElement).toBe(firstStar)
  })

  it('traps Tab focus within the dialog and restores focus to the trigger on close', async () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const wrapper = await mountSuspended(ReviewPromptModal, { props: { bookingId: 'b1' }, attachTo: document.body })
    await nextTick()

    const firstStar = wrapper.findAll('[data-testid="salon-rating-stars"] button')[0]!.element as HTMLElement
    const closeButton = wrapper.findAll('button').find((b) => b.text() === 'بستن')!.element as HTMLElement
    expect(document.activeElement).toBe(firstStar)

    firstStar.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(closeButton)

    closeButton.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(firstStar)

    wrapper.unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('closes on Escape', async () => {
    const wrapper = await mountSuspended(ReviewPromptModal, { props: { bookingId: 'b1' } })
    await nextTick()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('gives every star-rating button an accessible name', async () => {
    const wrapper = await mountSuspended(ReviewPromptModal, { props: { bookingId: 'b1', workerName: 'سارا محمدی' } })

    const salonButtons = wrapper.findAll('[data-testid="salon-rating-stars"] button')
    expect(salonButtons).toHaveLength(5)
    salonButtons.forEach((button, i) => {
      expect(button.attributes('aria-label')).toBe(`امتیاز ${i + 1} از ۵ به سالن`)
    })

    const workerButtons = wrapper.findAll('[data-testid="worker-rating-stars"] button')
    expect(workerButtons).toHaveLength(5)
    workerButtons.forEach((button, i) => {
      expect(button.attributes('aria-label')).toBe(`امتیاز ${i + 1} از ۵ به سارا محمدی`)
    })
  })

  it('renders star buttons as BaseIcon SVGs, not emoji glyphs', async () => {
    const wrapper = await mountSuspended(ReviewPromptModal, { props: { bookingId: 'b1' } })

    expect(wrapper.text()).not.toContain('⭐')
    expect(wrapper.text()).not.toContain('☆')

    const stars = wrapper.find('[data-testid="salon-rating-stars"]')
    expect(stars.findAll('svg')).toHaveLength(5)
  })
})
