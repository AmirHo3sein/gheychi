<!-- apps/provider-panel/src/components/booking/BookingSchedule.vue -->
<!-- The day/week time grid on BookingsView. Purely presentational: BookingsView fetches the
     visible window (GET /salons/mine/bookings?from&to) and owns every action; a block here is
     only a button that says "show me this booking's card". Day view splits into one column
     per worker when the salon has any (plus «بدون کارمند» for unassigned appointments);
     week view is one column per day. Cancelled/rejected/expired bookings no longer hold the
     chair, so they are left off the grid (and counted in a note) rather than drawn as if they
     still occupied time. -->
<script setup lang="ts">
import { computed } from 'vue'
import { bookingStatusLabel } from '@/utils/labels'
import { gridBounds, minutesIntoDay, placeIntervals, type ScheduleMode } from '@/utils/booking-schedule'
import { formatNumber, toPersianDigits } from '@/utils/digits'
import { tehranDateString } from '@/utils/tehran-date'

export interface ScheduleBooking {
  id: string
  serviceName: string
  startsAt: string
  endsAt: string
  status: string
  workerId: string | null
  workerName: string | null
  customerName: string | null
}

const props = defineProps<{
  mode: ScheduleMode
  days: string[]
  bookings: ScheduleBooking[]
  /** Visible days the salon is closed on (from GET /salons/mine/capacity), keyed by day. */
  closedDays?: Record<string, 'no_hours' | 'closed_exception'>
  workers: Array<{ id: string; name: string }>
  now: Date
  selectedId?: string | null
}>()
const emit = defineEmits<{ select: [id: string] }>()

// Statuses that sit on the chair (or did): what the grid draws.
const SHOWN = new Set(['pending_approval', 'pending_payment', 'confirmed', 'completed', 'no_show'])
const PX_PER_MIN = 1.1
const MIN_BLOCK_PX = 26

function dayOf(b: ScheduleBooking): string {
  return tehranDateString(new Date(b.startsAt))
}

// Only what starts on a visible day -- the window read already guarantees that, but the grid
// must not depend on it (a wider list passed in would otherwise inflate the hidden count).
const inView = computed(() => {
  const days = new Set(props.days)
  return props.bookings.filter((b) => days.has(dayOf(b)))
})
const shown = computed(() => inView.value.filter((b) => SHOWN.has(b.status)))
const hiddenCount = computed(() => inView.value.length - shown.value.length)

function span(b: ScheduleBooking, day: string): { start: number; end: number } {
  const start = minutesIntoDay(b.startsAt, day)
  const rawEnd = minutesIntoDay(b.endsAt, day)
  // A missing/unparsable endsAt still gets a visible block rather than vanishing.
  const end = Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : start + 30
  return { start, end: Math.min(end, 24 * 60) }
}

interface Column {
  key: string
  label: string
  day: string
  items: ScheduleBooking[]
}

const columns = computed<Column[]>(() => {
  if (props.mode === 'week') {
    return props.days.map((day) => ({ key: day, label: day, day, items: shown.value.filter((b) => dayOf(b) === day) }))
  }
  const day = props.days[0]!
  const items = shown.value.filter((b) => dayOf(b) === day)
  if (props.workers.length === 0) return [{ key: 'all', label: '', day, items }]
  const cols: Column[] = props.workers.map((w) => ({ key: w.id, label: w.name, day, items: items.filter((b) => b.workerId === w.id) }))
  // A booking still assigned to a since-deactivated worker keeps a column of its own --
  // silently folding it elsewhere would misreport who holds that chair.
  const known = new Set(props.workers.map((w) => w.id))
  for (const b of items) {
    if (b.workerId && !known.has(b.workerId)) {
      known.add(b.workerId)
      cols.push({ key: b.workerId, label: b.workerName || 'کارمند غیرفعال', day, items: items.filter((x) => x.workerId === b.workerId) })
    }
  }
  cols.push({ key: 'unassigned', label: 'بدون کارمند', day, items: items.filter((b) => !b.workerId) })
  return cols
})

const bounds = computed(() =>
  gridBounds(columns.value.flatMap((c) => c.items.map((b) => span(b, c.day)))),
)
const heightPx = computed(() => (bounds.value.end - bounds.value.start) * PX_PER_MIN)
const hours = computed(() => {
  const out: number[] = []
  for (let m = bounds.value.start; m < bounds.value.end; m += 60) out.push(m)
  return out
})

const todayKey = computed(() => tehranDateString(props.now))
const nowTop = computed(() => {
  const m = minutesIntoDay(props.now.toISOString(), todayKey.value)
  if (m < bounds.value.start || m > bounds.value.end) return null
  return (m - bounds.value.start) * PX_PER_MIN
})

function placed(col: Column) {
  const byId = new Map(col.items.map((b) => [b.id, b]))
  return placeIntervals(col.items.map((b) => ({ id: b.id, ...span(b, col.day) }))).map((p) => ({ ...p, booking: byId.get(p.id)! }))
}

const STATUS_CLASSES: Record<string, string> = {
  confirmed: 'border-(--color-accent-text) bg-(--color-accent-soft)',
  pending_approval: 'border-dashed border-(--tone-warning-text) bg-(--tone-warning-bg)',
  pending_payment: 'border-(--tone-warning-text) bg-(--tone-warning-bg)',
  completed: 'border-(--tone-success-text) bg-(--tone-success-bg)',
  no_show: 'border-(--tone-danger-text) bg-(--tone-danger-bg)',
}

// Same format as the booking cards beside the grid (BookingsView's formatBookingTime):
// zero-padded 24h, «۰۹:۰۰».
const timeFmt = new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Tehran' })
const dayFmt = new Intl.DateTimeFormat('fa-IR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Tehran' })

function hourLabel(minutes: number): string {
  return `${toPersianDigits(String(Math.floor(minutes / 60)).padStart(2, '0'))}:۰۰`
}

const CLOSED_LABELS: Record<string, string> = {
  no_hours: 'ساعت کاری ثبت نشده',
  closed_exception: 'روز تعطیل ثبت‌شده',
}
function closedReason(day: string): string | null {
  const r = props.closedDays?.[day]
  return r ? (CLOSED_LABELS[r] ?? 'تعطیل') : null
}
// Quiet diagonal hatching: reads as "not available" without competing with booking blocks.
const CLOSED_STRIPES = {
  backgroundImage: 'repeating-linear-gradient(135deg, var(--color-border-soft) 0 1px, transparent 1px 10px)',
}
// Day view: every column is the same day, so the closure is said once above the grid.
const dayClosed = computed(() => (props.mode === 'day' ? closedReason(props.days[0]!) : null))
function dayLabel(day: string): string {
  return dayFmt.format(new Date(`${day}T12:00:00Z`))
}
function blockLabel(b: ScheduleBooking): string {
  const parts = [timeFmt.format(new Date(b.startsAt)), b.serviceName, b.customerName || 'بدون نام', bookingStatusLabel(b.status).label]
  if (props.mode === 'week' && b.workerName) parts.push(`کارمند: ${b.workerName}`)
  return parts.join(' — ')
}

const minWidth = computed(() => `${56 + columns.value.length * (props.mode === 'week' ? 112 : 150)}px`)
const showHeader = computed(() => props.mode === 'week' || props.workers.length > 0)
</script>

<template>
  <div class="space-y-2">
    <p
      v-if="dayClosed"
      data-testid="schedule-closed-day"
      class="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl border border-dashed border-(--color-border) bg-(--color-surface-subtle) px-3 py-2 text-sm"
    >
      <span class="font-bold text-(--color-text)">سالن در این روز تعطیل است</span>
      <span class="text-xs text-(--color-text-muted)">({{ dayClosed }})</span>
    </p>
    <!-- Scrolls inside itself, never the page: a 4-worker day or a full week is wider than a phone. -->
    <div class="overflow-x-auto rounded-2xl border border-(--color-border) bg-(--color-surface-card)" data-testid="schedule-grid">
      <div class="flex" :style="{ minWidth }">
        <!-- Time gutter: the first flex child sits at the right edge in RTL. -->
        <div class="w-14 shrink-0 border-e border-(--color-border-soft)">
          <div v-if="showHeader" class="h-12 border-b border-(--color-border-soft)" />
          <div class="relative" :style="{ height: `${heightPx}px` }" aria-hidden="true">
            <span
              v-for="m in hours"
              :key="m"
              class="tnum absolute inset-x-0 -translate-y-1/2 px-1 text-center text-[11px] text-(--color-text-muted) first:translate-y-0"
              :style="{ top: `${(m - bounds.start) * PX_PER_MIN}px` }"
            >{{ hourLabel(m) }}</span>
          </div>
        </div>

        <div
          v-for="col in columns"
          :key="col.key"
          class="min-w-0 flex-1 border-e border-(--color-border-soft) last:border-e-0"
          :data-testid="`schedule-col-${col.key}`"
        >
          <div
            v-if="showHeader"
            class="flex h-12 flex-col items-center justify-center border-b border-(--color-border-soft) px-1 text-center"
            :class="mode === 'week' && col.day === todayKey ? 'bg-(--color-accent-soft)' : closedReason(col.day) ? 'bg-(--color-surface-subtle)' : ''"
          >
            <template v-if="mode === 'week'">
              <span class="text-xs font-bold" :class="closedReason(col.day) ? 'text-(--color-text-muted)' : 'text-(--color-text)'">{{ dayLabel(col.day) }}</span>
              <span v-if="col.day === todayKey" class="text-[11px] font-semibold text-(--color-accent-text)">امروز</span>
              <span v-else-if="closedReason(col.day)" class="text-[11px] font-semibold text-(--color-text-muted)">تعطیل</span>
              <span v-else class="tnum text-[11px] text-(--color-text-muted)">{{ formatNumber(col.items.length) }} نوبت</span>
            </template>
            <template v-else>
              <span class="line-clamp-1 text-xs font-bold text-(--color-text)">{{ col.label }}</span>
              <span class="tnum text-[11px] text-(--color-text-muted)">{{ formatNumber(col.items.length) }} نوبت</span>
            </template>
          </div>

          <div
            class="relative"
            :class="closedReason(col.day) ? 'bg-(--color-surface-subtle)' : ''"
            :style="{ height: `${heightPx}px`, ...(closedReason(col.day) ? CLOSED_STRIPES : {}) }"
            :data-closed="closedReason(col.day) ? 'true' : undefined"
          >
            <span
              v-if="closedReason(col.day)"
              :data-testid="`schedule-closed-${col.day}`"
              :title="closedReason(col.day)!"
              class="pointer-events-none absolute inset-x-1 top-2 z-[5] rounded-md bg-(--color-surface-card) px-1 py-0.5 text-center text-[11px] font-bold text-(--color-text-muted) shadow-(--shadow-sm)"
            >تعطیل</span>
            <div
              v-for="m in hours"
              :key="m"
              class="absolute inset-x-0 border-t border-(--color-border-soft)"
              :style="{ top: `${(m - bounds.start) * PX_PER_MIN}px` }"
              aria-hidden="true"
            />
            <div
              v-if="col.day === todayKey && nowTop !== null"
              data-testid="schedule-now"
              class="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-(--color-danger)"
              :style="{ top: `${nowTop}px` }"
              aria-hidden="true"
            />
            <button
              v-for="p in placed(col)"
              :key="p.id"
              type="button"
              :data-testid="`schedule-block-${p.id}`"
              :aria-label="blockLabel(p.booking)"
              :aria-pressed="selectedId === p.id"
              class="absolute overflow-hidden rounded-lg border border-s-4 px-1.5 py-1 text-start text-[11px] leading-4 text-(--color-text) transition-shadow duration-150 hover:shadow-(--shadow-md) focus-visible:z-20"
              :class="[STATUS_CLASSES[p.booking.status] ?? 'border-(--color-border) bg-(--color-surface-subtle)', selectedId === p.id ? 'z-20 ring-2 ring-(--color-accent-text)' : '']"
              :style="{
                top: `${(p.start - bounds.start) * PX_PER_MIN + 1}px`,
                height: `${Math.max((p.end - p.start) * PX_PER_MIN - 2, MIN_BLOCK_PX)}px`,
                insetInlineStart: `calc(${(p.lane / p.lanes) * 100}% + 2px)`,
                width: `calc(${100 / p.lanes}% - 4px)`,
              }"
              @click="emit('select', p.id)"
            >
              <!-- A short appointment gets one line (time · service) instead of three clipped ones. -->
              <span v-if="(p.end - p.start) * PX_PER_MIN < 52" class="block truncate">
                <span class="tnum font-bold">{{ timeFmt.format(new Date(p.booking.startsAt)) }}</span>
                · <span class="font-semibold">{{ p.booking.serviceName }}</span>
              </span>
              <template v-else>
                <span class="tnum block font-bold">{{ timeFmt.format(new Date(p.booking.startsAt)) }}</span>
                <span class="block truncate font-semibold">{{ p.booking.serviceName }}</span>
                <span class="block truncate text-(--color-text-muted)">{{ p.booking.customerName || 'بدون نام' }}</span>
              </template>
            </button>
          </div>
        </div>
      </div>
    </div>

    <ul class="flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-(--color-text-muted)" aria-label="راهنمای رنگ‌ها">
      <li class="inline-flex items-center gap-1.5"><span class="h-3 w-3 rounded-sm border border-s-4 border-(--color-accent-text) bg-(--color-accent-soft)" />تایید شده</li>
      <li class="inline-flex items-center gap-1.5"><span class="h-3 w-3 rounded-sm border border-dashed border-(--tone-warning-text) bg-(--tone-warning-bg)" />در انتظار تایید یا پرداخت</li>
      <li class="inline-flex items-center gap-1.5"><span class="h-3 w-3 rounded-sm border border-(--tone-success-text) bg-(--tone-success-bg)" />انجام شد</li>
      <li class="inline-flex items-center gap-1.5"><span class="h-3 w-3 rounded-sm border border-(--tone-danger-text) bg-(--tone-danger-bg)" />عدم حضور</li>
    </ul>
    <p v-if="hiddenCount > 0" data-testid="schedule-hidden-note" class="px-1 text-xs text-(--color-text-muted)">
      {{ formatNumber(hiddenCount) }} نوبت لغوشده، ردشده یا منقضی در این بازه هست که زمانی را اشغال نمی‌کند و در جدول نمایش داده نمی‌شود.
    </p>
  </div>
</template>
