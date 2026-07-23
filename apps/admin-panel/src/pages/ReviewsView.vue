<!-- apps/admin-panel/src/pages/ReviewsView.vue -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import ModerateReviewButton from '@/components/reviews/ModerateReviewButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Pagination from '@/components/ui/Pagination.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { debounce } from '@/utils/debounce'
import { reviewStatusLabel } from '@/utils/labels'

const STATUS_OPTIONS = [
  { value: '', label: 'همه وضعیت‌ها' },
  { value: 'published', label: 'منتشر شده' },
  { value: 'rejected', label: 'رد شده' },
]
const RATING_OPTIONS = [
  { value: '', label: 'همه امتیازها' },
  { value: 1, label: '۱ ستاره' },
  { value: 2, label: '۲ ستاره' },
  { value: 3, label: '۳ ستاره' },
  { value: 4, label: '۴ ستاره' },
  { value: 5, label: '۵ ستاره' },
]

interface ReviewRow {
  id: string
  salonId: string
  rating: number
  comment: string | null
  status: 'published' | 'rejected'
  salonReply: string | null
  // JUDGMENT CALL / KNOWN GAP: ReviewsService.listForAdmin() (apps/api/src/reviews/reviews.service.ts)
  // currently returns bare Review rows with no join onto worker_ratings -- there is no
  // backend field to read here yet. Declared optional so this renders nothing until the
  // list endpoint is extended to include it (see WorkerRatingsView.vue's header comment
  // for the matching gap on the moderation-queue side), rather than assuming a shape that
  // doesn't exist and silently breaking when it stays absent.
  workerRating?: { score: number; workerName: string } | null
}

interface ReviewListResponse {
  items: ReviewRow[]
  total: number
  page: number
  pageSize: number
}

const { apiFetch } = useApi()
const reviews = ref<ReviewRow[]>([])
const loading = ref(true)
const page = ref(1)
const total = ref(0)
const pageSize = 10

const salonIdFilter = ref('')
const statusFilter = ref<'' | 'published' | 'rejected'>('')
const ratingFilter = ref<'' | number>('')

async function load() {
  loading.value = true
  const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) })
  if (salonIdFilter.value) params.set('salonId', salonIdFilter.value)
  if (statusFilter.value) params.set('status', statusFilter.value)
  if (ratingFilter.value) params.set('rating', String(ratingFilter.value))

  const { data } = await apiFetch<ReviewListResponse>(`/admin/reviews?${params.toString()}`, { silent: true })
  reviews.value = data?.items ?? []
  total.value = data?.total ?? 0
  loading.value = false
}

function loadFromFilterChange() {
  page.value = 1
  load()
}

function onUpdated(reviewId: string, status: string) {
  const review = reviews.value.find((r) => r.id === reviewId)
  if (review) review.status = status as ReviewRow['status']
}

function clearFilters() {
  salonIdFilter.value = ''
  statusFilter.value = ''
  ratingFilter.value = ''
}

const hasActiveFilters = computed(() => !!salonIdFilter.value || !!statusFilter.value || !!ratingFilter.value)

onMounted(load)
watch(salonIdFilter, debounce(loadFromFilterChange, 350))
watch([statusFilter, ratingFilter], loadFromFilterChange)
watch(page, load)
</script>

<template>
  <div class="space-y-5 p-8">
    <AppCard :padded="false" class="p-4">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-muted)">شناسه آرایشگاه</label>
          <div class="relative">
            <AppIcon name="search" :size="16" class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-(--color-muted)" />
            <input
              v-model="salonIdFilter"
              placeholder="جست‌وجو…"
              class="w-52 rounded-xl border border-(--color-border) py-2 ps-9 pe-3 text-sm"
            />
          </div>
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-muted)">وضعیت</label>
          <AppSelect v-model="statusFilter" :options="STATUS_OPTIONS" width="10rem" />
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-muted)">امتیاز</label>
          <AppSelect v-model="ratingFilter" :options="RATING_OPTIONS" width="9rem" />
        </div>
        <button
          v-if="hasActiveFilters"
          type="button"
          class="mb-2 flex items-center gap-1.5 text-sm font-semibold text-(--color-muted) transition-colors hover:text-(--tone-danger-text)"
          @click="clearFilters"
        >
          <AppIcon name="reset" :size="15" />
          پاک کردن فیلترها
        </button>
      </div>
    </AppCard>

    <EmptyState v-if="!loading && reviews.length === 0" icon="reviews" message="نظری با این فیلترها یافت نشد." />

    <div v-else class="space-y-3">
      <AppCard v-for="review in reviews" :key="review.id">
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-center gap-1 text-(--color-accent)">
            <AppIcon
              v-for="n in 5"
              :key="n"
              name="star"
              :size="16"
              :fill="n <= review.rating ? 'currentColor' : 'none'"
              :class="n > review.rating && 'text-(--color-border)'"
            />
            <span class="tnum mr-1 text-sm font-bold text-(--color-text)">{{ review.rating }}.0</span>
          </div>
          <StatusBadge :label="reviewStatusLabel(review.status).label" :tone="reviewStatusLabel(review.status).tone" />
        </div>

        <div v-if="review.workerRating" class="mt-2.5 flex items-center gap-1.5 text-sm text-(--color-muted)">
          <AppIcon name="worker-ratings" :size="15" />
          <span>امتیاز کارمند ({{ review.workerRating.workerName }}):</span>
          <span class="flex items-center gap-0.5 text-(--color-accent)">
            <AppIcon
              v-for="n in 5"
              :key="n"
              name="star"
              :size="13"
              :fill="n <= review.workerRating.score ? 'currentColor' : 'none'"
              :class="n > review.workerRating.score && 'text-(--color-border)'"
            />
          </span>
          <span class="tnum font-bold text-(--color-text)">{{ review.workerRating.score }}.0</span>
        </div>

        <p v-if="review.comment" class="mt-3 text-sm leading-6 text-(--color-text)">{{ review.comment }}</p>

        <div v-if="review.salonReply" class="mt-3 rounded-xl bg-(--color-border-soft) p-3">
          <p class="mb-1 text-xs font-semibold text-(--color-muted)">پاسخ آرایشگاه</p>
          <p class="text-sm text-(--color-text)">{{ review.salonReply }}</p>
        </div>

        <div class="mt-4 border-t border-(--color-border-soft) pt-3.5">
          <ModerateReviewButton
            :review-id="review.id"
            :status="review.status"
            @updated="(r) => onUpdated(r.id, r.status)"
          />
        </div>
      </AppCard>
    </div>

    <AppCard v-if="!loading && reviews.length > 0" :padded="false">
      <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="(p) => (page = p)" />
    </AppCard>
  </div>
</template>
