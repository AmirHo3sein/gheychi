<!-- apps/admin-panel/src/pages/DashboardView.vue -->
<!-- One request, GET /admin/dashboard-summary: every figure below is a DB aggregate. The old
     page counted the first 100 rows of several list endpoints client-side and silently
     undercounted past that -- nothing here derives a total from a list page any more. -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import VChart from 'vue-echarts'
import { useApi } from '@/composables/useApi'
import { useTheme } from '@/composables/useTheme'
import ChartCard from '@/components/dashboard/ChartCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon, { type IconName } from '@/components/ui/AppIcon.vue'
import { salonStatusLabel, userRoleLabel } from '@/utils/labels'
import { toPersianDigits } from '@/utils/digits'
import { formatToman } from '@/utils/format-toman'
import { readToken, type ChartToken } from '@/utils/chart-tokens'

use([CanvasRenderer, BarChart, LineChart, TooltipComponent, LegendComponent, GridComponent])

type SalonStatus = 'pending' | 'approved' | 'rejected' | 'suspended'
type UserRole = 'customer' | 'provider' | 'admin'
type BackupStatus = 'ok' | 'stale' | 'missing' | 'unknown'

// Mirrors AdminDashboardSummary in apps/api/src/admin-dashboard/admin-dashboard.service.ts.
interface DashboardSummary {
  generatedAt: string
  today: string
  salons: { byStatus: Record<SalonStatus, number>; total: number }
  users: { byRole: Record<UserRole, number>; suspended: number; total: number }
  bookings: {
    today: { total: number; pending: number; confirmed: number; completed: number; noShow: number; cancelled: number }
    last7Days: { created: number; completed: number }
    last30Days: { created: number; completed: number }
    series: Array<{ date: string; created: number; completed: number }>
    pendingApprovalNow: number
  }
  payments: { refundPending: number }
  moderation: { openReports: number; pendingCategoryRequests: number }
  revenueLast30Days: { grossAmount: number; commissionAmount: number; accruals: number }
  subscriptions: { byPlan: Array<{ planId: string; planKey: string; planName: string; activeCount: number }> }
  alerts: { unreadCritical: number; unreadWarning: number }
  backup: { lastSuccessAt: string | null; status: BackupStatus; staleAfterHours: number }
}

const { apiFetch } = useApi()
const { isDark } = useTheme()
const loading = ref(true)
const loadError = ref(false)
const summary = ref<DashboardSummary | null>(null)

async function load() {
  loading.value = true
  loadError.value = false
  const { data, error } = await apiFetch<DashboardSummary>('/admin/dashboard-summary', { silent: true })
  summary.value = data ?? null
  loadError.value = !!error || !data
  loading.value = false
}

const fa = (n: number) => n.toLocaleString('fa-IR')

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', {
    timeZone: 'Asia/Tehran',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

// Series dates are Tehran calendar days ('YYYY-MM-DD'); noon UTC keeps them on the same day
// whatever the viewer's own zone, then they render as a Jalali «۲۴ مهر».
function formatDay(date: string): string {
  return new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', month: 'short', day: 'numeric' }).format(
    new Date(`${date}T12:00:00Z`),
  )
}

// ── «نیاز به رسیدگی» ────────────────────────────────────────────────────────────────────
interface AttentionItem {
  key: string
  label: string
  // A count, or a short status phrase for the one non-count signal (backup).
  value: string
  detail?: string
  icon: IconName
  tone: 'danger' | 'warning'
  to: string
}

const BACKUP_TEXT: Record<Exclude<BackupStatus, 'ok'>, { value: string; detail: string }> = {
  stale: { value: 'قدیمی', detail: '' },
  missing: { value: 'ثبت نشده', detail: 'هیچ پشتیبان موفقی گزارش نشده است.' },
  unknown: { value: 'نامشخص', detail: 'وضعیت پشتیبان از Redis خوانده نشد.' },
}

const attention = computed<AttentionItem[]>(() => {
  const s = summary.value
  if (!s) return []
  const items: AttentionItem[] = []
  const add = (count: number, item: Omit<AttentionItem, 'value'>) => {
    if (count > 0) items.push({ ...item, value: fa(count) })
  }
  add(s.alerts.unreadCritical, {
    key: 'critical-alerts',
    label: 'هشدار بحرانی خوانده‌نشده',
    icon: 'warning',
    tone: 'danger',
    to: '/notifications?severity=critical&unread=true',
  })
  add(s.payments.refundPending, {
    key: 'refund-pending',
    label: 'استرداد در انتظار',
    detail: 'بیعانه‌ای که باید به مشتری برگردد',
    icon: 'wallet',
    tone: 'danger',
    to: '/bookings?paymentStatus=refund_pending',
  })
  if (s.backup.status !== 'ok') {
    const text = BACKUP_TEXT[s.backup.status]
    items.push({
      key: 'backup',
      label: 'پشتیبان‌گیری پایگاه داده',
      value: text.value,
      detail:
        s.backup.status === 'stale' && s.backup.lastSuccessAt
          ? `آخرین پشتیبان موفق: ${formatDateTime(s.backup.lastSuccessAt)}`
          : text.detail,
      icon: 'history',
      tone: s.backup.status === 'unknown' ? 'warning' : 'danger',
      to: '/notifications?type=alert',
    })
  }
  add(s.salons.byStatus.pending, {
    key: 'pending-salons',
    label: 'سالن در انتظار بررسی',
    icon: 'salons',
    tone: 'warning',
    to: '/salons?status=pending',
  })
  add(s.moderation.openReports, { key: 'open-reports', label: 'گزارش باز', icon: 'flag', tone: 'warning', to: '/reports' })
  add(s.moderation.pendingCategoryRequests, {
    key: 'category-requests',
    label: 'درخواست دسته‌بندی',
    icon: 'inbox',
    tone: 'warning',
    to: '/category-requests',
  })
  return items
})

const allClear = computed(() => !!summary.value && attention.value.length === 0)

const TONE_TILE: Record<AttentionItem['tone'], string> = {
  danger: 'border-(--tone-danger-text)/30 bg-(--tone-danger-bg)',
  warning: 'border-(--tone-warning-text)/30 bg-(--tone-warning-bg)',
}
const TONE_TEXT: Record<AttentionItem['tone'], string> = {
  danger: 'text-(--tone-danger-text)',
  warning: 'text-(--tone-warning-text)',
}

// ── KPIs ────────────────────────────────────────────────────────────────────────────────
interface Kpi {
  key: string
  label: string
  value: string
  unit?: string
  hint: string
}
const kpis = computed<Kpi[]>(() => {
  const s = summary.value
  if (!s) return []
  return [
    { key: 'today', label: 'نوبت‌های امروز', value: fa(s.bookings.today.total), hint: 'نوبت‌هایی که زمانشان امروز است' },
    { key: 'created-7d', label: 'رزرو ۷ روز اخیر', value: fa(s.bookings.last7Days.created), hint: 'نوبت‌های ثبت‌شده' },
    { key: 'completed-30d', label: 'انجام‌شده ۳۰ روز', value: fa(s.bookings.last30Days.completed), hint: `از ${fa(s.bookings.last30Days.created)} نوبت ثبت‌شده` },
    {
      key: 'gross-30d',
      label: 'بیعانه دریافت‌شده ۳۰ روز',
      value: formatToman(s.revenueLast30Days.grossAmount),
      unit: 'تومان',
      // grossAmount is captured deposit money from the commission ledger, never full price.
      hint: `فقط پرداخت‌های آنلاین واقعی (${fa(s.revenueLast30Days.accruals)} مورد)`,
    },
    {
      key: 'commission-30d',
      label: 'کمیسیون ۳۰ روز',
      value: formatToman(s.revenueLast30Days.commissionAmount),
      unit: 'تومان',
      hint: 'کمیسیون ثبت‌شده در دفتر مالی',
    },
  ]
})

const todayBreakdown = computed(() => {
  const t = summary.value?.bookings.today
  if (!t) return []
  return [
    { label: 'در انتظار', value: t.pending },
    { label: 'تاییدشده', value: t.confirmed },
    { label: 'انجام‌شده', value: t.completed },
    { label: 'عدم حضور', value: t.noShow },
    { label: 'لغو/منقضی', value: t.cancelled },
  ]
})

// ── 30-day chart ────────────────────────────────────────────────────────────────────────
const FONT = "'Vazirmatn Variable', ui-sans-serif, system-ui, sans-serif"
// Colours from the live tokens (utils/chart-tokens.ts); reading isDark makes each computed
// re-resolve on a theme switch. Two series, two forms (bars vs line with markers), so the pair
// never relies on hue alone -- the legend names both.
function themed(name: ChartToken): string {
  void isDark.value
  return readToken(name)
}

const hasSeriesData = computed(() => (summary.value?.bookings.series ?? []).some((d) => d.created > 0 || d.completed > 0))

const seriesChart = computed(() => {
  const series = summary.value?.bookings.series ?? []
  const text = themed('--color-text')
  const muted = themed('--color-text-muted')
  return {
    textStyle: { fontFamily: FONT, color: text },
    legend: { top: 0, right: 0, itemGap: 16, textStyle: { fontFamily: FONT, fontSize: 12, color: text } },
    tooltip: {
      trigger: 'axis',
      textStyle: { fontFamily: FONT },
      formatter: (params: Array<{ axisValueLabel: string; seriesName: string; value: number; marker: string }>) =>
        [params[0]?.axisValueLabel ?? '', ...params.map((p) => `${p.marker} ${p.seriesName}: ${toPersianDigits(p.value)}`)].join('<br/>'),
    },
    grid: { top: 36, right: 8, bottom: 24, left: 32 },
    xAxis: {
      type: 'category',
      // RTL reading order: oldest day at the right edge, today at the left.
      inverse: true,
      data: series.map((d) => formatDay(d.date)),
      axisLine: { lineStyle: { color: themed('--color-border') } },
      axisTick: { show: false },
      axisLabel: { fontFamily: FONT, fontSize: 11, color: muted, interval: 'auto', hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      position: 'right',
      minInterval: 1,
      splitLine: { lineStyle: { color: themed('--color-border-soft') } },
      axisLabel: { fontFamily: FONT, fontSize: 11, color: muted, formatter: (v: number) => toPersianDigits(v) },
    },
    series: [
      {
        name: 'ثبت‌شده',
        type: 'bar',
        data: series.map((d) => d.created),
        barMaxWidth: 14,
        itemStyle: { color: themed('--color-accent-text'), borderRadius: [4, 4, 0, 0] },
      },
      {
        name: 'انجام‌شده',
        type: 'line',
        data: series.map((d) => d.completed),
        symbol: 'circle',
        symbolSize: 8,
        lineStyle: { width: 2, color: themed('--tone-info-text') },
        itemStyle: { color: themed('--tone-info-text'), borderColor: themed('--color-surface-card'), borderWidth: 2 },
      },
    ],
  }
})

// ── Breakdowns (CSS meters: a handful of categories reads better as labelled rows) ──────
interface BreakdownRow {
  key: string
  label: string
  count: number
  to?: string
}
const SALON_ORDER: SalonStatus[] = ['pending', 'approved', 'rejected', 'suspended']
const salonRows = computed<BreakdownRow[]>(() =>
  SALON_ORDER.map((st) => ({
    key: st,
    label: salonStatusLabel(st).label,
    count: summary.value?.salons.byStatus[st] ?? 0,
    to: `/salons?status=${st}`,
  })),
)
const ROLE_ORDER: UserRole[] = ['customer', 'provider', 'admin']
const userRows = computed<BreakdownRow[]>(() =>
  ROLE_ORDER.map((role) => ({
    key: role,
    label: userRoleLabel(role),
    count: summary.value?.users.byRole[role] ?? 0,
    to: `/users?role=${role}`,
  })),
)
const planRows = computed<BreakdownRow[]>(() =>
  (summary.value?.subscriptions.byPlan ?? []).map((p) => ({ key: p.planId, label: p.planName, count: p.activeCount })),
)

function share(count: number, rows: BreakdownRow[]): number {
  const max = Math.max(0, ...rows.map((r) => r.count))
  if (max === 0 || count === 0) return 0
  return Math.max(2, Math.round((count / max) * 100))
}

const loadStatusAnnouncement = computed(() => {
  if (loading.value) return ''
  return loadError.value ? 'بارگذاری اطلاعات داشبورد با خطا مواجه شد.' : 'اطلاعات داشبورد بارگذاری شد.'
})

onMounted(load)
</script>

<template>
  <div class="space-y-6 p-4 sm:p-6 lg:p-8">
    <div class="sr-only" role="status" aria-live="polite">{{ loadStatusAnnouncement }}</div>

    <AppCard
      v-if="!loading && loadError"
      role="alert"
      data-testid="dashboard-error-banner"
      class="flex flex-wrap items-center gap-3 bg-(--tone-danger-bg)! text-sm text-(--tone-danger-text)"
    >
      <AppIcon name="warning" :size="18" class="shrink-0" />
      <p class="min-w-0 flex-1">بارگذاری اطلاعات داشبورد با خطا مواجه شد. هیچ عددی نمایش داده نمی‌شود تا با صفر واقعی اشتباه نشود.</p>
      <AppButton type="button" variant="secondary" data-testid="dashboard-retry" @click="load">تلاش دوباره</AppButton>
    </AppCard>

    <!-- 1. What needs an admin now. -->
    <section aria-labelledby="attention-heading" class="space-y-3">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="attention-heading" class="text-base font-bold text-(--color-text)">نیاز به رسیدگی</h2>
        <p v-if="summary" class="tnum text-xs text-(--color-text-muted)">به‌روزرسانی: {{ formatDateTime(summary.generatedAt) }}</p>
      </div>

      <div v-if="loading" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="attention-loading" role="status" aria-label="در حال بارگذاری">
        <div v-for="n in 3" :key="n" class="h-24 animate-pulse rounded-2xl bg-(--color-border-soft)" />
      </div>

      <AppCard
        v-else-if="allClear"
        data-testid="dashboard-all-clear"
        class="flex items-center gap-4"
      >
        <!-- The one mascot moment on the dashboard: nothing is waiting on anyone. -->
        <div class="h-20 w-20 shrink-0 overflow-hidden rounded-3xl bg-(--color-mascot-tile)">
          <img src="/mascot/happy.webp" alt="" width="80" height="80" class="h-full w-full object-cover" />
        </div>
        <div class="min-w-0">
          <p class="text-base font-bold text-(--color-text)">همه‌چیز مرتب است</p>
          <p class="mt-1 text-sm text-(--color-text-muted)">
            سالن، گزارش، درخواست دسته‌بندی، استرداد یا هشدار بحرانی در انتظار رسیدگی نیست و پشتیبان‌گیری به‌روز است.
          </p>
        </div>
      </AppCard>

      <div v-else-if="summary" class="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
        <RouterLink
          v-for="item in attention"
          :key="item.key"
          :to="item.to"
          :data-testid="`attention-${item.key}`"
          class="group flex flex-col rounded-2xl border p-4 transition-shadow hover:shadow-(--shadow-md) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent-text)"
          :class="TONE_TILE[item.tone]"
        >
          <div class="flex items-center justify-between gap-2" :class="TONE_TEXT[item.tone]">
            <AppIcon :name="item.icon" :size="19" class="shrink-0" />
            <span class="tnum font-black" :class="item.key === 'backup' ? 'text-lg' : 'text-2xl'" data-testid="attention-value">{{ item.value }}</span>
          </div>
          <p class="mt-2 text-sm font-semibold text-(--color-text)">{{ item.label }}</p>
          <p v-if="item.detail" class="mt-0.5 text-xs leading-5 text-(--color-text-muted)">{{ item.detail }}</p>
        </RouterLink>
      </div>

      <p v-if="summary && summary.backup.status === 'ok' && summary.backup.lastSuccessAt" data-testid="backup-ok" class="tnum flex items-center gap-1.5 text-xs text-(--color-text-muted)">
        <AppIcon name="check" :size="14" class="text-(--tone-success-text)" />
        آخرین پشتیبان موفق: {{ formatDateTime(summary.backup.lastSuccessAt) }}
      </p>
    </section>

    <!-- 2. Bookings and money. -->
    <section aria-labelledby="activity-heading" class="space-y-3">
      <h2 id="activity-heading" class="text-base font-bold text-(--color-text)">نوبت‌ها و درآمد</h2>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <template v-if="loading || !summary">
          <AppCard v-for="n in 5" :key="n">
            <p class="tnum text-xl font-black text-(--color-text-muted)" data-testid="stat-value">—</p>
            <div class="mt-2 h-3 w-2/3 rounded bg-(--color-border-soft)" :class="loading && 'animate-pulse'" />
          </AppCard>
        </template>
        <AppCard v-for="kpi in kpis" v-else :key="kpi.key" :data-testid="`kpi-${kpi.key}`" class="min-w-0">
          <p class="text-xs font-semibold text-(--color-text-muted)">{{ kpi.label }}</p>
          <p class="mt-1.5 flex flex-wrap items-baseline gap-1">
            <span class="tnum text-xl font-black text-(--color-text) sm:text-2xl" data-testid="stat-value">{{ kpi.value }}</span>
            <span v-if="kpi.unit" class="text-xs text-(--color-text-muted)">{{ kpi.unit }}</span>
          </p>
          <p class="mt-1 text-xs leading-5 text-(--color-text-muted)">{{ kpi.hint }}</p>
        </AppCard>
      </div>

      <div v-if="summary" class="flex flex-wrap gap-2" data-testid="today-breakdown">
        <span class="text-xs font-semibold text-(--color-text-muted)">امروز:</span>
        <span v-for="part in todayBreakdown" :key="part.label" class="tnum rounded-full bg-(--color-surface-card) px-2.5 py-0.5 text-xs text-(--color-text) ring-1 ring-(--color-border)">
          {{ part.label }} {{ fa(part.value) }}
        </span>
      </div>

      <ChartCard
        title="روند ۳۰ روز اخیر"
        subtitle="نوبت‌های ثبت‌شده در هر روز، و نوبت‌هایی که در آن روز انجام شدند"
        :loading="loading"
        :error="loadError"
        :empty="!hasSeriesData"
        empty-message="در ۳۰ روز اخیر نوبتی ثبت نشده است."
      >
        <VChart :option="seriesChart" autoresize class="!h-64" aria-hidden="true" />
        <details class="mt-2 text-xs text-(--color-text-muted)">
          <summary class="cursor-pointer font-semibold hover:text-(--color-text)">نمایش جدول داده‌ها</summary>
          <div class="mt-2 max-h-56 overflow-y-auto">
            <table class="w-full text-start" data-testid="series-table">
              <thead>
                <tr class="text-(--color-text-muted)"><th scope="col" class="py-1 text-start font-semibold">روز</th><th scope="col" class="py-1 text-start font-semibold">ثبت‌شده</th><th scope="col" class="py-1 text-start font-semibold">انجام‌شده</th></tr>
              </thead>
              <tbody class="tnum text-(--color-text)">
                <tr v-for="d in [...(summary?.bookings.series ?? [])].reverse()" :key="d.date" class="border-t border-(--color-border-soft)">
                  <td class="py-1">{{ formatDay(d.date) }}</td><td class="py-1">{{ fa(d.created) }}</td><td class="py-1">{{ fa(d.completed) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </ChartCard>
    </section>

    <!-- 3. Who is on the platform. -->
    <section v-if="summary" aria-labelledby="platform-heading" class="space-y-3">
      <h2 id="platform-heading" class="text-base font-bold text-(--color-text)">سالن‌ها و کاربران</h2>
      <div class="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <AppCard v-for="block in [
          { key: 'salons', title: 'سالن‌ها', total: summary.salons.total, rows: salonRows, extra: '' },
          { key: 'users', title: 'کاربران', total: summary.users.total, rows: userRows, extra: summary.users.suspended > 0 ? `${fa(summary.users.suspended)} حساب معلق` : '' },
          { key: 'plans', title: 'اشتراک فعال به تفکیک پلن', total: null, rows: planRows, extra: '' },
        ]" :key="block.key" :data-testid="`breakdown-${block.key}`">
          <div class="flex items-baseline justify-between gap-2">
            <p class="text-sm font-bold text-(--color-text)">{{ block.title }}</p>
            <p v-if="block.total !== null" class="tnum text-xs text-(--color-text-muted)">مجموع {{ fa(block.total) }}</p>
          </div>
          <p v-if="block.rows.length === 0" class="mt-3 text-xs text-(--color-text-muted)">پلنی تعریف نشده است.</p>
          <ul class="mt-3 space-y-2.5">
            <li v-for="row in block.rows" :key="row.key">
              <component
                :is="row.to ? 'RouterLink' : 'div'"
                :to="row.to"
                class="block rounded-lg"
                :class="row.to && 'hover:bg-(--color-border-soft) -mx-1.5 -my-1 px-1.5 py-1.5'"
              >
                <span class="flex items-center justify-between gap-2 text-sm">
                  <span class="truncate text-(--color-text)">{{ row.label }}</span>
                  <span class="tnum font-semibold text-(--color-text)">{{ fa(row.count) }}</span>
                </span>
                <span class="mt-1 block h-1.5 rounded-full bg-(--color-border-soft)" aria-hidden="true">
                  <span class="block h-full rounded-full bg-(--color-accent-text)" :style="{ width: `${share(row.count, block.rows)}%` }" />
                </span>
              </component>
            </li>
          </ul>
          <p v-if="block.extra" class="mt-3 text-xs font-semibold text-(--tone-warning-text)">{{ block.extra }}</p>
        </AppCard>
      </div>
    </section>
  </div>
</template>
