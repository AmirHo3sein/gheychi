<!-- apps/admin-panel/src/pages/ReportsView.vue -->
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import ResolveReportActions from '@/components/reports/ResolveReportActions.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Pagination from '@/components/ui/Pagination.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { reportStatusLabel } from '@/utils/labels'

// Always an explicit status -- the backend defaults an absent status to 'open',
// so an "all" option would be a lie; the queue is worked one bucket at a time.
const STATUS_OPTIONS = [
  { value: 'open', label: 'باز' },
  { value: 'resolved', label: 'رسیدگی شده' },
  { value: 'dismissed', label: 'رد شده' },
]

interface ReportRow {
  id: string
  reason: string
  status: 'open' | 'resolved' | 'dismissed'
  salonId: string
  salonName: string
  reporterPhone: string
  reviewId: string | null
  reviewRating: number | null
  reviewComment: string | null
  // Set server-side from the resolved target at creation. Unlike the FKs below, it
  // survives the ON DELETE SET NULL cascade -- so it (never the nullable FKs) is what
  // discriminates which quoted-content block a report renders.
  targetType: 'salon' | 'review' | 'story' | 'portfolio'
  // Story/portfolio context is nullable by construction: the FK is ON DELETE SET NULL,
  // so a provider delete or the expiry GC nulls it and only the report text survives.
  storyId: string | null
  storyUrl: string | null
  storyCaption: string | null
  portfolioItemId: string | null
  portfolioItemUrl: string | null
  portfolioItemCaption: string | null
  resolutionNote: string | null
  createdAt: string
}

interface ReportListResponse {
  items: ReportRow[]
  total: number
  page: number
  pageSize: number
}

const { apiFetch } = useApi()
const reports = ref<ReportRow[]>([])
const loading = ref(true)
// Distinguishes a genuinely empty queue from a failed fetch -- a silently-broken "all
// clear" queue is a real trust-and-safety risk on this page specifically, so the error
// is surfaced instead of being swallowed by `silent: true`.
const loadError = ref(false)
const page = ref(1)
const total = ref(0)
const pageSize = 10

const statusFilter = ref<'open' | 'resolved' | 'dismissed'>('open')

async function load() {
  loading.value = true
  loadError.value = false
  const params = new URLSearchParams({
    status: statusFilter.value,
    page: String(page.value),
    pageSize: String(pageSize),
  })
  const { data, error } = await apiFetch<ReportListResponse>(`/admin/reports?${params.toString()}`, { silent: true })
  reports.value = data?.items ?? []
  total.value = data?.total ?? 0
  loadError.value = error !== null
  loading.value = false
  // Resolving the last item on a page > 1 can leave us past the end (empty page, total > 0,
  // Pagination hidden) — step back so the admin isn't stranded; the page watcher reloads.
  if (reports.value.length === 0 && total.value > 0 && page.value > 1) {
    page.value -= 1
  }
}

function loadFromFilterChange() {
  // Any filter change invalidates the current page position. When we're past page 1,
  // just reset it -- the page watcher triggers the (single) reload; calling load() here
  // too would fire a duplicate request.
  if (page.value !== 1) {
    page.value = 1
  } else {
    load()
  }
}

// Both a successful action and a failed one (409 lost race) re-run load(): on success
// the handled card leaves the open queue and total/pagination stay truthful; on failure
// the row refreshes to the winning admin's state instead of lingering as a stale 'open'.
function onActionFinished() {
  load()
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso))
}

onMounted(load)
watch(statusFilter, loadFromFilterChange)
watch(page, load)
</script>

<template>
  <div class="space-y-5 p-8">
    <AppCard :padded="false" class="p-4">
      <div class="flex flex-wrap items-end gap-3">
        <div data-testid="status-filter">
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">وضعیت</label>
          <AppSelect v-model="statusFilter" :options="STATUS_OPTIONS" width="10rem" />
        </div>
      </div>
    </AppCard>

    <div v-if="loading" class="flex h-40 items-center justify-center" role="status" aria-label="در حال بارگذاری" data-testid="reports-loading">
      <AppIcon name="spinner" :size="24" class="animate-spin text-(--color-text-muted)" />
    </div>

    <div
      v-else-if="loadError"
      data-testid="reports-error"
      class="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-(--tone-danger-text) py-16 text-center"
    >
      <AppIcon name="warning" :size="22" class="text-(--tone-danger-text)" />
      <p class="text-sm text-(--tone-danger-text)">بارگذاری گزارش‌ها با خطا مواجه شد. ممکن است گزارش‌های باز دیده‌نشده وجود داشته باشند.</p>
      <AppButton type="button" variant="secondary" data-testid="reports-retry" @click="load">
        <template #icon><AppIcon name="reset" :size="15" /></template>
        تلاش مجدد
      </AppButton>
    </div>

    <EmptyState v-else-if="reports.length === 0" icon="flag" message="گزارشی با این وضعیت وجود ندارد." />

    <div v-else class="space-y-3">
      <AppCard v-for="report in reports" :key="report.id" data-testid="report-card">
        <div class="flex items-start justify-between gap-4">
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span class="tnum font-semibold text-(--color-text)">{{ report.reporterPhone }}</span>
            <span class="text-(--color-text-muted)">درباره</span>
            <RouterLink :to="`/salons/${report.salonId}`" class="font-semibold text-(--color-accent-text) hover:opacity-80">
              {{ report.salonName }}
            </RouterLink>
          </div>
          <StatusBadge :label="reportStatusLabel(report.status).label" :tone="reportStatusLabel(report.status).tone" />
        </div>

        <p class="mt-3 text-sm leading-6 text-(--color-text)">{{ report.reason }}</p>

        <div v-if="report.reviewId" data-testid="quoted-review" class="mt-3 rounded-xl bg-(--color-border-soft) p-3">
          <p class="mb-1 flex items-center gap-1.5 text-xs font-semibold text-(--color-text-muted)">
            <AppIcon name="star" :size="13" />
            نظر گزارش‌شده — امتیاز {{ report.reviewRating ?? '—' }}
          </p>
          <p class="text-sm text-(--color-text)">{{ report.reviewComment ?? '(بدون متن)' }}</p>
          <!-- Only salon-target reports get a natural escalation path via the salon-name
               link above; review-target reports need their own way to reach the flagged
               content, since ReviewsView.vue has no per-review deep link, only salonId. -->
          <RouterLink
            :to="`/reviews?salonId=${report.salonId}`"
            data-testid="review-escalation-link"
            class="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-(--color-accent-text) hover:opacity-80"
          >
            <AppIcon name="reviews" :size="13" />
            مشاهده نظرات این سالن
          </RouterLink>
        </div>

        <!-- Gated on targetType, NOT the storyId FK: ON DELETE SET NULL nulls the FK when
             the provider deletes the story or the expiry GC collects it, and that is exactly
             when the fallback placeholder must still identify the report as story-targeted. -->
        <div v-if="report.targetType === 'story'" data-testid="quoted-story" class="mt-3 rounded-xl bg-(--color-border-soft) p-3">
          <p class="mb-1 flex items-center gap-1.5 text-xs font-semibold text-(--color-text-muted)">
            <AppIcon name="sparkles" :size="13" />
            استوری گزارش‌شده
          </p>
          <template v-if="report.storyUrl">
            <img
              :src="report.storyUrl"
              :alt="report.storyCaption || 'تصویر استوری گزارش‌شده'"
              class="h-24 w-24 rounded-xl object-cover"
            />
            <p v-if="report.storyCaption" class="mt-2 text-sm text-(--color-text)">{{ report.storyCaption }}</p>
          </template>
          <!-- A story reaches here two ways -- the provider deleted it, or the 24h GC
               collected it -- and nothing on the row distinguishes them, so the copy must
               cover both rather than assert the benign one. -->
          <p v-else data-testid="story-gone-note" class="text-sm text-(--color-text-muted)">
            این استوری دیگر در دسترس نیست؛ یا آرایشگاه‌دار آن را حذف کرده یا مهلت ۲۴ ساعته‌اش تمام شده است. گزارش را بر اساس متن آن بررسی کنید.
          </p>
        </div>

        <div v-if="report.targetType === 'portfolio'" data-testid="quoted-portfolio-item" class="mt-3 rounded-xl bg-(--color-border-soft) p-3">
          <p class="mb-1 flex items-center gap-1.5 text-xs font-semibold text-(--color-text-muted)">
            <AppIcon name="brush" :size="13" />
            نمونه کار گزارش‌شده
          </p>
          <template v-if="report.portfolioItemUrl">
            <img
              :src="report.portfolioItemUrl"
              :alt="report.portfolioItemCaption || 'تصویر نمونه‌کار گزارش‌شده'"
              class="h-24 w-24 rounded-xl object-cover"
            />
            <p v-if="report.portfolioItemCaption" class="mt-2 text-sm text-(--color-text)">{{ report.portfolioItemCaption }}</p>
          </template>
          <!-- Portfolio items have no expiry column at all -- nothing ever collects them --
               so a nulled FK can only mean the provider deleted the item themselves. Saying
               "expired" here would read as benign and no-action-needed; it is the opposite. -->
          <p v-else data-testid="portfolio-gone-note" class="text-sm text-(--color-text-muted)">
            این نمونه کار توسط آرایشگاه‌دار حذف شده است. گزارش را بر اساس متن آن بررسی کنید.
          </p>
        </div>

        <div v-if="report.resolutionNote" class="mt-3 rounded-xl bg-(--color-border-soft) p-3">
          <p class="mb-1 text-xs font-semibold text-(--color-text-muted)">یادداشت رسیدگی</p>
          <p class="text-sm text-(--color-text)">{{ report.resolutionNote }}</p>
        </div>

        <p class="tnum mt-3 text-xs text-(--color-text-muted)">{{ formatDate(report.createdAt) }}</p>

        <div v-if="report.status === 'open'" class="mt-4 border-t border-(--color-border-soft) pt-3.5">
          <ResolveReportActions :report-id="report.id" @updated="onActionFinished" @refresh="onActionFinished" />
        </div>
      </AppCard>
    </div>

    <AppCard v-if="!loading && reports.length > 0" :padded="false">
      <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="(p) => (page = p)" />
    </AppCard>
  </div>
</template>
