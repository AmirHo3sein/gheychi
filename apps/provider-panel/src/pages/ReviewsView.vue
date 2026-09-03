<!-- apps/provider-panel/src/pages/ReviewsView.vue -->
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { useApi } from '@/composables/useApi'
import { useFeatureFlags } from '@/composables/useFeatureFlags'
import { useSalon } from '@/composables/useSalon'

interface Review {
  id: string
  rating: number
  comment: string | null
  salonReply: string | null
  createdAt: string
}

interface SalonReviewsPage {
  items: Review[]
  total: number
  page: number
  pageSize: number
}

const { apiFetch } = useApi()
const { salon } = useSalon()
const { flags: featureFlags } = useFeatureFlags()
const reviews = ref<Review[]>([])
const loading = ref(true)
const loadError = ref(false)
const drafts = reactive<Record<string, string>>({})
const sending = reactive<Record<string, boolean>>({})

// This page reads the same public, paginated listing the customer app does (the API
// defaults to 50 per page) -- without paging, a salon's 51st-and-older reviews were simply
// unreachable from here. `page` is 1-based, as the API's SalonReviewsQueryDto expects.
const page = ref(1)
const total = ref(0)
const pageSize = ref(50)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

// Unanswered reviews surface first (a review awaiting a reply is the one that needs
// action), ties broken by most-recent first. Sorted within the current page only -- the
// API orders by createdAt DESC, so an old unanswered review still lives on a later page.
const sortedReviews = computed(() =>
  [...reviews.value].sort((a, b) => {
    const aAnswered = a.salonReply ? 1 : 0
    const bAnswered = b.salonReply ? 1 : 0
    if (aAnswered !== bAnswered) return aAnswered - bAnswered
    return b.createdAt.localeCompare(a.createdAt)
  }),
)

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['week', 60 * 60 * 24 * 7],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
]
const relativeFormatter = new Intl.RelativeTimeFormat('fa-IR', { numeric: 'auto' })

function formatRelativeDate(iso: string): string {
  const diffSeconds = (new Date(iso).getTime() - Date.now()) / 1000
  const absSeconds = Math.abs(diffSeconds)
  for (const [unit, secondsInUnit] of RELATIVE_UNITS) {
    if (absSeconds >= secondsInUnit) return relativeFormatter.format(Math.round(diffSeconds / secondsInUnit), unit)
  }
  return relativeFormatter.format(Math.round(diffSeconds / 60), 'minute')
}

async function load() {
  if (!salon.value) return
  // The listing is gated server-side while the flag is off (listForSalon returns an empty
  // page), so fetching would only produce a misleading "no reviews yet" -- the template
  // shows the disabled banner instead.
  if (!featureFlags.value.reviewsEnabled) {
    loading.value = false
    return
  }
  loading.value = true
  loadError.value = false
  const { data, error } = await apiFetch<SalonReviewsPage>(`/salons/${salon.value.id}/reviews?page=${page.value}`, { silent: true })
  if (error) {
    loadError.value = true
    loading.value = false
    return
  }
  reviews.value = data?.items ?? []
  total.value = data?.total ?? reviews.value.length
  if (data?.pageSize) pageSize.value = data.pageSize
  for (const r of reviews.value) drafts[r.id] = r.salonReply ?? ''
  loading.value = false
}

async function goToPage(target: number) {
  if (loading.value || target < 1 || target > totalPages.value || target === page.value) return
  page.value = target
  await load()
}

onMounted(load)

async function sendReply(id: string) {
  const reply = drafts[id]?.trim()
  if (!reply || sending[id]) return
  sending[id] = true
  const { data } = await apiFetch<Review>(`/salons/mine/reviews/${id}/reply`, { method: 'PATCH', body: { reply } })
  if (data) {
    const target = reviews.value.find((r) => r.id === id)
    if (target) target.salonReply = data.salonReply
  }
  sending[id] = false
}
</script>

<template>
  <!-- max-w-4xl, deliberately narrower than the list screens: this page is prose (a customer
       comment, the reply textarea) and an 1888px measure is simply unreadable. -->
  <div class="mx-auto w-full max-w-4xl space-y-3 p-4 lg:p-6">
    <h1 class="text-lg font-bold text-(--color-text)">نظرات مشتریان</h1>

    <!-- Unlike stories/portfolio (whose management keeps working while their flag is off),
         the reviews listing itself is gated server-side, so there is nothing to manage here
         until it's re-enabled -- the banner replaces the list rather than sitting above it. -->
    <p
      v-if="!featureFlags.reviewsEnabled"
      data-testid="reviews-disabled-banner"
      role="status"
      class="flex items-center gap-2 rounded-xl bg-(--tone-warning-bg) p-3 text-sm text-(--tone-warning-text)"
    >
      <AppIcon name="warning" :size="16" class="shrink-0" />
      بخش نظرات موقتاً در پلتفرم غیرفعال است؛ نظرات مشتریان پس از فعال شدن دوباره اینجا نمایش داده می‌شوند.
    </p>

    <div v-else-if="loadError" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">نظرات بارگذاری نشد.</p>
      <AppButton variant="secondary" data-testid="retry-reviews" @click="load">
        تلاش دوباره
      </AppButton>
    </div>

    <template v-else>
      <EmptyState v-if="!loading && reviews.length === 0" icon="reviews" message="هنوز نظری ثبت نشده است." />

      <AppCard v-for="r in sortedReviews" :key="r.id" class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div
            class="flex shrink-0 items-center gap-1 text-(--tone-warning-text)"
            :aria-label="`${r.rating.toLocaleString('fa-IR')} از ۵ ستاره`"
          >
            <AppIcon
              v-for="i in 5"
              :key="i"
              name="star"
              :size="15"
              :fill="i <= r.rating ? 'currentColor' : 'none'"
              aria-hidden="true"
            />
          </div>
          <div class="flex items-center gap-2">
            <StatusBadge v-if="!r.salonReply" label="بدون پاسخ" tone="warning" />
            <span class="tnum text-xs text-(--color-text-muted)">{{ formatRelativeDate(r.createdAt) }}</span>
          </div>
        </div>

        <!-- break-words: customer-authored text can contain an unbreakable run (a URL, a
             long handle) that would otherwise widen the card past the viewport. -->
        <p v-if="r.comment" class="break-words text-sm text-(--color-text)">{{ r.comment }}</p>
        <p v-if="r.salonReply" class="break-words rounded-xl bg-(--tone-info-bg) p-3 text-sm text-(--color-text)">
          <span class="font-semibold text-(--color-accent-text)">پاسخ شما: </span>{{ r.salonReply }}
        </p>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <label :for="`reply-${r.id}`" class="text-xs font-semibold text-(--color-text-muted)">
              {{ r.salonReply ? 'ویرایش پاسخ' : 'پاسخ شما' }}
            </label>
            <span class="tnum text-xs text-(--color-text-muted)">{{ (drafts[r.id]?.length ?? 0).toLocaleString('fa-IR') }}/۲۰۰۰</span>
          </div>
          <textarea
            :id="`reply-${r.id}`"
            v-model="drafts[r.id]"
            rows="3"
            maxlength="2000"
            :placeholder="r.salonReply ? 'ویرایش پاسخ' : 'پاسخ خود را بنویسید'"
            class="w-full rounded-xl border border-(--color-border) bg-(--color-surface-card) p-3 text-sm text-(--color-text)"
          />
          <AppButton
            type="button"
            variant="primary"
            :loading="!!sending[r.id]"
            :disabled="!!sending[r.id] || !drafts[r.id]?.trim()"
            @click="sendReply(r.id)"
          >
            ارسال
          </AppButton>
        </div>
      </AppCard>

      <!-- Same prev/next shape as BookingsView's day nav: in RTL the FIRST child sits at the
           physical right, so "previous" (rotated chevron) points right and "next" points
           left, each away from the indicator between them. -->
      <div v-if="totalPages > 1" data-testid="reviews-pager" class="flex items-center justify-center gap-2 pt-1">
        <AppButton
          type="button"
          variant="ghost"
          aria-label="صفحه قبل"
          data-testid="reviews-prev-page"
          :disabled="page <= 1 || loading"
          @click="goToPage(page - 1)"
        >
          <AppIcon name="chevron-left" :size="16" class="rotate-180" />
        </AppButton>
        <span class="tnum text-sm text-(--color-text-muted)" data-testid="reviews-page-indicator">
          صفحه {{ page.toLocaleString('fa-IR') }} از {{ totalPages.toLocaleString('fa-IR') }}
        </span>
        <AppButton
          type="button"
          variant="ghost"
          aria-label="صفحه بعد"
          data-testid="reviews-next-page"
          :disabled="page >= totalPages || loading"
          @click="goToPage(page + 1)"
        >
          <AppIcon name="chevron-left" :size="16" />
        </AppButton>
      </div>
    </template>
  </div>
</template>
