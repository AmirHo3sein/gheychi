// Pure classification behind BookingsView's segmented tabs. Kept out of the component so the
// rules (which booking is "needs action", which tab a fresh booking belongs to, where the page
// lands) are testable without mounting a 1000-line view.
import { canMarkCompleted } from './booking-money'
import { formatHoursMinutes } from './remaining-time'
import { tehranDateString } from './tehran-date'

export type BookingTab = 'needs-action' | 'today' | 'upcoming' | 'past'

export const BOOKING_TABS: ReadonlyArray<{ key: BookingTab; label: string }> = [
  { key: 'needs-action', label: 'نیاز به اقدام' },
  { key: 'today', label: 'امروز' },
  { key: 'upcoming', label: 'پیش‌رو' },
  { key: 'past', label: 'گذشته' },
]

export function isBookingTab(value: unknown): value is BookingTab {
  return typeof value === 'string' && BOOKING_TABS.some((t) => t.key === value)
}

export interface TabBooking {
  id: string
  startsAt: string
  status: string
}

export interface TabContext {
  now: Date
  /** False while the salon isn't approved: the API refuses completed/no_show then. */
  canMarkOutcome: boolean
}

/**
 * A confirmed appointment whose start time has passed and that nobody has marked yet: the
 * owner owes it an outcome (انجام شد / عدم حضور). Mirrors the API rule exactly -- completion
 * is refused before startsAt, and both outcomes are refused while the salon isn't approved --
 * so this never lists a booking the owner could not actually act on.
 */
export function needsOutcome(b: TabBooking, ctx: TabContext): boolean {
  return b.status === 'confirmed' && ctx.canMarkOutcome && canMarkCompleted(b.startsAt, ctx.now)
}

function dayOf(b: TabBooking): string {
  return tehranDateString(new Date(b.startsAt))
}

/** The date-based tab only (today / upcoming / past), on the salon's Tehran calendar. */
export function dateTabFor(b: TabBooking, now: Date): Exclude<BookingTab, 'needs-action'> {
  const day = dayOf(b)
  const today = tehranDateString(now)
  if (day === today) return 'today'
  return day > today ? 'upcoming' : 'past'
}

/**
 * The cards a tab lists. «نیاز به اقدام» lists only the outcome-owed cards here: its
 * pending-approval requests render in their own queue above them (with the countdown and the
 * approve/reject controls), never duplicated as a second card.
 */
export function bookingsForTab<T extends TabBooking>(list: T[], tab: BookingTab, ctx: TabContext): T[] {
  if (tab === 'needs-action') return list.filter((b) => needsOutcome(b, ctx))
  return list.filter((b) => dateTabFor(b, ctx.now) === tab)
}

/** Everything waiting on the owner: requests to decide plus appointments to close out. */
export function needsActionCount(list: TabBooking[], ctx: TabContext): number {
  return list.filter((b) => b.status === 'pending_approval' || needsOutcome(b, ctx)).length
}

/** Where a booking the owner just created/touched can be seen. */
export function tabFor(b: TabBooking, ctx: TabContext): BookingTab {
  if (b.status === 'pending_approval' || needsOutcome(b, ctx)) return 'needs-action'
  return dateTabFor(b, ctx.now)
}

/**
 * Landing tab when the URL names none: the first non-empty of needs-action -> today ->
 * upcoming -> past, so the owner opens on the most urgent thing there is rather than on an
 * empty list while work sits in another tab. Nothing at all -> today (its empty state).
 */
export function defaultTab(list: TabBooking[], ctx: TabContext): BookingTab {
  if (needsActionCount(list, ctx) > 0) return 'needs-action'
  for (const tab of ['today', 'upcoming', 'past'] as const) {
    if (list.some((b) => dateTabFor(b, ctx.now) === tab)) return tab
  }
  return 'today'
}

/** Live «mm:ss» under an hour, floored hours + minutes beyond it. Display only -- the deadline is the server's. */
export function formatCountdown(expiresAt: string, now: Date): string {
  const ms = new Date(expiresAt).getTime() - now.getTime()
  if (!Number.isFinite(ms)) return '—'
  if (ms <= 0) return 'منقضی شده'
  const totalSeconds = Math.ceil(ms / 1000)
  if (totalSeconds < 3600) {
    const m = Math.floor(totalSeconds / 60)
    const s = totalSeconds % 60
    const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`.replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!)
    return `${mmss} مانده`
  }
  return `${formatHoursMinutes(ms)} مانده`
}
