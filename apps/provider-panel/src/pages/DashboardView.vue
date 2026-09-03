<!-- apps/provider-panel/src/pages/DashboardView.vue -->
<!-- Previously this screen showed today's bookings, next-up bookings, and quick links, and
     nothing else -- a salon owner had no way to see how their business was doing without
     exporting nothing and counting by hand. It now leads with a real, period-selectable
     performance summary from GET /salons/mine/dashboard-summary, every figure compared
     against the immediately-preceding period of the same length, plus this salon's own
     slice of the booking funnel from GET /salons/mine/funnel.

     The bookings/quick-links sections below are unchanged; they stay where a between-clients
     phone check expects them. -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon, { type IconName } from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useApi } from '@/composables/useApi'
import { formatToman } from '@/utils/format-toman'

interface Booking {
  id: string
  serviceId: string
  startsAt: string
  status: string
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
}
interface Funnel {
  stages: Array<{ stage: string; count: number; conversionFromPreviousPercent: number | null }>
}

const { apiFetch } = useApi()
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
    apiFetch<Booking[]>('/salons/mine/bookings', { silent: true }),
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

const todayKey = new Date().toDateString()

const todaysBookings = computed(() =>
  bookings.value
    .filter((b) => b.status === 'confirmed' && new Date(b.startsAt).toDateString() === todayKey)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
)

const upcomingBookings = computed(() =>
  bookings.value
    .filter(
      (b) =>
        b.status === 'confirmed' &&
        new Date(b.startsAt) > new Date() &&
        new Date(b.startsAt).toDateString() !== todayKey,
    )
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
    },
    {
      key: 'gross',
      label: 'ارزش ناخالص نوبت‌ها',
      value: `${formatToman(s.grossBookingValue)} تومان`,
      hint: 'قیمت کامل خدمات، نه فقط بیعانهٔ آنلاین',
      deltaPercent: delta(s.grossBookingValue, p.grossBookingValue),
      higherIsBetter: true,
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
  booking_confirmed: 'رزرو نهایی',
}
function funnelLabel(stage: string): string {
  return FUNNEL_LABELS[stage] ?? stage
}
const funnelHasData = computed(() => (funnel.value?.stages ?? []).some((s) => s.count > 0))

const QUICK_LINKS: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/customers', label: 'مشتریان', icon: 'customers' },
  { to: '/hours', label: 'ساعات کاری', icon: 'hours' },
  { to: '/photos', label: 'تصاویر', icon: 'photos' },
  { to: '/stories', label: 'استوری‌ها', icon: 'stories' },
  { to: '/portfolio', label: 'نمونه کارها', icon: 'portfolio' },
  { to: '/coupons', label: 'کدهای تخفیف', icon: 'coupons' },
  { to: '/team', label: 'تیم', icon: 'team' },
  { to: '/settings', label: 'تنظیمات', icon: 'settings' },
  { to: '/plan', label: 'پلن من', icon: 'plan' },
]
// Pinned to the salon's timezone, not the browser's -- see BookingsView's equivalent.
function formatBookingTime(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', { timeStyle: 'short', timeZone: 'Asia/Tehran' }).format(
    new Date(iso),
  )
}
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-6 p-4 lg:p-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-lg font-bold text-(--color-text)">داشبورد</h1>
      <div class="flex items-center gap-1 rounded-xl bg-(--color-border-soft) p-1">
        <button
          v-for="p in PERIODS"
          :key="p.days"
          type="button"
          :data-testid="`period-${p.days}`"
          :aria-pressed="periodDays === p.days"
          class="min-h-9 rounded-lg px-3 text-xs font-semibold transition-colors"
          :class="periodDays === p.days ? 'bg-(--color-surface-card) text-(--color-text) shadow-(--shadow-sm)' : 'text-(--color-text-muted)'"
          @click="selectPeriod(p.days)"
        >
          {{ p.label }}
        </button>
      </div>
    </div>

    <section class="space-y-3">
      <div v-if="metricsLoading" class="flex items-center justify-center py-10 text-(--color-text-muted)">
        <AppIcon name="spinner" :size="20" class="animate-spin" />
      </div>

      <div v-else-if="metricsError" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
        <p class="text-sm text-(--tone-danger-text)">آمار عملکرد بارگذاری نشد.</p>
        <AppButton variant="secondary" data-testid="retry-metrics" @click="loadMetrics">تلاش دوباره</AppButton>
      </div>

      <template v-else-if="summary">
        <div class="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-3">
          <AppCard v-for="tile in tiles" :key="tile.key" :data-testid="`metric-${tile.key}`" class="bg-(--color-surface-subtle)">
            <p class="text-xs text-(--color-text-muted)">{{ tile.label }}</p>
            <p class="mt-1 break-words text-lg font-bold text-(--color-text)"><span dir="ltr" class="tnum">{{ tile.value }}</span></p>
            <p v-if="tile.hint" class="mt-0.5 text-xs text-(--color-text-muted)">{{ tile.hint }}</p>
            <p class="mt-1 text-xs" :class="deltaTone(tile)">{{ deltaText(tile) }}</p>
          </AppCard>
        </div>

        <div class="grid gap-3 lg:grid-cols-3 lg:items-start">
          <AppCard>
            <h2 class="mb-2 text-sm font-bold text-(--color-text)">پرمراجعه‌ترین خدمات</h2>
            <p v-if="summary.topServices.length === 0" class="text-xs text-(--color-text-muted)">در این دوره نوبتی ثبت نشده است.</p>
            <ul v-else class="space-y-1.5">
              <li v-for="s in summary.topServices" :key="s.serviceId" data-testid="top-service" class="flex items-center justify-between gap-2 text-sm">
                <span class="min-w-0 break-words text-(--color-text)">{{ s.name || 'خدمت حذف‌شده' }}</span>
                <span class="tnum shrink-0 text-(--color-text-muted)">{{ s.bookingsCount.toLocaleString('fa-IR') }} نوبت</span>
              </li>
            </ul>
          </AppCard>

          <AppCard>
            <h2 class="mb-2 text-sm font-bold text-(--color-text)">پرکارترین کارمندان</h2>
            <!-- Bookings with no worker assigned are excluded server-side rather than
                 bucketed as "unassigned", which would top this list at most salons. -->
            <p v-if="summary.topWorkers.length === 0" class="text-xs text-(--color-text-muted)">
              نوبتی با کارمند مشخص در این دوره ثبت نشده است.
            </p>
            <ul v-else class="space-y-1.5">
              <li v-for="w in summary.topWorkers" :key="w.workerId" data-testid="top-worker" class="flex items-center justify-between gap-2 text-sm">
                <span class="min-w-0 break-words text-(--color-text)">{{ w.name || 'کارمند حذف‌شده' }}</span>
                <span class="tnum shrink-0 text-(--color-text-muted)">{{ w.bookingsCount.toLocaleString('fa-IR') }} نوبت</span>
              </li>
            </ul>
          </AppCard>

          <AppCard>
            <h2 class="mb-2 text-sm font-bold text-(--color-text)">شلوغ‌ترین زمان</h2>
            <p v-if="busiestText" data-testid="busiest-time" class="text-sm font-semibold text-(--color-text)">{{ busiestText }}</p>
            <p v-else class="text-xs text-(--color-text-muted)">هنوز نوبت انجام‌شده‌ای در این دوره نبوده است.</p>
            <p class="mt-1 text-xs text-(--color-text-muted)">بر اساس زمان نوبت‌ها به وقت تهران.</p>
          </AppCard>
        </div>

        <AppCard>
          <h2 class="mb-1 text-sm font-bold text-(--color-text)">مسیر رزرو مشتریان</h2>
          <p class="mb-3 text-xs text-(--color-text-muted)">
            از بازدید صفحهٔ سالن تا رزرو نهایی. مرحلهٔ پرداخت هنوز قابل تفکیک به ازای هر سالن نیست و عمداً نمایش داده نمی‌شود.
          </p>
          <p v-if="!funnel" data-testid="funnel-unavailable" class="text-xs text-(--color-text-muted)">
            این بخش بارگذاری نشد.
          </p>
          <p v-else-if="!funnelHasData" data-testid="funnel-empty" class="text-xs text-(--color-text-muted)">
            هنوز داده‌ای برای این دوره ثبت نشده است. آمار از زمان فعال شدن این قابلیت جمع‌آوری می‌شود و برای نوبت‌های قدیمی وجود ندارد.
          </p>
          <ul v-else class="space-y-2">
            <li v-for="stage in funnel.stages" :key="stage.stage" data-testid="funnel-stage" class="flex items-center justify-between gap-2 text-sm">
              <span class="min-w-0 break-words text-(--color-text)">{{ funnelLabel(stage.stage) }}</span>
              <span class="flex shrink-0 items-center gap-2">
                <span class="tnum font-semibold text-(--color-text)">{{ stage.count.toLocaleString('fa-IR') }}</span>
                <!-- null (not 0%) whenever the stage before it has no data: "we cannot
                     measure this" and "nobody converted" are different statements. -->
                <span class="tnum text-xs text-(--color-text-muted)">
                  {{ stage.conversionFromPreviousPercent === null ? '—' : `${stage.conversionFromPreviousPercent.toLocaleString('fa-IR')}٪` }}
                </span>
              </span>
            </li>
          </ul>
        </AppCard>
      </template>
    </section>

    <!-- These nine tiles are the only route to the screens the nav bar doesn't carry, so
         they matter at every width: 3-up on a phone (90px tiles at 320px, enough for a
         two-line label), then more columns rather than taller tiles as the viewport grows,
         landing on a single 9-across row on a laptop. -->
    <div class="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-9 lg:gap-3">
      <RouterLink
        v-for="link in QUICK_LINKS"
        :key="link.to"
        :to="link.to"
        class="flex flex-col items-center gap-1.5 rounded-2xl border-2 border-(--color-border) bg-(--color-surface-card) py-4 text-center shadow-(--shadow-sm) transition-colors hover:border-(--color-accent)"
      >
        <div class="flex h-9 w-9 items-center justify-center rounded-full bg-(--tone-info-bg) text-(--color-text-muted)">
          <AppIcon :name="link.icon" :size="18" />
        </div>
        <span class="px-1 text-center text-xs font-semibold text-balance text-(--color-text)">{{ link.label }}</span>
      </RouterLink>
    </div>

    <div v-if="loadError" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">اطلاعات نوبت‌ها بارگذاری نشد.</p>
      <AppButton variant="secondary" data-testid="retry-dashboard" @click="load">
        تلاش دوباره
      </AppButton>
    </div>

    <!-- Today and next-up sit side by side from lg: the between-clients phone check reads
         them in sequence, but a desktop session should see both without scrolling. -->
    <div v-else class="grid gap-6 lg:grid-cols-2 lg:items-start">
      <section>
        <h2 class="mb-2 flex items-center gap-2 text-sm font-bold text-(--color-text)">
          <AppIcon name="bookings" :size="16" class="text-(--color-text-muted)" />
          نوبت‌های امروز
        </h2>
        <div v-if="loading" class="flex items-center justify-center py-8 text-(--color-text-muted)">
          <AppIcon name="spinner" :size="20" class="animate-spin" />
        </div>
        <EmptyState v-else-if="todaysBookings.length === 0" icon="bookings" message="نوبتی برای امروز ثبت نشده است." />
        <div v-else class="space-y-2">
          <AppCard v-for="b in todaysBookings" :key="b.id" :padded="false" class="p-3">
            <div class="flex items-center justify-between gap-2">
              <p class="min-w-0 break-words text-sm font-semibold text-(--color-text)">{{ serviceName(b.serviceId) }}</p>
              <p class="tnum shrink-0 text-sm font-bold text-(--color-accent-text)">{{ formatBookingTime(b.startsAt) }}</p>
            </div>
          </AppCard>
        </div>
      </section>

      <section>
        <h2 class="mb-2 flex items-center gap-2 text-sm font-bold text-(--color-text)">
          <AppIcon name="bookings" :size="16" class="text-(--color-text-muted)" />
          نوبت‌های بعدی
        </h2>
        <div v-if="loading" class="flex items-center justify-center py-8 text-(--color-text-muted)">
          <AppIcon name="spinner" :size="20" class="animate-spin" />
        </div>
        <EmptyState v-else-if="upcomingBookings.length === 0" icon="bookings" message="نوبت بعدی ثبت نشده است." />
        <div v-else class="space-y-2">
          <AppCard v-for="b in upcomingBookings" :key="b.id" :padded="false" class="p-3">
            <div class="flex items-center justify-between gap-2">
              <p class="min-w-0 break-words text-sm font-semibold text-(--color-text)">{{ serviceName(b.serviceId) }}</p>
              <p class="tnum shrink-0 text-sm text-(--color-text-muted)">{{ new Date(b.startsAt).toLocaleDateString('fa-IR') }}</p>
            </div>
          </AppCard>
        </div>
      </section>
    </div>
  </div>
</template>
