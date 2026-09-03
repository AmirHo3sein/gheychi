import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVisiblePolling, type VisiblePollingOptions } from './useVisiblePolling'

// The composable's hooks are onMounted/onUnmounted, so it can only be exercised from inside
// a real component instance -- this is the smallest one that does nothing else.
function mountWith(options: VisiblePollingOptions) {
  return mount(defineComponent({
    setup() {
      useVisiblePolling(options)
      return () => h('div')
    },
  }))
}

function setTabHidden(hidden: boolean, { dispatch = true } = {}) {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden })
  if (dispatch) document.dispatchEvent(new Event('visibilitychange'))
}

describe('useVisiblePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  })

  afterEach(() => {
    vi.useRealTimers()
    setTabHidden(false, { dispatch: false })
  })

  // ...Async, because a tick only clears its own re-entrancy latch in a microtask: two
  // interval callbacks fired inside one synchronous advanceTimersByTime() would (correctly)
  // be treated as an overlapping run. Every real tick is 30s apart, so this only ever bites
  // a test that advances the clock without letting promises settle in between.
  it('polls on the interval while visible', async () => {
    const poll = vi.fn()
    mountWith({ poll, intervalMs: 1000 })

    // Nothing on mount -- the caller has just loaded its own data.
    expect(poll).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(3000)
    expect(poll).toHaveBeenCalledTimes(3)
  })

  it('starts nothing at all when the tab is mounted already hidden', async () => {
    setTabHidden(true, { dispatch: false })
    const poll = vi.fn()
    mountWith({ poll, intervalMs: 1000 })

    await vi.advanceTimersByTimeAsync(10_000)
    expect(poll).not.toHaveBeenCalled()

    // ...and picks up correctly the first time it IS looked at.
    setTabHidden(false)
    expect(poll).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(poll).toHaveBeenCalledTimes(2)
  })

  it('tears the interval down while hidden rather than merely no-oping the callback', async () => {
    const poll = vi.fn()
    mountWith({ poll, intervalMs: 1000 })

    setTabHidden(true)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(poll).not.toHaveBeenCalled()
  })

  it('skips a tick when shouldSkip says a mutation is in flight', async () => {
    const poll = vi.fn()
    let blocked = true
    mountWith({ poll, intervalMs: 1000, shouldSkip: () => blocked })

    await vi.advanceTimersByTimeAsync(3000)
    expect(poll).not.toHaveBeenCalled()

    // A skipped tick is dropped, not queued -- the next one simply runs.
    blocked = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(poll).toHaveBeenCalledTimes(1)
  })

  it('never re-enters a poll that is slower than the interval', async () => {
    let release!: () => void
    const poll = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    mountWith({ poll, intervalMs: 1000 })

    await vi.advanceTimersByTimeAsync(5000)
    expect(poll).toHaveBeenCalledTimes(1)

    release()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1000)
    expect(poll).toHaveBeenCalledTimes(2)
  })

  it('releases both the interval and the listener on unmount', async () => {
    const poll = vi.fn()
    const wrapper = mountWith({ poll, intervalMs: 1000 })

    wrapper.unmount()

    await vi.advanceTimersByTimeAsync(10_000)
    // Neither the timer nor the visibility path can resurrect it.
    setTabHidden(true)
    setTabHidden(false)
    expect(poll).not.toHaveBeenCalled()
  })
})
