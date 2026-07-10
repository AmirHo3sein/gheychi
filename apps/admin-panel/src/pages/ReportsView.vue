<!-- apps/admin-panel/src/pages/ReportsView.vue -->
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import ResolveReportActions from '@/components/reports/ResolveReportActions.vue'
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
const page = ref(1)
const total = ref(0)
const pageSize = 10

const statusFilter = ref<'open' | 'resolved' | 'dismissed'>('open')

async function load() {
  loading.value = true
  const params = new URLSearchParams({
    status: statusFilter.value,
    page: String(page.value),
    pageSize: String(pageSize),
  })
  const { data } = await apiFetch<ReportListResponse>(`/admin/reports?${params.toString()}`, { silent: true })
  reports.value = data?.items ?? []
  total.value = data?.total ?? 0
  loading.value = false
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

function onUpdated(reportId: string, status: string) {
  const report = reports.value.find((r) => r.id === reportId)
  if (report) report.status = status as ReportRow['status']
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
          <label class="mb-1.5 block text-xs font-semibold text-(--color-muted)">وضعیت</label>
          <AppSelect v-model="statusFilter" :options="STATUS_OPTIONS" width="10rem" />
        </div>
      </div>
    </AppCard>

    <EmptyState v-if="!loading && reports.length === 0" icon="flag" message="گزارشی با این وضعیت وجود ندارد." />

    <div v-else class="space-y-3">
      <AppCard v-for="report in reports" :key="report.id" data-testid="report-card">
        <div class="flex items-start justify-between gap-4">
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span class="tnum font-semibold text-(--color-text)">{{ report.reporterPhone }}</span>
            <span class="text-(--color-muted)">درباره</span>
            <RouterLink :to="`/salons/${report.salonId}`" class="font-semibold text-(--color-accent) hover:opacity-80">
              {{ report.salonName }}
            </RouterLink>
          </div>
          <StatusBadge :label="reportStatusLabel(report.status).label" :tone="reportStatusLabel(report.status).tone" />
        </div>

        <p class="mt-3 text-sm leading-6 text-(--color-text)">{{ report.reason }}</p>

        <div v-if="report.reviewId" data-testid="quoted-review" class="mt-3 rounded-xl bg-(--color-border-soft) p-3">
          <p class="mb-1 flex items-center gap-1.5 text-xs font-semibold text-(--color-muted)">
            <AppIcon name="star" :size="13" />
            نظر گزارش‌شده — امتیاز {{ report.reviewRating }}
          </p>
          <p class="text-sm text-(--color-text)">{{ report.reviewComment ?? '(بدون متن)' }}</p>
        </div>

        <div v-if="report.resolutionNote" class="mt-3 rounded-xl bg-(--color-border-soft) p-3">
          <p class="mb-1 text-xs font-semibold text-(--color-muted)">یادداشت رسیدگی</p>
          <p class="text-sm text-(--color-text)">{{ report.resolutionNote }}</p>
        </div>

        <p class="tnum mt-3 text-xs text-(--color-muted)">{{ formatDate(report.createdAt) }}</p>

        <div v-if="report.status === 'open'" class="mt-4 border-t border-(--color-border-soft) pt-3.5">
          <ResolveReportActions :report-id="report.id" @updated="(r) => onUpdated(r.id, r.status)" />
        </div>
      </AppCard>
    </div>

    <AppCard v-if="!loading && reports.length > 0" :padded="false">
      <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="(p) => (page = p)" />
    </AppCard>
  </div>
</template>
