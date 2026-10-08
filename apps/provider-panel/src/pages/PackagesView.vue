<!-- apps/provider-panel/src/pages/PackagesView.vue -->
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppMoneyInput from '@/components/ui/AppMoneyInput.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useApi } from '@/composables/useApi'
import { useConfirm } from '@/composables/useConfirm'
import { useToast } from '@/composables/useToast'
import { formatToman } from '@/utils/format-toman'

type PricingType = 'fixed' | 'from' | 'range' | 'quote'

interface Service {
  id: string
  name: string
  isActive: boolean
}

interface PackageItem {
  serviceId: string
  name: string
  pricingType: PricingType
  price: number | null
  durationMin: number
}

interface Package {
  id: string
  name: string
  description: string | null
  isActive: boolean
  pricingType: PricingType
  price: number | null
  priceMax: number | null
  items: PackageItem[]
}

const PRICING_TYPE_META: Record<PricingType, string> = {
  fixed: 'قیمت ثابت', from: 'شروع از', range: 'بازه قیمتی', quote: 'قیمت توافقی',
}

function priceDisplay(p: Pick<Package, 'pricingType' | 'price' | 'priceMax'>): string {
  if (p.pricingType === 'quote') return 'قیمت توافقی'
  if (p.pricingType === 'range') return `${formatToman(p.price ?? 0)} تا ${formatToman(p.priceMax ?? 0)} تومان`
  if (p.pricingType === 'from') return `از ${formatToman(p.price ?? 0)} تومان`
  return `${formatToman(p.price ?? 0)} تومان`
}

const { apiFetch } = useApi()
const { confirm } = useConfirm()
const { push: pushToast } = useToast()
const packages = ref<Package[]>([])
const services = ref<Service[]>([])
const loading = ref(true)
const loadError = ref(false)
const createError = ref('')
const creating = ref(false)

const PRICING_TYPES: PricingType[] = ['fixed', 'from', 'range', 'quote']

const newPackage = reactive({
  name: '',
  description: '',
  pricingType: 'quote' as PricingType,
  price: 0,
  priceMax: 0,
  serviceIds: [] as string[],
})

async function load() {
  loading.value = true
  loadError.value = false
  const [packagesRes, servicesRes] = await Promise.all([
    apiFetch<Package[]>('/salons/mine/packages', { silent: true }),
    apiFetch<Service[]>('/salons/mine/services', { silent: true }),
  ])
  if (packagesRes.error || servicesRes.error) {
    loadError.value = true
    loading.value = false
    return
  }
  packages.value = packagesRes.data ?? []
  services.value = servicesRes.data ?? []
  loading.value = false
}
onMounted(load)

function toggleServiceId(id: string) {
  const i = newPackage.serviceIds.indexOf(id)
  if (i === -1) newPackage.serviceIds.push(id)
  else newPackage.serviceIds.splice(i, 1)
}

function resetForm() {
  newPackage.name = ''
  newPackage.description = ''
  newPackage.pricingType = 'quote'
  newPackage.price = 0
  newPackage.priceMax = 0
  newPackage.serviceIds = []
}

async function createPackage() {
  if (creating.value) return
  createError.value = ''
  if (newPackage.name.trim().length < 2) {
    createError.value = 'نام پکیج باید حداقل ۲ حرف باشد.'
    return
  }
  if (newPackage.serviceIds.length < 2) {
    createError.value = 'یک پکیج باید حداقل شامل ۲ خدمت باشد.'
    return
  }
  if (newPackage.pricingType !== 'quote' && (!Number.isInteger(newPackage.price) || newPackage.price <= 0)) {
    createError.value = 'قیمت پکیج باید یک عدد صحیح بزرگ‌تر از صفر باشد.'
    return
  }
  if (newPackage.pricingType === 'range' && (!Number.isInteger(newPackage.priceMax) || newPackage.priceMax < newPackage.price)) {
    createError.value = 'حداکثر قیمت باید عددی صحیح و بزرگ‌تر یا برابر با حداقل باشد.'
    return
  }

  const body: Record<string, unknown> = {
    name: newPackage.name,
    pricingType: newPackage.pricingType,
    serviceIds: newPackage.serviceIds,
  }
  if (newPackage.pricingType !== 'quote') body.price = newPackage.price
  if (newPackage.pricingType === 'range') body.priceMax = newPackage.priceMax
  if (newPackage.description.trim()) body.description = newPackage.description.trim()

  creating.value = true
  const { error } = await apiFetch('/salons/mine/packages', { method: 'POST', body })
  creating.value = false
  if (error) return

  resetForm()
  await load()
  pushToast('پکیج ایجاد شد', 'success')
}

async function archive(pkg: Package) {
  const ok = await confirm({
    title: `پکیج «${pkg.name}» برای همیشه غیرفعال شود؟`,
    message: 'این عملیات قابل بازگشت نیست.',
    confirmLabel: 'غیرفعال کن',
    tone: 'danger',
  })
  if (!ok) return
  const { error } = await apiFetch(`/salons/mine/packages/${pkg.id}`, { method: 'DELETE' })
  if (!error) {
    packages.value = packages.value.filter((p) => p.id !== pkg.id)
    pushToast('پکیج غیرفعال شد', 'success')
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-2xl space-y-4 p-4 lg:p-6">
    <h1 class="text-lg font-bold text-(--color-text)">پکیج‌ها</h1>
    <p class="text-xs text-(--color-text-muted)">
      پکیج فقط برای نمایش و معرفی است؛ هر خدمت داخل پکیج جداگانه و از همان صفحه خدمات رزرو می‌شود.
    </p>

    <div v-if="loadError" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">پکیج‌ها بارگذاری نشد.</p>
      <AppButton variant="secondary" data-testid="retry-packages" @click="load">تلاش دوباره</AppButton>
    </div>

    <template v-else>
      <div v-if="loading" class="flex items-center justify-center py-8 text-(--color-text-muted)">
        <AppIcon name="spinner" :size="20" class="animate-spin" />
      </div>

      <template v-else>
        <EmptyState v-if="packages.length === 0" icon="packages" message="هنوز پکیجی ثبت نشده است." />

        <div v-else class="space-y-4">
          <AppCard v-for="p in packages" :key="p.id" :data-testid="`package-card-${p.id}`" :padded="false" class="space-y-2 p-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="min-w-0 break-words text-sm font-bold text-(--color-text)">{{ p.name }}</p>
              <AppButton type="button" variant="danger" data-testid="archive-package" @click="archive(p)">
                <template #icon><AppIcon name="x" :size="15" /></template>
                غیرفعال‌سازی
              </AppButton>
            </div>
            <p v-if="p.description" class="text-xs text-(--color-text-muted)">{{ p.description }}</p>
            <p class="text-sm font-semibold text-(--color-text)">{{ priceDisplay(p) }}</p>
            <ul class="flex flex-wrap gap-1.5">
              <li
                v-for="item in p.items"
                :key="item.serviceId"
                class="rounded-full bg-(--color-surface-subtle) px-2.5 py-1 text-xs text-(--color-text-muted)"
              >
                {{ item.name }}
              </li>
            </ul>
          </AppCard>
        </div>
      </template>
    </template>

    <AppCard class="space-y-3">
      <h2 class="font-bold text-(--color-text)">افزودن پکیج جدید</h2>
      <AppInput v-model="newPackage.name" placeholder="نام پکیج، مثلاً: پکیج عروس" />
      <div>
        <label class="mb-1.5 block text-sm font-medium text-(--color-text)">توضیحات (اختیاری)</label>
        <textarea
          v-model="newPackage.description"
          rows="2"
          maxlength="1000"
          placeholder="شامل چه خدماتی است و چه ویژگی‌ای دارد"
          class="w-full rounded-xl border border-(--color-border) bg-(--color-surface-card) p-3 text-sm"
        />
      </div>

      <fieldset class="space-y-1.5">
        <legend class="mb-1 block text-sm font-medium text-(--color-text)">خدمات داخل پکیج (حداقل ۲ مورد)</legend>
        <label
          v-for="s in services.filter((s) => s.isActive)"
          :key="s.id"
          class="flex cursor-pointer items-center gap-2 rounded-xl border border-(--color-border) p-2 text-sm"
        >
          <input
            type="checkbox"
            :checked="newPackage.serviceIds.includes(s.id)"
            :data-testid="`package-service-checkbox-${s.id}`"
            @change="toggleServiceId(s.id)"
          />
          {{ s.name }}
        </label>
      </fieldset>

      <fieldset class="grid grid-cols-2 gap-2">
        <legend class="mb-1 block text-sm font-medium text-(--color-text)">نوع قیمت‌گذاری (اطلاع‌رسانی، غیرقابل شارژ)</legend>
        <label
          v-for="t in PRICING_TYPES"
          :key="t"
          class="flex cursor-pointer items-center gap-2 rounded-xl border p-2 text-xs"
          :class="newPackage.pricingType === t ? 'border-(--color-accent-strong) bg-(--color-accent-soft)' : 'border-(--color-border)'"
          :data-testid="`new-package-pricing-type-${t}`"
        >
          <input v-model="newPackage.pricingType" type="radio" :value="t" />
          {{ PRICING_TYPE_META[t] }}
        </label>
      </fieldset>

      <div class="grid grid-cols-2 gap-3">
        <AppMoneyInput
          v-if="newPackage.pricingType !== 'quote'"
          :model-value="String(newPackage.price)"
          :label="newPackage.pricingType === 'range' ? 'حداقل قیمت (تومان)' : 'قیمت (تومان)'"
          data-testid="new-package-price-input"
          @update:model-value="(v) => (newPackage.price = Number(v))"
        />
        <AppMoneyInput
          v-if="newPackage.pricingType === 'range'"
          :model-value="String(newPackage.priceMax)"
          label="حداکثر قیمت (تومان)"
          data-testid="new-package-price-max-input"
          @update:model-value="(v) => (newPackage.priceMax = Number(v))"
        />
      </div>

      <p v-if="createError" class="flex items-center gap-2 rounded-xl bg-(--tone-danger-bg) p-3 text-sm text-(--tone-danger-text)">
        {{ createError }}
      </p>
      <AppButton type="button" block data-testid="add-package" :disabled="creating" :loading="creating" @click="createPackage">
        افزودن
      </AppButton>
    </AppCard>
  </div>
</template>
