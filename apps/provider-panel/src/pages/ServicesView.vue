<!-- apps/provider-panel/src/pages/ServicesView.vue -->
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppSelect, { type SelectOption } from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { useApi } from '@/composables/useApi'

interface Service {
  id: string
  categoryId: number
  name: string
  price: number
  durationMin: number
  isActive: boolean
  discountPercent: number | null
}

const { apiFetch } = useApi()
const services = ref<Service[]>([])
const categories = ref<{ id: number; name: string }[]>([])
const loading = ref(true)
const newService = reactive({
  categoryId: null as number | null,
  name: '',
  price: 0,
  durationMin: 30,
  discountPercent: null as number | null,
})

const categoryOptions = computed<SelectOption[]>(() => categories.value.map((c) => ({ value: c.id, label: c.name })))

async function load() {
  const { data } = await apiFetch<Service[]>('/salons/mine/services', { silent: true })
  services.value = data ?? []
  loading.value = false
}

onMounted(async () => {
  const [categoriesRes] = await Promise.all([apiFetch<{ id: number; name: string }[]>('/categories', { silent: true }), load()])
  categories.value = categoriesRes.data ?? []
})

async function addService() {
  if (!newService.categoryId || newService.name.trim().length < 2) return
  // discountPercent is optional on create (unlike update, the create DTO has no null-clear
  // path) -- omit it entirely rather than sending an empty/NaN value when left blank.
  const body: Record<string, unknown> = {
    categoryId: newService.categoryId,
    name: newService.name,
    price: newService.price,
    durationMin: newService.durationMin,
  }
  if (newService.discountPercent) body.discountPercent = Number(newService.discountPercent)
  await apiFetch('/salons/mine/services', { method: 'POST', body })
  newService.categoryId = null
  newService.name = ''
  newService.price = 0
  newService.durationMin = 30
  newService.discountPercent = null
  await load()
}

// NOTE: GET /salons/mine/services only ever returns isActive: true rows, and
// PATCH /salons/mine/services/:id looks the service up scoped to isActive: true
// (see salon-services.controller.ts `update()`), so a deactivated service can never
// be found again to be reactivated -- it simply disappears from this list after
// DELETE. There is no reactivation path in the API today, so this is a one-way
// "deactivate" action, not a bidirectional toggle.
async function deactivate(service: Service) {
  await apiFetch(`/salons/mine/services/${service.id}`, { method: 'DELETE' })
  await load()
}

async function updatePrice(service: Service, price: number) {
  await apiFetch(`/salons/mine/services/${service.id}`, { method: 'PATCH', body: { price } })
}

async function updateDiscount(service: Service, value: string) {
  await apiFetch(`/salons/mine/services/${service.id}`, {
    method: 'PATCH',
    body: { discountPercent: value === '' ? null : Number(value) },
  })
}
</script>

<template>
  <div class="space-y-4 p-4">
    <h1 class="text-lg font-bold text-(--color-text)">خدمات و قیمت‌ها</h1>

    <EmptyState v-if="!loading && services.length === 0" icon="services" message="هنوز خدمتی ثبت نشده است." />

    <AppCard v-for="s in services" :key="s.id" :padded="false" class="flex items-center justify-between p-4">
      <div>
        <div class="mb-1.5 flex items-center gap-2">
          <p class="text-sm font-bold text-(--color-text)">{{ s.name }}</p>
          <StatusBadge v-if="s.discountPercent" :label="`٪${s.discountPercent} تخفیف`" tone="success" />
        </div>
        <div class="flex items-center gap-2">
          <div class="relative w-32">
            <input
              :value="s.price"
              type="number"
              class="tnum w-full rounded-lg border border-(--color-border) bg-(--color-surface) p-1.5 text-sm"
              @change="updatePrice(s, +($event.target as HTMLInputElement).value)"
            />
          </div>
          <div class="relative w-24">
            <input
              :value="s.discountPercent ?? ''"
              type="number"
              min="1"
              max="100"
              placeholder="٪ تخفیف"
              class="tnum w-full rounded-lg border border-(--color-border) bg-(--color-surface) p-1.5 text-sm"
              @change="updateDiscount(s, ($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>
      </div>
      <label class="flex items-center gap-2 text-sm text-(--color-text)">
        <input type="checkbox" class="h-4 w-4 accent-(--color-accent)" :checked="s.isActive" @change="deactivate(s)" />
        فعال
      </label>
    </AppCard>

    <AppCard class="space-y-3">
      <h2 class="font-bold text-(--color-text)">افزودن خدمت جدید</h2>
      <AppSelect v-model="newService.categoryId" :options="categoryOptions" placeholder="دسته‌بندی" />
      <input v-model="newService.name" placeholder="نام خدمت" class="w-full rounded-xl border border-(--color-border) bg-(--color-surface) p-3 text-sm" />
      <div class="grid grid-cols-2 gap-3">
        <input
          v-model.number="newService.price"
          type="number"
          placeholder="قیمت"
          class="tnum w-full rounded-xl border border-(--color-border) bg-(--color-surface) p-3 text-sm"
        />
        <input
          v-model.number="newService.durationMin"
          type="number"
          placeholder="مدت زمان (دقیقه)"
          class="tnum w-full rounded-xl border border-(--color-border) bg-(--color-surface) p-3 text-sm"
        />
      </div>
      <input
        v-model.number="newService.discountPercent"
        type="number"
        min="1"
        max="100"
        placeholder="٪ تخفیف (اختیاری)"
        class="tnum w-full rounded-xl border border-(--color-border) bg-(--color-surface) p-3 text-sm"
      />
      <button
        type="button"
        class="w-full rounded-xl bg-(--color-accent) p-3 text-sm font-bold text-white transition-opacity hover:opacity-90"
        @click="addService"
      >
        افزودن
      </button>
    </AppCard>
  </div>
</template>
