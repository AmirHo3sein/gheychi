<script setup lang="ts">
// A customer's Beauty Guide. AI output is advisory and labelled as such; every price,
// duration and booking link below comes from REAL Gheychi services via the matches
// endpoint, and booking itself goes through the existing booking page.
import type { SelectOption } from '../../components/ui/AppSelect.client.vue'
import {
  conceptLabel, failureMessage, formatDurationEstimate, guideImageUrl, UNSUITABLE_MESSAGE,
  type BeautyGuide, type GuideMatches,
} from '../../utils/beauty-guide'

interface IranCity { name: string; lat: number; lng: number }

const route = useRoute()
const id = route.params.id as string
const config = useRuntimeConfig()
const { apiFetch } = useApi()

const { data: guide, pending, refresh } = await useAsyncData(`beauty-guide-${id}`, async () => {
  const { data } = await apiFetch<BeautyGuide>(`/beauty-guides/${id}`, { silent: true })
  return data
})

const busy = ref(false)
const retrying = ref(false)
const vocabulary = ref<Array<{ key: string; nameFa: string; nameEn: string; domain: string }>>([])

// --- location for matching (same city / near-me pattern as the home page) ---
const coords = ref<{ lat: number; lng: number }>({ lat: 35.6892, lng: 51.389 })
const selectedCity = ref('تهران')
const cities = ref<IranCity[]>([])
const cityOptions = computed<SelectOption[]>(() => cities.value.map((c) => ({ value: c.name, label: c.name })))
const locating = ref(false)

const matches = ref<GuideMatches | null>(null)
const matchesLoading = ref(false)
const matchesError = ref(false)

const conceptNames = computed(() =>
  Object.fromEntries((guide.value?.concepts ?? []).map((c) => [c.key, c.nameFa])),
)
const activeConcepts = computed(() => (guide.value?.concepts ?? []).filter((c) => !c.removed))

async function loadMatches() {
  if (guide.value?.status !== 'ready') return
  matchesLoading.value = true
  matchesError.value = false
  const { data, error } = await apiFetch<GuideMatches>(`/beauty-guides/${id}/matches`, {
    query: { lat: coords.value.lat, lng: coords.value.lng },
    silent: true,
  })
  matchesLoading.value = false
  if (error) {
    matchesError.value = true
    return
  }
  matches.value = data
}

watch(selectedCity, (name) => {
  const city = cities.value.find((c) => c.name === name)
  if (city) coords.value = { lat: city.lat, lng: city.lng }
})
watch(coords, loadMatches)

function useMyLocation() {
  if (!import.meta.client || !navigator.geolocation) return
  locating.value = true
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      coords.value = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      locating.value = false
    },
    () => (locating.value = false),
    { timeout: 5000 },
  )
}

async function patch(body: Record<string, unknown>) {
  busy.value = true
  const { data } = await apiFetch<BeautyGuide>(`/beauty-guides/${id}`, { method: 'PATCH', body })
  busy.value = false
  if (data) {
    guide.value = data
    await loadMatches()
  }
}

async function retry() {
  retrying.value = true
  const { data } = await apiFetch<BeautyGuide>(`/beauty-guides/${id}/retry`, { method: 'POST' })
  retrying.value = false
  if (data) {
    guide.value = data
    await loadMatches()
  }
}

// Irreversible (the uploaded photo goes with it), so it asks through the shared ConfirmDialog.
const confirmingDelete = ref(false)
const deleting = ref(false)

async function remove() {
  if (deleting.value) return
  deleting.value = true
  const { error } = await apiFetch(`/beauty-guides/${id}`, { method: 'DELETE' })
  deleting.value = false
  if (error) {
    confirmingDelete.value = false
    return
  }
  confirmingDelete.value = false
  await navigateTo('/account/beauty-guides')
}

const copied = ref(false)
async function copyRequest() {
  if (!guide.value?.stylistRequestFa) return
  try {
    await navigator.clipboard.writeText(guide.value.stylistRequestFa)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    // Clipboard blocked -- the text is on screen to copy by hand.
  }
}

// A guide that's still processing (e.g. the analyzing request dropped) -- poll briefly.
let pollTimer: ReturnType<typeof setTimeout> | undefined
function pollIfProcessing() {
  if (guide.value?.status !== 'processing') return
  pollTimer = setTimeout(async () => {
    await refresh()
    if (guide.value?.status === 'ready') await loadMatches()
    pollIfProcessing()
  }, 3000)
}

onMounted(async () => {
  const [citiesRes, vocabRes] = await Promise.all([
    apiFetch<IranCity[]>('/cities', { silent: true }),
    apiFetch<typeof vocabulary.value>('/beauty-guides/concepts', { silent: true }),
  ])
  cities.value = citiesRes.data ?? []
  vocabulary.value = vocabRes.data ?? []
  pollIfProcessing()
  await loadMatches()
})
onBeforeUnmount(() => pollTimer && clearTimeout(pollTimer))

useSeoMeta({ title: 'راهنمای زیبایی من — قیچی', robots: 'noindex, nofollow' })
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6 p-4 lg:max-w-3xl">
    <div class="flex items-center gap-2">
      <NuxtLink
        to="/account/beauty-guides"
        aria-label="بازگشت"
        class="-ms-2 flex h-11 w-11 items-center justify-center rounded-lg text-(--color-text-muted) transition-colors hover:bg-(--color-surface-subtle)"
      >
        <BaseIcon name="chevron-forward" :size="20" />
      </NuxtLink>
      <h1 class="text-lg font-bold">راهنمای زیبایی شما</h1>
    </div>

    <p v-if="pending && !guide" class="text-sm text-(--color-text-muted)">در حال بارگذاری…</p>

    <BaseCard v-else-if="!guide" data-testid="guide-not-found" class="text-sm text-(--color-text-muted)">
      این راهنما پیدا نشد.
      <NuxtLink to="/beauty-guide" class="font-medium text-(--color-accent-text) hover:underline">ساخت راهنمای جدید</NuxtLink>
    </BaseCard>

    <template v-else>
      <img
        :src="guideImageUrl(config.public.apiBase as string, guide.imagePath)"
        alt="تصویر الهام شما"
        data-testid="guide-image"
        class="mx-auto max-h-96 w-full rounded-2xl object-contain bg-(--color-surface-subtle)"
      />

      <div v-if="guide.status === 'processing'" data-testid="guide-processing" role="status" class="flex items-center gap-2 text-sm text-(--color-text-muted)">
        <BaseIcon name="spinner" :size="18" class="animate-spin" /> در حال آماده‌سازی راهنما…
      </div>

      <BaseCard v-else-if="guide.status === 'unsuitable'" data-testid="guide-unsuitable" class="space-y-3 text-sm">
        <p class="text-(--color-text)">{{ UNSUITABLE_MESSAGE }}</p>
        <NuxtLink to="/beauty-guide" class="font-medium text-(--color-accent-text) hover:underline">ارسال تصویر دیگر</NuxtLink>
      </BaseCard>

      <BaseCard v-else-if="guide.status === 'failed'" data-testid="guide-failed" class="space-y-3 text-sm">
        <p class="text-(--color-text)">{{ failureMessage(guide.failureCode) }}</p>
        <BaseButton :loading="retrying" data-testid="guide-retry" @click="retry">تلاش دوباره</BaseButton>
      </BaseCard>

      <template v-else>
        <p v-if="guide.lookSummaryFa" data-testid="guide-summary" class="text-base leading-8 text-(--color-text)">{{ guide.lookSummaryFa }}</p>

        <BaseCard v-if="guide.safetyNote === 'medical_concern'" data-testid="guide-safety" class="flex gap-2 text-sm text-(--color-text)">
          <BaseIcon name="alert-circle" :size="18" class="mt-0.5 shrink-0 text-(--color-danger)" />
          <span>این راهنما جنبه پزشکی ندارد. اگر نگران وضعیت پوست سر، پوست یا ناخن خود هستید، پیش از هر خدمتی با یک متخصص مشورت کنید.</span>
        </BaseCard>

        <GuideConceptList
          :concepts="guide.concepts"
          :vocabulary="vocabulary"
          :domain="guide.domain"
          :busy="busy"
          @remove="(key) => patch({ removeConceptKeys: [key] })"
          @restore="(key) => patch({ restoreConceptKeys: [key] })"
          @confirm="(key) => patch({ addConceptKeys: [key] })"
          @add="(key) => patch({ addConceptKeys: [key] })"
        />

        <GuideAttributeEditor
          :attributes="guide.attributes"
          :domain="guide.domain"
          :busy="busy"
          @change="(key, value) => patch({ attributes: { [key]: value } })"
        />

        <section v-if="guide.stylistRequestFa" class="space-y-2" data-testid="guide-request">
          <h2 class="font-bold text-(--color-text)">به آرایشگر بگویید</h2>
          <BaseCard class="space-y-3">
            <p class="leading-7 text-(--color-text)">«{{ guide.stylistRequestFa }}»</p>
            <BaseButton variant="secondary" @click="copyRequest">{{ copied ? 'کپی شد' : 'کپی متن' }}</BaseButton>
          </BaseCard>
        </section>

        <div class="grid gap-3 sm:grid-cols-2">
          <BaseCard v-if="guide.durationEstimate" data-testid="guide-duration" class="space-y-1">
            <p class="flex items-center gap-1 text-xs text-(--color-text-muted)"><BaseIcon name="clock" :size="14" /> زمان تقریبی</p>
            <p class="font-bold text-(--color-text)">{{ formatDurationEstimate(guide.durationEstimate) }}</p>
            <p class="text-xs text-(--color-text-muted)">تخمینی است؛ زمان نوبت را مدت خدمت هر سالن تعیین می‌کند.</p>
          </BaseCard>
          <BaseCard v-if="guide.maintenance.length" data-testid="guide-maintenance" class="space-y-1">
            <p class="text-xs text-(--color-text-muted)">نگهداری</p>
            <ul class="list-disc space-y-1 ps-5 text-sm text-(--color-text)">
              <li v-for="(item, i) in guide.maintenance" :key="i">{{ item.text }}</li>
            </ul>
          </BaseCard>
        </div>

        <section v-if="guide.discussionPoints.length" class="space-y-2" data-testid="guide-discussion">
          <h2 class="font-bold text-(--color-text)">با آرایشگر درباره این‌ها صحبت کنید</h2>
          <ul class="list-disc space-y-1 ps-5 text-sm text-(--color-text)">
            <li v-for="(point, i) in guide.discussionPoints" :key="i">{{ point }}</li>
          </ul>
        </section>

        <section class="space-y-3" aria-labelledby="guide-salons-title">
          <div class="flex items-center justify-between gap-3">
            <h2 id="guide-salons-title" class="font-bold text-(--color-text)">سالن‌هایی که این را انجام می‌دهند</h2>
            <BaseButton variant="ghost" :loading="locating" @click="useMyLocation">
              <template #icon><BaseIcon name="map-pin" :size="16" /></template>
              نزدیک من
            </BaseButton>
          </div>
          <AppSelect v-model="selectedCity" label="شهر" :options="cityOptions" placeholder="شهر را انتخاب کنید" />

          <p v-if="matchesLoading" class="text-sm text-(--color-text-muted)">در حال جستجوی سالن‌ها…</p>
          <BaseCard v-else-if="matchesError" data-testid="guide-matches-error" class="space-y-2 text-sm">
            <p>جستجوی سالن‌ها ناموفق بود.</p>
            <BaseButton variant="secondary" @click="loadMatches">تلاش دوباره</BaseButton>
          </BaseCard>
          <template v-else-if="matches">
            <p v-if="matches.emptyReason === 'no_mappable_concepts'" data-testid="guide-matches-unmapped" class="text-sm text-(--color-text-muted)">
              برای پیدا کردن سالن، حداقل یکی از موارد بالا را تأیید یا انتخاب کنید.
            </p>
            <p v-else-if="matches.emptyReason === 'gender_required'" class="text-sm text-(--color-text-muted)">
              برای نمایش سالن‌ها، جنسیت را در <NuxtLink to="/profile" class="text-(--color-accent-text) hover:underline">پروفایل</NuxtLink> تکمیل کنید.
            </p>
            <p v-else-if="!matches.salons.length" data-testid="guide-matches-empty" class="text-sm text-(--color-text-muted)">
              در این محدوده سالنی با این خدمات پیدا نشد. شهر دیگری را امتحان کنید.
            </p>
            <template v-else>
              <p v-if="activeConcepts.length > 1" class="text-xs text-(--color-text-muted)" data-testid="guide-price-note">
                هزینه نهایی بسته به خدمات انتخابی و مشاوره سالن متفاوت است.
              </p>
              <GuideSalonMatches :salons="matches.salons" :guide-id="guide.id" :concept-names="conceptNames" />
            </template>

            <section v-if="matches.portfolio.length" class="space-y-2" aria-labelledby="guide-portfolio-title">
              <h2 id="guide-portfolio-title" class="font-bold text-(--color-text)">نمونه کارهای مشابه</h2>
              <GuidePortfolioGrid :items="matches.portfolio" />
            </section>
          </template>
        </section>

        <p class="text-xs leading-6 text-(--color-text-muted)">
          این راهنما با کمک هوش مصنوعی ساخته شده و جنبه راهنمایی دارد. قیمت، زمان و امکان انجام خدمت را سالن تعیین می‌کند.
          تشخیص‌ها: {{ activeConcepts.map((c) => conceptLabel(c)).join('، ') || '—' }}
        </p>
      </template>

      <div class="pt-2 text-center">
        <BaseButton variant="ghost" data-testid="guide-delete" @click="confirmingDelete = true">حذف این راهنما</BaseButton>
      </div>
    </template>

    <ConfirmDialog
      v-if="confirmingDelete"
      title="حذف راهنما"
      message="این راهنما و تصویر آن برای همیشه حذف می‌شود."
      confirm-label="حذف راهنما"
      tone="danger"
      :loading="deleting"
      data-testid="guide-delete-dialog"
      confirm-test-id="guide-delete-confirm"
      cancel-test-id="guide-delete-cancel"
      @confirm="remove"
      @cancel="confirmingDelete = false"
    />
  </div>
</template>
