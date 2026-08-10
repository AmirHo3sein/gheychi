<!-- apps/admin-panel/src/pages/AnalyticsView.vue -->
<!-- Reads GET /admin/analytics/summary (admin-analytics.controller.ts /
     analytics-aggregation.service.ts) -- a totals-by-event breakdown plus a day-by-day
     booking funnel (booking_started -> booking_confirmed -> payment_succeeded) over an
     optional from/to range, defaulting server-side to the last 30 days. A dedicated route
     rather than a DashboardView section: the funnel table needs a real date-range picker
     of its own, which doesn't fit DashboardView's fixed "current snapshot" charts. No
     charting library exists anywhere in this app outside DashboardView's ECharts pie/bar
     use (all fixed-category distributions, not a time series) -- pulling one in for a
     single day-by-day table here isn't worth the new dependency, so this is plain tnum
     tables, matching InvoicesView.vue's own numeric-table convention. -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'
import { analyticsEventLabel } from '@/utils/labels'

interface EventTotal {
  eventName: string
  count: number
}

// One row per day, only for days that had at least one funnel event (see
// AnalyticsAggregationService.pivotFunnel -- no zero-filling server-side).
interface FunnelDay {
  date: string
  booking_started: number
  booking_confirmed: number
  payment_succeeded: number
}

interface AnalyticsSummaryResponse {
  from: string
  to: string
  totalsByEvent: EventTotal[]
  funnelByDay: FunnelDay[]
}

const { apiFetch } = useApi()
const loading = ref(true)
// A fetch failure must not be silently repainted as an empty state -- see
// SalonsView.vue/InvoicesView.vue's identical loadError pattern.
const loadError = ref(false)
const totals = ref<EventTotal[]>([])
const funnel = ref<FunnelDay[]>([])
// The range the backend actually used (echoed back in the response) -- distinct from the
// filter inputs below, since those can be blank while the server still applied its own
// default last-30-days window.
const summaryFrom = ref('')
const summaryTo = ref('')

const fromDate = ref('')
const toDate = ref('')

async function load() {
  loading.value = true
  loadError.value = false
  const params = new URLSearchParams()
  // Both bounds anchored in LOCAL time -- see WalletView.vue/UsersView.vue for why
  // `new Date('YYYY-MM-DD')` alone (parsed as UTC midnight) would silently drop early
  // local-time rows on the from-day (UTC+3:30).
  if (fromDate.value) params.set('from', new Date(`${fromDate.value}T00:00:00.000`).toISOString())
  if (toDate.value) params.set('to', new Date(`${toDate.value}T23:59:59.999`).toISOString())
  const qs = params.toString()

  const { data, error } = await apiFetch<AnalyticsSummaryResponse>(`/admin/analytics/summary${qs ? `?${qs}` : ''}`, {
    silent: true,
  })
  if (error) {
    loadError.value = true
    totals.value = []
    funnel.value = []
    summaryFrom.value = ''
    summaryTo.value = ''
  } else {
    totals.value = data?.totalsByEvent ?? []
    funnel.value = data?.funnelByDay ?? []
    summaryFrom.value = data?.from ?? ''
    summaryTo.value = data?.to ?? ''
  }
  loading.value = false
}

function clearFilters() {
  fromDate.value = ''
  toDate.value = ''
}

const hasActiveFilters = computed(() => !!fromDate.value || !!toDate.value)
// Both arrays empty is a genuinely empty range (no events at all), not a fetch failure --
// gated on !loadError so the error card takes priority.
const isEmpty = computed(() => !loading.value && !loadError.value && totals.value.length === 0 && funnel.value.length === 0)

const dayFormatter = new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
const rangeFormatter = new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' })

// funnelByDay's `date` is a plain "YYYY-MM-DD" day bucket (see pivotFunnel), not a
// timestamp -- formatted in UTC so the displayed day never shifts off the bucket the
// backend actually grouped by, regardless of the browser's own timezone.
function formatDay(date: string): string {
  return dayFormatter.format(new Date(`${date}T00:00:00.000Z`))
}

const formattedRange = computed(() => {
  if (!summaryFrom.value || !summaryTo.value) return ''
  return `${rangeFormatter.format(new Date(summaryFrom.value))} تا ${rangeFormatter.format(new Date(summaryTo.value))}`
})

// booking_confirmed/booking_started and payment_succeeded/booking_confirmed -- the two
// funnel-stage conversion rates called for in the spec. A zero denominator (no starts that
// day) has no meaningful rate, so it renders as "—" rather than a misleading 0% or NaN%.
function conversionRate(numerator: number, denominator: number): string {
  if (denominator === 0) return '—'
  return `${Math.round((numerator / denominator) * 100).toLocaleString('fa-IR')}٪`
}

onMounted(load)
watch([fromDate, toDate], load)
</script>

<template>
  <div class="space-y-5 p-8" data-testid="analytics-page">
    <AppCard>
      <div class="flex flex-wrap items-end gap-3">
        <div class="min-w-0">
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">بازه زمانی</label>
          <!-- See WalletView.vue: the from/to pair is a nested flex row that would otherwise
               stay one unbreakable block, the widest item in this bar. -->
          <div class="flex flex-wrap items-center gap-1.5">
            <JalaliDatePicker v-model="fromDate" placeholder="از تاریخ" aria-label="از تاریخ" class="w-40" />
            <span class="text-(--color-text-muted)">تا</span>
            <JalaliDatePicker v-model="toDate" placeholder="تا تاریخ" aria-label="تا تاریخ" class="w-40" />
          </div>
        </div>
        <AppButton v-if="hasActiveFilters" type="button" variant="ghost" data-testid="analytics-clear-filters" @click="clearFilters">
          <template #icon><AppIcon name="reset" :size="15" /></template>
          پاک‌کردن فیلتر
        </AppButton>
      </div>
      <p v-if="!loading && !loadError && formattedRange" class="mt-3 text-xs text-(--color-text-muted)">
        بازه نمایش‌داده‌شده: <span class="tnum">{{ formattedRange }}</span>
        <span v-if="!hasActiveFilters">(۳۰ روز اخیر، به‌صورت پیش‌فرض)</span>
      </p>
    </AppCard>

    <div v-if="loading" class="flex h-40 items-center justify-center" role="status" aria-label="در حال بارگذاری" data-testid="analytics-loading">
      <AppIcon name="spinner" :size="24" class="animate-spin text-(--color-text-muted)" />
    </div>

    <AppCard
      v-else-if="loadError"
      :padded="false"
      data-testid="analytics-error"
      class="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center"
    >
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-(--tone-danger-bg) text-(--tone-danger-text)">
        <AppIcon name="warning" :size="22" />
      </div>
      <p class="text-sm text-(--color-text-muted)">بارگذاری اطلاعات تحلیلی با خطا مواجه شد.</p>
      <AppButton type="button" variant="secondary" data-testid="analytics-retry" @click="load">تلاش دوباره</AppButton>
    </AppCard>

    <EmptyState v-else-if="isEmpty" icon="chart" message="داده‌ای برای این بازه زمانی ثبت نشده است." />

    <template v-else>
      <AppCard :padded="false">
        <div class="p-4 pb-0">
          <p class="text-sm font-bold text-(--color-text)">رویدادها به تفکیک نوع</p>
          <p class="mb-2 text-xs text-(--color-text-muted)">تعداد کل هر رویداد در بازه انتخاب‌شده</p>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-right text-sm">
            <thead>
              <tr class="border-b border-(--color-border) bg-(--color-border-soft) text-xs text-(--color-text-muted)">
                <th scope="col" class="px-5 py-3 font-semibold">رویداد</th>
                <th scope="col" class="px-5 py-3 font-semibold">تعداد</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="totals.length === 0">
                <td colspan="2" class="px-5 py-6 text-center text-sm text-(--color-text-muted)">در این بازه رویدادی ثبت نشده است.</td>
              </tr>
              <tr
                v-for="row in totals"
                :key="row.eventName"
                data-testid="event-total-row"
                class="border-b border-(--color-border-soft) transition-colors last:border-0 hover:bg-(--color-border-soft)"
              >
                <td class="px-5 py-3.5 font-semibold text-(--color-text)">{{ analyticsEventLabel(row.eventName) }}</td>
                <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ row.count.toLocaleString('fa-IR') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </AppCard>

      <AppCard :padded="false">
        <div class="p-4 pb-0">
          <p class="text-sm font-bold text-(--color-text)">قیف رزرو به تفکیک روز</p>
          <p class="mb-2 text-xs text-(--color-text-muted)">شروع، تایید و پرداخت رزرو به همراه نرخ تبدیل هر مرحله</p>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-right text-sm">
            <thead>
              <tr class="border-b border-(--color-border) bg-(--color-border-soft) text-xs text-(--color-text-muted)">
                <th scope="col" class="px-5 py-3 font-semibold">تاریخ</th>
                <th scope="col" class="px-5 py-3 font-semibold">شروع رزرو</th>
                <th scope="col" class="px-5 py-3 font-semibold">تایید رزرو</th>
                <th scope="col" class="px-5 py-3 font-semibold">پرداخت موفق</th>
                <th scope="col" class="px-5 py-3 font-semibold">نرخ تبدیل شروع به تایید</th>
                <th scope="col" class="px-5 py-3 font-semibold">نرخ تبدیل تایید به پرداخت</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="funnel.length === 0">
                <td colspan="6" class="px-5 py-6 text-center text-sm text-(--color-text-muted)">در این بازه رویداد قیف رزرو ثبت نشده است.</td>
              </tr>
              <tr
                v-for="day in funnel"
                :key="day.date"
                data-testid="funnel-day-row"
                class="border-b border-(--color-border-soft) transition-colors last:border-0 hover:bg-(--color-border-soft)"
              >
                <td class="tnum px-5 py-3.5 font-semibold text-(--color-text)">{{ formatDay(day.date) }}</td>
                <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ day.booking_started.toLocaleString('fa-IR') }}</td>
                <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ day.booking_confirmed.toLocaleString('fa-IR') }}</td>
                <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ day.payment_succeeded.toLocaleString('fa-IR') }}</td>
                <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ conversionRate(day.booking_confirmed, day.booking_started) }}</td>
                <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ conversionRate(day.payment_succeeded, day.booking_confirmed) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </AppCard>
    </template>
  </div>
</template>
