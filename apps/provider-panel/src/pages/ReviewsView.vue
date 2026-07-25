<!-- apps/provider-panel/src/pages/ReviewsView.vue -->
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { useApi } from '@/composables/useApi'
import { useSalon } from '@/composables/useSalon'

interface Review {
  id: string
  rating: number
  comment: string | null
  salonReply: string | null
  createdAt: string
}

const { apiFetch } = useApi()
const { salon } = useSalon()
const reviews = ref<Review[]>([])
const loading = ref(true)
const loadError = ref(false)
const drafts = reactive<Record<string, string>>({})
const sending = reactive<Record<string, boolean>>({})

// Unanswered reviews surface first (a review awaiting a reply is the one that needs
// action), ties broken by most-recent first.
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
  loading.value = true
  loadError.value = false
  const { data, error } = await apiFetch<Review[]>(`/salons/${salon.value.id}/reviews`, { silent: true })
  if (error) {
    loadError.value = true
    loading.value = false
    return
  }
  reviews.value = data ?? []
  for (const r of reviews.value) drafts[r.id] = r.salonReply ?? ''
  loading.value = false
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
  <div class="space-y-3 p-4">
    <h1 class="text-lg font-bold text-(--color-text)">نظرات مشتریان</h1>

    <div v-if="loadError" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">نظرات بارگذاری نشد.</p>
      <AppButton variant="secondary" data-testid="retry-reviews" @click="load">
        تلاش دوباره
      </AppButton>
    </div>

    <template v-else>
      <EmptyState v-if="!loading && reviews.length === 0" icon="reviews" message="هنوز نظری ثبت نشده است." />

      <AppCard v-for="r in sortedReviews" :key="r.id" class="space-y-3">
        <div class="flex items-center justify-between gap-2">
          <div
            class="flex items-center gap-1 text-(--tone-warning-text)"
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

        <p v-if="r.comment" class="text-sm text-(--color-text)">{{ r.comment }}</p>
        <p v-if="r.salonReply" class="rounded-xl bg-(--tone-info-bg) p-3 text-sm text-(--color-text)">
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
    </template>
  </div>
</template>
