// One shared, slowly-ticking "current time" for every countdown label on a page.
//
// Every <RemainingTime> reads this same ref, so a bookings list with N pending requests
// costs one interval rather than N, and all of its labels advance on the same tick instead
// of drifting apart from each other.
//
// useState (not a module-level ref) for the reason useToast.ts documents: a module-level ref
// is a single Node-process-wide singleton under SSR. Here it would leak nothing but a clock,
// but it would also be frozen at process start -- so a server-rendered countdown could be
// arbitrarily stale. useState is request-scoped, so each SSR render seeds its own.
export const NOW_STATE_KEY = 'now'

// Coarse on purpose: formatRemainingTime()'s smallest unit is a minute, so anything faster
// re-renders without changing a single character. 30s (rather than 60s) only bounds how long
// a label can lag the minute it belongs to.
const TICK_MS = 30_000

// Client-only bookkeeping -- the interval is never started on the server, so these module
// scoped values are never touched during SSR.
let subscribers = 0
let timer: ReturnType<typeof setInterval> | undefined

export function useNow() {
  const now = useState<Date>(NOW_STATE_KEY, () => new Date())

  if (import.meta.client) {
    onMounted(() => {
      // Re-seeded after hydration, not during setup: overwriting the SSR-provided value
      // while the component is still hydrating would make the client's first render differ
      // from the server's markup (a hydration mismatch on the countdown text). Post-mount
      // it is just a normal reactive update.
      now.value = new Date()
      subscribers += 1
      timer ??= setInterval(() => {
        now.value = new Date()
      }, TICK_MS)
    })
    onUnmounted(() => {
      subscribers -= 1
      if (subscribers <= 0) {
        subscribers = 0
        if (timer) clearInterval(timer)
        timer = undefined
      }
    })
  }

  return now
}
