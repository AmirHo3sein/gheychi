// apps/provider-panel/src/composables/useVisiblePolling.ts
import { onMounted, onUnmounted } from 'vue'

export interface VisiblePollingOptions {
  /**
   * The refresh itself. Must resolve rather than throw -- this composable owns only the
   * *when*, never the error policy: a background refresh that failed is the caller's own
   * business (see BookingsView, which counts failures and leaves its list untouched).
   */
  poll: () => Promise<void> | void
  intervalMs: number
  /**
   * Return true to drop this tick entirely. The intended use is "a mutation is in flight",
   * so a background read can never land on top of a write the owner just started. A skipped
   * tick is not rescheduled or retried -- the next tick is soon enough, and the mutation's
   * own refetch is a fresher read than this one would have been anyway.
   */
  shouldSkip?: () => boolean
}

/**
 * A `setInterval` that only runs while the tab is actually being looked at.
 *
 * Two things this exists to get right, both of which are the classic bugs in a hand-rolled
 * polling loop:
 *
 * 1. **Hidden tabs.** The interval is genuinely torn down on `visibilitychange` → hidden
 *    (not merely no-op'd inside the callback) and rebuilt on the way back, so a panel left
 *    open in a background tab overnight issues zero requests. Browsers already throttle
 *    background timers, but throttled is not stopped, and the throttling is neither uniform
 *    nor guaranteed. Coming back to visible fires `poll()` immediately rather than waiting
 *    out a full interval, which is the moment the data is most likely to be stale.
 * 2. **Cleanup.** Both the interval and the listener are released in `onUnmounted`. A route
 *    change unmounts the page component but nothing else -- a leaked interval keeps fetching
 *    (and keeps writing into a dead component's refs) for the rest of the session.
 *
 * Overlapping runs are also prevented: a `poll()` that is slower than `intervalMs` will not
 * be re-entered by the next tick.
 */
export function useVisiblePolling(options: VisiblePollingOptions) {
  let timer: ReturnType<typeof setInterval> | null = null
  let inFlight = false

  async function tick(): Promise<void> {
    // Belt and braces alongside stop-on-hidden: a tick can already be queued at the instant
    // the tab is hidden, and a caller may also invoke pollNow() directly.
    if (document.hidden) return
    if (inFlight) return
    if (options.shouldSkip?.()) return
    inFlight = true
    try {
      await options.poll()
    } finally {
      inFlight = false
    }
  }

  function start(): void {
    if (timer !== null) return
    timer = setInterval(() => void tick(), options.intervalMs)
  }

  function stop(): void {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  function onVisibilityChange(): void {
    if (document.hidden) {
      stop()
      return
    }
    start()
    void tick()
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibilityChange)
    // A tab can be mounted already hidden (opened in the background, restored session),
    // in which case nothing should start until it is actually looked at.
    if (!document.hidden) start()
  })

  onUnmounted(() => {
    stop()
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return { start, stop, pollNow: tick }
}
