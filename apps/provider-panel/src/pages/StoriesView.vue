<!-- apps/provider-panel/src/pages/StoriesView.vue -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useId } from 'vue'
import PhotoUploader from '@/components/photos/PhotoUploader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useApi } from '@/composables/useApi'
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
const stories = ref<SalonStory[]>([])
const services = ref<Service[]>([])
const loading = ref(true)
const loadError = ref(false)
const caption = ref('')
const serviceId = ref('')
const serviceSelectId = useId()
const deletingId = ref<string | null>(null)

// GET /salons/mine/stories only ever returns unexpired rows (the API's expiry read
// filter is authoritative), and admin-removed rows still occupy their cap slot until
// natural expiry -- so the cap meter's active count is simply the list length.
const activeCount = computed(() => stories.value.length)

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
  <div class="space-y-4 p-4">
    <div class="flex items-center justify-between">
      <h1 class="text-lg font-bold text-(--color-text)">استوری‌ها</h1>
      <span data-testid="cap-meter" class="tnum rounded-full bg-(--tone-info-bg) px-3 py-1 text-xs font-semibold text-(--tone-info-text)">
        {{ activeCount.toLocaleString('fa-IR') }} از ۱۰ استوری فعال
      </span>
    </div>

    <div class="space-y-3 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-4 shadow-(--shadow-sm)">
      <div>
        <div class="mb-1.5 flex items-center justify-between">
          <label class="block text-sm font-semibold text-(--color-text)">توضیح استوری (اختیاری)</label>
          <span class="tnum text-xs text-(--color-text-muted)">{{ caption.length.toLocaleString('fa-IR') }}/۲۰۰</span>
        </div>
        <AppInput v-model="caption" data-testid="story-caption" :maxlength="200" placeholder="توضیح کوتاه" />
      </div>
      <div>
        <label :for="serviceSelectId" class="mb-1.5 block text-sm font-semibold text-(--color-text)">خدمت مرتبط (اختیاری)</label>
        <select
          :id="serviceSelectId"
          v-model="serviceId"
          data-testid="story-service"
          class="native-select w-full rounded-xl border border-(--color-border) bg-(--color-surface) p-3 text-sm"
        >
          <option value="">بدون خدمت مرتبط</option>
          <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
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

        <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
                class="absolute end-2 top-2 rounded-full bg-(--tone-danger-bg) px-2 py-0.5 text-xs font-bold text-(--tone-danger-text) shadow-(--shadow-sm)"
              >
                توسط مدیر حذف شد
              </span>
            </div>
            <div class="space-y-1.5 p-2">
              <p v-if="s.caption" class="truncate text-xs text-(--color-text)">{{ s.caption }}</p>
              <p v-if="serviceName(s.serviceId)" class="truncate text-xs text-(--color-accent-text)">{{ serviceName(s.serviceId) }}</p>
              <div class="flex items-center justify-between">
                <span class="tnum text-xs text-(--color-text-muted)">{{ formatRemainingTime(s.expiresAt, now) }}</span>
                <AppButton
                  type="button"
                  variant="danger"
                  aria-label="حذف استوری"
                  data-testid="delete-story"
                  :loading="deletingId === s.id"
                  :disabled="deletingId === s.id"
                  @click="removeStory(s.id)"
                >
                  <template #icon><AppIcon name="trash" :size="15" /></template>
                </AppButton>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
