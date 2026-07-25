<!-- apps/provider-panel/src/pages/ServicesView.vue -->
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect, { type SelectOption } from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'

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
const { push: pushToast } = useToast()
const services = ref<Service[]>([])
const categories = ref<{ id: number; name: string }[]>([])
const loading = ref(true)
const loadError = ref(false)
const createError = ref('')
const newService = reactive({
  categoryId: null as number | null,
  name: '',
  price: 0,
  durationMin: 30,
  discountPercent: null as number | null,
})

const categoryOptions = computed<SelectOption[]>(() => categories.value.map((c) => ({ value: c.id, label: c.name })))

async function load() {
  loading.value = true
  loadError.value = false

  const [servicesRes, categoriesRes] = await Promise.all([
    apiFetch<Service[]>('/salons/mine/services', { silent: true }),
    apiFetch<{ id: number; name: string }[]>('/categories', { silent: true }),
  ])

  if (servicesRes.error || categoriesRes.error) {
    loadError.value = true
    loading.value = false
    return
  }

  services.value = servicesRes.data ?? []
  categories.value = categoriesRes.data ?? []
  loading.value = false
}

onMounted(load)

async function addService() {
  createError.value = ''
  if (!newService.categoryId) {
    createError.value = 'دسته‌بندی خدمت را انتخاب کنید.'
    return
  }
  if (newService.name.trim().length < 2) {
    createError.value = 'نام خدمت باید حداقل ۲ حرف باشد.'
    return
  }

  // discountPercent is optional on create (unlike update, the create DTO has no null-clear
  // path) -- omit it entirely rather than sending an empty/NaN value when left blank.
  const body: Record<string, unknown> = {
    categoryId: newService.categoryId,
    name: newService.name,
    price: newService.price,
    durationMin: newService.durationMin,
  }
  if (newService.discountPercent) body.discountPercent = Number(newService.discountPercent)
  const { error } = await apiFetch('/salons/mine/services', { method: 'POST', body })
  if (error) return

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
// "deactivate" action, not a bidirectional toggle -- confirm explicitly rather than
// exposing it as a bare checkbox (mirrors CouponsView.vue's deactivate()).
async function deactivate(service: Service) {
  if (!window.confirm(`خدمت «${service.name}» برای همیشه غیرفعال شود؟ این عملیات قابل بازگشت نیست.`)) return
  const { error } = await apiFetch(`/salons/mine/services/${service.id}`, { method: 'DELETE' })
  if (!error) {
    services.value = services.value.filter((s) => s.id !== service.id)
    pushToast('خدمت غیرفعال شد')
  }
}

async function updatePrice(service: Service, price: number) {
  const { error } = await apiFetch(`/salons/mine/services/${service.id}`, { method: 'PATCH', body: { price } })
  if (!error) {
    service.price = price
    pushToast('قیمت به‌روزرسانی شد')
  }
}

async function updateDiscount(service: Service, value: string) {
  const discountPercent = value === '' ? null : Number(value)
  const { error } = await apiFetch(`/salons/mine/services/${service.id}`, {
    method: 'PATCH',
    body: { discountPercent },
  })
  if (!error) {
    service.discountPercent = discountPercent
    pushToast('تخفیف به‌روزرسانی شد')
  }
}
</script>

<template>
  <div class="space-y-4 p-4">
    <h1 class="text-lg font-bold text-(--color-text)">خدمات و قیمت‌ها</h1>

    <div v-if="loadError" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">خدمات بارگذاری نشد.</p>
      <AppButton variant="secondary" data-testid="retry-services" @click="load">
        تلاش دوباره
      </AppButton>
    </div>

    <template v-else>
      <div v-if="loading" class="flex items-center justify-center py-8 text-(--color-text-muted)">
        <AppIcon name="spinner" :size="20" class="animate-spin" />
      </div>

      <template v-else>
        <EmptyState v-if="services.length === 0" icon="services" message="هنوز خدمتی ثبت نشده است." />

        <AppCard v-for="s in services" :key="s.id" :padded="false" class="space-y-3 p-4">
          <div class="flex items-center justify-between gap-3">
            <div class="mb-1.5 flex items-center gap-2">
              <p class="text-sm font-bold text-(--color-text)">{{ s.name }}</p>
              <StatusBadge v-if="s.discountPercent" :label="`٪${s.discountPercent} تخفیف`" tone="success" />
            </div>
            <AppButton type="button" variant="danger" data-testid="deactivate-service" @click="deactivate(s)">
              <template #icon><AppIcon name="x" :size="15" /></template>
              غیرفعال‌سازی
            </AppButton>
          </div>
          <div class="flex items-center gap-2">
            <AppInput
              :model-value="String(s.price)"
              label="قیمت (تومان)"
              type="number"
              class="tnum w-32"
              @change="updatePrice(s, +($event.target as HTMLInputElement).value)"
            />
            <AppInput
              :model-value="s.discountPercent != null ? String(s.discountPercent) : ''"
              label="٪ تخفیف"
              type="number"
              min="1"
              max="100"
              placeholder="٪ تخفیف"
              class="tnum w-24"
              @change="updateDiscount(s, ($event.target as HTMLInputElement).value)"
            />
          </div>
        </AppCard>
      </template>
    </template>

    <AppCard class="space-y-3">
      <h2 class="font-bold text-(--color-text)">افزودن خدمت جدید</h2>
      <AppSelect v-model="newService.categoryId" :options="categoryOptions" placeholder="دسته‌بندی" />
      <AppInput v-model="newService.name" placeholder="نام خدمت" />
      <div class="grid grid-cols-2 gap-3">
        <AppInput
          :model-value="String(newService.price)"
          label="قیمت (تومان)"
          type="number"
          class="tnum"
          @update:model-value="(v) => (newService.price = Number(v))"
        />
        <AppInput
          :model-value="String(newService.durationMin)"
          label="مدت زمان (دقیقه)"
          type="number"
          class="tnum"
          @update:model-value="(v) => (newService.durationMin = Number(v))"
        />
      </div>
      <AppInput
        :model-value="newService.discountPercent != null ? String(newService.discountPercent) : ''"
        label="٪ تخفیف (اختیاری)"
        type="number"
        min="1"
        max="100"
        placeholder="٪ تخفیف (اختیاری)"
        class="tnum"
        @update:model-value="(v) => (newService.discountPercent = v === '' ? null : Number(v))"
      />
      <p v-if="createError" class="flex items-center gap-2 rounded-xl bg-(--tone-danger-bg) p-3 text-sm text-(--tone-danger-text)">
        {{ createError }}
      </p>
      <AppButton type="button" block @click="addService">
        افزودن
      </AppButton>
    </AppCard>
  </div>
</template>
