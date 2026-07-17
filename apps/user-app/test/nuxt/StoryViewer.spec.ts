import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import StoryViewer from '../../app/components/salon/StoryViewer.client.vue'

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
})
