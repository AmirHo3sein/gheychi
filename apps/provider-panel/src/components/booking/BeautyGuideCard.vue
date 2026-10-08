<!-- apps/provider-panel/src/components/booking/BeautyGuideCard.vue -->
<!-- The customer's AI beauty guide, shown inside a booking card on BookingsView when that
     booking carries a beautyGuideId. Collapsed by default and fetched only on first expand:
     most cards are never opened, and the guide (plus its private image) is the customer's
     personal data -- it shouldn't be pulled for every card on every poll tick.

     Everything here is a conversation aid, never booking truth: the AI duration estimate is
     labelled as such, and the booking itself keeps using the service's real duration and
     price. Confidence is shown only as hedged words, never as a raw number. A 404 means the
     guide is gone (the customer can delete it at any time, which nulls the booking's FK on
     the server -- this card may simply be rendering from a slightly stale list). -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useApi } from '@/composables/useApi'
import { buildEnv } from '@/utils/build-env'

interface BeautyGuideConcept {
  key: string
  nameFa: string
  nameEn: string
  domain: string
  confidence: 'high' | 'medium' | 'low'
  source: 'ai' | 'user'
  removed: boolean
  evidenceFa: string | null
  mappable: boolean
}

interface BeautyGuideView {
  id: string
  status: 'processing' | 'ready' | 'unsuitable' | 'failed'
  failureCode: string | null
  createdAt: string
  analyzedAt: string | null
  imagePath: string
  sourcePortfolioItemId: string | null
  domain: string | null
  lookSummaryFa: string | null
  stylistRequestFa: string | null
  durationEstimate: { min: number; max: number } | null
  attributes: Record<string, string>
  discussionPoints: string[]
  maintenance: Array<{ text: string; source: 'curated' | 'ai' }>
  safetyNote: 'medical_concern' | null
  concepts: BeautyGuideConcept[]
}

const props = defineProps<{ bookingId: string }>()

// Same base useApi() prefixes every request with -- imagePath is relative to it. A plain
// <img src> carries the API's own session cookie (same-site subresource request).
const API_BASE = buildEnv(import.meta.env.VITE_API_BASE, 'http://localhost:3002/api')

const CONFIDENCE_LABEL: Record<BeautyGuideConcept['confidence'], string> = {
  high: 'به احتمال زیاد',
  medium: 'احتمالاً',
  low: 'شاید',
}

const ATTRIBUTE_LABEL: Record<string, string> = {
  hair_length: 'بلندی مو',
  hair_color_family: 'خانواده رنگ مو',
  hair_texture: 'بافت مو',
  nail_shape: 'فرم ناخن',
  nail_length: 'بلندی ناخن',
  finish: 'پوشش نهایی',
}

const ATTRIBUTE_VALUE_LABEL: Record<string, Record<string, string>> = {
  hair_length: { short: 'کوتاه', medium: 'متوسط', long: 'بلند' },
  hair_color_family: { black: 'مشکی', brown: 'قهوه‌ای', blonde: 'بلوند', red: 'قرمز', gray: 'طوسی', fantasy: 'فانتزی' },
  hair_texture: { straight: 'صاف', wavy: 'موج‌دار', curly: 'فر' },
  nail_shape: { almond: 'بادامی', coffin: 'تابوتی', square: 'مربعی', oval: 'بیضی', stiletto: 'استیلتو', round: 'گرد' },
  nail_length: { short: 'کوتاه', medium: 'متوسط', long: 'بلند' },
  finish: { glossy: 'براق', matte: 'مات', chrome: 'کروم', natural: 'طبیعی' },
}

const { apiFetch } = useApi()
const expanded = ref(false)
const loading = ref(false)
// 'gone' = 404 (deleted / no longer attached), 'error' = anything else (retryable).
const loadState = ref<'idle' | 'ready' | 'gone' | 'error'>('idle')
const guide = ref<BeautyGuideView | null>(null)

async function load() {
  loading.value = true
  const { data, error } = await apiFetch<BeautyGuideView>(`/salons/mine/bookings/${props.bookingId}/beauty-guide`, {
    silent: true,
  })
  loading.value = false
  if (error) {
    loadState.value = error.status === 404 ? 'gone' : 'error'
    return
  }
  guide.value = data
  loadState.value = 'ready'
}

function toggle() {
  expanded.value = !expanded.value
  // Fetched once, on the first expand; a failed load is retried explicitly via its button.
  if (expanded.value && loadState.value === 'idle' && !loading.value) void load()
}

const imageSrc = computed(() => (guide.value ? `${API_BASE}${guide.value.imagePath}` : ''))
const visibleConcepts = computed(() => guide.value?.concepts.filter((c) => !c.removed) ?? [])
const attributeRows = computed(() =>
  Object.entries(guide.value?.attributes ?? {})
    .filter(([key]) => key in ATTRIBUTE_LABEL)
    .map(([key, value]) => ({ key, label: ATTRIBUTE_LABEL[key], value: ATTRIBUTE_VALUE_LABEL[key]?.[value] ?? value })),
)

function faNumber(n: number): string {
  return n.toLocaleString('fa-IR', { maximumFractionDigits: 1 })
}

// Under 90 minutes reads naturally in minutes; longer looks (balayage etc.) in hours,
// rounded to the half hour -- it's an estimate, false precision would only mislead.
const durationText = computed(() => {
  const d = guide.value?.durationEstimate
  if (!d) return ''
  if (d.max < 90) return `حدود ${faNumber(d.min)} تا ${faNumber(d.max)} دقیقه`
  const toHours = (m: number) => Math.round((m / 60) * 2) / 2
  return `حدود ${faNumber(toHours(d.min))} تا ${faNumber(toHours(d.max))} ساعت`
})
</script>

<template>
  <div class="space-y-3 border-t border-(--color-border-soft) pt-3" data-testid="beauty-guide-card">
    <AppButton
      type="button"
      variant="ghost"
      size="sm"
      :aria-expanded="expanded"
      data-testid="beauty-guide-toggle"
      @click="toggle"
    >
      <template #icon><AppIcon name="sparkles" :size="13" class="text-(--color-ai)" /></template>
      {{ expanded ? 'بستن راهنمای زیبایی مشتری' : 'مشاهده راهنمای زیبایی مشتری' }}
    </AppButton>

    <div v-if="expanded" class="space-y-3">
      <p v-if="loading" data-testid="beauty-guide-loading" class="flex items-center gap-2 text-xs text-(--color-text-muted)">
        <AppIcon name="spinner" :size="13" class="animate-spin" /> در حال دریافت راهنما…
      </p>

      <p v-else-if="loadState === 'gone'" data-testid="beauty-guide-gone" class="text-xs text-(--color-text-muted)">
        راهنما دیگر در دسترس نیست. ممکن است مشتری آن را حذف کرده باشد.
      </p>

      <div v-else-if="loadState === 'error'" data-testid="beauty-guide-error" class="flex flex-wrap items-center gap-2">
        <p class="text-xs text-(--tone-danger-text)">دریافت راهنما با خطا مواجه شد.</p>
        <AppButton type="button" variant="secondary" size="sm" data-testid="beauty-guide-retry" @click="load">
          تلاش دوباره
        </AppButton>
      </div>

      <template v-else-if="guide">
        <p v-if="guide.status !== 'ready'" data-testid="beauty-guide-not-ready" class="text-xs text-(--color-text-muted)">
          تحلیل این راهنما کامل نشده است؛ جزئیات استایل را مستقیماً با مشتری هماهنگ کنید.
        </p>

        <div class="flex flex-col gap-3 sm:flex-row sm:items-start">
          <img
            :src="imageSrc"
            alt="تصویر الهام استایل ارسال‌شده توسط مشتری"
            data-testid="beauty-guide-image"
            loading="lazy"
            class="h-32 w-32 shrink-0 rounded-xl border border-(--color-border-soft) object-cover"
          />
          <div class="min-w-0 space-y-2">
            <div v-if="guide.lookSummaryFa">
              <p class="text-xs font-semibold text-(--color-text-muted)">خلاصه استایل</p>
              <p data-testid="beauty-guide-summary" class="break-words text-sm text-(--color-text)">{{ guide.lookSummaryFa }}</p>
            </div>
            <div v-if="guide.stylistRequestFa">
              <p class="text-xs font-semibold text-(--color-text-muted)">درخواست مشتری</p>
              <p data-testid="beauty-guide-request" class="break-words text-sm text-(--color-text)">{{ guide.stylistRequestFa }}</p>
            </div>
          </div>
        </div>

        <ul v-if="visibleConcepts.length" class="flex flex-wrap gap-1.5" data-testid="beauty-guide-concepts">
          <li
            v-for="c in visibleConcepts"
            :key="c.key"
            :data-testid="`beauty-guide-concept-${c.key}`"
            class="inline-flex items-center gap-1.5 rounded-full border border-(--color-ai) px-2.5 py-1 text-xs text-(--color-text)"
          >
            <span>{{ c.nameFa }} (<span dir="ltr">{{ c.nameEn }}</span>)</span>
            <span class="text-(--color-text-muted)">· {{ c.source === 'user' ? 'تأیید مشتری' : CONFIDENCE_LABEL[c.confidence] }}</span>
          </li>
        </ul>

        <dl v-if="attributeRows.length" class="flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid="beauty-guide-attributes">
          <div v-for="row in attributeRows" :key="row.key" class="flex gap-1">
            <dt class="text-(--color-text-muted)">{{ row.label }}:</dt>
            <dd class="font-semibold text-(--color-text)">{{ row.value }}</dd>
          </div>
        </dl>

        <div v-if="guide.discussionPoints.length" data-testid="beauty-guide-discussion">
          <p class="text-xs font-semibold text-(--color-text-muted)">نکات قابل گفتگو</p>
          <ul class="list-disc space-y-0.5 ps-5 text-sm text-(--color-text)">
            <li v-for="(point, i) in guide.discussionPoints" :key="i" class="break-words">{{ point }}</li>
          </ul>
        </div>

        <div v-if="guide.durationEstimate" data-testid="beauty-guide-duration" class="space-y-0.5 text-xs">
          <p class="text-(--color-text)">
            زمان تقریبی (تخمین هوش مصنوعی): <span class="tnum font-semibold">{{ durationText }}</span>
          </p>
          <p class="text-(--color-text-muted)">مدت و قیمت این نوبت همان مدت و قیمت واقعی خدمت رزروشده است.</p>
        </div>

        <p
          v-if="guide.safetyNote === 'medical_concern'"
          data-testid="beauty-guide-medical"
          class="rounded-xl bg-(--tone-warning-bg) p-3 text-xs text-(--tone-warning-text)"
        >
          در این تصویر نکته‌ای دیده شد که بهتر است پیش از انجام خدمت، با مشتری درباره آن صحبت شود و در صورت نیاز به مشاوره با متخصص توصیه شود.
        </p>
      </template>
    </div>
  </div>
</template>
