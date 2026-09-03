<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect, { type SelectOption } from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import { useVisiblePolling } from '@/composables/useVisiblePolling'
import { toEnglishDigits } from '@/utils/digits'
import { bookingStatusLabel } from '@/utils/labels'
import { formatToman } from '@/utils/format-toman'
import { formatRemainingTime } from '@/utils/remaining-time'
import { tehranDateString } from '@/utils/tehran-date'

interface Booking {
  id: string
  serviceId: string
  serviceName: string
  priceSnapshot: number
  startsAt: string
  endsAt: string
  createdAt: string
  status: string
  // Which workflow this booking was created under, snapshotted server-side -- an
  // in-flight request keeps its own mode even if the salon switches mode afterwards.
  confirmationMode: 'automatic' | 'manual_approval'
  // Backend truth, both of them: the deadline snapshots the API itself enforces. The
  // countdown rendered from approvalExpiresAt is a display convenience only -- no
  // action here is ever gated on a client-side clock.
  approvalExpiresAt: string | null
  paymentExpiresAt: string | null
  workerId: string | null
  workerName: string | null
  // A shadow account created via findOrCreateByPhone (SalonWorkersController's own
  // customer-by-phone idiom, reused for manual bookings) may never get a name -- phone
  // is the one field that's always real, since bookings.user_id always resolves to a
  // genuine users row.
  customerName: string | null
  customerPhone: string
  source: 'online' | 'manual'
}
interface Worker {
  id: string
  name: string
  active: boolean
}
interface Service {
  id: string
  name: string
}

const { apiFetch } = useApi()
const { push: pushToast } = useToast()
const bookings = ref<Booking[]>([])
const workers = ref<Worker[]>([])
const services = ref<Service[]>([])
const loading = ref(true)
const loadError = ref(false)
const submittingId = ref<string | null>(null)

async function fetchBookings(): Promise<boolean> {
  const { data, error } = await apiFetch<Booking[]>('/salons/mine/bookings', { silent: true })
  if (error) return false
  applyBookings(data ?? [])
  return true
}

async function fetchWorkers(): Promise<boolean> {
  const { data, error } = await apiFetch<Worker[]>('/salons/mine/workers', { silent: true })
  if (error) return false
  workers.value = (data ?? []).filter((w) => w.active)
  return true
}

async function fetchServices(): Promise<boolean> {
  const { data, error } = await apiFetch<Service[]>('/salons/mine/services', { silent: true })
  if (error) return false
  services.value = data ?? []
  return true
}

async function loadAll() {
  loading.value = true
  loadError.value = false
  const [bookingsOk, workersOk, servicesOk] = await Promise.all([fetchBookings(), fetchWorkers(), fetchServices()])
  loadError.value = !bookingsOk || !workersOk || !servicesOk
  loading.value = false
}

onMounted(loadAll)

// -- Live refresh -------------------------------------------------------------------
//
// There is no push channel to this panel at all: provider-panel is a plain Vite SPA with
// no service worker, so an owner never becomes a `push_subscriptions` row and every
// owner-directed push resolves to zero subscriptions. There is no socket either. That left
// exactly one channel that reaches an owner about a new manual-approval request -- a single
// SMS -- while this screen, which is where the decision is actually made, fetched once on
// mount and then showed a frozen queue for as long as the tab stayed open. Against a
// default 10-minute approval window that is long enough for a request to arrive, lapse and
// release its slot without ever being rendered. Polling is the fallback that closes it.
//
// 30s is chosen against that 10-minute window: a tick costs at most 5% of the owner's
// decision time, so "arrived" and "on screen" are close enough that the remaining window is
// still worth acting on, at a ceiling of 120 requests/hour per open tab -- and only while
// the tab is visible (see useVisiblePolling). GET /salons/mine/bookings is one already-
// enriched query capped at 1000 rows server-side, so a tick is a single cheap read, not a
// fan-out. Faster buys nothing a human can act on; meaningfully slower starts eating a real
// share of a 10-minute deadline.
//
// No audible cue: this app ships no audio asset and no sound is used anywhere in it, and
// adding one for this would be a new asset plus an autoplay-policy problem, not a one-liner.
const POLL_INTERVAL_MS = 30_000

// Pending-request ids this tab has already shown the owner. Seeded (silently) from the
// first successful load so the queue that was already there on arrival is not announced as
// if it just landed; everything after that is genuinely new. Never pruned -- a request
// cannot return to pending_approval once it leaves, so a re-announcement is impossible, and
// the set is bounded by how many requests one session sees.
const seenPendingIds = new Set<string>()
let arrivalsSeeded = false

// The ids behind the "new" badge. Kept as ids rather than a bare counter so the badge can
// self-correct: a new request that the owner then approves (or that lapses) stops counting
// without anything having to remember to decrement.
const newRequestIds = ref<string[]>([])
const lastSyncAt = ref<Date | null>(null)
// Consecutive failed background refreshes. One failure is a blip; the pill only admits to
// being offline once a second one confirms it, so a single dropped request doesn't flash a
// warning at an owner whose data is in fact 30 seconds old.
const pollFailures = ref(0)
const pollDegraded = computed(() => pollFailures.value >= 2)

function applyBookings(list: Booking[]) {
  bookings.value = list
  lastSyncAt.value = new Date()
  noteArrivals(list)
}

function noteArrivals(list: Booking[]) {
  const pendingIds = list.filter((b) => b.status === 'pending_approval').map((b) => b.id)
  if (!arrivalsSeeded) {
    arrivalsSeeded = true
    for (const id of pendingIds) seenPendingIds.add(id)
    return
  }
  const arrivals = pendingIds.filter((id) => !seenPendingIds.has(id))
  if (arrivals.length === 0) return
  for (const id of arrivals) seenPendingIds.add(id)
  newRequestIds.value = [...newRequestIds.value, ...arrivals]
  // Exactly one toast per refresh however many arrived at once -- three toasts stacked for
  // three requests says nothing the count doesn't, and the badge is the durable signal
  // anyway (a toast the owner was away from the keyboard for is gone in 5 seconds).
  pushToast(
    arrivals.length === 1
      ? 'درخواست نوبت جدیدی دریافت شد'
      : `${arrivals.length.toLocaleString('fa-IR')} درخواست نوبت جدید دریافت شد`,
  )
}

// Only counts requests still actually waiting -- see newRequestIds' own comment.
const newRequestCount = computed(() => pendingRequests.value.filter((b) => newRequestIds.value.includes(b.id)).length)
const isNewRequest = (id: string) => newRequestIds.value.includes(id)

function dismissNewRequests() {
  newRequestIds.value = []
}

// A background read must never land on top of a write the owner just started: approve,
// reject, mark-status and cancel all refetch when they settle, and assignWorker writes its
// response straight onto the row object, which a concurrent whole-list replacement would
// silently discard. This is also why the initial-load error state suppresses polling -- the
// retry button is the explicit recovery path there, and refreshing bookings alone could not
// repair a failed workers/services fetch anyway (worker assignment would stay empty).
function refreshBlocked(): boolean {
  return submittingId.value !== null || manualSubmitting.value || loading.value || loadError.value
}

async function pollBookings() {
  const { data, error } = await apiFetch<Booking[]>('/salons/mine/bookings', { silent: true })
  // Re-checked AFTER the await, not only before the tick: the owner can click approve while
  // this read is already in flight, and applying a list fetched before that write would
  // briefly roll the card back to its pre-click state. Dropping the payload costs nothing --
  // the mutation's own refetch is a strictly fresher read of the same list.
  if (refreshBlocked()) return
  if (error || !data) {
    // Deliberately leaves bookings.value alone and is `silent`, so an outage degrades into
    // "this list is a little stale" (said once, by the pill) rather than into an emptied
    // page or a toast every 30 seconds for as long as the API is down.
    pollFailures.value += 1
    return
  }
  pollFailures.value = 0
  applyBookings(data)
}

useVisiblePolling({ poll: pollBookings, intervalMs: POLL_INTERVAL_MS, shouldSkip: refreshBlocked })

function formatSyncTime(date: Date): string {
  return new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' }).format(date)
}

// Backend returns startsAt DESC (furthest-future first), which buries the next
// imminent booking under farther-future ones -- re-sort ascending so the soonest
// booking always surfaces first.
const sortedBookings = computed(() => [...bookings.value].sort((a, b) => a.startsAt.localeCompare(b.startsAt)))

// -- Manual-approval queue: requests waiting on the owner's decision. --
//
// Deliberately NOT filtered by the day view below and never grouped into the agenda's
// date sections: a request expires on its own deadline (its slot is released and the
// customer told no), so it is time-critical regardless of which day it is for, and
// burying it under a date header the owner isn't currently looking at would let it
// lapse unseen. Requests still appear in the agenda too, where they read as a held slot.
const pendingRequests = computed(() =>
  // Soonest deadline first -- the ordering that matches what will lapse first, not the
  // startsAt ordering the agenda uses. A missing deadline (never expected for a real
  // pending request) sorts last rather than crashing the comparator.
  bookings.value
    .filter((b) => b.status === 'pending_approval')
    .sort((a, b) => (a.approvalExpiresAt ?? '9999').localeCompare(b.approvalExpiresAt ?? '9999')),
)

// Ticks once a minute so the «... مانده» labels stay fresh while the page is open. Same
// interval pattern as StoriesView -- a display refresh only; the deadline itself is the
// backend's, and an expired request is rejected server-side, not hidden by this clock.
const now = ref(new Date())
const remainingTimer = setInterval(() => {
  now.value = new Date()
}, 60_000)
onUnmounted(() => clearInterval(remainingTimer))

const todayCount = computed(
  () => sortedBookings.value.filter((b) => tehranDateString(new Date(b.startsAt)) === tehranDateString(new Date())).length,
)

// The leading empty entry is the old native <option value="">: it is what an unassigned
// booking displays, so it stays a real option rather than a placeholder. Picking it is a
// no-op, exactly as before -- assignWorker ignores an empty value.
const workerOptions = computed<SelectOption[]>(() => [
  { value: '', label: 'بدون تخصیص کارمند' },
  ...workers.value.map((w) => ({ value: w.id, label: w.name })),
])

const serviceOptions = computed<SelectOption[]>(() => services.value.map((s) => ({ value: s.id, label: s.name })))

// Deliberately no leading "بدون تخصیص کارمند" entry here (unlike workerOptions above) --
// this field's own null default already reads as "no worker chosen" via AppSelect's
// placeholder, and a selectable '' value would submit workerId: '' and fail the DTO's
// @IsUUID check (which only skips empty/undefined, not an empty string).
const manualWorkerOptions = computed<SelectOption[]>(() => workers.value.map((w) => ({ value: w.id, label: w.name })))

async function markStatus(id: string, status: 'completed' | 'no_show') {
  submittingId.value = id
  try {
    await apiFetch(`/salons/mine/bookings/${id}`, { method: 'PATCH', body: { status } })
    await fetchBookings()
  } finally {
    submittingId.value = null
  }
}

// -- Approve / reject a manual-approval request --
//
// Both always refetch, success or failure. A request can stop being pending without this
// tab knowing (the approval deadline lapses, the customer cancels, another device decides
// it) and the API answers that with a 409 -- refetching on the error path is what replaces
// the stale card with the state that actually won, instead of leaving a dead "approve"
// button on screen. useApi already toasted the message.
async function approveRequest(id: string) {
  if (submittingId.value) return
  submittingId.value = id
  try {
    await apiFetch(`/salons/mine/bookings/${id}/approve`, { method: 'POST' })
    await fetchBookings()
  } finally {
    submittingId.value = null
  }
}

// Two-step, mirroring SalonStatusActions' reject half: the buttons collapse into a reason
// field, and the reason is mandatory (the API's own RejectBookingDto is 1..300) so it is
// validated here rather than letting a 400 be the owner's first feedback.
const rejectingId = ref<string | null>(null)
const rejectReason = ref('')
const rejectReasonError = ref(false)

function openReject(id: string) {
  rejectingId.value = id
  rejectReason.value = ''
  rejectReasonError.value = false
}

function cancelReject() {
  rejectingId.value = null
  rejectReason.value = ''
  rejectReasonError.value = false
}

async function submitReject(id: string) {
  if (submittingId.value) return
  const reason = rejectReason.value.trim()
  if (!reason) {
    rejectReasonError.value = true
    return
  }
  rejectReasonError.value = false
  submittingId.value = id
  try {
    await apiFetch(`/salons/mine/bookings/${id}/reject`, { method: 'POST', body: { reason } })
    // The panel closes either way: on success the request is gone, and on a lost race the
    // refetched card no longer offers rejecting at all, so a still-open reason box would
    // be pointing at nothing.
    cancelReject()
    await fetchBookings()
  } finally {
    submittingId.value = null
  }
}

async function cancelBooking(id: string) {
  if (!confirm('لغو این نوبت ممکن است مشمول جریمه شود. ادامه می‌دهید؟')) return
  submittingId.value = id
  try {
    await apiFetch(`/bookings/${id}/cancel`, { method: 'POST' })
    await fetchBookings()
  } finally {
    submittingId.value = null
  }
}

// AppSelect emits the chosen option's raw value (or null when cleared), not a DOM event.
async function assignWorker(booking: Booking, workerId: string | number | null) {
  if (!workerId) return
  submittingId.value = booking.id
  try {
    const { data } = await apiFetch<Booking>(`/salons/mine/bookings/${booking.id}/assign-worker`, {
      method: 'PATCH',
      body: { workerId },
    })
    if (data) {
      booking.workerId = data.workerId
      booking.workerName = data.workerName
    }
  } finally {
    submittingId.value = null
  }
}

// Slot instants are real UTC (see availability.util.ts); pin the salon's own timezone rather
// than relying on the browser's, so a provider viewing from another timezone still sees the
// appointment time their salon actually operates on.
function formatBookingTime(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', { timeStyle: 'short', timeZone: 'Asia/Tehran' }).format(new Date(iso))
}

function formatDateLabel(dateStr: string): string {
  return new Intl.DateTimeFormat('fa-IR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Tehran' }).format(
    new Date(`${dateStr}T12:00:00Z`),
  )
}

// Same Tehran pinning as formatBookingTime, with the calendar date included -- a request
// card has to say WHEN it arrived, and «۱۰:۳۰» alone would read as today's.
function formatRequestedAt(iso: string): string {
  // Explicit hour/minute rather than `timeStyle: 'short'`: Intl rejects mixing timeStyle
  // with individual date components in the same options object.
  return new Intl.DateTimeFormat('fa-IR', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tehran',
  }).format(new Date(iso))
}

// endsAt is the booking's own snapshot, not a live re-read of the service's current
// durationMin -- so a service edited after the request was made never misreports how long
// this appointment actually blocks the chair.
function durationLabel(b: Booking): string | null {
  const minutes = Math.round((new Date(b.endsAt).getTime() - new Date(b.startsAt).getTime()) / 60_000)
  // Guarded rather than printed blindly: an unparsable/absent endsAt would otherwise
  // render a literal «NaN دقیقه» on the card.
  return Number.isFinite(minutes) ? `${minutes.toLocaleString('fa-IR')} دقیقه` : null
}

// -- Manual/offline booking: the owner recording a customer who called or walked in --

const manualForm = reactive({
  phone: '',
  name: '',
  serviceId: null as string | null,
  workerId: null as string | null,
  date: '',
  time: '09:00',
  notes: '',
})
const manualFormError = ref('')
const manualSubmitting = ref(false)

async function submitManualBooking() {
  manualFormError.value = ''
  const phone = toEnglishDigits(manualForm.phone.trim())
  if (!phone) {
    manualFormError.value = 'شماره موبایل مشتری الزامی است'
    return
  }
  if (!manualForm.serviceId) {
    manualFormError.value = 'انتخاب خدمت الزامی است'
    return
  }
  if (!manualForm.date || !manualForm.time) {
    manualFormError.value = 'تاریخ و ساعت نوبت الزامی است'
    return
  }

  // Iran's UTC offset is fixed at +03:30 (no DST since 2022) -- an explicit offset turns
  // the owner's picked wall-clock date+time directly into the real instant the server
  // expects, the same instant iranWallClockToInstant would produce for the online flow.
  const startsAt = new Date(`${manualForm.date}T${manualForm.time}:00+03:30`).toISOString()

  manualSubmitting.value = true
  const { data, error } = await apiFetch<Booking>('/salons/mine/bookings', {
    method: 'POST',
    body: {
      phone,
      name: manualForm.name.trim() || undefined,
      serviceId: manualForm.serviceId,
      workerId: manualForm.workerId ?? undefined,
      startsAt,
      notes: manualForm.notes.trim() || undefined,
    },
  })
  manualSubmitting.value = false
  // A rejected submission (e.g. a genuine double-booking conflict) keeps the form filled
  // in -- apiFetch's own toast already explains why, so clearing it here would just make
  // the owner re-enter everything to retry the same booking.
  if (error) return

  if (data) {
    bookings.value.unshift(data)
    // Otherwise a booking created for a different day than the one currently shown in
    // day view would vanish from sight with nothing but a toast to explain why -- jump
    // straight to it so the owner sees the confirmation, not just hears about it.
    if (!showAllBookings.value) selectedDate.value = tehranDateString(new Date(data.startsAt))
  }
  manualForm.phone = ''
  manualForm.name = ''
  manualForm.serviceId = null
  manualForm.workerId = null
  manualForm.date = ''
  manualForm.time = '09:00'
  manualForm.notes = ''
  pushToast('نوبت با موفقیت ثبت شد')
}

// -- Day view: a date-picker + prev/next-day nav over the bookings this page already
// fetches in one call, filtered client-side to the selected Tehran-calendar-day. --

const selectedDate = ref(tehranDateString(new Date()))
// Defaults to the original unfiltered grid -- additive, not a replacement (see this
// component's own history/PRODUCT.md discussion). The day view is a one-click toggle away.
const showAllBookings = ref(true)

function stepDay(delta: number) {
  const [y, m, d] = selectedDate.value.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + delta))
  selectedDate.value = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

function goToToday() {
  selectedDate.value = tehranDateString(new Date())
}

const selectedDateLabel = computed(() => formatDateLabel(selectedDate.value))

const bookingsForSelectedDate = computed(() =>
  sortedBookings.value.filter((b) => tehranDateString(new Date(b.startsAt)) === selectedDate.value),
)

const displayedBookings = computed(() => (showAllBookings.value ? sortedBookings.value : bookingsForSelectedDate.value))

// -- Grouping: "همه نوبت‌ها" reads as a running daily agenda (date headers), not a flat
// unstructured list -- displayedBookings is already ascending by startsAt, so the order
// groups are first pushed in is already the right display order for free. --
interface BookingGroup {
  date: string
  label: string
  isToday: boolean
  bookings: Booking[]
}

const groupedBookings = computed<BookingGroup[]>(() => {
  const order: string[] = []
  const byDate = new Map<string, Booking[]>()
  for (const b of displayedBookings.value) {
    const date = tehranDateString(new Date(b.startsAt))
    if (!byDate.has(date)) {
      byDate.set(date, [])
      order.push(date)
    }
    byDate.get(date)!.push(b)
  }
  const today = tehranDateString(new Date())
  return order.map((date) => ({ date, label: formatDateLabel(date), isToday: date === today, bookings: byDate.get(date)! }))
})
</script>

<template>
  <div class="mx-auto w-full max-w-3xl space-y-6 p-4 lg:p-6">
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h1 class="text-xl font-bold text-(--color-text)">نوبت‌ها</h1>
        <p class="mt-1 text-sm text-(--color-text-muted)">
          {{ todayCount > 0 ? `امروز ${todayCount.toLocaleString('fa-IR')} نوبت دارید` : 'امروز نوبتی ثبت نشده است' }}
        </p>
      </div>
      <!-- The one honest thing a self-refreshing list owes its reader: when it last actually
           heard from the server. Quiet by default, and it is the ONLY place a failed
           background refresh is reported -- no toast fires on a poll, at any tick count. -->
      <p
        v-if="lastSyncAt"
        data-testid="sync-status"
        class="tnum inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
        :class="pollDegraded ? 'bg-(--tone-warning-bg) font-semibold text-(--tone-warning-text)' : 'text-(--color-text-muted)'"
      >
        <AppIcon :name="pollDegraded ? 'warning' : 'hours'" :size="13" class="shrink-0" />
        <span v-if="pollDegraded">اتصال برقرار نیست — آخرین به‌روزرسانی {{ formatSyncTime(lastSyncAt) }}</span>
        <span v-else>به‌روزرسانی خودکار — {{ formatSyncTime(lastSyncAt) }}</span>
      </p>
    </div>

    <AppCard v-if="loadError" class="space-y-3 text-center">
      <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-(--tone-danger-bg) text-(--tone-danger-text)">
        <AppIcon name="warning" :size="22" />
      </div>
      <p class="text-sm text-(--tone-danger-text)">نوبت‌ها بارگذاری نشد.</p>
      <AppButton type="button" variant="secondary" data-testid="retry-bookings" @click="loadAll">
        تلاش دوباره
      </AppButton>
    </AppCard>

    <template v-else>
      <div v-if="loading" class="flex items-center justify-center py-12 text-(--color-text-muted)">
        <AppIcon name="spinner" :size="22" class="animate-spin" />
      </div>

      <template v-else>
        <!-- Manual-approval queue, deliberately the first thing on the page and outside the
             day view entirely: these requests expire on their own deadline, so they must be
             visible no matter which day the agenda below is currently showing. -->
        <section v-if="pendingRequests.length > 0" data-testid="pending-requests" class="space-y-3">
          <div class="flex flex-wrap items-center gap-2 px-1">
            <h2 class="font-bold text-(--color-text)">درخواست‌های در انتظار تایید</h2>
            <StatusBadge :label="`${pendingRequests.length.toLocaleString('fa-IR')} درخواست`" tone="warning" />
            <!-- Survives the toast: a toast is gone in 5 seconds and an owner who stepped
                 away misses it entirely, so the count of what arrived while they weren't
                 looking has to persist until they act on it or dismiss it. role="status"
                 so a screen reader is told too, since the toast is the visual-only half. -->
            <button
              v-if="newRequestCount > 0"
              type="button"
              data-testid="new-requests-badge"
              role="status"
              class="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-(--color-accent-strong) px-3 text-xs font-bold text-(--color-fill-text) transition-transform active:scale-95"
              @click="dismissNewRequests"
            >
              <AppIcon name="plus" :size="12" class="shrink-0" />
              <span class="tnum">{{ newRequestCount.toLocaleString('fa-IR') }} درخواست جدید</span>
            </button>
          </div>
          <!-- The one thing an owner must not misread: nothing has been paid yet. -->
          <p class="px-1 text-xs text-(--color-text-muted)">
            مشتری هنوز پرداختی انجام نداده است؛ پس از تایید شما مهلت پرداخت آغاز می‌شود. اگر تا پایان مهلت تصمیم نگیرید،
            درخواست به‌صورت خودکار منقضی و نوبت آزاد می‌شود.
          </p>

          <!-- ring, not a border-color override: AppCard's root already sets
               border-(--color-border), and two border-color utilities on one element are
               resolved by stylesheet order, not by which one is written last here. -->
          <AppCard
            v-for="b in pendingRequests"
            :key="b.id"
            :data-testid="`pending-request-${b.id}`"
            class="space-y-3 ring-1 ring-(--tone-warning-text)"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="flex min-w-0 items-start gap-3">
                <div class="flex w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-(--tone-warning-bg) py-2 text-(--tone-warning-text)">
                  <span class="tnum text-sm font-bold">{{ formatBookingTime(b.startsAt) }}</span>
                </div>
                <!-- min-w-0 + break-words, same reason as the agenda card below: a long
                     salon-authored service name must wrap inside the card. -->
                <div class="min-w-0 space-y-1">
                  <p class="break-words text-sm font-bold text-(--color-text)">{{ b.serviceName }}</p>
                  <p class="text-xs text-(--color-text-muted)">
                    {{ formatDateLabel(tehranDateString(new Date(b.startsAt))) }}
                    <span v-if="durationLabel(b)" class="tnum"> — {{ durationLabel(b) }}</span>
                  </p>
                  <p class="text-sm text-(--color-text-muted)">
                    {{ b.customerName || 'بدون نام' }}
                    <span v-if="b.customerPhone" dir="ltr" class="tnum"> — {{ b.customerPhone }}</span>
                  </p>
                  <p class="text-xs text-(--color-text-muted)">
                    کارمند:
                    <span class="font-semibold text-(--color-text)">{{ b.workerName || 'تعیین‌نشده' }}</span>
                  </p>
                  <p class="text-xs text-(--color-text-muted)">
                    <span dir="ltr" class="tnum">{{ formatToman(b.priceSnapshot) }}</span> تومان
                    · ثبت درخواست: <span class="tnum">{{ formatRequestedAt(b.createdAt) }}</span>
                  </p>
                </div>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-1.5">
                <!-- Which of several queued requests is the one that just arrived -- the
                     heading badge gives the count, this points at the card. -->
                <StatusBadge v-if="isNewRequest(b.id)" :data-testid="`new-request-${b.id}`" label="جدید" tone="info" />
                <!-- Display only: the real deadline lives on the server (approvalExpiresAt is
                     its snapshot), and an expired request is refused there, not here. -->
                <span
                  v-if="b.approvalExpiresAt"
                  :data-testid="`approval-remaining-${b.id}`"
                  class="tnum inline-flex items-center gap-1.5 rounded-full bg-(--tone-warning-bg) px-2.5 py-1 text-xs font-semibold text-(--tone-warning-text)"
                >
                  <AppIcon name="hours" :size="13" class="shrink-0" />
                  {{ formatRemainingTime(b.approvalExpiresAt, now) }}
                </span>
              </div>
            </div>

            <div v-if="rejectingId === b.id" class="space-y-2 border-t border-(--color-border-soft) pt-3">
              <label :for="`reject-reason-${b.id}`" class="block text-xs font-semibold text-(--color-text-muted)">
                دلیل رد درخواست (برای مشتری ارسال می‌شود)
              </label>
              <textarea
                :id="`reject-reason-${b.id}`"
                v-model="rejectReason"
                data-testid="reject-reason"
                rows="2"
                maxlength="300"
                placeholder="مثلاً در این ساعت ظرفیت نداریم"
                class="w-full rounded-xl border border-(--color-border) bg-(--color-surface-card) p-3 text-sm text-(--color-text)"
              />
              <p v-if="rejectReasonError" data-testid="reject-reason-error" class="text-xs text-(--tone-danger-text)">
                نوشتن دلیل الزامی است.
              </p>
              <div class="flex flex-wrap justify-end gap-2">
                <AppButton
                  data-testid="reject-submit"
                  type="button"
                  variant="danger"
                  size="sm"
                  :disabled="submittingId === b.id"
                  :loading="submittingId === b.id"
                  @click="submitReject(b.id)"
                >
                  ثبت رد درخواست
                </AppButton>
                <AppButton
                  data-testid="reject-cancel"
                  type="button"
                  variant="secondary"
                  size="sm"
                  :disabled="submittingId === b.id"
                  @click="cancelReject"
                >
                  انصراف
                </AppButton>
              </div>
            </div>

            <div v-else class="flex flex-wrap justify-end gap-2 border-t border-(--color-border-soft) pt-3">
              <AppButton
                data-testid="approve-request"
                type="button"
                variant="primary"
                size="sm"
                :disabled="submittingId === b.id"
                :loading="submittingId === b.id"
                @click="approveRequest(b.id)"
              >
                <template #icon><AppIcon name="check" :size="13" /></template>
                تایید درخواست
              </AppButton>
              <AppButton
                data-testid="reject-request"
                type="button"
                variant="danger"
                size="sm"
                :disabled="submittingId === b.id"
                @click="openReject(b.id)"
              >
                <template #icon><AppIcon name="x" :size="13" /></template>
                رد درخواست
              </AppButton>
            </div>
          </AppCard>
        </section>

        <!-- Always-visible, not a modal -- same shape as HoursView.vue's ad-hoc-closures
             form. A compact quick-add panel, not a page-dominating wall of fields. -->
        <AppCard class="space-y-4">
          <div class="flex items-center gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-(--color-accent-soft) text-(--color-accent-text)">
              <AppIcon name="plus" :size="18" />
            </span>
            <div class="min-w-0">
              <h2 class="font-bold text-(--color-text)">ثبت نوبت حضوری/تلفنی</h2>
              <p class="text-xs text-(--color-text-muted)">برای مشتریانی که تلفنی یا حضوری نوبت می‌گیرند</p>
            </div>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <AppInput
              v-model="manualForm.phone"
              label="شماره موبایل مشتری"
              icon="phone"
              type="tel"
              inputmode="tel"
              class="tnum"
              placeholder="09xxxxxxxxx"
              data-testid="manual-booking-phone"
            />
            <AppInput v-model="manualForm.name" label="نام مشتری (اختیاری)" icon="user-circle" data-testid="manual-booking-name" />
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <div>
              <label id="manual-service-label" class="mb-1.5 block text-sm font-medium text-(--color-text)">خدمت</label>
              <AppSelect
                v-model="manualForm.serviceId"
                :options="serviceOptions"
                placeholder="انتخاب خدمت"
                aria-labelledby="manual-service-label"
                data-testid="manual-booking-service"
              />
            </div>

            <div v-if="workers.length > 0">
              <label id="manual-worker-label" class="mb-1.5 block text-sm font-medium text-(--color-text)">کارمند (اختیاری)</label>
              <AppSelect
                v-model="manualForm.workerId"
                :options="manualWorkerOptions"
                aria-labelledby="manual-worker-label"
                data-testid="manual-booking-worker"
              />
            </div>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <div>
              <label class="mb-1.5 block text-sm font-medium text-(--color-text)">تاریخ</label>
              <JalaliDatePicker v-model="manualForm.date" aria-label="تاریخ نوبت" data-testid="manual-booking-date" />
            </div>
            <div>
              <label class="mb-1.5 block text-sm font-medium text-(--color-text)">ساعت</label>
              <input
                v-model="manualForm.time"
                type="time"
                aria-label="ساعت نوبت"
                data-testid="manual-booking-time"
                class="tnum min-h-11 w-full min-w-0 rounded-xl border border-(--color-border) bg-(--color-surface-card) p-2 text-sm"
              />
            </div>
          </div>

          <AppInput v-model="manualForm.notes" label="یادداشت (اختیاری)" icon="pencil" placeholder="مثلاً تماس تلفنی" data-testid="manual-booking-notes" />

          <p v-if="manualFormError" class="flex items-center gap-2 rounded-xl bg-(--tone-danger-bg) p-3 text-sm text-(--tone-danger-text)">
            <AppIcon name="warning" :size="15" class="shrink-0" />
            {{ manualFormError }}
          </p>

          <div class="flex justify-end">
            <AppButton
              type="button"
              class="w-full sm:w-auto sm:min-w-44"
              data-testid="submit-manual-booking"
              :disabled="manualSubmitting"
              :loading="manualSubmitting"
              @click="submitManualBooking"
            >
              <template #icon><AppIcon name="plus" :size="16" /></template>
              ثبت نوبت
            </AppButton>
          </div>
        </AppCard>

        <!-- Day view: filters the same single fetch above to one Tehran-calendar-day.
             The segmented control drives the exact same boolean as before (a real
             checkbox under the hood, styled as two tabs) -- "همه نوبت‌ها" switches back
             to the full agenda, grouped by date. Additive: existing behavior untouched. -->
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div v-if="!showAllBookings" class="flex min-w-0 flex-wrap items-center gap-1.5">
            <!-- RTL flex places the FIRST DOM child at the physical right edge -- so
                 prev-day (rightmost) points further right (rotated) and next-day (to its
                 left) points further left (unrotated), each chevron pointing away from the
                 date picker toward its own side, not toward it. -->
            <AppButton type="button" variant="ghost" aria-label="روز قبل" data-testid="prev-day" @click="stepDay(-1)">
              <AppIcon name="chevron-left" :size="16" class="rotate-180" />
            </AppButton>
            <div class="w-40 shrink-0">
              <JalaliDatePicker v-model="selectedDate" aria-label="انتخاب روز" data-testid="day-picker" />
            </div>
            <AppButton type="button" variant="ghost" aria-label="روز بعد" data-testid="next-day" @click="stepDay(1)">
              <AppIcon name="chevron-left" :size="16" />
            </AppButton>
            <AppButton type="button" variant="ghost" data-testid="jump-today" @click="goToToday">امروز</AppButton>
          </div>
          <p v-else class="text-sm font-semibold text-(--color-text)">فهرست همه نوبت‌ها</p>

          <label class="inline-flex shrink-0 cursor-pointer overflow-hidden rounded-xl border border-(--color-border) bg-(--color-surface-card) text-sm font-medium">
            <input v-model="showAllBookings" type="checkbox" data-testid="toggle-show-all" class="sr-only" />
            <span class="min-h-11 px-3.5 py-2.5 leading-6 transition-colors" :class="showAllBookings ? 'bg-(--color-accent-strong) text-(--color-fill-text)' : 'text-(--color-text-muted)'">
              همه نوبت‌ها
            </span>
            <span class="min-h-11 px-3.5 py-2.5 leading-6 transition-colors" :class="!showAllBookings ? 'bg-(--color-accent-strong) text-(--color-fill-text)' : 'text-(--color-text-muted)'">
              یک روز
            </span>
          </label>
        </div>
        <p v-if="!showAllBookings" class="text-sm font-semibold text-(--color-text)">{{ selectedDateLabel }}</p>

        <EmptyState
          v-if="displayedBookings.length === 0"
          icon="bookings"
          :message="showAllBookings ? 'هنوز نوبتی ثبت نشده است.' : 'نوبتی برای این روز ثبت نشده است.'"
        />

        <!-- A daily agenda, not a card grid -- grouped by Tehran-calendar-date so "همه
             نوبت‌ها" reads as a schedule, and every row shares one predictable width
             (no per-column auto-fit sizing, the source of the previous layout's uneven,
             floating cards). -->
        <div v-else class="space-y-6">
          <div v-for="group in groupedBookings" :key="group.date" class="space-y-3">
            <div v-if="showAllBookings" class="flex items-center gap-2 px-1">
              <h3 class="text-sm font-bold text-(--color-text)">{{ group.label }}</h3>
              <StatusBadge v-if="group.isToday" label="امروز" tone="info" />
              <span class="tnum text-xs text-(--color-text-muted)">({{ group.bookings.length.toLocaleString('fa-IR') }})</span>
            </div>

            <AppCard v-for="b in group.bookings" :key="b.id" :data-testid="`booking-${b.id}`" class="space-y-3">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="flex min-w-0 items-start gap-3">
                  <div class="flex w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-(--color-surface-subtle) py-2 text-(--color-text)">
                    <span class="tnum text-sm font-bold">{{ formatBookingTime(b.startsAt) }}</span>
                  </div>
                  <!-- min-w-0 + break-words: a long salon-authored service name must wrap
                       inside the card, never push the badges out of it. -->
                  <div class="min-w-0 space-y-1">
                    <p class="break-words text-sm font-bold text-(--color-text)">{{ b.serviceName }}</p>
                    <p class="text-sm text-(--color-text-muted)">
                      {{ b.customerName || 'بدون نام' }}
                      <span v-if="b.customerPhone" dir="ltr" class="tnum"> — {{ b.customerPhone }}</span>
                    </p>
                    <p class="text-xs text-(--color-text-muted)"><span dir="ltr" class="tnum">{{ formatToman(b.priceSnapshot) }}</span> تومان</p>
                  </div>
                </div>
                <div class="flex shrink-0 flex-col items-end gap-1.5">
                  <StatusBadge :label="bookingStatusLabel(b.status).label" :tone="bookingStatusLabel(b.status).tone" />
                  <StatusBadge v-if="b.source === 'manual'" label="ثبت دستی" tone="neutral" />
                </div>
              </div>

              <div v-if="b.status === 'confirmed' && workers.length > 0" class="border-t border-(--color-border-soft) pt-3">
                <!-- AppSelect's root is vue-multiselect's role="combobox" div, not a labelable
                     native control, so <label for> can no longer reach it; aria-labelledby is
                     the right ARIA association and falls through onto that root div. -->
                <label :id="`worker-select-${b.id}`" class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">تخصیص کارمند</label>
                <AppSelect
                  :model-value="b.workerId ?? ''"
                  :options="workerOptions"
                  :disabled="submittingId === b.id"
                  :aria-labelledby="`worker-select-${b.id}`"
                  data-testid="assign-worker"
                  @update:model-value="assignWorker(b, $event)"
                />
              </div>
              <p v-else-if="b.workerName" class="border-t border-(--color-border-soft) pt-3 text-sm text-(--color-text-muted)">
                کارمند: <span class="font-semibold text-(--color-text)">{{ b.workerName }}</span>
              </p>

              <div v-if="b.status === 'confirmed'" class="flex flex-wrap justify-end gap-2 border-t border-(--color-border-soft) pt-3">
                <AppButton
                  data-testid="mark-completed"
                  type="button"
                  variant="secondary"
                  size="sm"
                  :disabled="submittingId === b.id"
                  :loading="submittingId === b.id"
                  @click="markStatus(b.id, 'completed')"
                >
                  <template #icon><AppIcon name="check" :size="13" /></template>
                  انجام شد
                </AppButton>
                <AppButton
                  data-testid="mark-no-show"
                  type="button"
                  variant="secondary"
                  size="sm"
                  :disabled="submittingId === b.id"
                  :loading="submittingId === b.id"
                  @click="markStatus(b.id, 'no_show')"
                >
                  <template #icon><AppIcon name="x" :size="13" /></template>
                  عدم حضور
                </AppButton>
                <AppButton
                  data-testid="cancel-booking"
                  type="button"
                  variant="danger"
                  size="sm"
                  :disabled="submittingId === b.id"
                  :loading="submittingId === b.id"
                  @click="cancelBooking(b.id)"
                >
                  لغو
                </AppButton>
              </div>
              <!-- Sibling branch of the confirmed-only actions above, deliberately a pointer
                   rather than a second pair of approve/reject buttons: the decision belongs to
                   the queue at the top of the page (the one place that never hides behind the
                   day filter), and duplicating it here would mean two controls, one busy-lock
                   and two ways to lose the same race. -->
              <p
                v-else-if="b.status === 'pending_approval'"
                data-testid="agenda-pending-hint"
                class="border-t border-(--color-border-soft) pt-3 text-xs text-(--color-text-muted)"
              >
                این نوبت هنوز پرداخت نشده و در بخش «درخواست‌های در انتظار تایید» بالای صفحه بررسی می‌شود.
              </p>
            </AppCard>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
