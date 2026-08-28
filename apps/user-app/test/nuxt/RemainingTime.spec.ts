import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import RemainingTime from '../../app/components/booking/RemainingTime.vue'
import { NOW_STATE_KEY } from '../../app/composables/useNow'

// Every assertion here is about what the label SAYS at a known instant, so the clock is
// pinned rather than being read from the machine running the suite. useNow() re-seeds itself
// from the real clock in onMounted, which is exactly why fake timers (not just a stubbed
// state value) are what makes this deterministic.
const NOW = new Date('2026-07-20T12:00:00.000Z')

describe('RemainingTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the remaining time until a future deadline', async () => {
    const wrapper = await mountSuspended(RemainingTime, { props: { expiresAt: '2026-07-20T12:30:00.000Z' } })
    expect(wrapper.get('[data-testid="remaining-time"]').text()).toBe('۳۰ دقیقه مانده')
    wrapper.unmount()
  })

  it('renders nothing at all when there is no deadline in play', async () => {
    const wrapper = await mountSuspended(RemainingTime, { props: { expiresAt: null } })
    expect(wrapper.find('[data-testid="remaining-time"]').exists()).toBe(false)
    wrapper.unmount()
  })

  // The backend deadline is the truth: once it has passed the label states that plainly
  // instead of counting into negatives -- and, crucially, it is the only thing that changes.
  // Nothing on any page is gated on this component's output.
  it('says منقضی شده once the deadline has passed', async () => {
    const wrapper = await mountSuspended(RemainingTime, { props: { expiresAt: '2026-07-20T11:59:00.000Z' } })
    expect(wrapper.get('[data-testid="remaining-time"]').text()).toBe('منقضی شده')
    wrapper.unmount()
  })

  it('advances on the shared tick without being re-mounted or re-fetched', async () => {
    const wrapper = await mountSuspended(RemainingTime, { props: { expiresAt: '2026-07-20T12:10:00.000Z' } })
    expect(wrapper.get('[data-testid="remaining-time"]').text()).toBe('۱۰ دقیقه مانده')

    vi.advanceTimersByTime(5 * 60_000)
    await nextTick()

    expect(wrapper.get('[data-testid="remaining-time"]').text()).toBe('۵ دقیقه مانده')
    wrapper.unmount()
  })

  // Two countdowns must read the SAME clock -- one interval and one shared value, not two
  // that can drift a tick apart from each other on screen.
  it('drives every mounted countdown from one shared ticking ref', async () => {
    const first = await mountSuspended(RemainingTime, { props: { expiresAt: '2026-07-20T12:10:00.000Z' } })
    const second = await mountSuspended(RemainingTime, { props: { expiresAt: '2026-07-20T12:40:00.000Z' } })

    expect(useState<Date>(NOW_STATE_KEY).value.toISOString()).toBe(NOW.toISOString())

    vi.advanceTimersByTime(5 * 60_000)
    await nextTick()

    expect(first.get('[data-testid="remaining-time"]').text()).toBe('۵ دقیقه مانده')
    expect(second.get('[data-testid="remaining-time"]').text()).toBe('۳۵ دقیقه مانده')

    first.unmount()
    second.unmount()
  })
})
