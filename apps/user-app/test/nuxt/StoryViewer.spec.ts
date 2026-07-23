import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import StoryViewer from '../../app/components/salon/StoryViewer.client.vue'

/** Minimal MediaQueryList stub -- only the members StoryViewer actually reads. */
function stubReducedMotion(matches: boolean) {
  const listeners: Array<(event: { matches: boolean }) => void> = []
  const mql = {
    matches,
    addEventListener: (_type: string, cb: (event: { matches: boolean }) => void) => listeners.push(cb),
    removeEventListener: vi.fn(),
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => (query === '(prefers-reduced-motion: reduce)' ? mql : { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
  return {
    mql,
    fireChange(next: boolean) {
      mql.matches = next
      listeners.forEach((cb) => cb({ matches: next }))
    },
  }
}

// Same pattern as ReportForm.spec.ts: `$fetch` is a real globalThis binding, stubbed
// directly -- the embedded ReportForm posts through it.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

const STORIES = [
  {
    id: 'st1',
    url: 'http://cdn.example/st1.jpg',
    caption: 'کپشن استوری اول',
    serviceId: null,
    createdAt: '2026-07-17T10:00:00.000Z',
    expiresAt: '2026-07-18T10:00:00.000Z',
  },
  {
    id: 'st2',
    url: 'http://cdn.example/st2.jpg',
    caption: 'کپشن استوری دوم',
    serviceId: null,
    createdAt: '2026-07-17T11:00:00.000Z',
    expiresAt: '2026-07-18T11:00:00.000Z',
  },
]

const BASE_PROPS = { stories: STORIES, services: [], slug: 'test-salon', salonId: 's1' }

const VALID_REASON = 'این استوری محتوای نامناسبی دارد'

describe('StoryViewer', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    localStorage.clear()
    // Start every test from an unlocked document (a failed prior test could leak a lock).
    document.documentElement.style.overflow = ''
    document.body.style.overflow = ''
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('locks background scroll on mount and restores the exact prior value on unmount', async () => {
    document.documentElement.style.overflow = 'scroll'
    try {
      const wrapper = await mountSuspended(StoryViewer, { props: BASE_PROPS })

      expect(document.documentElement.style.overflow).toBe('hidden')
      expect(document.body.style.overflow).toBe('hidden')

      wrapper.unmount()
      expect(document.documentElement.style.overflow).toBe('scroll')
      expect(document.body.style.overflow).toBe('')
    } finally {
      document.documentElement.style.overflow = ''
      document.body.style.overflow = ''
    }
  })

  it('shows no report affordance when the viewer is not report-eligible', async () => {
    const wrapper = await mountSuspended(StoryViewer, { props: BASE_PROPS })

    expect(wrapper.find('[data-testid="story-report-button"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('pauses auto-advance while the report form is open and resumes when it closes', async () => {
    vi.useFakeTimers()
    const wrapper = await mountSuspended(StoryViewer, {
      props: { ...BASE_PROPS, canReport: true },
    })

    await wrapper.get('[data-testid="story-report-button"]').trigger('click')
    expect(wrapper.find('[data-testid="report-reason-input"]').exists()).toBe(true)

    // Two full story durations pass -- a running timer would have advanced to the
    // second story and then closed the viewer. Paused, it stays on the first.
    await vi.advanceTimersByTimeAsync(12000)
    expect(wrapper.get('[data-testid="story-caption"]').text()).toBe('کپشن استوری اول')
    expect(wrapper.emitted('close')).toBeUndefined()

    // Dismissing the form resumes playback from where it left off.
    await wrapper.get('[data-testid="report-close-button"]').trigger('click')
    expect(wrapper.find('[data-testid="report-reason-input"]').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(5100)
    expect(wrapper.get('[data-testid="story-caption"]').text()).toBe('کپشن استوری دوم')

    wrapper.unmount()
  })

  it('reports the story on screen: the form POSTs a storyId-targeted body', async () => {
    fetchMock.mockResolvedValue({ id: 'rep1' })
    const wrapper = await mountSuspended(StoryViewer, {
      props: { ...BASE_PROPS, canReport: true },
    })

    await wrapper.get('[data-testid="story-report-button"]').trigger('click')
    await wrapper.get('[data-testid="report-reason-input"]').setValue(VALID_REASON)
    await wrapper.get('[data-testid="submit-report-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/reports',
      expect.objectContaining({ method: 'POST', body: { storyId: 'st1', reason: VALID_REASON } }),
    )
    // ReportForm emitted close on success -- form gone, viewer still open.
    expect(wrapper.find('[data-testid="report-reason-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="story-viewer"]').exists()).toBe(true)
    expect(wrapper.emitted('close')).toBeUndefined()

    wrapper.unmount()
  })

  it('exposes dialog semantics: role=dialog, aria-modal, aria-labelledby pointing at its own heading', async () => {
    const wrapper = await mountSuspended(StoryViewer, { props: BASE_PROPS })

    const dialog = wrapper.get('[data-testid="story-viewer"]')
    expect(dialog.attributes('role')).toBe('dialog')
    expect(dialog.attributes('aria-modal')).toBe('true')
    const labelledBy = dialog.attributes('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(dialog.get('h2').attributes('id')).toBe(labelledBy)

    wrapper.unmount()
  })

  it('moves focus into the viewer on mount, traps Tab, and restores focus to the trigger on close', async () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()

    const wrapper = await mountSuspended(StoryViewer, { props: BASE_PROPS, attachTo: document.body })
    await nextTick()

    const prevZone = wrapper.get('[data-testid="story-prev-zone"]').element as HTMLElement
    const closeButton = wrapper.get('[data-testid="story-close"]').element as HTMLElement
    // No canReport/service pill in BASE_PROPS -- focusable order is [prev, next, close].
    expect(document.activeElement).toBe(prevZone)

    closeButton.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(prevZone)

    wrapper.unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('closes on Escape', async () => {
    const wrapper = await mountSuspended(StoryViewer, { props: BASE_PROPS })
    await nextTick()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(wrapper.emitted('close')).toHaveLength(1)

    wrapper.unmount()
  })

  it('disables auto-advance for prefers-reduced-motion users and requires a manual tap', async () => {
    vi.useFakeTimers()
    stubReducedMotion(true)
    const wrapper = await mountSuspended(StoryViewer, { props: BASE_PROPS })

    // No CSS fill animation is applied when motion is reduced.
    expect(wrapper.find('.story-fill').exists()).toBe(false)

    // Far longer than STORY_DURATION_MS -- a running timer would have advanced/closed.
    await vi.advanceTimersByTimeAsync(20000)
    expect(wrapper.get('[data-testid="story-caption"]').text()).toBe('کپشن استوری اول')
    expect(wrapper.emitted('close')).toBeUndefined()

    // Manual tap still works.
    await wrapper.get('[data-testid="story-next-zone"]').trigger('click')
    expect(wrapper.get('[data-testid="story-caption"]').text()).toBe('کپشن استوری دوم')

    wrapper.unmount()
  })

  it('runs the CSS fill animation for auto-advance when motion is not reduced', async () => {
    stubReducedMotion(false)
    const wrapper = await mountSuspended(StoryViewer, { props: BASE_PROPS })

    expect(wrapper.find('.story-fill').exists()).toBe(true)

    wrapper.unmount()
  })

  it('pauses auto-advance on a held tap zone and resumes (without navigating) on release', async () => {
    vi.useFakeTimers()
    stubReducedMotion(false)
    const wrapper = await mountSuspended(StoryViewer, { props: BASE_PROPS })

    const nextZone = wrapper.get('[data-testid="story-next-zone"]')
    await nextZone.trigger('pointerdown')
    // Past the hold threshold -- playback should now be paused.
    await vi.advanceTimersByTimeAsync(400)
    await vi.advanceTimersByTimeAsync(6000)
    expect(wrapper.get('[data-testid="story-caption"]').text()).toBe('کپشن استوری اول')

    // Releasing a held press resumes playback in place -- it must not also navigate.
    await nextZone.trigger('pointerup')
    await nextZone.trigger('click')
    expect(wrapper.get('[data-testid="story-caption"]').text()).toBe('کپشن استوری اول')

    // Playback resumed -- it eventually advances on its own.
    await vi.advanceTimersByTimeAsync(6000)
    expect(wrapper.get('[data-testid="story-caption"]').text()).toBe('کپشن استوری دوم')

    wrapper.unmount()
  })

  it('a quick tap on a zone still navigates immediately (no false pause)', async () => {
    vi.useFakeTimers()
    stubReducedMotion(false)
    const wrapper = await mountSuspended(StoryViewer, { props: BASE_PROPS })

    const nextZone = wrapper.get('[data-testid="story-next-zone"]')
    await nextZone.trigger('pointerdown')
    await nextZone.trigger('pointerup')
    await nextZone.trigger('click')

    expect(wrapper.get('[data-testid="story-caption"]').text()).toBe('کپشن استوری دوم')

    wrapper.unmount()
  })
})
