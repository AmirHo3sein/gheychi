<!-- apps/admin-panel/src/pages/DashboardView.vue -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { PieChart, BarChart } from 'echarts/charts'
import { TitleComponent, TooltipComponent, LegendComponent, GridComponent } from 'echarts/components'
import VChart from 'vue-echarts'
import { useApi } from '@/composables/useApi'
import { useTheme } from '@/composables/useTheme'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon, { type IconName } from '@/components/ui/AppIcon.vue'
import { genderTargetLabel, salonStatusLabel, userRoleLabel } from '@/utils/labels'
import { toPersianDigits } from '@/utils/digits'

use([CanvasRenderer, PieChart, BarChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent])

interface SalonRow {
  status: 'pending' | 'approved' | 'rejected' | 'suspended'
  genderTarget: 'women' | 'men'
}
interface UserRow {
  role: 'customer' | 'provider' | 'admin'
  status: 'active' | 'suspended'
}
interface ReviewRow {
  rating: number
  status: 'published' | 'rejected'
}
interface CategoryRow {
  id: number
}

const { apiFetch } = useApi()
const loading = ref(true)
const loadError = ref(false)
const salons = ref<SalonRow[]>([])
const users = ref<UserRow[]>([])
const reviews = ref<ReviewRow[]>([])
const categoryCount = ref(0)
const openReportCount = ref(0)

const { isDark } = useTheme()

const FONT = "'Vazirmatn Variable', ui-sans-serif, system-ui, sans-serif"

// ECharts renders to canvas and can't read CSS custom properties, so its colors are
// resolved here per-theme instead -- duplicates the tone/accent hex values from
// main.css's .dark block, kept in sync with StatusBadge's own tone colors.
type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info' | 'accent'
const TONE_HEX: Record<Tone, { light: string; dark: string }> = {
  success: { light: '#34744E', dark: '#53B179' },
  warning: { light: '#8F600A', dark: '#F2B440' },
  danger: { light: '#C92222', dark: '#E66B6B' },
  neutral: { light: '#5C5656', dark: '#B7B0AC' },
  info: { light: '#1B68B6', dark: '#64A5E8' },
  accent: { light: '#FFB6A3', dark: '#FFB6A3' },
}
function toneColor(tone: Tone): string {
  return isDark.value ? TONE_HEX[tone].dark : TONE_HEX[tone].light
}

// ECharts renders to canvas and formats its own tooltip/axis-label numbers as plain JS
// `String(number)` (Latin digits) unless told otherwise -- ordinary toLocaleString('fa-IR')
// template usage elsewhere in this app doesn't reach these, since ECharts owns this text
// itself. `unknown` params (not echarts' own types, not a direct dependency of this app)
// kept minimal to just the two fields each formatter below actually reads.
function pieTooltipFormatter(params: { name: string; value: number; percent: number }): string {
  return `${params.name}: ${toPersianDigits(params.value)} (${toPersianDigits(Math.round(params.percent))}٪)`
}

const TONE_BG: Record<'success' | 'warning' | 'danger' | 'info', string> = {
  success: 'bg-(--tone-success-bg) text-(--tone-success-text)',
  warning: 'bg-(--tone-warning-bg) text-(--tone-warning-text)',
  danger: 'bg-(--tone-danger-bg) text-(--tone-danger-text)',
  info: 'bg-(--tone-info-bg) text-(--tone-info-text)',
}

interface Stat {
  label: string
  value: number
  icon: IconName
  tone: 'success' | 'warning' | 'danger' | 'info'
  to: string
}

const pendingSalons = computed(() => salons.value.filter((s) => s.status === 'pending').length)
const suspendedUsers = computed(() => users.value.filter((u) => u.status === 'suspended').length)
const publishedReviews = computed(() => reviews.value.filter((r) => r.status === 'published').length)

const stats = computed<Stat[]>(() => [
  { label: 'در انتظار بررسی', value: pendingSalons.value, icon: 'salons', tone: 'warning', to: '/salons' },
  { label: 'گزارش‌های باز', value: openReportCount.value, icon: 'flag', tone: 'danger', to: '/reports' },
  { label: 'کاربران معلق', value: suspendedUsers.value, icon: 'users', tone: 'danger', to: '/users' },
  { label: 'نظرات منتشر شده', value: publishedReviews.value, icon: 'reviews', tone: 'success', to: '/reviews' },
  { label: 'دسته‌بندی‌های خدمات', value: categoryCount.value, icon: 'categories', tone: 'info', to: '/categories' },
])

const QUICK_LINKS: { to: string; label: string; icon: IconName; desc: string }[] = [
  { to: '/salons', label: 'آرایشگاه‌ها', icon: 'salons', desc: 'بررسی، تایید و رد درخواست‌ها' },
  { to: '/reviews', label: 'نظرات', icon: 'reviews', desc: 'مدیریت و تعدیل نظرات کاربران' },
  { to: '/reports', label: 'گزارش‌ها', icon: 'flag', desc: 'رسیدگی به گزارش‌های کاربران' },
  { to: '/categories', label: 'دسته‌بندی‌ها', icon: 'categories', desc: 'افزودن و ویرایش خدمات' },
  { to: '/users', label: 'کاربران', icon: 'users', desc: 'جست‌وجو و مدیریت وضعیت کاربران' },
  { to: '/config', label: 'تنظیمات پلتفرم', icon: 'config', desc: 'مقادیر پیش‌پرداخت، کمیسیون و...' },
]

const baseTextStyle = computed(() => ({ fontFamily: FONT, color: isDark.value ? '#F7F4F2' : '#2D2D2D' }))
const sliceBorderColor = computed(() => (isDark.value ? '#262323' : '#FFFFFF'))
const axisLineColor = computed(() => (isDark.value ? '#494444' : '#E2D7D3'))
const splitLineColor = computed(() => (isDark.value ? '#3A3636' : '#EFE7E4'))
const axisLabelColor = computed(() => (isDark.value ? '#B8B0AB' : '#777777'))

const salonStatusChart = computed(() => {
  const order: SalonRow['status'][] = ['pending', 'approved', 'rejected', 'suspended']
  const data = order.map((status) => ({
    name: salonStatusLabel(status).label,
    value: salons.value.filter((s) => s.status === status).length,
    itemStyle: { color: toneColor(salonStatusLabel(status).tone) },
  }))
  return {
    textStyle: baseTextStyle.value,
    tooltip: { trigger: 'item', textStyle: { fontFamily: FONT }, formatter: pieTooltipFormatter },
    legend: { bottom: 0, textStyle: { fontFamily: FONT, fontSize: 11, color: baseTextStyle.value.color } },
    series: [
      {
        type: 'pie',
        radius: ['48%', '72%'],
        center: ['50%', '42%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: sliceBorderColor.value, borderWidth: 2 },
        label: { show: false },
        emphasis: { label: { show: true, fontWeight: 'bold', fontFamily: FONT } },
        data,
      },
    ],
  }
})

const genderChart = computed(() => {
  const order: SalonRow['genderTarget'][] = ['women', 'men']
  const colors: Tone[] = ['accent', 'info']
  const data = order.map((g, i) => ({
    name: genderTargetLabel(g),
    value: salons.value.filter((s) => s.genderTarget === g).length,
    itemStyle: { color: toneColor(colors[i]) },
  }))
  return {
    textStyle: baseTextStyle.value,
    tooltip: { trigger: 'item', textStyle: { fontFamily: FONT }, formatter: pieTooltipFormatter },
    legend: { bottom: 0, textStyle: { fontFamily: FONT, fontSize: 11, color: baseTextStyle.value.color } },
    series: [
      {
        type: 'pie',
        radius: ['48%', '72%'],
        center: ['50%', '42%'],
        itemStyle: { borderColor: sliceBorderColor.value, borderWidth: 2 },
        label: { show: false },
        emphasis: { label: { show: true, fontWeight: 'bold', fontFamily: FONT } },
        data,
      },
    ],
  }
})

const userRoleChart = computed(() => {
  const order: UserRow['role'][] = ['customer', 'provider', 'admin']
  const colors: Tone[] = ['accent', 'info', 'neutral']
  const data = order.map((role, i) => ({
    name: userRoleLabel(role),
    value: users.value.filter((u) => u.role === role).length,
    itemStyle: { color: toneColor(colors[i]) },
  }))
  return {
    textStyle: baseTextStyle.value,
    tooltip: { trigger: 'item', textStyle: { fontFamily: FONT }, formatter: pieTooltipFormatter },
    legend: { bottom: 0, textStyle: { fontFamily: FONT, fontSize: 11, color: baseTextStyle.value.color } },
    series: [
      {
        type: 'pie',
        radius: ['48%', '72%'],
        center: ['50%', '42%'],
        itemStyle: { borderColor: sliceBorderColor.value, borderWidth: 2 },
        label: { show: false },
        emphasis: { label: { show: true, fontWeight: 'bold', fontFamily: FONT } },
        data,
      },
    ],
  }
})

const ratingChart = computed(() => {
  const counts = [1, 2, 3, 4, 5].map((star) => reviews.value.filter((r) => r.rating === star).length)
  return {
    textStyle: baseTextStyle.value,
    tooltip: {
      trigger: 'axis',
      textStyle: { fontFamily: FONT },
      // 'axis' trigger hands the formatter an array (one entry per series at that category --
      // just the one bar series here), unlike the pie charts' single-object 'item' trigger.
      formatter: (params: Array<{ name: string; value: number }>) => {
        const p = params[0]
        return p ? `${p.name}: ${toPersianDigits(p.value)}` : ''
      },
    },
    grid: { top: 20, right: 16, bottom: 24, left: 28 },
    xAxis: {
      type: 'category',
      data: ['۱ ستاره', '۲ ستاره', '۳ ستاره', '۴ ستاره', '۵ ستاره'],
      axisLine: { lineStyle: { color: axisLineColor.value } },
      axisLabel: { fontFamily: FONT, fontSize: 11, color: axisLabelColor.value },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: splitLineColor.value } },
      axisLabel: { fontFamily: FONT, fontSize: 11, color: axisLabelColor.value, formatter: (value: number) => toPersianDigits(value) },
    },
    series: [
      {
        type: 'bar',
        data: counts,
        barMaxWidth: 36,
        itemStyle: { color: toneColor('accent'), borderRadius: [6, 6, 0, 0] },
      },
    ],
  }
})

const hasSalonData = computed(() => salons.value.length > 0)
const hasUserData = computed(() => users.value.length > 0)
const hasReviewData = computed(() => reviews.value.length > 0)

// Distinct from "0" everywhere above -- a failed fetch must never be indistinguishable
// from a genuine zero-count, so every stat/chart consults this alongside `loading`.
const loadStatusAnnouncement = computed(() => {
  if (loading.value) return ''
  return loadError.value ? 'بارگذاری اطلاعات داشبورد با خطا مواجه شد.' : 'اطلاعات داشبورد بارگذاری شد.'
})

onMounted(async () => {
  // Salons/reviews are paginated endpoints (see SalonsView/ReviewsView) -- the dashboard
  // charts need the full distribution, not one page of it, so pageSize is set to the
  // backend's own max (100). Fine for this admin tool's scale; would need a dedicated
  // aggregate/stats endpoint if the dataset ever meaningfully exceeds that.
  const [salonsRes, usersRes, reviewsRes, categoriesRes, reportsRes] = await Promise.all([
    apiFetch<{ items: SalonRow[]; total: number }>('/admin/salons?status=all&pageSize=100', { silent: true }),
    // Paginated like salons/reviews above (pageSize maxes at 100 server-side) -- the role
    // and status breakdowns below need the distribution, not one default-sized page.
    apiFetch<{ items: UserRow[]; total: number }>('/admin/users?pageSize=100', { silent: true }),
    apiFetch<{ items: ReviewRow[]; total: number }>('/admin/reviews?pageSize=100', { silent: true }),
    apiFetch<CategoryRow[]>('/categories', { silent: true }),
    // Only the total matters for the stat card -- pageSize=1 keeps the payload minimal.
    apiFetch<{ items: unknown[]; total: number }>('/admin/reports?status=open&pageSize=1', { silent: true }),
  ])
  salons.value = salonsRes.data?.items ?? []
  users.value = usersRes.data?.items ?? []
  reviews.value = reviewsRes.data?.items ?? []
  categoryCount.value = categoriesRes.data?.length ?? 0
  openReportCount.value = reportsRes.data?.total ?? 0
  loadError.value = [salonsRes, usersRes, reviewsRes, categoriesRes, reportsRes].some((res) => res.error !== null)
  loading.value = false
})
</script>

<template>
  <div class="space-y-6 p-4">
    <!-- Visually hidden -- announces load completion/failure for screen-reader users,
         since the stat cards/charts themselves only convey it visually. -->
    <div class="sr-only" role="status" aria-live="polite">{{ loadStatusAnnouncement }}</div>

    <p
      v-if="!loading && loadError"
      role="alert"
      data-testid="dashboard-error-banner"
      class="flex items-center gap-2 rounded-xl bg-(--tone-danger-bg) p-3 text-sm text-(--tone-danger-text)"
    >
      <AppIcon name="warning" :size="16" class="shrink-0" />
      بارگذاری برخی اطلاعات داشبورد با خطا مواجه شد. اعداد و نمودارهای زیر ممکن است ناقص باشند.
    </p>

    <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      <RouterLink v-for="stat in stats" :key="stat.label" :to="stat.to">
        <AppCard class="transition-shadow hover:shadow-(--shadow-lg)">
          <!-- Two columns of these land at ~110px on a 320px screen; the 40px icon tile plus
               a three-digit `text-2xl` count overruns the card's own padding there, so the
               count steps down one size below `sm` (still the largest text on the card) and
               the gap keeps the two from touching. Unchanged from `sm` up. -->
          <div class="flex items-center justify-between gap-2">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" :class="TONE_BG[stat.tone]">
              <AppIcon :name="stat.icon" :size="19" />
            </div>
            <span class="tnum text-xl font-black text-(--color-text) sm:text-2xl" data-testid="stat-value">{{
              loading || loadError ? '—' : stat.value.toLocaleString('fa-IR')
            }}</span>
          </div>
          <p class="mt-3 text-sm text-(--color-text-muted)">{{ stat.label }}</p>
        </AppCard>
      </RouterLink>
    </div>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <AppCard>
        <p class="mb-1 text-sm font-bold text-(--color-text)">وضعیت آرایشگاه‌ها</p>
        <p class="mb-2 text-xs text-(--color-text-muted)">توزیع آرایشگاه‌ها بر اساس وضعیت بررسی</p>
        <div v-if="loading" class="flex h-64 items-center justify-center" role="status" aria-label="در حال بارگذاری" data-testid="chart-loading">
          <AppIcon name="spinner" :size="24" class="animate-spin text-(--color-text-muted)" />
        </div>
        <p v-else-if="loadError" class="py-16 text-center text-sm text-(--tone-danger-text)" data-testid="chart-error">بارگذاری داده‌ها با خطا مواجه شد.</p>
        <VChart v-else-if="hasSalonData" :option="salonStatusChart" autoresize class="!h-64" />
        <p v-else class="py-16 text-center text-sm text-(--color-text-muted)">داده‌ای برای نمایش موجود نیست.</p>
      </AppCard>

      <AppCard>
        <p class="mb-1 text-sm font-bold text-(--color-text)">مخاطب آرایشگاه‌ها</p>
        <p class="mb-2 text-xs text-(--color-text-muted)">سهم آرایشگاه‌های بانوان و آقایان</p>
        <div v-if="loading" class="flex h-64 items-center justify-center" role="status" aria-label="در حال بارگذاری" data-testid="chart-loading">
          <AppIcon name="spinner" :size="24" class="animate-spin text-(--color-text-muted)" />
        </div>
        <p v-else-if="loadError" class="py-16 text-center text-sm text-(--tone-danger-text)" data-testid="chart-error">بارگذاری داده‌ها با خطا مواجه شد.</p>
        <VChart v-else-if="hasSalonData" :option="genderChart" autoresize class="!h-64" />
        <p v-else class="py-16 text-center text-sm text-(--color-text-muted)">داده‌ای برای نمایش موجود نیست.</p>
      </AppCard>

      <AppCard>
        <p class="mb-1 text-sm font-bold text-(--color-text)">نقش کاربران</p>
        <p class="mb-2 text-xs text-(--color-text-muted)">توزیع کاربران بر اساس نقش</p>
        <div v-if="loading" class="flex h-64 items-center justify-center" role="status" aria-label="در حال بارگذاری" data-testid="chart-loading">
          <AppIcon name="spinner" :size="24" class="animate-spin text-(--color-text-muted)" />
        </div>
        <p v-else-if="loadError" class="py-16 text-center text-sm text-(--tone-danger-text)" data-testid="chart-error">بارگذاری داده‌ها با خطا مواجه شد.</p>
        <VChart v-else-if="hasUserData" :option="userRoleChart" autoresize class="!h-64" />
        <p v-else class="py-16 text-center text-sm text-(--color-text-muted)">داده‌ای برای نمایش موجود نیست.</p>
      </AppCard>
    </div>

    <AppCard>
      <p class="mb-1 text-sm font-bold text-(--color-text)">توزیع امتیاز نظرات</p>
      <p class="mb-2 text-xs text-(--color-text-muted)">تعداد نظرات ثبت‌شده به تفکیک امتیاز</p>
      <div v-if="loading" class="flex h-64 items-center justify-center" role="status" aria-label="در حال بارگذاری" data-testid="chart-loading">
        <AppIcon name="spinner" :size="24" class="animate-spin text-(--color-text-muted)" />
      </div>
      <p v-else-if="loadError" class="py-16 text-center text-sm text-(--tone-danger-text)" data-testid="chart-error">بارگذاری داده‌ها با خطا مواجه شد.</p>
      <VChart v-else-if="hasReviewData" :option="ratingChart" autoresize class="!h-64" />
      <p v-else class="py-16 text-center text-sm text-(--color-text-muted)">هنوز نظری ثبت نشده است.</p>
    </AppCard>

    <div>
      <h2 class="mb-3 text-sm font-bold text-(--color-text-muted)">دسترسی سریع</h2>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <RouterLink v-for="link in QUICK_LINKS" :key="link.to" :to="link.to">
          <AppCard class="flex items-center gap-3.5 transition-shadow hover:shadow-(--shadow-lg)">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--color-border-soft) text-(--color-accent-text)">
              <AppIcon :name="link.icon" :size="19" />
            </div>
            <div class="min-w-0">
              <p class="font-semibold text-(--color-text)">{{ link.label }}</p>
              <p class="truncate text-xs text-(--color-text-muted)">{{ link.desc }}</p>
            </div>
            <!-- `ms-auto`, not `mr-auto`: identical in this RTL-only app, but the logical
                 property is the one that stays correct if a direction ever changes. -->
            <AppIcon name="chevron-left" :size="16" class="ms-auto shrink-0 text-(--color-border)" />
          </AppCard>
        </RouterLink>
      </div>
    </div>
  </div>
</template>
