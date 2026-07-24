<!-- apps/admin-panel/src/pages/WorkerRatingsView.vue -->
<!--
  Mirrors ReviewsView.vue's exact shape (filter card, list, publish/reject toggle,
  pagination) per the design spec (§8, "Worker Ratings Moderation ... mirrors the
  existing Reviews moderation screen exactly").

  JUDGMENT CALL / KNOWN GAP: the implemented backend (apps/api/src/reviews/) only ships
  PATCH /admin/worker-ratings/:id/status (AdminWorkerRatingsController) -- there is no
  GET list endpoint for admin worker-rating moderation anywhere in the codebase (grepped
  reviews/, salons/public-salon-content.controller.ts, and every DTO under reviews/dto and
  salons/dto -- the only other worker-rating read is the PUBLIC, published-only,
  single-worker-scoped GET /salons/:slug/workers/:id/ratings, which can't power an
  admin-wide moderation queue since it can't surface 'rejected' rows or cross salons).
  AdminReviewQueryDto/ReviewsService.listForAdmin() also has no query param that scopes
  down to worker-rated reviews only, so there's no existing mechanism to reuse via a query
  param either.

  This page is therefore written against GET /admin/worker-ratings (query: status,
  salonId, page, pageSize -> {items, total, page, pageSize}), following the exact
  convention every other admin list+moderate pair in this codebase already uses
  (GET/PATCH /admin/reviews, /admin/reports, /admin/salons, ...) and reusing the resource
  base path the real PATCH endpoint already established (admin/worker-ratings/:id/status).
  That GET endpoint does not exist yet server-side -- this page will 404 until a matching
  ReviewsService.listForWorkerRatingsAdmin()-style method and controller @Get() are added
  alongside AdminWorkerRatingsController. Flagged here rather than silently assumed.
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import ModerateWorkerRatingButton from '@/components/reviews/ModerateWorkerRatingButton.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Pagination from '@/components/ui/Pagination.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { debounce } from '@/utils/debounce'
import { reviewStatusLabel } from '@/utils/labels'

// worker_ratings.status only ever has these two values (no 'withdrawn' -- see
// worker-rating.entity.ts), same two-state shape as Review, so reviewStatusLabel()
// is reused as-is rather than declaring a duplicate label map.
const STATUS_OPTIONS = [
  { value: '', label: 'همه وضعیت‌ها' },
  { value: 'published', label: 'منتشر شده' },
  { value: 'rejected', label: 'رد شده' },
]

interface WorkerRatingRow {
  id: string
  workerId: string
  workerName: string
  salonId: string
  salonName: string
  rating: number
  status: 'published' | 'rejected'
  createdAt: string
}

interface WorkerRatingListResponse {
  items: WorkerRatingRow[]
  total: number
  page: number
  pageSize: number
}

const { apiFetch } = useApi()
const ratings = ref<WorkerRatingRow[]>([])
const loading = ref(true)
const page = ref(1)
const total = ref(0)
const pageSize = 10

const salonIdFilter = ref('')
const statusFilter = ref<'' | 'published' | 'rejected'>('')

async function load() {
  loading.value = true
  const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) })
  if (salonIdFilter.value) params.set('salonId', salonIdFilter.value)
  if (statusFilter.value) params.set('status', statusFilter.value)

  const { data } = await apiFetch<WorkerRatingListResponse>(`/admin/worker-ratings?${params.toString()}`, { silent: true })
  ratings.value = data?.items ?? []
  total.value = data?.total ?? 0
  loading.value = false
}

function loadFromFilterChange() {
  page.value = 1
  load()
}

function onUpdated(ratingId: string, status: string) {
  const rating = ratings.value.find((r) => r.id === ratingId)
  if (rating) rating.status = status as WorkerRatingRow['status']
}

function clearFilters() {
  salonIdFilter.value = ''
  statusFilter.value = ''
}

const hasActiveFilters = computed(() => !!salonIdFilter.value || !!statusFilter.value)

onMounted(load)
watch(salonIdFilter, debounce(loadFromFilterChange, 350))
watch(statusFilter, loadFromFilterChange)
watch(page, load)
</script>

<template>
  <div class="space-y-5 p-8">
    <AppCard :padded="false" class="p-4">
      <div class="flex flex-wrap items-end gap-3">
        <div class="w-52">
          <AppInput v-model="salonIdFilter" icon="search" label="شناسه آرایشگاه" placeholder="جست‌وجو…" />
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">وضعیت</label>
          <AppSelect v-model="statusFilter" :options="STATUS_OPTIONS" width="10rem" />
        </div>
        <AppButton v-if="hasActiveFilters" type="button" variant="ghost" class="mb-2" @click="clearFilters">
          <template #icon>
            <AppIcon name="reset" :size="15" />
          </template>
          پاک کردن فیلترها
        </AppButton>
      </div>
    </AppCard>

    <EmptyState v-if="!loading && ratings.length === 0" icon="worker-ratings" message="امتیازی با این فیلترها یافت نشد." />

    <div v-else class="space-y-3">
      <AppCard v-for="rating in ratings" :key="rating.id">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="flex items-center gap-1 text-(--color-accent)">
              <AppIcon
                v-for="n in 5"
                :key="n"
                name="star"
                :size="16"
                :fill="n <= rating.rating ? 'currentColor' : 'none'"
                :class="n > rating.rating && 'text-(--color-border)'"
              />
              <span class="tnum mr-1 text-sm font-bold text-(--color-text)">{{ rating.rating }}.0</span>
            </div>
            <p class="mt-1.5 text-sm text-(--color-text-muted)">
              <span class="font-semibold text-(--color-text)">{{ rating.workerName }}</span>
              — {{ rating.salonName }}
            </p>
          </div>
          <StatusBadge :label="reviewStatusLabel(rating.status).label" :tone="reviewStatusLabel(rating.status).tone" />
        </div>

        <div class="mt-4 border-t border-(--color-border-soft) pt-3.5">
          <ModerateWorkerRatingButton
            :rating-id="rating.id"
            :status="rating.status"
            @updated="(r) => onUpdated(r.id, r.status)"
          />
        </div>
      </AppCard>
    </div>

    <AppCard v-if="!loading && ratings.length > 0" :padded="false">
      <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="(p) => (page = p)" />
    </AppCard>
  </div>
</template>
