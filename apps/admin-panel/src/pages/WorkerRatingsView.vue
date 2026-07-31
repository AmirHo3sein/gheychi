<!-- apps/admin-panel/src/pages/WorkerRatingsView.vue -->
<!--
  Table-based list+moderate screen for worker ratings, mirroring the shape every other
  admin list screen already uses (SalonsView, UsersView, CouponsView, ReferralsView,
  WalletView, AuditLogView, BlogPostsView), per DESIGN.md's Density-First Rule.

  Backed by GET /admin/worker-ratings (query: status, salonId, page, pageSize ->
  {items, total, page, pageSize}), which AdminWorkerRatingsController.list()
  (apps/api/src/reviews/) actually serves, alongside the existing PATCH
  /admin/worker-ratings/:id/status moderation endpoint this page's row action calls.
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
import { workerRatingStatusLabel } from '@/utils/labels'

// worker_ratings.status only ever has these two values (no 'withdrawn' -- see
// worker-rating.entity.ts): a rating whose customer deleted the parent review is
// cascaded to 'rejected' too, and is only distinguishable via `reviewStatus` below, so
// filtering by 'rejected' deliberately returns both kinds.
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
  // Parent Review's status -- the only thing that tells an admin rejection apart from
  // the customer having deleted their own review (see workerRatingStatusLabel).
  reviewStatus: 'published' | 'rejected' | 'withdrawn'
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

  // Deliberately NOT silent: salonId is free-text here but validated server-side with
  // @IsUUID() (400 on anything else). Swallowing that error would repaint as a false "no
  // ratings found" empty state instead of telling the operator their input was rejected.
  const { data } = await apiFetch<WorkerRatingListResponse>(`/admin/worker-ratings?${params.toString()}`)
  ratings.value = data?.items ?? []
  total.value = data?.total ?? 0
  loading.value = false
}

function loadFromFilterChange() {
  // Any filter change invalidates the current page position. When we're past page 1, just
  // reset it -- the page watcher below triggers the (single) reload; calling load() here too
  // would fire a redundant concurrent second request.
  if (page.value !== 1) {
    page.value = 1
  } else {
    load()
  }
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
        <!-- Labeled and formatted as a UUID lookup, not free-text search: the backend DTO
             validates salonId with @IsUUID(), and the salon-name link in the table below
             is how an operator actually obtains one from this same screen. -->
        <AppInput
          v-model="salonIdFilter"
          icon="search"
          label="شناسه آرایشگاه (UUID)"
          placeholder="شناسه کامل را وارد کنید"
          dir="ltr"
          class="w-52"
        />
        <AppSelect v-model="statusFilter" :options="STATUS_OPTIONS" label="وضعیت" width="10rem" />
        <AppButton v-if="hasActiveFilters" type="button" variant="ghost" class="mb-2" @click="clearFilters">
          <template #icon>
            <AppIcon name="reset" :size="15" />
          </template>
          پاک کردن فیلترها
        </AppButton>
      </div>
    </AppCard>

    <EmptyState v-if="!loading && ratings.length === 0" icon="worker-ratings" message="امتیازی با این فیلترها یافت نشد." />

    <AppCard v-else :padded="false" class="overflow-hidden">
      <div class="relative">
        <div
          v-if="loading"
          data-testid="table-loading"
          role="status"
          aria-label="در حال بارگذاری"
          class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-(--color-surface-card)/70"
        >
          <AppIcon name="spinner" :size="22" class="animate-spin text-(--color-text-muted)" />
        </div>
        <!-- The table gets its OWN horizontal scroller (CouponsView.vue's idiom). Without it a
             table narrower than its min-content width doesn't shrink -- it overflows the card,
             and AppCard's overflow-hidden (there for the rounded corners) then CLIPS the
             trailing columns. Here that trailing column is the moderation action, so the
             clipping made a real action unreachable. Desktop is untouched: no scrollbar exists
             while the table fits, which is the ≥1280px case this app optimizes for. -->
        <div class="overflow-x-auto">
          <table class="w-full text-right text-sm transition-opacity" :class="{ 'opacity-50': loading }">
            <thead>
              <tr class="border-b border-(--color-border) bg-(--color-border-soft) text-xs text-(--color-text-muted)">
                <th class="px-5 py-3 font-semibold">کارمند</th>
                <th class="px-5 py-3 font-semibold">آرایشگاه</th>
                <th class="px-5 py-3 font-semibold">امتیاز</th>
                <th class="px-5 py-3 font-semibold">وضعیت</th>
                <th class="px-5 py-3 font-semibold">اقدام</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="rating in ratings"
                :key="rating.id"
                class="border-b border-(--color-border-soft) transition-colors last:border-0 hover:bg-(--color-border-soft)"
              >
                <td class="px-5 py-3.5 font-semibold text-(--color-text)">{{ rating.workerName }}</td>
                <td class="px-5 py-3.5">
                  <!-- Click-through to the salon detail page -- also how an operator gets a
                       valid UUID to paste into the salon-id filter above. -->
                  <RouterLink :to="`/salons/${rating.salonId}`" class="text-(--color-text) hover:text-(--color-accent-text)">
                    {{ rating.salonName }}
                  </RouterLink>
                </td>
                <td class="px-5 py-3.5">
                  <div class="flex items-center gap-1 text-(--color-accent-strong)">
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
                </td>
                <td class="px-5 py-3.5">
                  <StatusBadge
                    :label="workerRatingStatusLabel(rating.status, rating.reviewStatus).label"
                    :tone="workerRatingStatusLabel(rating.status, rating.reviewStatus).tone"
                  />
                </td>
                <td class="px-5 py-3.5">
                  <ModerateWorkerRatingButton
                    :rating-id="rating.id"
                    :status="rating.status"
                    :review-status="rating.reviewStatus"
                    @updated="(r) => onUpdated(r.id, r.status)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="(p) => (page = p)" />
    </AppCard>
  </div>
</template>
