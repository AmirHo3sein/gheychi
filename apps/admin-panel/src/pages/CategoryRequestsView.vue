<!-- apps/admin-panel/src/pages/CategoryRequestsView.vue -->
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import ResolveCategoryRequestActions from '@/components/category-requests/ResolveCategoryRequestActions.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Pagination from '@/components/ui/Pagination.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { categoryRequestStatusLabel } from '@/utils/labels'

// Mirrors ReportsView.vue: always an explicit status (the backend defaults an absent
// status to 'pending'), the queue is worked one bucket at a time.
const STATUS_OPTIONS = [
  { value: 'pending', label: 'در انتظار بررسی' },
  { value: 'approved', label: 'تایید شده' },
  { value: 'rejected', label: 'رد شده' },
  { value: 'all', label: 'همه' },
]

interface CategoryRequestRow {
  id: string
  requesterId: string
  salonId: string
  name: string
  note: string | null
  status: 'pending' | 'approved' | 'rejected'
  resolutionNote: string | null
  resolvedBy: string | null
  resolvedAt: string | null
  categoryId: number | null
  createdAt: string
  salonName: string
  requesterPhone: string
}

interface CategoryRequestListResponse {
  items: CategoryRequestRow[]
  total: number
  page: number
  pageSize: number
}

const { apiFetch } = useApi()
const requests = ref<CategoryRequestRow[]>([])
const loading = ref(true)
const loadError = ref(false)
const page = ref(1)
const total = ref(0)
const pageSize = 10

const statusFilter = ref<'pending' | 'approved' | 'rejected' | 'all'>('pending')

async function load() {
  loading.value = true
  loadError.value = false
  const params = new URLSearchParams({
    status: statusFilter.value,
    page: String(page.value),
    pageSize: String(pageSize),
  })
  const { data, error } = await apiFetch<CategoryRequestListResponse>(`/admin/category-requests?${params.toString()}`, {
    silent: true,
  })
  requests.value = data?.items ?? []
  total.value = data?.total ?? 0
  loadError.value = error !== null
  loading.value = false
  // Resolving the last item on a page > 1 can leave us past the end -- step back so the
  // admin isn't stranded, same as ReportsView.vue.
  if (requests.value.length === 0 && total.value > 0 && page.value > 1) {
    page.value -= 1
  }
}

function loadFromFilterChange() {
  if (page.value !== 1) {
    page.value = 1
  } else {
    load()
  }
}

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

    <div v-if="loading" class="flex h-40 items-center justify-center" role="status" aria-label="در حال بارگذاری" data-testid="requests-loading">
      <AppIcon name="spinner" :size="24" class="animate-spin text-(--color-text-muted)" />
    </div>

    <AppCard
      v-else-if="loadError"
      :padded="false"
      data-testid="requests-error"
      class="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center"
    >
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-(--tone-danger-bg) text-(--tone-danger-text)">
        <AppIcon name="warning" :size="22" />
      </div>
      <p class="text-sm text-(--color-text-muted)">بارگذاری درخواست‌ها با خطا مواجه شد.</p>
      <AppButton type="button" variant="secondary" data-testid="requests-retry" @click="load">
        <template #icon><AppIcon name="reset" :size="15" /></template>
        تلاش مجدد
      </AppButton>
    </AppCard>

    <EmptyState v-else-if="requests.length === 0" icon="tag" message="درخواستی با این وضعیت وجود ندارد." />

    <div v-else class="space-y-3">
      <AppCard v-for="req in requests" :key="req.id" data-testid="category-request-card" class="break-words">
        <div class="flex items-start justify-between gap-4">
          <div class="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <span class="font-semibold text-(--color-text)">{{ req.name }}</span>
            <span class="text-(--color-text-muted)">از طرف</span>
            <RouterLink :to="`/salons/${req.salonId}`" class="font-semibold text-(--color-accent-text) hover:opacity-80">
              {{ req.salonName }}
            </RouterLink>
            <span class="tnum text-(--color-text-muted)">({{ req.requesterPhone }})</span>
          </div>
          <StatusBadge :label="categoryRequestStatusLabel(req.status).label" :tone="categoryRequestStatusLabel(req.status).tone" />
        </div>

        <p v-if="req.note" class="mt-3 text-sm leading-6 text-(--color-text)">{{ req.note }}</p>

        <div v-if="req.resolutionNote" class="mt-3 rounded-xl bg-(--color-border-soft) p-3">
          <p class="mb-1 text-xs font-semibold text-(--color-text-muted)">یادداشت رسیدگی</p>
          <p class="text-sm text-(--color-text)">{{ req.resolutionNote }}</p>
        </div>

        <p class="tnum mt-3 text-xs text-(--color-text-muted)">{{ formatDate(req.createdAt) }}</p>

        <div v-if="req.status === 'pending'" class="mt-4 border-t border-(--color-border-soft) pt-3.5">
          <ResolveCategoryRequestActions :request-id="req.id" :requested-name="req.name" @updated="onActionFinished" @refresh="onActionFinished" />
        </div>
      </AppCard>
    </div>

    <AppCard v-if="!loading && requests.length > 0" :padded="false">
      <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="(p) => (page = p)" />
    </AppCard>
  </div>
</template>
