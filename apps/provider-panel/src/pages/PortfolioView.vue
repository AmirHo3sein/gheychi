<!-- apps/provider-panel/src/pages/PortfolioView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import PhotoUploader from '@/components/photos/PhotoUploader.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useApi } from '@/composables/useApi'

interface PortfolioItem {
  id: string
  url: string
  caption: string | null
  serviceId: string | null
  status: 'published' | 'removed'
  sortOrder: number
  createdAt: string
}
interface Service {
  id: string
  name: string
}

const { apiFetch } = useApi()
const items = ref<PortfolioItem[]>([])
const services = ref<Service[]>([])
const loading = ref(true)

async function load() {
  const { data } = await apiFetch<PortfolioItem[]>('/salons/mine/portfolio', { silent: true })
  items.value = data ?? []
  loading.value = false
}

onMounted(async () => {
  const [servicesRes] = await Promise.all([apiFetch<Service[]>('/salons/mine/services', { silent: true }), load()])
  services.value = servicesRes.data ?? []
})

function onUploaded(item: PortfolioItem) {
  items.value.push(item)
}

async function removeItem(id: string) {
  await apiFetch(`/salons/mine/portfolio/${id}`, { method: 'DELETE' })
  await load()
}

async function saveCaption(item: PortfolioItem, event: Event) {
  const input = event.target as HTMLInputElement
  const caption = input.value.trim()
  if (caption === (item.caption ?? '')) return
  // An emptied input clears the caption: explicit null bypasses the 1-300 length rule
  // (@IsOptional skips null) and nulls the column -- same pattern as serviceId below.
  const { data } = await apiFetch<PortfolioItem>(`/salons/mine/portfolio/${item.id}`, {
    method: 'PATCH',
    body: { caption: caption || null },
  })
  if (data) item.caption = data.caption
}

async function setService(item: PortfolioItem, event: Event) {
  const value = (event.target as HTMLSelectElement).value
  // '' clears the service link -- the API accepts serviceId: null for that.
  const { data } = await apiFetch<PortfolioItem>(`/salons/mine/portfolio/${item.id}`, {
    method: 'PATCH',
    body: { serviceId: value || null },
  })
  if (data) item.serviceId = data.serviceId
}

// Reorder = swap the two adjacent rows' sortOrders via two PATCHes, then refetch
// the server-ordered list.
async function move(index: number, direction: -1 | 1) {
  const a = items.value[index]
  const b = items.value[index + direction]
  if (!a || !b) return
  await Promise.all([
    apiFetch(`/salons/mine/portfolio/${a.id}`, { method: 'PATCH', body: { sortOrder: b.sortOrder } }),
    apiFetch(`/salons/mine/portfolio/${b.id}`, { method: 'PATCH', body: { sortOrder: a.sortOrder } }),
  ])
  await load()
}
</script>

<template>
  <div class="space-y-4 p-4">
    <div class="flex items-center justify-between">
      <h1 class="text-lg font-bold text-(--color-text)">نمونه کارها</h1>
      <span data-testid="cap-meter" class="tnum rounded-full bg-(--tone-info-bg) px-3 py-1 text-xs font-semibold text-(--tone-info-text)">
        {{ items.length.toLocaleString('fa-IR') }} از ۴۰ نمونه کار
      </span>
    </div>

    <PhotoUploader endpoint="/salons/mine/portfolio" @uploaded="onUploaded" />

    <EmptyState v-if="!loading && items.length === 0" icon="portfolio" message="هنوز نمونه کاری ثبت نشده است." />

    <div v-else class="space-y-3">
      <div
        v-for="(p, index) in items"
        :key="p.id"
        class="flex gap-3 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-3 shadow-(--shadow-panel)"
      >
        <div class="relative h-24 w-24 shrink-0">
          <img :src="p.url" class="h-full w-full rounded-xl object-cover" />
          <span
            v-if="p.status === 'removed'"
            data-testid="removed-badge"
            class="absolute right-1 top-1 rounded-full bg-(--tone-danger-bg) px-1.5 py-0.5 text-[10px] font-bold text-(--tone-danger-text) shadow-(--shadow-panel)"
          >
            توسط مدیر حذف شد
          </span>
        </div>
        <div class="min-w-0 flex-1 space-y-2">
          <input
            :value="p.caption ?? ''"
            data-testid="item-caption"
            maxlength="300"
            placeholder="توضیح نمونه کار"
            class="w-full rounded-lg border border-(--color-border) bg-(--color-surface) p-1.5 text-sm"
            @blur="saveCaption(p, $event)"
          />
          <select
            :value="p.serviceId ?? ''"
            data-testid="item-service"
            class="native-select w-full rounded-lg border border-(--color-border) bg-(--color-surface) p-1.5 text-sm"
            @change="setService(p, $event)"
          >
            <option value="">بدون خدمت مرتبط</option>
            <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1">
              <button
                type="button"
                data-testid="move-up"
                :disabled="index === 0"
                class="rounded-lg border border-(--color-border) p-1 text-(--color-text) disabled:opacity-30"
                @click="move(index, -1)"
              >
                <AppIcon name="chevron-up" :size="14" />
              </button>
              <button
                type="button"
                data-testid="move-down"
                :disabled="index === items.length - 1"
                class="rounded-lg border border-(--color-border) p-1 text-(--color-text) disabled:opacity-30"
                @click="move(index, 1)"
              >
                <AppIcon name="chevron-down" :size="14" />
              </button>
            </div>
            <button type="button" data-testid="delete-item" class="text-(--tone-danger-text)" @click="removeItem(p.id)">
              <AppIcon name="trash" :size="15" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
