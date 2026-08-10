<!-- apps/provider-panel/src/pages/PortfolioView.vue -->
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import PhotoUploader from '@/components/photos/PhotoUploader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect, { type SelectOption } from '@/components/ui/AppSelect.vue'
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
const loadError = ref(false)

// Caption edit drafts, keyed by item id -- kept separate from PortfolioItem.caption
// (rather than a direct v-model onto it) so the existing "no-op if unchanged from the
// persisted value" guard in saveCaption below keeps working: AppInput requires a real
// two-way v-model target, and binding straight to item.caption would make the guard
// compare a value against itself and never fire the PATCH.
const captionDrafts = reactive<Record<string, string>>({})

async function load() {
  loading.value = true
  loadError.value = false

  const [itemsRes, servicesRes] = await Promise.all([
    apiFetch<PortfolioItem[]>('/salons/mine/portfolio', { silent: true }),
    apiFetch<Service[]>('/salons/mine/services', { silent: true }),
  ])

  if (itemsRes.error || servicesRes.error) {
    loadError.value = true
    loading.value = false
    return
  }

  items.value = itemsRes.data ?? []
  for (const p of items.value) captionDrafts[p.id] = p.caption ?? ''
  services.value = servicesRes.data ?? []
  loading.value = false
}

onMounted(load)

// The empty-valued first entry is a REAL selectable option, not a placeholder: picking it
// is the only way to unlink a service, and it's also what a null serviceId displays as.
const serviceOptions = computed<SelectOption[]>(() => [
  { value: '', label: 'بدون خدمت مرتبط' },
  ...services.value.map((s) => ({ value: s.id, label: s.name })),
])

function onUploaded(item: PortfolioItem) {
  items.value.push(item)
  captionDrafts[item.id] = item.caption ?? ''
}

async function removeItem(id: string) {
  if (!window.confirm('این نمونه کار حذف شود؟')) return
  await apiFetch(`/salons/mine/portfolio/${id}`, { method: 'DELETE' })
  await load()
}

async function saveCaption(item: PortfolioItem) {
  const caption = (captionDrafts[item.id] ?? '').trim()
  if (caption === (item.caption ?? '')) return
  // An emptied input clears the caption: explicit null bypasses the 1-300 length rule
  // (@IsOptional skips null) and nulls the column -- same pattern as serviceId below.
  const { data } = await apiFetch<PortfolioItem>(`/salons/mine/portfolio/${item.id}`, {
    method: 'PATCH',
    body: { caption: caption || null },
  })
  if (data) {
    item.caption = data.caption
    captionDrafts[item.id] = data.caption ?? ''
  }
}

// AppSelect hands over the picked option's raw value, not a DOM Event.
async function setService(item: PortfolioItem, value: string | number | null) {
  // '' (the «بدون خدمت مرتبط» option) clears the service link -- the API accepts
  // serviceId: null for that.
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
  <div class="mx-auto w-full max-w-5xl space-y-4 p-4 lg:p-6">
    <!-- flex-wrap: heading + cap meter don't share a 288px row at 320px. justify-center, not
         justify-between: the content below is independently centered within this wide
         container (uploader via mx-auto, item grid via auto-fit + justify-center), not
         stretched to fill it -- a justify-between header spanning the full container read as
         visibly offset from that centered content ("the title is on the right"). -->
    <div class="flex flex-wrap items-center justify-center gap-2">
      <h1 class="text-lg font-bold text-(--color-text)">نمونه کارها</h1>
      <span data-testid="cap-meter" class="tnum rounded-full bg-(--tone-info-bg) px-3 py-1 text-xs font-semibold text-(--tone-info-text)">
        {{ items.length.toLocaleString('fa-IR') }} از ۴۰ نمونه کار
      </span>
    </div>

    <PhotoUploader class="mx-auto max-w-2xl" endpoint="/salons/mine/portfolio" @uploaded="onUploaded" />

    <div v-if="loadError" class="space-y-3 rounded-2xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">نمونه کارها بارگذاری نشد.</p>
      <AppButton type="button" variant="secondary" data-testid="retry-portfolio" @click="load">تلاش دوباره</AppButton>
    </div>

    <template v-else>
      <div v-if="loading" class="flex items-center justify-center py-8 text-(--color-text-muted)">
        <AppIcon name="spinner" :size="20" class="animate-spin" />
      </div>

      <template v-else>
        <EmptyState v-if="items.length === 0" icon="portfolio" message="هنوز نمونه کاری ثبت نشده است." />

        <!-- auto-fit + justify-center, not a fixed xl:grid-cols-2: each row is a fixed 96px
             thumbnail plus a compact edit column, so one row per line wastes most of a
             laptop/desktop viewport -- but a FIXED column count strands a lone/odd trailing
             item in the RTL start (right) column with visibly empty space beside it. This
             still lays out two-up once there's enough for a second column, but centers the
             populated tracks when there isn't.
             max: 1fr, not a fixed px cap -- a fixed max lets each column size independently
             off its own content up to that cap, producing visibly uneven column widths when
             items differ (the bug BookingsView.vue had); 1fr splits the row's leftover space
             equally across every populated column instead. -->
        <div v-else class="grid items-start justify-center gap-3 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
          <div
            v-for="(p, index) in items"
            :key="p.id"
            class="flex gap-3 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-3 shadow-(--shadow-sm)"
          >
            <div class="relative h-24 w-24 shrink-0">
              <img :src="p.url" class="h-full w-full rounded-xl object-cover" />
              <span
                v-if="p.status === 'removed'"
                data-testid="removed-badge"
                class="absolute end-1 top-1 rounded-full bg-(--tone-danger-bg) px-1.5 py-0.5 text-[10px] font-bold text-(--tone-danger-text) shadow-(--shadow-sm)"
              >
                توسط مدیر حذف شد
              </span>
            </div>
            <div class="min-w-0 flex-1 space-y-2">
              <div>
                <AppInput
                  v-model="captionDrafts[p.id]"
                  data-testid="item-caption"
                  label="توضیح نمونه کار"
                  :maxlength="300"
                  placeholder="مثلاً رنگ و کوتاهی مو"
                  @blur="saveCaption(p)"
                />
                <span class="tnum mt-1 block text-end text-xs text-(--color-text-muted)">
                  {{ (captionDrafts[p.id] ?? '').length.toLocaleString('fa-IR') }}/۳۰۰
                </span>
              </div>
              <!-- Not v-model: the picked value isn't kept locally, it round-trips through the
                   PATCH and the row is updated from the server response. aria-label stands in
                   for the visible label this compact row deliberately doesn't have. -->
              <AppSelect
                :model-value="p.serviceId ?? ''"
                :options="serviceOptions"
                data-testid="item-service"
                aria-label="خدمت مرتبط"
                @update:model-value="setService(p, $event)"
              />
              <!-- Two reorder buttons + delete come to ~143px against the ~156px this column
                   has at 320px -- inside the margin, but flex-wrap keeps it honest if a
                   label or icon size ever grows. -->
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-1">
                  <AppButton
                    type="button"
                    variant="secondary"
                    data-testid="move-up"
                    aria-label="جابه‌جایی به بالا"
                    :disabled="index === 0"
                    @click="move(index, -1)"
                  >
                    <template #icon><AppIcon name="chevron-up" :size="14" /></template>
                  </AppButton>
                  <AppButton
                    type="button"
                    variant="secondary"
                    data-testid="move-down"
                    aria-label="جابه‌جایی به پایین"
                    :disabled="index === items.length - 1"
                    @click="move(index, 1)"
                  >
                    <template #icon><AppIcon name="chevron-down" :size="14" /></template>
                  </AppButton>
                </div>
                <AppButton
                  type="button"
                  variant="danger"
                  data-testid="delete-item"
                  aria-label="حذف نمونه کار"
                  @click="removeItem(p.id)"
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
