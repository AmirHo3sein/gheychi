<!-- apps/provider-panel/src/pages/ServicesView.vue -->
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppMoneyInput from '@/components/ui/AppMoneyInput.vue'
import AppSelect, { type SelectOption } from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import { formatToman } from '@/utils/format-toman'

type PricingType = 'fixed' | 'from' | 'range' | 'quote'

interface Service {
  id: string
  categoryId: number | null
  customCategoryId: string | null
  name: string
  description: string | null
  pricingType: PricingType
  price: number | null
  priceMax: number | null
  durationMin: number
  durationMax: number | null
  isActive: boolean
  discountPercent: number | null
}

interface CategoryRequestRow {
  id: string
  name: string
  note: string | null
  status: 'pending' | 'approved' | 'rejected'
  resolutionNote: string | null
  createdAt: string
}

interface CustomCategory {
  id: string
  name: string
}

const PRICING_TYPE_META: Record<PricingType, { label: string; hint: string }> = {
  fixed: { label: 'قیمت ثابت', hint: 'مبلغ دقیق و قطعی' },
  from: { label: 'شروع از', hint: 'حداقل قیمت، ممکن است بیشتر شود' },
  range: { label: 'بازه قیمتی', hint: 'بین یک حداقل و حداکثر مشخص' },
  quote: { label: 'قیمت توافقی', hint: 'قیمت پس از مشاوره تعیین می‌شود' },
}
const PRICING_TYPES: PricingType[] = ['fixed', 'from', 'range', 'quote']

// A system category's option value is prefixed "sys:<id>", a custom one "custom:<uuid>" --
// one flat AppSelect list can then represent "exactly one of the two", matching the API's
// own mutually-exclusive categoryId/customCategoryId shape, with no optgroup support needed.
function categorySelectionOf(categoryId: number | null, customCategoryId: string | null): string | null {
  if (categoryId !== null) return `sys:${categoryId}`
  if (customCategoryId !== null) return `custom:${customCategoryId}`
  return null
}
function parseCategorySelection(selection: string | null): { categoryId: number | null; customCategoryId: string | null } {
  if (!selection) return { categoryId: null, customCategoryId: null }
  const [kind, id] = selection.split(':')
  return kind === 'sys' ? { categoryId: Number(id), customCategoryId: null } : { categoryId: null, customCategoryId: id }
}

function priceDisplay(s: Pick<Service, 'pricingType' | 'price' | 'priceMax'>): string {
  if (s.pricingType === 'quote') return 'قیمت توافقی'
  if (s.pricingType === 'range') return `${formatToman(s.price ?? 0)} تا ${formatToman(s.priceMax ?? 0)} تومان`
  if (s.pricingType === 'from') return `از ${formatToman(s.price ?? 0)} تومان`
  return `${formatToman(s.price ?? 0)} تومان`
}

const { apiFetch } = useApi()
const { push: pushToast } = useToast()
const services = ref<Service[]>([])
const categories = ref<{ id: number; name: string }[]>([])
const customCategories = ref<CustomCategory[]>([])
const loading = ref(true)
const loadError = ref(false)
const createError = ref('')
// In-flight guard for the add form -- same shape as categoryRequestSubmitting below. Without
// it a double-tap on «افزودن» posted the same service twice (the API has no uniqueness rule
// on service names, so both rows stuck).
const creating = ref(false)
const newService = reactive({
  categorySelection: null as string | null,
  name: '',
  description: '',
  pricingType: 'fixed' as PricingType,
  price: 0,
  priceMax: 0,
  durationMin: 30,
  durationMax: null as number | null,
  discountPercent: null as number | null,
})

// Inline "request a new category" form -- collapsed by default, opened via a link right
// under the category select. Deliberately separate from newService: submitting a
// category request is its own action, not a step toward creating a service (the salon
// has to wait for admin approval before it can pick the new category at all). Distinct
// from "create a custom category" below, which is immediate and self-serve.
const categoryRequests = ref<CategoryRequestRow[]>([])
const requestingCategory = ref(false)
const categoryRequestName = ref('')
const categoryRequestNote = ref('')
const categoryRequestError = ref('')
const categoryRequestSubmitting = ref(false)

// "Create a custom category" -- immediate and private to this salon, unlike the
// admin-approved request flow above. Once created it's selected right away.
const creatingCustomCategory = ref(false)
const customCategoryName = ref('')
const customCategoryError = ref('')
const customCategorySubmitting = ref(false)

const CATEGORY_REQUEST_STATUS_META: Record<CategoryRequestRow['status'], { label: string; tone: 'warning' | 'success' | 'danger' }> = {
  pending: { label: 'در انتظار بررسی', tone: 'warning' },
  approved: { label: 'تایید شد', tone: 'success' },
  rejected: { label: 'رد شد', tone: 'danger' },
}

// Server-side DTO validation only checks @IsString() with no length cap (the column is a
// plain Postgres `text`) -- this is a client-side sanity bound, not a mirrored API rule.
const DESCRIPTION_MAX_LENGTH = 300

const categoryOptions = computed<SelectOption[]>(() => [
  ...categories.value.map((c) => ({ value: `sys:${c.id}`, label: c.name })),
  ...customCategories.value.map((c) => ({ value: `custom:${c.id}`, label: `${c.name} (سفارشی)` })),
])

// Create/UpdateServiceDto both bound discountPercent with @IsInt @Min(1) @Max(100); the
// create form and the per-row editor share the rule, so they share the check and the copy.
const DISCOUNT_RANGE_ERROR = 'درصد تخفیف باید عددی صحیح بین ۱ تا ۱۰۰ باشد.'
function isValidDiscount(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 100
}

// The price field edits a draft string rather than s.price directly: AppInput needs a real
// two-way v-model target, and updatePrice() below has to be able to put a rejected edit back
// to the last persisted price (same reason PortfolioView.vue keeps captionDrafts). Only ever
// used for pricingType === 'fixed' rows -- FROM/RANGE/QUOTE are edited via the pricing-type
// panel below instead.
const priceDrafts = reactive<Record<string, string>>({})

// Same draft treatment as priceDrafts, for the same reason plus one more: a rejected
// discount edit has to be put back visually, and binding the input straight to
// s.discountPercent can't do that -- the prop never changed, so Vue has nothing to patch
// and the invalid text would stay in the field.
const discountDrafts = reactive<Record<string, string>>({})

// Same draft treatment again -- free text a provider uses to flag that the listed
// duration is a minimum and the real time can run longer (e.g. a complex color job).
const descriptionDrafts = reactive<Record<string, string>>({})

// Same draft treatment as priceDrafts -- this is the ONE field this screen could
// previously only set at creation, with no way to fix a wrong value afterward (e.g. a
// service left at the "add service" form's 30-minute default that should really be 15).
const durationDrafts = reactive<Record<string, string>>({})

// Common values a provider is likely to want, surfaced as one-tap presets so the fact
// that this number is freely editable (not a fixed platform grid) is obvious at a glance
// -- this exact value also becomes the spacing between bookable slots for this service,
// which the label/hint below spells out explicitly.
const DURATION_PRESETS = [15, 30, 45, 60, 90] as const

// Per-row "change pricing type" panel state -- a service switching type is an atomic
// operation (see the API's reconcilePricingOnUpdate), so it gets its own small draft
// object rather than reusing priceDrafts/discountDrafts, which only ever handle a bare
// price/discount edit on an already-FIXED service.
const editingPricing = reactive<Record<string, boolean>>({})
const pricingDrafts = reactive<Record<string, { pricingType: PricingType; price: number; priceMax: number; discountPercent: number | null }>>({})

function openPricingEditor(s: Service) {
  pricingDrafts[s.id] = {
    pricingType: s.pricingType,
    price: s.price ?? 0,
    priceMax: s.priceMax ?? 0,
    discountPercent: s.discountPercent,
  }
  editingPricing[s.id] = true
}
function cancelPricingEditor(id: string) {
  editingPricing[id] = false
}

async function savePricingEditor(s: Service) {
  const draft = pricingDrafts[s.id]
  const error = validatePricingDraft(draft)
  if (error) {
    pushToast(error)
    return
  }
  const body: Record<string, unknown> = { pricingType: draft.pricingType }
  if (draft.pricingType !== 'quote') body.price = draft.price
  if (draft.pricingType === 'range') body.priceMax = draft.priceMax
  if (draft.pricingType === 'fixed') body.discountPercent = draft.discountPercent
  const { data, error: apiError } = await apiFetch<Service>(`/salons/mine/services/${s.id}`, { method: 'PATCH', body })
  if (apiError || !data) return
  Object.assign(s, data)
  priceDrafts[s.id] = String(s.price ?? '')
  discountDrafts[s.id] = s.discountPercent === null ? '' : String(s.discountPercent)
  editingPricing[s.id] = false
  pushToast('قیمت‌گذاری به‌روزرسانی شد')
}

function validatePricingDraft(draft: { pricingType: PricingType; price: number; priceMax: number; discountPercent: number | null }): string {
  if (draft.pricingType !== 'quote') {
    if (!Number.isInteger(draft.price) || draft.price <= 0) return 'قیمت خدمت باید یک عدد صحیح بزرگ‌تر از صفر باشد.'
  }
  if (draft.pricingType === 'range') {
    if (!Number.isInteger(draft.priceMax) || draft.priceMax < draft.price) {
      return 'حداکثر قیمت باید عددی صحیح و بزرگ‌تر یا برابر با حداقل باشد.'
    }
  }
  if (draft.pricingType === 'fixed' && draft.discountPercent !== null && !isValidDiscount(draft.discountPercent)) {
    return DISCOUNT_RANGE_ERROR
  }
  return ''
}

async function load() {
  loading.value = true
  loadError.value = false

  const [servicesRes, categoriesRes, customCategoriesRes] = await Promise.all([
    apiFetch<Service[]>('/salons/mine/services', { silent: true }),
    apiFetch<{ id: number; name: string }[]>('/categories', { silent: true }),
    apiFetch<CustomCategory[]>('/salons/mine/custom-categories', { silent: true }),
  ])

  if (servicesRes.error || categoriesRes.error || customCategoriesRes.error) {
    loadError.value = true
    loading.value = false
    return
  }

  services.value = servicesRes.data ?? []
  for (const s of services.value) {
    priceDrafts[s.id] = String(s.price ?? '')
    discountDrafts[s.id] = s.discountPercent === null ? '' : String(s.discountPercent)
    descriptionDrafts[s.id] = s.description ?? ''
    durationDrafts[s.id] = String(s.durationMin)
  }
  categories.value = categoriesRes.data ?? []
  customCategories.value = customCategoriesRes.data ?? []
  loading.value = false
}

// Kept separate from load() -- a failure here is not a whole-page failure the way a
// failed services/categories fetch is, so it fails silently rather than gating the page
// behind loadError.
async function loadCategoryRequests() {
  const { data } = await apiFetch<CategoryRequestRow[]>('/salons/mine/category-requests', { silent: true })
  categoryRequests.value = data ?? []
}

onMounted(load)
onMounted(loadCategoryRequests)

function openCategoryRequest() {
  requestingCategory.value = true
  categoryRequestName.value = ''
  categoryRequestNote.value = ''
  categoryRequestError.value = ''
}

function cancelCategoryRequest() {
  requestingCategory.value = false
}

async function submitCategoryRequest() {
  categoryRequestError.value = ''
  const name = categoryRequestName.value.trim()
  // Mirrors CreateCategoryRequestDto's @Length(2, 60).
  if (name.length < 2 || name.length > 60) {
    categoryRequestError.value = 'نام دسته‌بندی باید بین ۲ تا ۶۰ حرف باشد.'
    return
  }

  categoryRequestSubmitting.value = true
  const body: Record<string, unknown> = { name }
  if (categoryRequestNote.value.trim()) body.note = categoryRequestNote.value.trim()
  const { error } = await apiFetch('/salons/mine/category-requests', { method: 'POST', body })
  categoryRequestSubmitting.value = false
  if (error) return

  pushToast('درخواست دسته‌بندی ارسال شد و در انتظار بررسی مدیر است')
  requestingCategory.value = false
  await loadCategoryRequests()
}

function openCustomCategory() {
  creatingCustomCategory.value = true
  customCategoryName.value = ''
  customCategoryError.value = ''
}
function cancelCustomCategory() {
  creatingCustomCategory.value = false
}

async function submitCustomCategory() {
  customCategoryError.value = ''
  const name = customCategoryName.value.trim()
  if (name.length < 2 || name.length > 60) {
    customCategoryError.value = 'نام دسته‌بندی باید بین ۲ تا ۶۰ حرف باشد.'
    return
  }
  customCategorySubmitting.value = true
  const { data, error } = await apiFetch<CustomCategory>('/salons/mine/custom-categories', { method: 'POST', body: { name } })
  customCategorySubmitting.value = false
  if (error || !data) return

  customCategories.value.push(data)
  newService.categorySelection = `custom:${data.id}`
  creatingCustomCategory.value = false
  pushToast('دسته‌بندی سفارشی ایجاد شد')
}

function resetNewService() {
  newService.categorySelection = null
  newService.name = ''
  newService.description = ''
  newService.pricingType = 'fixed'
  newService.price = 0
  newService.priceMax = 0
  newService.durationMin = 30
  newService.durationMax = null
  newService.discountPercent = null
}

async function addService() {
  if (creating.value) return
  createError.value = ''
  if (!newService.categorySelection) {
    createError.value = 'دسته‌بندی خدمت را انتخاب کنید.'
    return
  }
  if (newService.name.trim().length < 2) {
    createError.value = 'نام خدمت باید حداقل ۲ حرف باشد.'
    return
  }
  const pricingError = validatePricingDraft({
    pricingType: newService.pricingType,
    price: newService.price,
    priceMax: newService.priceMax,
    discountPercent: newService.discountPercent,
  })
  if (pricingError) {
    createError.value = pricingError
    return
  }
  // CreateServiceDto's @Min(5)/@Max(600). Clearing the field lands here as 0 (Number('')),
  // which the DTO rejects -- previously with no inline error at all, so the only feedback
  // was the API's English validator text in a toast.
  if (!Number.isInteger(newService.durationMin) || newService.durationMin < 5 || newService.durationMin > 600) {
    createError.value = 'مدت زمان خدمت باید عددی صحیح بین ۵ تا ۶۰۰ دقیقه باشد.'
    return
  }
  if (newService.durationMax !== null && newService.durationMax < newService.durationMin) {
    createError.value = 'حداکثر مدت زمان نمی‌تواند کمتر از حداقل باشد.'
    return
  }

  const { categoryId, customCategoryId } = parseCategorySelection(newService.categorySelection)
  const body: Record<string, unknown> = {
    ...(categoryId !== null ? { categoryId } : { customCategoryId }),
    name: newService.name,
    pricingType: newService.pricingType,
    durationMin: newService.durationMin,
  }
  if (newService.pricingType !== 'quote') body.price = newService.price
  if (newService.pricingType === 'range') body.priceMax = newService.priceMax
  if (newService.pricingType === 'fixed' && newService.discountPercent) body.discountPercent = Number(newService.discountPercent)
  if (newService.durationMax !== null) body.durationMax = newService.durationMax
  if (newService.description.trim()) body.description = newService.description.trim()

  creating.value = true
  const { error } = await apiFetch('/salons/mine/services', { method: 'POST', body })
  creating.value = false
  if (error) return

  resetNewService()
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
// field below. Only ever rendered for pricingType === 'fixed' rows (see the template) --
// FROM/RANGE/QUOTE go through the pricing-type panel above instead. Two reasons the guard
// is not paranoia: a `type="number"` input silently discards Persian digits, so the natural
// "select all, retype ۱۸۰۰۰۰" leaves the field empty and fires `change` on blur; and the
// API's @Min(0) happily accepts the resulting 0, which makes the service free to book with
// a 0 deposit. On any rejected value the input is put back to the price we last knew about,
// so the field never shows something that isn't what the salon is actually charging.
async function updatePrice(service: Service) {
  // Vue casts a v-model on an `<input type="number">` to a real number (and leaves anything
  // unparseable as the raw string), so the draft is only nominally a string -- normalize.
  const raw = String(priceDrafts[service.id] ?? '').trim()
  const price = Number(raw)
  // Integer-only mirrors UpdateServiceDto's @IsInt -- a fractional toman would just 400.
  if (raw === '' || !Number.isInteger(price) || price <= 0) {
    priceDrafts[service.id] = String(service.price ?? '')
    pushToast('قیمت باید یک عدد صحیح بزرگ‌تر از صفر باشد.')
    return
  }
  if (price === service.price) return

  const confirmed = window.confirm(
    `قیمت «${service.name}» از ${formatToman(service.price ?? 0)} به ${formatToman(price)} تومان تغییر کند؟`,
  )
  if (!confirmed) {
    priceDrafts[service.id] = String(service.price ?? '')
    return
  }

  const { error } = await apiFetch(`/salons/mine/services/${service.id}`, { method: 'PATCH', body: { price } })
  if (error) {
    priceDrafts[service.id] = String(service.price ?? '')
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

// This is the field a provider could previously only set at creation, with no way back --
// changing it only affects FUTURE availability computation (already-confirmed bookings keep
// their own snapshotted startsAt/endsAt), so no confirm dialog is needed the way price gets
// one; same immediate-commit-on-blur shape as updateDiscount/updateDescription above.
async function updateDuration(service: Service) {
  const raw = String(durationDrafts[service.id] ?? '').trim()
  const durationMin = Number(raw)
  if (raw === '' || !Number.isInteger(durationMin) || durationMin < 5 || durationMin > 600) {
    durationDrafts[service.id] = String(service.durationMin)
    pushToast('مدت زمان باید عددی صحیح بین ۵ تا ۶۰۰ دقیقه باشد.')
    return
  }
  if (durationMin === service.durationMin) return

  const { error } = await apiFetch(`/salons/mine/services/${service.id}`, {
    method: 'PATCH',
    body: { durationMin },
  })
  if (error) {
    durationDrafts[service.id] = String(service.durationMin)
    return
  }
  service.durationMin = durationMin
  durationDrafts[service.id] = String(durationMin)
  pushToast('مدت زمان به‌روزرسانی شد')
}

function setDurationPreset(service: Service, minutes: number) {
  durationDrafts[service.id] = String(minutes)
  updateDuration(service)
}

function setNewServiceDurationPreset(minutes: number) {
  newService.durationMin = minutes
}

// Commits on blur, like price/discount above. An empty draft clears the note (sent as
// null, mirroring how updateDiscount clears its field) rather than sending ''.
async function updateDescription(service: Service) {
  const raw = descriptionDrafts[service.id] ?? ''
  const description = raw.trim() === '' ? null : raw.trim()
  if (description === service.description) return

  const { error } = await apiFetch(`/salons/mine/services/${service.id}`, {
    method: 'PATCH',
    body: { description },
  })
  if (error) {
    descriptionDrafts[service.id] = service.description ?? ''
    return
  }
  service.description = description
  descriptionDrafts[service.id] = description ?? ''
  pushToast('توضیحات به‌روزرسانی شد')
}
</script>

<template>
  <!-- max-w-2xl on the PAGE container, not just on the cards inside it -- capping only the
     cards while the container (and so the heading, which fills it) stayed max-w-5xl left the
     h1 aligned to a wider box than the content below it, reading as "the title is still on
     the right" even after the cards themselves were centered. The services list is a single
     column now (see below), so nothing on this page actually needs more width than the form. -->
  <div class="mx-auto w-full max-w-2xl space-y-4 p-4 lg:p-6">
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

        <!-- Single column, matching the page container's own width (now max-w-2xl -- see the
             top-level div) -- a 2-column grid here used to leave a lone/odd card at half the
             container's width, hugging the RTL start (right) edge with visibly empty space
             on the other side. -->
        <div v-else class="space-y-4">
          <!-- "service-card-" prefix, not "service-" -- the latter would collide with the
               per-row field testids nested inside this same card (service-price-input,
               service-description), making a prefix-based locator over ALL of them ambiguous. -->
          <AppCard v-for="s in services" :key="s.id" :data-testid="`service-card-${s.id}`" :padded="false" class="space-y-3 p-4">
            <!--
              flex-wrap + min-w-0: the name, its discount badge and the ~140px
              «غیرفعال‌سازی» button together need more than the ~256px a card has at 320px.
              Wrapping keeps the button reachable and lets a long service name break instead
              of pushing the row off the (left, in RTL) edge of the page.
            -->
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex min-w-0 flex-wrap items-center gap-2">
                <p class="min-w-0 break-words text-sm font-bold text-(--color-text)">{{ s.name }}</p>
                <StatusBadge :label="PRICING_TYPE_META[s.pricingType].label" tone="info" />
                <StatusBadge v-if="s.discountPercent" :label="`٪${s.discountPercent} تخفیف`" tone="success" />
              </div>
              <AppButton type="button" variant="danger" class="shrink-0" data-testid="deactivate-service" @click="deactivate(s)">
                <template #icon><AppIcon name="x" :size="15" /></template>
                غیرفعال‌سازی
              </AppButton>
            </div>

            <!-- FIXED-only inline price/discount editors, unchanged from before pricing
                 types existed -- committing a bare number here never needs an atomic type
                 switch. -->
            <template v-if="s.pricingType === 'fixed' && !editingPricing[s.id]">
              <div class="grid grid-cols-2 gap-3 sm:max-w-sm">
                <AppMoneyInput
                  v-model="priceDrafts[s.id]"
                  label="قیمت (تومان)"
                  data-testid="service-price-input"
                  @change="updatePrice(s)"
                />
                <AppInput
                  v-model="discountDrafts[s.id]"
                  label="٪ تخفیف"
                  type="number"
                  min="1"
                  max="100"
                  placeholder="٪ تخفیف"
                  class="tnum"
                  @change="updateDiscount(s)"
                />
              </div>
              <button
                type="button"
                class="text-xs text-(--color-accent-text) underline-offset-2 hover:underline"
                @click="openPricingEditor(s)"
              >
                تغییر نوع قیمت‌گذاری
              </button>
            </template>

            <!-- FROM/RANGE/QUOTE: a compact read-only summary plus an edit affordance --
                 changing anything here is an atomic type switch, not a bare number edit. -->
            <div v-else-if="!editingPricing[s.id]" class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-(--color-surface-subtle) p-3">
              <p class="text-sm font-semibold text-(--color-text)">{{ priceDisplay(s) }}</p>
              <button
                type="button"
                data-testid="edit-pricing-type"
                class="text-xs text-(--color-accent-text) underline-offset-2 hover:underline"
                @click="openPricingEditor(s)"
              >
                ویرایش قیمت‌گذاری
              </button>
            </div>

            <div v-if="editingPricing[s.id]" class="space-y-2 rounded-xl border border-(--color-border) bg-(--color-surface) p-3">
              <fieldset class="grid grid-cols-2 gap-2">
                <legend class="sr-only">نوع قیمت‌گذاری</legend>
                <label
                  v-for="t in PRICING_TYPES"
                  :key="t"
                  class="flex cursor-pointer items-start gap-2 rounded-xl border p-2 text-xs"
                  :class="pricingDrafts[s.id].pricingType === t ? 'border-(--color-accent-strong) bg-(--color-accent-soft)' : 'border-(--color-border)'"
                >
                  <input v-model="pricingDrafts[s.id].pricingType" type="radio" :value="t" class="mt-0.5" />
                  <span>
                    <span class="block font-semibold text-(--color-text)">{{ PRICING_TYPE_META[t].label }}</span>
                    <span class="block text-(--color-text-muted)">{{ PRICING_TYPE_META[t].hint }}</span>
                  </span>
                </label>
              </fieldset>

              <AppMoneyInput
                v-if="pricingDrafts[s.id].pricingType !== 'quote'"
                :model-value="String(pricingDrafts[s.id].price)"
                :label="pricingDrafts[s.id].pricingType === 'range' ? 'حداقل قیمت (تومان)' : 'قیمت (تومان)'"
                @update:model-value="(v) => (pricingDrafts[s.id].price = Number(v))"
              />
              <AppMoneyInput
                v-if="pricingDrafts[s.id].pricingType === 'range'"
                :model-value="String(pricingDrafts[s.id].priceMax)"
                label="حداکثر قیمت (تومان)"
                @update:model-value="(v) => (pricingDrafts[s.id].priceMax = Number(v))"
              />
              <AppInput
                v-if="pricingDrafts[s.id].pricingType === 'fixed'"
                :model-value="pricingDrafts[s.id].discountPercent != null ? String(pricingDrafts[s.id].discountPercent) : ''"
                label="٪ تخفیف (اختیاری)"
                type="number"
                min="1"
                max="100"
                class="tnum"
                @update:model-value="(v) => (pricingDrafts[s.id].discountPercent = v === '' ? null : Number(v))"
              />

              <div class="flex flex-wrap gap-2">
                <AppButton type="button" data-testid="save-pricing-type" @click="savePricingEditor(s)">ذخیره</AppButton>
                <AppButton type="button" variant="secondary" @click="cancelPricingEditor(s.id)">انصراف</AppButton>
              </div>
            </div>

            <div class="sm:max-w-sm">
              <AppInput
                v-model="durationDrafts[s.id]"
                label="مدت زمان و فاصله نوبت‌ها (دقیقه)"
                type="number"
                min="5"
                max="600"
                data-testid="service-duration-input"
                class="tnum"
                @change="updateDuration(s)"
              />
              <p class="mt-1 text-xs text-(--color-text-muted)">
                این عدد فاصله بین نوبت‌های قابل رزرو این خدمت را هم تعیین می‌کند؛ برای مثال یک خدمت
                ۱۵ دقیقه‌ای هر ۱۵ دقیقه یک نوبت جدید باز می‌کند.
              </p>
              <p v-if="s.durationMax" class="mt-1 text-xs text-(--color-text-muted)">
                مدت زمان تخمینی: تا {{ s.durationMax.toLocaleString('fa-IR') }} دقیقه
              </p>
              <div class="mt-1.5 flex flex-wrap gap-1.5">
                <button
                  v-for="preset in DURATION_PRESETS"
                  :key="preset"
                  type="button"
                  :data-testid="`service-duration-preset-${preset}`"
                  class="rounded-full border px-2.5 py-1 text-xs transition-colors"
                  :class="s.durationMin === preset
                    ? 'border-(--color-accent-text) bg-(--color-accent-soft) text-(--color-text)'
                    : 'border-(--color-border) text-(--color-text-muted) hover:bg-(--color-surface-subtle)'"
                  @click="setDurationPreset(s, preset)"
                >
                  {{ preset.toLocaleString('fa-IR') }} دقیقه
                </button>
              </div>
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-(--color-text-muted)">توضیحات خدمت (اختیاری)</label>
              <textarea
                v-model="descriptionDrafts[s.id]"
                rows="2"
                :maxlength="DESCRIPTION_MAX_LENGTH"
                placeholder="مثلاً: این زمان تقریبی است و ممکن است بیشتر طول بکشد"
                class="w-full rounded-xl border border-(--color-border) bg-(--color-surface) p-2 text-sm"
                data-testid="service-description"
                @change="updateDescription(s)"
              />
            </div>
          </AppCard>
        </div>
      </template>
    </template>

    <AppCard class="space-y-3">
      <h2 class="font-bold text-(--color-text)">افزودن خدمت جدید</h2>
      <AppSelect v-model="newService.categorySelection" :options="categoryOptions" placeholder="دسته‌بندی" data-testid="new-service-category" />

      <div class="flex flex-wrap gap-3">
        <button
          v-if="!requestingCategory"
          type="button"
          data-testid="open-category-request"
          class="text-xs text-(--color-accent-text) underline-offset-2 hover:underline"
          @click="openCategoryRequest"
        >
          دسته‌بندی مدنظرتان در لیست نیست؟ درخواست دسته‌بندی جدید
        </button>
        <button
          v-if="!creatingCustomCategory"
          type="button"
          data-testid="open-custom-category"
          class="text-xs text-(--color-accent-text) underline-offset-2 hover:underline"
          @click="openCustomCategory"
        >
          + دسته‌بندی سفارشی برای همین سالن
        </button>
      </div>

      <div v-if="creatingCustomCategory" class="space-y-2 rounded-xl border border-(--color-border) bg-(--color-surface) p-3">
        <p class="text-sm font-semibold text-(--color-text)">دسته‌بندی سفارشی جدید</p>
        <p class="text-xs text-(--color-text-muted)">
          این دسته‌بندی فقط برای سالن شما قابل استفاده است و بلافاصله آماده می‌شود؛ نیازی به تایید مدیر نیست.
        </p>
        <AppInput
          v-model="customCategoryName"
          label="نام دسته‌بندی سفارشی"
          placeholder="مثلاً: خدمات ویژه"
          data-testid="custom-category-name"
          :error="customCategoryError"
        />
        <div class="flex flex-wrap gap-2">
          <AppButton
            type="button"
            data-testid="submit-custom-category"
            :loading="customCategorySubmitting"
            :disabled="customCategorySubmitting"
            @click="submitCustomCategory"
          >
            ایجاد و انتخاب
          </AppButton>
          <AppButton type="button" variant="secondary" :disabled="customCategorySubmitting" @click="cancelCustomCategory">
            انصراف
          </AppButton>
        </div>
      </div>

      <div v-if="requestingCategory" class="space-y-2 rounded-xl border border-(--color-border) bg-(--color-surface) p-3">
        <p class="text-sm font-semibold text-(--color-text)">درخواست دسته‌بندی جدید</p>
        <AppInput
          v-model="categoryRequestName"
          label="نام دسته‌بندی"
          placeholder="مثلاً: ماساژ درمانی"
          data-testid="category-request-name"
          :error="categoryRequestError"
        />
        <div>
          <label class="mb-1 block text-xs font-medium text-(--color-text-muted)">توضیح (اختیاری)</label>
          <textarea
            v-model="categoryRequestNote"
            rows="2"
            maxlength="500"
            placeholder="چرا به این دسته‌بندی نیاز دارید؟"
            class="w-full rounded-xl border border-(--color-border) bg-(--color-surface-card) p-2 text-sm"
            data-testid="category-request-note"
          />
        </div>
        <div class="flex flex-wrap gap-2">
          <AppButton
            type="button"
            data-testid="submit-category-request"
            :loading="categoryRequestSubmitting"
            :disabled="categoryRequestSubmitting"
            @click="submitCategoryRequest"
          >
            ارسال درخواست
          </AppButton>
          <AppButton
            type="button"
            variant="secondary"
            data-testid="cancel-category-request"
            :disabled="categoryRequestSubmitting"
            @click="cancelCategoryRequest"
          >
            انصراف
          </AppButton>
        </div>
      </div>

      <AppInput v-model="newService.name" placeholder="نام خدمت" />

      <fieldset class="grid grid-cols-2 gap-2">
        <legend class="mb-1 block text-sm font-medium text-(--color-text)">نوع قیمت‌گذاری</legend>
        <label
          v-for="t in PRICING_TYPES"
          :key="t"
          class="flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 text-xs"
          :class="newService.pricingType === t ? 'border-(--color-accent-strong) bg-(--color-accent-soft)' : 'border-(--color-border)'"
          :data-testid="`new-service-pricing-type-${t}`"
        >
          <input v-model="newService.pricingType" type="radio" :value="t" class="mt-0.5" />
          <span>
            <span class="block font-semibold text-(--color-text)">{{ PRICING_TYPE_META[t].label }}</span>
            <span class="block text-(--color-text-muted)">{{ PRICING_TYPE_META[t].hint }}</span>
          </span>
        </label>
      </fieldset>

      <div class="grid grid-cols-2 gap-3">
        <AppMoneyInput
          v-if="newService.pricingType !== 'quote'"
          :model-value="String(newService.price)"
          :label="newService.pricingType === 'range' ? 'حداقل قیمت (تومان)' : 'قیمت (تومان)'"
          data-testid="new-service-price-input"
          @update:model-value="(v) => (newService.price = Number(v))"
        />
        <AppMoneyInput
          v-if="newService.pricingType === 'range'"
          :model-value="String(newService.priceMax)"
          label="حداکثر قیمت (تومان)"
          data-testid="new-service-price-max-input"
          @update:model-value="(v) => (newService.priceMax = Number(v))"
        />
        <div>
          <AppInput
            :model-value="String(newService.durationMin)"
            label="مدت زمان و فاصله نوبت‌ها (دقیقه)"
            data-testid="new-service-duration-input"
            type="number"
            min="5"
            max="600"
            class="tnum"
            @update:model-value="(v) => (newService.durationMin = Number(v))"
          />
          <div class="mt-1.5 flex flex-wrap gap-1.5">
            <button
              v-for="preset in DURATION_PRESETS"
              :key="preset"
              type="button"
              :data-testid="`new-service-duration-preset-${preset}`"
              class="rounded-full border px-2.5 py-1 text-xs transition-colors"
              :class="newService.durationMin === preset
                ? 'border-(--color-accent-text) bg-(--color-accent-soft) text-(--color-text)'
                : 'border-(--color-border) text-(--color-text-muted) hover:bg-(--color-surface-subtle)'"
              @click="setNewServiceDurationPreset(preset)"
            >
              {{ preset.toLocaleString('fa-IR') }} دقیقه
            </button>
          </div>
        </div>
      </div>
      <p class="text-xs text-(--color-text-muted)">
        این عدد فاصله بین نوبت‌های قابل رزرو این خدمت را هم تعیین می‌کند؛ خدمت‌های مختلف یک سالن
        می‌توانند مدت‌زمان‌های متفاوتی داشته باشند (مثلاً یکی ۱۵ دقیقه و دیگری ۶۰ دقیقه).
      </p>
      <div>
        <label class="mb-1.5 block text-sm font-medium text-(--color-text)">توضیحات خدمت (اختیاری)</label>
        <textarea
          v-model="newService.description"
          rows="2"
          :maxlength="DESCRIPTION_MAX_LENGTH"
          placeholder="مثلاً: این زمان تقریبی است و ممکن است بسته به شرایط بیشتر طول بکشد"
          class="w-full rounded-xl border border-(--color-border) bg-(--color-surface-card) p-3 text-sm"
        />
        <p class="mt-1 text-xs text-(--color-text-muted)">
          اگر مدت زمان انجام این خدمت می‌تواند بیشتر از عدد بالا طول بکشد، همین‌جا به مشتری توضیح دهید.
        </p>
      </div>
      <AppInput
        v-if="newService.pricingType === 'fixed'"
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
      <AppButton type="button" block data-testid="add-service" :disabled="creating" :loading="creating" @click="addService">
        افزودن
      </AppButton>
    </AppCard>

    <AppCard v-if="categoryRequests.length" class="space-y-3">
      <h2 class="font-bold text-(--color-text)">درخواست‌های دسته‌بندی من</h2>
      <div
        v-for="r in categoryRequests"
        :key="r.id"
        data-testid="category-request-row"
        class="flex flex-wrap items-start justify-between gap-2 border-t border-(--color-border-soft) pt-3 first:border-t-0 first:pt-0"
      >
        <div class="min-w-0">
          <p class="break-words text-sm font-semibold text-(--color-text)">{{ r.name }}</p>
          <p v-if="r.status === 'rejected' && r.resolutionNote" class="mt-0.5 text-xs text-(--color-text-muted)">
            {{ r.resolutionNote }}
          </p>
        </div>
        <StatusBadge :label="CATEGORY_REQUEST_STATUS_META[r.status].label" :tone="CATEGORY_REQUEST_STATUS_META[r.status].tone" />
      </div>
    </AppCard>
  </div>
</template>
