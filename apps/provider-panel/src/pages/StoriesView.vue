<!-- apps/provider-panel/src/pages/StoriesView.vue -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useId } from 'vue'
import PhotoUploader from '@/components/photos/PhotoUploader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect, { type SelectOption } from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useApi } from '@/composables/useApi'
import { useFeatureFlags } from '@/composables/useFeatureFlags'
import { formatRemainingTime } from '@/utils/remaining-time'

interface SalonStory {
  id: string
  url: string
  caption: string | null
  serviceId: string | null
  status: 'published' | 'removed'
  createdAt: string
  expiresAt: string
}
interface Service {
  id: string
  name: string
}

const { apiFetch } = useApi()
const { flags: featureFlags } = useFeatureFlags()
const stories = ref<SalonStory[]>([])
const services = ref<Service[]>([])
const loading = ref(true)
const loadError = ref(false)
const caption = ref('')
const serviceId = ref('')
// vue-multiselect's root is a role="combobox" div, not a labelable control, so the visible
// label can't reach it with `for`. It carries this id instead and AppSelect gets it via
// aria-labelledby (an undeclared Multiselect prop, so attrs fallthrough lands it on the root).
const serviceLabelId = useId()
const deletingId = ref<string | null>(null)

// GET /salons/mine/stories only ever returns unexpired rows (the API's expiry read
// filter is authoritative), and admin-removed rows still occupy their cap slot until
// natural expiry -- so the cap meter's active count is simply the list length.
const activeCount = computed(() => stories.value.length)

// «بدون خدمت مرتبط» is a real, selectable option (empty serviceId), not a placeholder:
// picking it is how an owner detaches a service they'd already chosen.
const serviceOptions = computed<SelectOption[]>(() => [
  { value: '', label: 'بدون خدمت مرتبط' },
  ...services.value.map((s) => ({ value: s.id, label: s.name })),
])

const extraFields = computed<Record<string, string>>(() => {
  const fields: Record<string, string> = {}
  if (caption.value.trim()) fields.caption = caption.value.trim()
  if (serviceId.value) fields.serviceId = serviceId.value
  return fields
})

// Ticks once a minute so the «... مانده» labels stay fresh while the page is open.
const now = ref(new Date())
const timer = setInterval(() => {
  now.value = new Date()
}, 60_000)
onUnmounted(() => clearInterval(timer))

async function load() {
  loading.value = true
  loadError.value = false
  const { data, error } = await apiFetch<SalonStory[]>('/salons/mine/stories', { silent: true })
  if (error) {
    loadError.value = true
    loading.value = false
    return
  }
  stories.value = data ?? []
  loading.value = false
}

onMounted(async () => {
  const [servicesRes] = await Promise.all([apiFetch<Service[]>('/salons/mine/services', { silent: true }), load()])
  services.value = servicesRes.data ?? []
})

function onUploaded(story: SalonStory) {
  stories.value.push(story)
  caption.value = ''
  serviceId.value = ''
}

async function removeStory(id: string) {
  if (deletingId.value) return
  if (!window.confirm('این استوری حذف شود؟')) return
  deletingId.value = id
  const { error } = await apiFetch(`/salons/mine/stories/${id}`, { method: 'DELETE' })
  deletingId.value = null
  if (!error) await load()
}

function serviceName(id: string | null) {
  if (!id) return null
  return services.value.find((s) => s.id === id)?.name ?? null
}
</script>

<template>
  <div class="mx-auto w-full max-w-6xl space-y-4 p-4 lg:p-6">
    <!-- flex-wrap: the cap meter pill is ~165px and the heading ~85px -- together they need
         two rows once 320px loses its page padding. justify-center, not justify-between: the
         composer form below is independently centered (mx-auto) within this wide container,
         not stretched to fill it -- a justify-between header spanning the full container
         read as visibly offset from that centered form. -->
    <div class="flex flex-wrap items-center justify-center gap-2">
      <h1 class="text-lg font-bold text-(--color-text)">استوری‌ها</h1>
      <span data-testid="cap-meter" class="tnum rounded-full bg-(--tone-info-bg) px-3 py-1 text-xs font-semibold text-(--tone-info-text)">
        {{ activeCount.toLocaleString('fa-IR') }} از ۱۰ استوری فعال
      </span>
    </div>

    <!-- Management stays fully functional while the flag is off (only the public read is
         gated server-side, see public-salon-content.controller.ts) -- this just explains
         why nothing shows up on the salon's public profile right now. -->
    <p
      v-if="!featureFlags.storiesEnabled"
      data-testid="stories-disabled-banner"
      role="status"
      class="mx-auto flex max-w-2xl items-center gap-2 rounded-xl bg-(--tone-warning-bg) p-3 text-sm text-(--tone-warning-text)"
    >
      <AppIcon name="warning" :size="16" class="shrink-0" />
      این ویژگی موقتاً برای مشتریان غیرفعال است؛ می‌توانید همچنان استوری مدیریت کنید.
    </p>

    <!-- Composer form: capped AND centered so its caption field stays a sane width on a
         laptop (while the story grid below still uses the full container) without hugging
         the RTL start (right) edge the way a cap-without-center would. -->
    <div class="mx-auto max-w-2xl space-y-3 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-4 shadow-(--shadow-sm)">
      <div>
        <div class="mb-1.5 flex items-center justify-between">
          <label class="block text-sm font-semibold text-(--color-text)">توضیح استوری (اختیاری)</label>
          <span class="tnum text-xs text-(--color-text-muted)">{{ caption.length.toLocaleString('fa-IR') }}/۲۰۰</span>
        </div>
        <AppInput v-model="caption" data-testid="story-caption" :maxlength="200" placeholder="توضیح کوتاه" />
      </div>
      <div>
        <label :id="serviceLabelId" class="mb-1.5 block text-sm font-semibold text-(--color-text)">خدمت مرتبط (اختیاری)</label>
        <AppSelect
          :model-value="serviceId"
          data-testid="story-service"
          :options="serviceOptions"
          :aria-labelledby="serviceLabelId"
          @update:model-value="serviceId = String($event ?? '')"
        />
      </div>
      <PhotoUploader v-if="activeCount < 10" endpoint="/salons/mine/stories" :extra-fields="extraFields" @uploaded="onUploaded" />
      <p
        v-else
        data-testid="cap-reached"
        class="rounded-xl bg-(--tone-warning-bg) p-3 text-sm text-(--tone-warning-text)"
      >
        به سقف ۱۰ استوری فعال رسیده‌اید.
      </p>
      <p class="text-xs text-(--color-text-muted)">هر استوری ۲۴ ساعت پس از انتشار به‌صورت خودکار حذف می‌شود.</p>
    </div>

    <div v-if="loadError" class="space-y-3 rounded-2xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">استوری‌ها بارگذاری نشد.</p>
      <AppButton type="button" variant="secondary" data-testid="retry-stories" @click="load">تلاش دوباره</AppButton>
    </div>

    <template v-else>
      <div v-if="loading" class="flex items-center justify-center py-8 text-(--color-text-muted)">
        <AppIcon name="spinner" :size="20" class="animate-spin" />
      </div>

      <template v-else>
        <EmptyState v-if="stories.length === 0" icon="stories" message="هنوز استوری فعالی ندارید." />

        <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <div
            v-for="s in stories"
            :key="s.id"
            class="overflow-hidden rounded-2xl border border-(--color-border) bg-(--color-surface-card) shadow-(--shadow-sm)"
          >
            <div class="relative aspect-square w-full">
              <img :src="s.url" :alt="s.caption ?? 'استوری'" class="h-full w-full object-cover" />
              <span
                v-if="s.status === 'removed'"
                data-testid="removed-badge"
                class="absolute end-2 top-2 max-w-[calc(100%-1rem)] rounded-full bg-(--tone-danger-bg) px-2 py-0.5 text-xs font-bold text-(--tone-danger-text) shadow-(--shadow-sm)"
              >
                توسط مدیر حذف شد
              </span>
              <!--
                Delete overlays the image rather than sharing the footer row with the
                «... مانده» label: the label (~85px) plus a 47px button exceeded the ~122px
                of footer a tile has at 320px, and the tile's overflow-hidden CLIPPED the
                button instead of overflowing visibly. Same treatment as PhotosView, and
                start-2 keeps it clear of the end-2 removed badge.
              -->
              <AppButton
                type="button"
                variant="danger"
                class="absolute start-2 top-2 shadow-(--shadow-md)"
                aria-label="حذف استوری"
                data-testid="delete-story"
                :loading="deletingId === s.id"
                :disabled="deletingId === s.id"
                @click="removeStory(s.id)"
              >
                <template #icon><AppIcon name="trash" :size="15" /></template>
              </AppButton>
            </div>
            <div class="space-y-1 p-2">
              <!-- line-clamp, not truncate: a 122px tile cuts almost any caption off at the
                   first word, which reads as data loss rather than a preview. -->
              <p v-if="s.caption" class="line-clamp-2 break-words text-xs text-(--color-text)">{{ s.caption }}</p>
              <p v-if="serviceName(s.serviceId)" class="truncate text-xs text-(--color-accent-text)">{{ serviceName(s.serviceId) }}</p>
              <span class="tnum block text-xs text-(--color-text-muted)">{{ formatRemainingTime(s.expiresAt, now) }}</span>
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
