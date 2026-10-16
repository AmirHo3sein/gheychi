// apps/provider-panel/src/composables/usePendingApprovals.ts
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useApi, type ApiResult } from './useApi'
import { useSalon } from './useSalon'
import { useToast } from './useToast'
import { useVisiblePolling } from './useVisiblePolling'

interface BookingLike {
  id: string
  status: string
}

/**
 * Same cadence BookingsView polls at, for the same reason (see the long comment above its
 * POLL_INTERVAL_MS): 30s is 5% of the default 10-minute approval window.
 */
export const PENDING_POLL_INTERVAL_MS = 30_000

// Module-level, like useSalon/useToast: one app-wide count that the sidebar, the bottom bar
// and the dashboard all read, whichever of them is mounted.
const pendingIds = ref<string[]>([])
// Pending ids this tab has already shown the owner, seeded silently from the first read so a
// queue that was already there on arrival is not announced as new. A request can never return
// to pending_approval once it leaves, so the set never needs pruning.
const seenIds = new Set<string>()
let seeded = false
// How many mounted pages are already polling GET /salons/mine/bookings themselves (today only
// BookingsView). While one is, the layout's own poll stands down and the page feeds the count
// instead, so the bookings screen never issues the same request twice per tick.
let pageFeeds = 0
// Bumped by resetPendingApprovals(): a read that was in flight across a reset (logout) belongs
// to the previous session and must not write its queue back into the fresh state.
let generation = 0
// The one GET /salons/mine/bookings currently in flight, shared by everyone who asks while it
// is (see readSalonBookings).
let inflightRead: Promise<ApiResult<unknown>> | null = null

type ApiFetch = ReturnType<typeof useApi>['apiFetch']

/**
 * GET /salons/mine/bookings, de-duplicated while in flight: a page that needs the list on
 * mount (the dashboard) and the layout's own mount-time poll get the same request instead of
 * two identical reads of up to 1000 rows. Only concurrent callers share -- once it settles the
 * next call is a fresh read. Not for a refetch after a write (BookingsView keeps its own
 * reads), where joining an older in-flight read could return pre-write data.
 */
export function readSalonBookings<T>(apiFetch: ApiFetch): Promise<ApiResult<T[]>> {
  if (!inflightRead) {
    const read = apiFetch<unknown>('/salons/mine/bookings', { silent: true })
    inflightRead = read
    void read.finally(() => {
      if (inflightRead === read) inflightRead = null
    })
  }
  return inflightRead as Promise<ApiResult<T[]>>
}

function pendingOf(list: BookingLike[]): string[] {
  return list.filter((b) => b.status === 'pending_approval').map((b) => b.id)
}

/**
 * Records a fresh bookings list read by a page that also announces arrivals itself
 * (BookingsView toasts new requests). Every id is marked seen so the layout never repeats an
 * announcement the page already made.
 */
export function reportBookings(list: BookingLike[]): void {
  const ids = pendingOf(list)
  for (const id of ids) seenIds.add(id)
  seeded = true
  pendingIds.value = ids
}

/**
 * Lets a page that polls the bookings list itself take over feeding the count while it is
 * mounted. Call from the page's setup; it releases automatically on unmount.
 */
export function usePendingApprovalsFeed(): void {
  onMounted(() => {
    pageFeeds += 1
  })
  onUnmounted(() => {
    pageFeeds = Math.max(0, pageFeeds - 1)
  })
}

/** The live count of requests waiting on the owner's decision. Read-only. */
export function usePendingApprovalCount() {
  return computed(() => pendingIds.value.length)
}

/**
 * The app-wide poll, mounted once by AppLayout. Uses the existing GET /salons/mine/bookings
 * (no new endpoint) through useVisiblePolling, so it stops entirely while the tab is hidden and
 * refreshes the moment the owner comes back. Only an approved salon polls: a pending/rejected
 * salon can reach a few screens inside the layout (see the router guard) but has no bookings.
 *
 * A request that arrives while the owner is on another screen is announced with one toast, the
 * same copy BookingsView uses -- otherwise it could lapse unseen before they ever open the
 * bookings tab. A failed read is silent and leaves the last known count in place.
 */
export function usePendingApprovalPolling() {
  const { apiFetch } = useApi()
  const { salon } = useSalon()
  const { push: pushToast } = useToast()

  async function poll(): Promise<void> {
    const startedIn = generation
    const { data, error } = await readSalonBookings<BookingLike>(apiFetch)
    // A page may have mounted (and started feeding) while this read was in flight; its own
    // read is at least as fresh, so drop this one. Likewise a read that straddled a logout.
    if (error || !Array.isArray(data) || pageFeeds > 0 || startedIn !== generation) return
    const ids = pendingOf(data)
    if (seeded) {
      const arrivals = ids.filter((id) => !seenIds.has(id))
      if (arrivals.length > 0) {
        pushToast(
          arrivals.length === 1
            ? 'درخواست نوبت جدیدی دریافت شد'
            : `${arrivals.length.toLocaleString('fa-IR')} درخواست نوبت جدید دریافت شد`,
        )
      }
    }
    for (const id of ids) seenIds.add(id)
    seeded = true
    pendingIds.value = ids
  }

  const shouldSkip = () => pageFeeds > 0 || salon.value?.status !== 'approved'
  const polling = useVisiblePolling({ poll, intervalMs: PENDING_POLL_INTERVAL_MS, shouldSkip })

  // useVisiblePolling only schedules the interval; read once right away so the badge is there
  // on arrival rather than 30 seconds later. Children mount before this hook runs, so a page
  // that feeds the count (direct load of /bookings) has already claimed it by now.
  onMounted(() => {
    void polling.pollNow()
  })
  // On a real page load the salon is usually still loading at mount, so the read above is
  // skipped by the approved-only guard. Read the moment it turns out to be approved instead
  // of leaving the badge and the dashboard callout empty until the next 30s tick.
  watch(
    () => salon.value?.status,
    (status, previous) => {
      if (status === 'approved' && previous !== 'approved') void polling.pollNow()
    },
  )

  return polling
}

// Back to the initial state. Called on logout (the next account on this tab must not inherit
// the previous salon's count or seen-set) and from specs, since Vitest isolates modules per
// file, not per test.
export function resetPendingApprovals(): void {
  pendingIds.value = []
  seenIds.clear()
  seeded = false
  pageFeeds = 0
  generation += 1
  inflightRead = null
}
