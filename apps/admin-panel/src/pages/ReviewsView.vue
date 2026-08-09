<!-- apps/admin-panel/src/pages/ReviewsView.vue -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import ModerateReviewButton from '@/components/reviews/ModerateReviewButton.vue'
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
  // Joined server-side by ReviewsService.listForAdmin() -- without this an operator
  // scanning the unfiltered queue had no way to tell which salon a review was about.
  salonName: string
  rating: number
  comment: string | null
  // 'withdrawn' = the customer soft-deleted their own review (DELETE /api/reviews/:id).
  // The unfiltered ("همه وضعیت‌ها") admin list can return these -- they must be typed
  // and handled distinctly from an admin 'rejected' call, never treated as "just
  // another non-published state" (see ModerateReviewButton.vue).
  status: 'published' | 'rejected' | 'withdrawn'
  salonReply: string | null
  createdAt: string
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
// A fetch failure must not be silently repainted as an empty state -- see
// SalonsView.vue's identical loadError pattern.
const loadError = ref(false)
const page = ref(1)
const total = ref(0)
const pageSize = 10

// Salon *name* search (server-side ILIKE via AdminReviewQueryDto.salonName), not a raw
// salon id -- an operator has no reason to know a salon's UUID by heart. See
// ReviewsService.listForAdmin() for the resolve-name-to-ids step this drives.
const salonNameFilter = ref('')
const statusFilter = ref<'' | 'published' | 'rejected'>('')
const ratingFilter = ref<'' | number>('')

async function load() {
  loading.value = true
  loadError.value = false
  const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) })
  if (salonNameFilter.value) params.set('salonName', salonNameFilter.value)
  if (statusFilter.value) params.set('status', statusFilter.value)
  if (ratingFilter.value) params.set('rating', String(ratingFilter.value))

  const { data, error } = await apiFetch<ReviewListResponse>(`/admin/reviews?${params.toString()}`, { silent: true })
  if (error) {
    loadError.value = true
    reviews.value = []
    total.value = 0
  } else {
    reviews.value = data?.items ?? []
    total.value = data?.total ?? 0
  }
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
  salonNameFilter.value = ''
  statusFilter.value = ''
  ratingFilter.value = ''
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso))
}

const hasActiveFilters = computed(() => !!salonNameFilter.value || !!statusFilter.value || !!ratingFilter.value)

onMounted(load)
watch(salonNameFilter, debounce(loadFromFilterChange, 350))
watch([statusFilter, ratingFilter], loadFromFilterChange)
watch(page, load)
</script>

<template>
  <div class="space-y-5 p-8">
    <AppCard :padded="false" class="p-4">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">نام آرایشگاه</label>
          <AppInput v-model="salonNameFilter" icon="search" placeholder="جست‌وجو…" class="w-52" />
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">وضعیت</label>
          <AppSelect v-model="statusFilter" :options="STATUS_OPTIONS" width="10rem" />
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">امتیاز</label>
          <AppSelect v-model="ratingFilter" :options="RATING_OPTIONS" width="9rem" />
        </div>
        <AppButton
          v-if="hasActiveFilters"
          type="button"
          variant="ghost"
          @click="clearFilters"
        >
          <template #icon><AppIcon name="reset" :size="15" /></template>
          پاک کردن فیلترها
        </AppButton>
      </div>
    </AppCard>

    <div
      v-if="loading"
      class="flex h-40 items-center justify-center"
      role="status"
      aria-label="در حال بارگذاری"
      data-testid="reviews-loading"
    >
      <AppIcon name="spinner" :size="24" class="animate-spin text-(--color-text-muted)" />
    </div>

    <AppCard
      v-else-if="loadError"
      :padded="false"
      data-testid="load-error"
      class="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center"
    >
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-(--tone-danger-bg) text-(--tone-danger-text)">
        <AppIcon name="warning" :size="22" />
      </div>
      <p class="text-sm text-(--color-text-muted)">خطا در دریافت نظرات.</p>
      <AppButton type="button" variant="secondary" data-testid="retry-load" @click="load">تلاش دوباره</AppButton>
    </AppCard>

    <EmptyState v-else-if="reviews.length === 0" icon="reviews" message="نظری با این فیلترها یافت نشد." />

    <div v-else class="space-y-3">
      <!-- break-words on the card, not on each <p>: overflow-wrap is inherited, and every piece
           of text below (salon name, comment, salon reply) is customer-supplied. A single
           unbroken token -- a pasted URL in a review, a run-on Persian word -- would otherwise
           push the card past the page. Only engages when a line genuinely can't fit, so normal
           text renders identically. -->
      <AppCard v-for="review in reviews" :key="review.id" class="break-words">
        <div class="flex items-start justify-between gap-4">
          <!-- min-w-0: a flex item won't shrink below its longest word without it, and
               overflow-wrap:break-word deliberately doesn't feed back into that intrinsic
               minimum -- so the pair is what actually keeps a long salon name inside the card. -->
          <div class="min-w-0">
            <div class="flex items-center gap-1 text-(--color-accent-text)">
              <AppIcon
                v-for="n in 5"
                :key="n"
                name="star"
                :size="16"
                :fill="n <= review.rating ? 'currentColor' : 'none'"
                :class="n > review.rating && 'text-(--color-border)'"
              />
              <span class="tnum mr-1 text-sm font-bold text-(--color-text)">{{
                Number(review.rating).toLocaleString('fa-IR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
              }}</span>
            </div>
            <p class="mt-1.5 text-sm font-semibold text-(--color-text)">{{ review.salonName }}</p>
          </div>
          <StatusBadge :label="reviewStatusLabel(review.status).label" :tone="reviewStatusLabel(review.status).tone" />
        </div>

        <div v-if="review.workerRating" class="mt-2.5 flex items-center gap-1.5 text-sm text-(--color-text-muted)">
          <AppIcon name="worker-ratings" :size="15" />
          <span>امتیاز کارمند ({{ review.workerRating.workerName }}):</span>
          <span class="flex items-center gap-0.5 text-(--color-accent-text)">
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
          <p class="mb-1 text-xs font-semibold text-(--color-text-muted)">پاسخ آرایشگاه</p>
          <p class="text-sm text-(--color-text)">{{ review.salonReply }}</p>
        </div>

        <p class="tnum mt-3 text-xs text-(--color-text-muted)">{{ formatDate(review.createdAt) }}</p>

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
