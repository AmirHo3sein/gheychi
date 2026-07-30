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

// Create/UpdateServiceDto both bound discountPercent with @IsInt @Min(1) @Max(100); the
// create form and the per-row editor share the rule, so they share the check and the copy.
const DISCOUNT_RANGE_ERROR = 'درصد تخفیف باید عددی صحیح بین ۱ تا ۱۰۰ باشد.'
function isValidDiscount(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 100
}

// The price field edits a draft string rather than s.price directly: AppInput needs a real
// two-way v-model target, and updatePrice() below has to be able to put a rejected edit back
// to the last persisted price (same reason PortfolioView.vue keeps captionDrafts).
const priceDrafts = reactive<Record<string, string>>({})

// Same draft treatment as priceDrafts, for the same reason plus one more: a rejected
// discount edit has to be put back visually, and binding the input straight to
// s.discountPercent can't do that -- the prop never changed, so Vue has nothing to patch
// and the invalid text would stay in the field.
const discountDrafts = reactive<Record<string, string>>({})

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
  for (const s of services.value) {
    priceDrafts[s.id] = String(s.price)
    discountDrafts[s.id] = s.discountPercent === null ? '' : String(s.discountPercent)
  }
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
  // An emptied price field arrives here as 0 (Number('') === 0), and the API's @Min(0)
  // accepts it -- which would publish a free, bookable service with a 0 deposit. Same guard
  // as updatePrice() below; a genuinely free service isn't something this screen offers.
  if (!Number.isInteger(newService.price) || newService.price <= 0) {
    createError.value = 'قیمت خدمت باید یک عدد صحیح بزرگ‌تر از صفر باشد.'
    return
  }
  // CreateServiceDto's @Min(5)/@Max(600). Clearing the field lands here as 0 (Number('')),
  // which the DTO rejects -- previously with no inline error at all, so the only feedback
  // was the API's English validator text in a toast.
  if (!Number.isInteger(newService.durationMin) || newService.durationMin < 5 || newService.durationMin > 600) {
    createError.value = 'مدت زمان خدمت باید عددی صحیح بین ۵ تا ۶۰۰ دقیقه باشد.'
    return
  }
  // Optional, but when given it must satisfy @Min(1)/@Max(100).
  if (newService.discountPercent !== null && !isValidDiscount(newService.discountPercent)) {
    createError.value = DISCOUNT_RANGE_ERROR
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
    delete priceDrafts[service.id]
    delete discountDrafts[service.id]
    pushToast('خدمت غیرفعال شد')
  }
}

// The price field commits on `change` (i.e. on blur), and its value is the salon's public,
// bookable price -- so it gets both a validity guard and a confirm, unlike the discount
// field below. Two reasons the guard is not paranoia: a `type="number"` input silently
// discards Persian digits, so the natural "select all, retype ۱۸۰۰۰۰" leaves the field
// empty and fires `change` on blur; and the API's @Min(0) happily accepts the resulting 0,
// which makes the service free to book with a 0 deposit. On any rejected value the input is
// put back to the price we last knew about, so the field never shows something that isn't
// what the salon is actually charging.
async function updatePrice(service: Service) {
  // Vue casts a v-model on an `<input type="number">` to a real number (and leaves anything
  // unparseable as the raw string), so the draft is only nominally a string -- normalize.
  const raw = String(priceDrafts[service.id] ?? '').trim()
  const price = Number(raw)
  // Integer-only mirrors UpdateServiceDto's @IsInt -- a fractional toman would just 400.
  if (raw === '' || !Number.isInteger(price) || price <= 0) {
    priceDrafts[service.id] = String(service.price)
    pushToast('قیمت باید یک عدد صحیح بزرگ‌تر از صفر باشد.')
    return
  }
  if (price === service.price) return

  const confirmed = window.confirm(
    `قیمت «${service.name}» از ${service.price.toLocaleString('fa-IR')} به ${price.toLocaleString('fa-IR')} تومان تغییر کند؟`,
  )
  if (!confirmed) {
    priceDrafts[service.id] = String(service.price)
    return
  }

  const { error } = await apiFetch(`/salons/mine/services/${service.id}`, { method: 'PATCH', body: { price } })
  if (error) {
    priceDrafts[service.id] = String(service.price)
    return
  }
  service.price = price
  pushToast('قیمت به‌روزرسانی شد')
}

// UpdateServiceDto accepts null (clear the discount) or an integer 1-100 -- notably NOT 0,
// which is what an emptied-then-retyped `0` produces and what the `min="1"` attribute does
// nothing to stop (it only blocks the spinner, not typing). Guarding here keeps the failure
// in Persian and next to the field instead of as an English validator array in a toast.
async function updateDiscount(service: Service) {
  const raw = String(discountDrafts[service.id] ?? '').trim()
  const discountPercent = raw === '' ? null : Number(raw)
  if (discountPercent !== null && !isValidDiscount(discountPercent)) {
    discountDrafts[service.id] = service.discountPercent === null ? '' : String(service.discountPercent)
    pushToast(DISCOUNT_RANGE_ERROR)
    return
  }
  if (discountPercent === service.discountPercent) return

  const { error } = await apiFetch(`/salons/mine/services/${service.id}`, {
    method: 'PATCH',
    body: { discountPercent },
  })
  if (error) {
    discountDrafts[service.id] = service.discountPercent === null ? '' : String(service.discountPercent)
    return
  }
  service.discountPercent = discountPercent
  discountDrafts[service.id] = discountPercent === null ? '' : String(discountPercent)
  pushToast('تخفیف به‌روزرسانی شد')
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
              v-model="priceDrafts[s.id]"
              label="قیمت (تومان)"
              type="number"
              min="1"
              class="tnum w-32"
              @change="updatePrice(s)"
            />
            <AppInput
              v-model="discountDrafts[s.id]"
              label="٪ تخفیف"
              type="number"
              min="1"
              max="100"
              placeholder="٪ تخفیف"
              class="tnum w-24"
              @change="updateDiscount(s)"
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
          min="5"
          max="600"
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
