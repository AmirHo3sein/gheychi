<!-- apps/provider-panel/src/pages/DashboardView.vue -->
<!-- Previously this screen showed today's bookings, next-up bookings, and quick links, and
     nothing else -- a salon owner had no way to see how their business was doing without
     exporting nothing and counting by hand. It now leads with a real, period-selectable
     performance summary from GET /salons/mine/dashboard-summary, every figure compared
     against the immediately-preceding period of the same length, plus this salon's own
     slice of the booking funnel from GET /salons/mine/funnel.

     Order (one clear hierarchy): what needs the owner now (pending requests), today's
     schedule and next up, then the free chair-time ahead (GET /salons/mine/capacity), then
     the period performance. The old quick-link tile grid is gone -- the sidebar (lg+) and the
     «بیشتر» page (phones) now reach every screen, so it only duplicated navigation. -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import MetricCard from '@/components/dashboard/MetricCard.vue'
import RankedListCard from '@/components/dashboard/RankedListCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import CapacityCard from '@/components/dashboard/CapacityCard.vue'
import DonutChart, { type DonutSegment } from '@/components/dashboard/charts/DonutChart.vue'
import HeatmapChart, { type HeatCell } from '@/components/dashboard/charts/HeatmapChart.vue'
import TrendChart, { type TrendPoint } from '@/components/dashboard/charts/TrendChart.vue'
import { useApi } from '@/composables/useApi'
import { useFeatureFlags } from '@/composables/useFeatureFlags'
import { readSalonBookings, usePendingApprovalCount } from '@/composables/usePendingApprovals'
import { formatNumber } from '@/utils/digits'
import { formatToman } from '@/utils/format-toman'
import { tehranNoon } from '@/utils/chart'
import { tehranDateString } from '@/utils/tehran-date'
import { endOfTehranDayIso, startOfTehranDayIso } from '@/utils/tehran-day'

interface Booking {
  id: string
  serviceId: string
  startsAt: string
  status: string
  customerName?: string | null
  workerName?: string | null
}
interface Service {
  id: string
  name: string
}

interface PeriodMetrics {
  bookingsCount: number
  grossBookingValue: number
  onlineCollected: number
  commission: number
  estimatedSalonRevenue: number
  distinctCustomers: number
  newCustomers: number
  returningCustomers: number
  completedCount: number
  cancelledCount: number
  noShowCount: number
  averageBookingValue: number
  repeatRatePercent: number
}
interface DashboardSummary extends PeriodMetrics {
  from: string
  to: string
  previous: PeriodMetrics
  topServices: Array<{ serviceId: string; name: string | null; bookingsCount: number; grossValue: number }>
  topWorkers: Array<{ workerId: string; name: string | null; bookingsCount: number }>
  busiestWeekday: number | null
  busiestHour: number | null
  // Optional: an API that predates the chart series simply renders no charts for them.
  daily?: DailyPoint[]
  previousDaily?: DailyPoint[]
  heatmap?: HeatCell[]
}
interface DailyPoint {
  date: string
  bookingsCount: number
  completedCount: number
  cancelledCount: number
  grossBookingValue: number
}
interface Funnel {
  stages: Array<{ stage: string; count: number; conversionFromPreviousPercent: number | null }>
}

const { apiFetch } = useApi()
const { flags } = useFeatureFlags()
const pendingCount = usePendingApprovalCount()
const bookings = ref<Booking[]>([])
const services = ref<Service[]>([])
const loading = ref(true)
const loadError = ref(false)

const summary = ref<DashboardSummary | null>(null)
const funnel = ref<Funnel | null>(null)
const metricsLoading = ref(true)
// Its own error flag, not the shared one: the bookings list is the screen's core job and
// must still render if the analytics endpoints are down (and vice versa).
const metricsError = ref(false)

const PERIODS = [
  { days: 7, label: '۷ روز' },
  { days: 30, label: '۳۰ روز' },
  { days: 90, label: '۹۰ روز' },
]
const periodDays = ref(30)

async function load() {
  loading.value = true
  loadError.value = false

  const [bookingsRes, servicesRes] = await Promise.all([
    // Shared with the layout's mount-time pending-approval poll, which reads the same list
    // at the same moment -- one request instead of two.
    readSalonBookings<Booking>(apiFetch),
    apiFetch<Service[]>('/salons/mine/services', { silent: true }),
  ])

  if (bookingsRes.error || servicesRes.error) {
    loadError.value = true
    loading.value = false
    return
  }

  bookings.value = bookingsRes.data ?? []
  services.value = servicesRes.data ?? []
  loading.value = false
}

async function loadMetrics() {
  metricsLoading.value = true
  metricsError.value = false

  // One explicit range shared by both requests, computed here rather than relying on each
  // endpoint's own default -- otherwise the summary and the funnel could cover windows that
  // differ by however long the first request took, and the two cards would quietly disagree.
  const to = new Date()
  const from = new Date(to.getTime() - periodDays.value * 86_400_000)
  const range = `from=${from.toISOString()}&to=${to.toISOString()}`

  const [summaryRes, funnelRes] = await Promise.all([
    apiFetch<DashboardSummary>(`/salons/mine/dashboard-summary?${range}`, { silent: true }),
    apiFetch<Funnel>(`/salons/mine/funnel?${range}`, { silent: true }),
  ])

  if (summaryRes.error) {
    metricsError.value = true
    metricsLoading.value = false
    return
  }
  summary.value = summaryRes.data
  funnel.value = funnelRes.data
  metricsLoading.value = false
}

function selectPeriod(days: number) {
  if (days === periodDays.value) return
  periodDays.value = days
  void loadMetrics()
}

onMounted(() => {
  void load()
  void loadMetrics()
})

function serviceName(id: string) {
  return services.value.find((s) => s.id === id)?.name ?? '—'
}

// "Today" is the salon's Tehran day, not the viewing browser's -- the same day boundaries
// BookingsView groups by and the API's schedule uses. Previously this compared
// `toDateString()` in the browser's zone, so an owner whose device was set to another zone
// (a VPN, a trip) saw a different "today" here than on the bookings screen.
const now = new Date()
const todayKey = tehranDateString(now)
const todayStart = Date.parse(startOfTehranDayIso(todayKey))
const todayEnd = Date.parse(endOfTehranDayIso(todayKey))
const todayLabel = new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', weekday: 'long', day: 'numeric', month: 'long' }).format(now)

function isToday(iso: string): boolean {
  const t = Date.parse(iso)
  return t >= todayStart && t <= todayEnd
}

const todaysBookings = computed(() =>
  bookings.value
    .filter((b) => b.status === 'confirmed' && isToday(b.startsAt))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
)

const upcomingBookings = computed(() =>
  bookings.value
    .filter((b) => b.status === 'confirmed' && Date.parse(b.startsAt) > todayEnd)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 5),
)

/**
 * Percentage change against the previous period. `null` when the previous period had
 * nothing at all -- "+∞%" is meaningless and "0%" would be a lie, so the tile says the
 * previous period has no data instead.
 */
function delta(current: number, previous: number): number | null {
  if (previous === 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

interface Tile {
  key: string
  spark?: number[]
  label: string
  value: string
  hint?: string
  deltaPercent: number | null
  /** false for figures where "down" is the good direction (cancellations, no-shows). */
  higherIsBetter: boolean
}

const tiles = computed<Tile[]>(() => {
  const s = summary.value
  if (!s) return []
  const p = s.previous
  return [
    {
      key: 'customers',
      label: 'مشتریان',
      value: s.distinctCustomers.toLocaleString('fa-IR'),
      hint: `${s.newCustomers.toLocaleString('fa-IR')} جدید · ${s.returningCustomers.toLocaleString('fa-IR')} بازگشتی`,
      deltaPercent: delta(s.distinctCustomers, p.distinctCustomers),
      higherIsBetter: true,
    },
    {
      key: 'bookings',
      label: 'نوبت‌ها',
      value: s.bookingsCount.toLocaleString('fa-IR'),
      hint: `${s.completedCount.toLocaleString('fa-IR')} انجام‌شده`,
      deltaPercent: delta(s.bookingsCount, p.bookingsCount),
      higherIsBetter: true,
      spark: daily.value.map((d) => d.bookingsCount),
    },
    {
      key: 'gross',
      label: 'ارزش ناخالص نوبت‌ها',
      value: `${formatToman(s.grossBookingValue)} تومان`,
      hint: 'قیمت کامل خدمات، نه فقط بیعانهٔ آنلاین',
      deltaPercent: delta(s.grossBookingValue, p.grossBookingValue),
      higherIsBetter: true,
      spark: daily.value.map((d) => d.grossBookingValue),
    },
    {
      key: 'average',
      label: 'میانگین ارزش هر نوبت',
      value: `${formatToman(s.averageBookingValue)} تومان`,
      deltaPercent: delta(s.averageBookingValue, p.averageBookingValue),
      higherIsBetter: true,
    },
    {
      key: 'repeat',
      label: 'نرخ بازگشت مشتری',
      value: `${s.repeatRatePercent.toLocaleString('fa-IR')}٪`,
      hint: 'سهم مشتریانی که قبلاً هم نوبت گرفته بودند',
      deltaPercent: delta(s.repeatRatePercent, p.repeatRatePercent),
      higherIsBetter: true,
    },
    {
      key: 'cancelled',
      label: 'لغوشده',
      value: s.cancelledCount.toLocaleString('fa-IR'),
      deltaPercent: delta(s.cancelledCount, p.cancelledCount),
      higherIsBetter: false,
      spark: daily.value.map((d) => d.cancelledCount),
    },
    {
      key: 'no-show',
      label: 'عدم حضور',
      value: s.noShowCount.toLocaleString('fa-IR'),
      deltaPercent: delta(s.noShowCount, p.noShowCount),
      higherIsBetter: false,
    },
    {
      key: 'deposit',
      label: 'بیعانهٔ آنلاین دریافتی',
      value: `${formatToman(s.onlineCollected)} تومان`,
      hint: 'مبلغ نقدی دریافتی در سالن در این رقم نیست',
      deltaPercent: delta(s.onlineCollected, p.onlineCollected),
      higherIsBetter: true,
    },
  ]
})

// ---- charts ----------------------------------------------------------------------------
const daily = computed<DailyPoint[]>(() => summary.value?.daily ?? [])

type TrendMetric = 'bookings' | 'gross'
const TREND_METRICS: Array<{ key: TrendMetric; label: string }> = [
  { key: 'bookings', label: 'نوبت‌ها' },
  { key: 'gross', label: 'ارزش نوبت‌ها' },
]
const trendMetric = ref<TrendMetric>('bookings')
const axisDayFmt = new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', day: 'numeric', month: 'short' })
const longDayFmt = new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', weekday: 'long', day: 'numeric', month: 'long' })

function trendValue(d: DailyPoint): number {
  return trendMetric.value === 'bookings' ? d.bookingsCount : d.grossBookingValue
}
const trendPoints = computed<TrendPoint[]>(() =>
  daily.value.map((d) => {
    const at = tehranNoon(d.date)
    return { key: d.date, label: axisDayFmt.format(at), longLabel: longDayFmt.format(at), value: trendValue(d) }
  }),
)
const trendPrevious = computed(() => (summary.value?.previousDaily ?? []).map(trendValue))
function formatTrendValue(v: number): string {
  return trendMetric.value === 'bookings' ? `${formatNumber(v)} نوبت` : `${formatToman(v)} تومان`
}

// Every booking created in the window, by where it ended up. `bookingsCount` is confirmed +
// completed, so "upcoming" is the confirmed remainder; cancellations and no-shows are counted
// separately by the API. Rejected/expired requests never became bookings and are not here.
const outcomeSegments = computed<DonutSegment[]>(() => {
  const s = summary.value
  if (!s) return []
  return [
    { key: 'completed', label: 'انجام‌شده', value: s.completedCount, color: 'var(--chart-completed)' },
    { key: 'upcoming', label: 'تأییدشده (پیش‌رو)', value: Math.max(0, s.bookingsCount - s.completedCount), color: 'var(--chart-upcoming)' },
    { key: 'cancelled', label: 'لغوشده', value: s.cancelledCount, color: 'var(--chart-cancelled)' },
    { key: 'no-show', label: 'عدم حضور', value: s.noShowCount, color: 'var(--chart-no-show)' },
  ]
})
const outcomeTotal = computed(() => outcomeSegments.value.reduce((n, x) => n + x.value, 0))

const customerMix = computed(() => {
  const s = summary.value
  if (!s || s.distinctCustomers === 0) return null
  const newPct = Math.round((s.newCustomers / s.distinctCustomers) * 100)
  return { newCount: s.newCustomers, returningCount: s.returningCustomers, newPct, returningPct: 100 - newPct }
})

const heatCells = computed<HeatCell[]>(() => summary.value?.heatmap ?? [])
const hasHeat = computed(() => heatCells.value.some((c) => c.count > 0))

const funnelMax = computed(() => Math.max(1, ...funnelRows.value.map((r) => r.count)))

function deltaTone(tile: Tile): string {
  if (tile.deltaPercent === null || tile.deltaPercent === 0) return 'text-(--color-text-muted)'
  const good = tile.deltaPercent > 0 === tile.higherIsBetter
  return good ? 'text-(--tone-success-text)' : 'text-(--tone-danger-text)'
}

function deltaText(tile: Tile): string {
  if (tile.deltaPercent === null) return 'دورهٔ قبل داده‌ای ندارد'
  if (tile.deltaPercent === 0) return 'بدون تغییر نسبت به دورهٔ قبل'
  const sign = tile.deltaPercent > 0 ? '+' : '−'
  return `${sign}${Math.abs(tile.deltaPercent).toLocaleString('fa-IR')}٪ نسبت به دورهٔ قبل`
}

// Postgres EXTRACT(DOW) is 0 = Sunday. Read in Tehran local time on the server, so these
// labels line up with the salon's own working week.
const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']

const busiestText = computed(() => {
  const s = summary.value
  if (!s || s.busiestWeekday === null || s.busiestHour === null) return null
  const hour = `${s.busiestHour.toLocaleString('fa-IR')}:۰۰`
  return `${WEEKDAYS[s.busiestWeekday] ?? '—'} · حدود ساعت ${hour}`
})

const FUNNEL_LABELS: Record<string, string> = {
  salon_profile_viewed: 'بازدید از صفحهٔ سالن',
  booking_started: 'شروع رزرو',
  payment_succeeded: 'پرداخت بیعانه',
  booking_confirmed: 'رزرو نهایی',
}
function funnelLabel(stage: string): string {
  return FUNNEL_LABELS[stage] ?? stage
}

interface FunnelRow {
  stage: string
  count: number
  /** Share of the row above that reached this one; null when there is nothing to divide by. */
  percent: number | null
}

// With online payment switched off platform-wide nobody can pay a deposit, so the payment
// stage would read as a dead end (0, then "rescued" by a confirmed count larger than it).
// It is dropped, and conversion is recomputed here between the rows actually shown rather
// than taken from the API, whose figure is always relative to the API's own previous stage.
const funnelRows = computed<FunnelRow[]>(() => {
  const stages = (funnel.value?.stages ?? []).filter(
    (s) => flags.value.onlinePaymentEnabled || s.stage !== 'payment_succeeded',
  )
  return stages.map((s, i) => {
    const prev = i > 0 ? stages[i - 1]! : null
    return {
      stage: s.stage,
      count: s.count,
      // null (not 0%) whenever the row before has no data: "we cannot measure this" and
      // "nobody converted" are different statements.
      percent: prev && prev.count > 0 ? Math.round((s.count / prev.count) * 100) : null,
    }
  })
})
const funnelHasData = computed(() => funnelRows.value.some((s) => s.count > 0))
// A step can exceed 100%: each stage is counted independently within the window, so a
// booking started before it (or confirmed without an online payment) reaches a later stage
// without having been counted in the earlier one. Shown as «بیش از ۱۰۰٪» with that
// explanation rather than as a meaningless "۲۵۰٪".
const funnelOverflow = computed(() => funnelRows.value.some((r) => r.percent !== null && r.percent > 100))
function funnelPercentText(percent: number | null): string {
  if (percent === null) return '—'
  return percent > 100 ? 'بیش از ۱۰۰٪' : `${formatNumber(percent)}٪`
}
// Weekday + date + time: «سه‌شنبه ۲۹ مهر، ۱۰:۳۰» says more than a bare numeric date.
const upcomingFmt = new Intl.DateTimeFormat('fa-IR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' })
function formatUpcoming(iso: string): string {
  return upcomingFmt.format(new Date(iso))
}
// Pinned to the salon's timezone, not the browser's -- see BookingsView's equivalent.
function formatBookingTime(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', { timeStyle: 'short', timeZone: 'Asia/Tehran' }).format(
    new Date(iso),
  )
}
</script>

<template>
  <div class="mx-auto w-full max-w-6xl space-y-6 p-4 lg:p-8">
    <div>
      <h1 class="text-xl font-bold text-(--color-text)">داشبورد</h1>
      <p class="mt-0.5 text-sm text-(--color-text-muted)">{{ todayLabel }}</p>
    </div>

    <!-- Requests auto-expire on their own deadline (10 minutes by default), so they lead the
         page. Fed by the layout's app-wide poll (usePendingApprovals), not a fetch of its own. -->
    <RouterLink
      v-if="pendingCount > 0"
      to="/bookings"
      data-testid="dashboard-pending-callout"
      class="flex items-center gap-3 rounded-2xl border border-(--color-accent) bg-(--color-accent-soft) p-4 transition-colors duration-150 hover:bg-(--color-accent)"
    >
      <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--color-surface-card) text-(--color-accent-text)">
        <AppIcon name="bookings" :size="20" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-bold text-(--color-text)">
          {{ formatNumber(pendingCount) }} درخواست نوبت منتظر تأیید شماست
        </span>
        <span class="block text-xs text-(--color-text)">اگر تا پایان مهلت پاسخ ندهید، درخواست خودکار منقضی می‌شود.</span>
      </span>
      <span class="hidden shrink-0 text-sm font-semibold text-(--color-text) sm:inline">بررسی درخواست‌ها</span>
      <AppIcon name="chevron-left" :size="18" class="shrink-0 text-(--color-text)" />
    </RouterLink>

    <div v-if="loadError" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">اطلاعات نوبت‌ها بارگذاری نشد.</p>
      <AppButton variant="secondary" data-testid="retry-dashboard" @click="load">
        تلاش دوباره
      </AppButton>
    </div>

    <!-- Today first (with next-up under it), and the free capacity ahead beside it from lg:
         the between-clients phone check reads them in that order, and a desktop session sees
         all three without scrolling. -->
    <div class="grid gap-6 lg:grid-cols-5 lg:items-start">
      <div class="space-y-6 lg:col-span-3">
        <div v-if="loadError" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
          <p class="text-sm text-(--tone-danger-text)">اطلاعات نوبت‌ها بارگذاری نشد.</p>
          <AppButton variant="secondary" data-testid="retry-dashboard" @click="load">
            تلاش دوباره
          </AppButton>
        </div>

        <template v-else>
          <section aria-labelledby="dashboard-today">
            <div class="mb-2 flex items-center justify-between gap-2">
              <h2 id="dashboard-today" class="flex items-center gap-2 text-base font-bold text-(--color-text)">
                <AppIcon name="bookings" :size="18" class="text-(--color-text-muted)" />
                نوبت‌های امروز
                <span v-if="!loading && todaysBookings.length > 0" class="tnum rounded-full bg-(--color-surface-subtle) px-2 text-xs font-semibold text-(--color-text-muted)">
                  {{ formatNumber(todaysBookings.length) }}
                </span>
              </h2>
              <RouterLink
                to="/bookings?tab=today"
                data-testid="dashboard-today-link"
                class="inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-semibold text-(--color-accent-text) underline-offset-4 hover:underline"
              >
                برنامهٔ امروز
                <AppIcon name="chevron-left" :size="14" />
              </RouterLink>
            </div>
            <div v-if="loading" class="flex items-center justify-center py-8 text-(--color-text-muted)">
              <AppIcon name="spinner" :size="20" class="animate-spin" />
            </div>
            <EmptyState v-else-if="todaysBookings.length === 0" compact icon="bookings" message="نوبتی برای امروز ثبت نشده است." />
            <div v-else class="space-y-2">
              <AppCard v-for="b in todaysBookings" :key="b.id" :padded="false" class="flex items-center gap-3 p-3">
                <span class="tnum flex w-16 shrink-0 items-center justify-center rounded-xl bg-(--color-accent-soft) py-2 text-sm font-bold text-(--color-text)">
                  {{ formatBookingTime(b.startsAt) }}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block break-words text-sm font-semibold text-(--color-text)">{{ serviceName(b.serviceId) }}</span>
                  <span v-if="b.customerName || b.workerName" class="block truncate text-xs text-(--color-text-muted)">
                    {{ b.customerName || 'بدون نام' }}<template v-if="b.workerName"> · {{ b.workerName }}</template>
                  </span>
                </span>
              </AppCard>
            </div>
          </section>

          <section aria-labelledby="dashboard-next">
            <h2 id="dashboard-next" class="mb-2 flex items-center gap-2 text-sm font-bold text-(--color-text)">
              <AppIcon name="calendar" :size="16" class="text-(--color-text-muted)" />
              نوبت‌های بعدی
            </h2>
            <div v-if="loading" class="flex items-center justify-center py-8 text-(--color-text-muted)">
              <AppIcon name="spinner" :size="20" class="animate-spin" />
            </div>
            <EmptyState v-else-if="upcomingBookings.length === 0" compact icon="calendar" message="نوبت بعدی ثبت نشده است." />
            <div v-else class="space-y-2">
              <AppCard v-for="b in upcomingBookings" :key="b.id" :padded="false" class="p-3">
                <div class="flex items-center justify-between gap-2">
                  <p class="min-w-0 break-words text-sm font-semibold text-(--color-text)">{{ serviceName(b.serviceId) }}</p>
                  <p class="tnum shrink-0 text-sm text-(--color-text-muted)">{{ formatUpcoming(b.startsAt) }}</p>
                </div>
              </AppCard>
            </div>
          </section>
        </template>
      </div>

      <CapacityCard class="lg:col-span-2" />
    </div>

    <section class="space-y-3" aria-labelledby="dashboard-performance">
      <div class="flex flex-wrap items-center justify-between gap-3 pt-2">
        <h2 id="dashboard-performance" class="text-base font-bold text-(--color-text)">عملکرد سالن</h2>
        <div class="flex items-center gap-1 rounded-xl bg-(--color-surface-subtle) p-1" role="group" aria-label="بازهٔ زمانی آمار">
          <button
            v-for="p in PERIODS"
            :key="p.days"
            type="button"
            :data-testid="`period-${p.days}`"
            :aria-pressed="periodDays === p.days"
            class="min-h-10 rounded-lg px-3 text-xs font-semibold transition-colors"
            :class="periodDays === p.days ? 'bg-(--color-surface-card) text-(--color-text) shadow-(--shadow-sm)' : 'text-(--color-text-muted) hover:text-(--color-text)'"
            @click="selectPeriod(p.days)"
          >
            {{ p.label }}
          </button>
        </div>
      </div>

      <!-- Same grid as the loaded tiles, so the page doesn't jump when the numbers land.
           animate-pulse is switched off under prefers-reduced-motion (main.css). -->
      <div v-if="metricsLoading" data-testid="metrics-skeleton" role="status" aria-label="در حال بارگذاری آمار" class="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-3">
        <div v-for="n in 8" :key="n" class="animate-pulse space-y-2 rounded-2xl border border-(--color-border) bg-(--color-surface-subtle) p-4">
          <div class="h-3 w-1/2 rounded bg-(--color-border)" />
          <div class="h-5 w-3/4 rounded bg-(--color-border)" />
          <div class="h-3 w-2/3 rounded bg-(--color-border-soft)" />
        </div>
      </div>

      <div v-else-if="metricsError" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
        <p class="text-sm text-(--tone-danger-text)">آمار عملکرد بارگذاری نشد.</p>
        <AppButton variant="secondary" data-testid="retry-metrics" @click="loadMetrics">تلاش دوباره</AppButton>
      </div>

      <template v-else-if="summary">
        <div class="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-3">
          <MetricCard
            v-for="tile in tiles"
            :key="tile.key"
            :data-testid="`metric-${tile.key}`"
            :label="tile.label"
            :value="tile.value"
            :hint="tile.hint"
            :delta-text="deltaText(tile)"
            :delta-class="deltaTone(tile)"
            :spark="tile.spark"
          />
        </div>

        <!-- Trend: the period day by day, against the previous period of the same length. -->
        <AppCard v-if="trendPoints.length > 1" data-testid="trend-card">
          <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <h3 class="text-sm font-bold text-(--color-text)">روند روزانه</h3>
              <p class="mt-0.5 text-xs leading-5 text-(--color-text-muted)">
                <template v-if="trendMetric === 'bookings'">نوبت‌های تأییدشده و انجام‌شده، بر اساس روز ثبت نوبت (به وقت تهران).</template>
                <template v-else>قیمت کامل نوبت‌های انجام‌شده، بر اساس روز ثبت نوبت؛ نه مبلغ دریافتی.</template>
              </p>
            </div>
            <div class="flex items-center gap-1 rounded-xl bg-(--color-surface-subtle) p-1" role="group" aria-label="معیار نمودار روند">
              <button
                v-for="m in TREND_METRICS"
                :key="m.key"
                type="button"
                :data-testid="`trend-metric-${m.key}`"
                :aria-pressed="trendMetric === m.key"
                class="min-h-10 rounded-lg px-3 text-xs font-semibold transition-colors"
                :class="trendMetric === m.key ? 'bg-(--color-surface-card) text-(--color-text) shadow-(--shadow-sm)' : 'text-(--color-text-muted) hover:text-(--color-text)'"
                @click="trendMetric = m.key"
              >
                {{ m.label }}
              </button>
            </div>
          </div>
          <TrendChart
            :points="trendPoints"
            :previous="trendPrevious"
            :series-label="`${periodDays.toLocaleString('fa-IR')} روز اخیر`"
            previous-label="دورهٔ قبل"
            :format-value="formatTrendValue"
            :integer="trendMetric === 'bookings'"
            :caption="trendMetric === 'bookings' ? 'نمودار روزانهٔ تعداد نوبت‌ها' : 'نمودار روزانهٔ ارزش نوبت‌های انجام‌شده'"
          />
          <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-(--color-text-muted)" aria-hidden="true">
            <span class="flex items-center gap-1.5"><span class="h-0.5 w-4 rounded-full bg-(--chart-line)" />{{ periodDays.toLocaleString('fa-IR') }} روز اخیر</span>
            <span class="flex items-center gap-1.5"><span class="w-4 border-t-2 border-dashed border-(--chart-previous)" />دورهٔ قبل</span>
          </div>
        </AppCard>

        <div class="grid gap-3 lg:grid-cols-2 lg:items-stretch">
          <AppCard data-testid="outcome-card">
            <h3 class="text-sm font-bold text-(--color-text)">وضعیت نوبت‌های این دوره</h3>
            <p class="mb-4 mt-0.5 text-xs text-(--color-text-muted)">همهٔ نوبت‌هایی که در این بازه ثبت شده‌اند، به تفکیک سرانجام.</p>
            <p v-if="outcomeTotal === 0" class="text-xs text-(--color-text-muted)" data-testid="outcome-empty">در این دوره نوبتی ثبت نشده است.</p>
            <DonutChart v-else :segments="outcomeSegments" center-label="نوبت" caption="سهم هر وضعیت از نوبت‌های این دوره" />
          </AppCard>

          <AppCard data-testid="customer-mix-card" class="flex flex-col">
            <h3 class="text-sm font-bold text-(--color-text)">مشتریان جدید و بازگشتی</h3>
            <p class="mb-4 mt-0.5 text-xs text-(--color-text-muted)">مشتری جدید یعنی اولین نوبتش در این سالن در همین بازه بوده است.</p>
            <p v-if="!customerMix" class="text-xs text-(--color-text-muted)">در این دوره مشتری‌ای نوبت نگرفته است.</p>
            <template v-else>
              <div class="flex items-end justify-between gap-3">
                <p>
                  <span class="tnum text-3xl font-extrabold text-(--color-text)">{{ formatNumber(summary.distinctCustomers) }}</span>
                  <span class="ms-1 text-sm text-(--color-text-muted)">مشتری</span>
                </p>
                <p class="text-end text-xs text-(--color-text-muted)">
                  نرخ بازگشت
                  <span class="tnum block text-lg font-bold text-(--color-text)">{{ formatNumber(summary.repeatRatePercent) }}٪</span>
                </p>
              </div>
              <div class="mt-4 flex h-4 gap-1 overflow-hidden rounded-full" aria-hidden="true">
                <div v-if="customerMix.newCount > 0" class="chart-grow h-full rounded-full bg-(--chart-new)" :style="{ width: `${customerMix.newPct}%` }" />
                <div v-if="customerMix.returningCount > 0" class="chart-grow h-full rounded-full bg-(--chart-returning)" :style="{ width: `${customerMix.returningPct}%`, animationDelay: '80ms' }" />
              </div>
              <ul class="mt-4 grid grid-cols-2 gap-3 text-sm">
                <li class="rounded-xl bg-(--color-surface-subtle) p-3">
                  <span class="flex items-center gap-1.5 text-xs text-(--color-text-muted)"><span class="h-2.5 w-2.5 rounded-full bg-(--chart-new)" aria-hidden="true" />جدید</span>
                  <span class="tnum mt-1 block font-bold text-(--color-text)">{{ formatNumber(customerMix.newCount) }} <span class="text-xs font-normal text-(--color-text-muted)">({{ formatNumber(customerMix.newPct) }}٪)</span></span>
                </li>
                <li class="rounded-xl bg-(--color-surface-subtle) p-3">
                  <span class="flex items-center gap-1.5 text-xs text-(--color-text-muted)"><span class="h-2.5 w-2.5 rounded-full bg-(--chart-returning)" aria-hidden="true" />بازگشتی</span>
                  <span class="tnum mt-1 block font-bold text-(--color-text)">{{ formatNumber(customerMix.returningCount) }} <span class="text-xs font-normal text-(--color-text-muted)">({{ formatNumber(customerMix.returningPct) }}٪)</span></span>
                </li>
              </ul>
            </template>
          </AppCard>
        </div>

        <div class="grid gap-3 lg:grid-cols-2">
          <RankedListCard
            title="پرمراجعه‌ترین خدمات"
            empty-text="در این دوره نوبتی ثبت نشده است."
            row-test-id="top-service"
            :rows="summary.topServices.map((x) => ({ key: x.serviceId, name: x.name || 'خدمت حذف‌شده', count: x.bookingsCount, detail: x.grossValue > 0 ? `${formatToman(x.grossValue)} تومان از نوبت‌های انجام‌شده` : undefined }))"
          />

          <!-- Bookings with no worker assigned are excluded server-side rather than
               bucketed as "unassigned", which would top this list at most salons. -->
          <RankedListCard
            title="پرکارترین کارمندان"
            empty-text="نوبتی با کارمند مشخص در این دوره ثبت نشده است."
            row-test-id="top-worker"
            :rows="summary.topWorkers.map((x) => ({ key: x.workerId, name: x.name || 'کارمند حذف‌شده', count: x.bookingsCount }))"
          />
        </div>

        <AppCard data-testid="heatmap-card">
          <div class="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
              <h3 class="text-sm font-bold text-(--color-text)">شلوغ‌ترین زمان‌ها</h3>
              <p class="mt-0.5 text-xs text-(--color-text-muted)">زمان حضور مشتری‌ها در سالن، به وقت تهران.</p>
            </div>
            <p v-if="busiestText" data-testid="busiest-time" class="rounded-full bg-(--color-accent-soft) px-3 py-1 text-xs font-semibold text-(--color-text)">
              اوج: {{ busiestText }}
            </p>
          </div>
          <HeatmapChart v-if="hasHeat" :cells="heatCells" caption="تعداد نوبت‌ها در هر روز هفته و ساعت" />
          <p v-else class="text-xs text-(--color-text-muted)">هنوز نوبتی در این دوره در سالن انجام نشده است.</p>
        </AppCard>

        <AppCard>
          <h3 class="mb-1 text-sm font-bold text-(--color-text)">مسیر رزرو مشتریان</h3>
          <p data-testid="funnel-description" class="mb-3 text-xs leading-5 text-(--color-text-muted)">
            <template v-if="flags.onlinePaymentEnabled">از بازدید صفحهٔ سالن تا پرداخت بیعانه و رزرو نهایی.</template>
            <template v-else>از بازدید صفحهٔ سالن تا رزرو نهایی. پرداخت آنلاین فعلاً روی پلتفرم خاموش است، برای همین مرحلهٔ پرداخت نمایش داده نمی‌شود.</template>
          </p>
          <p v-if="!funnel" data-testid="funnel-unavailable" class="text-xs text-(--color-text-muted)">
            این بخش بارگذاری نشد.
          </p>
          <p v-else-if="!funnelHasData" data-testid="funnel-empty" class="text-xs text-(--color-text-muted)">
            هنوز داده‌ای برای این دوره ثبت نشده است. آمار از زمان فعال شدن این قابلیت جمع‌آوری می‌شود و برای نوبت‌های قدیمی وجود ندارد.
          </p>
          <template v-else>
            <ol class="space-y-3">
              <li v-for="(row, i) in funnelRows" :key="row.stage" data-testid="funnel-stage">
                <div class="mb-1 flex items-center justify-between gap-2 text-sm">
                  <span class="min-w-0 break-words text-(--color-text)">{{ funnelLabel(row.stage) }}</span>
                  <span class="flex shrink-0 items-center gap-3">
                    <span class="tnum font-semibold text-(--color-text)">{{ formatNumber(row.count) }}</span>
                    <span class="tnum min-w-16 rounded-full bg-(--color-surface-subtle) px-2 py-0.5 text-center text-xs text-(--color-text-muted)">{{ funnelPercentText(row.percent) }}</span>
                  </span>
                </div>
                <div class="h-3 overflow-hidden rounded-full bg-(--color-surface-subtle)" aria-hidden="true">
                  <div
                    class="chart-grow h-full rounded-full"
                    :style="{ width: `${(row.count / funnelMax) * 100}%`, background: `color-mix(in srgb, var(--chart-line) ${100 - i * 22}%, var(--chart-area))`, animationDelay: `${i * 80}ms` }"
                  />
                </div>
              </li>
            </ol>
            <p v-if="funnelOverflow" data-testid="funnel-overflow-note" class="mt-3 text-xs leading-5 text-(--color-text-muted)">
              «بیش از ۱۰۰٪» یعنی بعضی نوبت‌ها مرحلهٔ قبل را در این بازه ثبت نکرده‌اند؛ مثلاً رزرو پیش از شروع بازه آغاز شده یا نوبت بدون پرداخت آنلاین تأیید شده است.
            </p>
          </template>
        </AppCard>
      </template>
    </section>
  </div>
</template>
