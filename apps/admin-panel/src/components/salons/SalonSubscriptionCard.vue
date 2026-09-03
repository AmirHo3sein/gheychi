<!-- apps/admin-panel/src/components/salons/SalonSubscriptionCard.vue -->
<!-- Admin view/management of ONE salon's subscription (Phase 3 of the monetization
     initiative -- docs/technical-overview/30-subscription-plan-foundation.md). Plan
     assignment, cancellation, and the salon-specific entitlement override are all
     admin-only here -- the owner has a read-only equivalent (GET /salons/mine/subscription)
     with no route to change any of it, matching the "salon owner picks only booking mode,
     nothing commercial" decision. -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect, { type SelectOption } from '@/components/ui/AppSelect.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { formatToman } from '@/utils/format-toman'

const props = defineProps<{ salonId: string }>()

interface Plan { id: string; key: string; name: string; monthlyPriceToman: number; isActive: boolean }
interface Subscription {
  id: string
  planId: string
  status: 'active' | 'canceled'
  startedAt: string
  canceledAt: string | null
  entitlementOverrides: Record<string, unknown> | null
}
interface SubscriptionResponse { subscription: Subscription; plan: Plan; resolvedEntitlements: Record<string, unknown> }

const { apiFetch } = useApi()
const { push: pushToast } = useToast()

const data = ref<SubscriptionResponse | null>(null)
const loading = ref(true)
const loadError = ref(false)
const plans = ref<Plan[]>([])
const submitting = ref(false)

async function load() {
  loading.value = true
  loadError.value = false
  const [subRes, plansRes] = await Promise.all([
    apiFetch<SubscriptionResponse>(`/admin/salons/${props.salonId}/subscription`, { silent: true }),
    apiFetch<Plan[]>('/admin/plans', { silent: true }),
  ])
  if (subRes.error || !subRes.data) {
    loadError.value = true
    loading.value = false
    return
  }
  data.value = subRes.data
  plans.value = plansRes.data ?? []
  loading.value = false
}
onMounted(() => {
  load()
  loadBillingPeriods()
})

const planOptions = computed<SelectOption[]>(() =>
  plans.value.filter((p) => p.isActive).map((p) => ({ value: p.id, label: p.name })),
)
const selectedPlanId = ref<string>('')
watch(data, (d) => { if (d) selectedPlanId.value = d.plan.id }, { immediate: true })

const confirmingPlanChange = ref(false)
async function applyPlanChange() {
  if (!selectedPlanId.value || selectedPlanId.value === data.value?.plan.id) {
    confirmingPlanChange.value = false
    return
  }
  submitting.value = true
  const { data: result } = await apiFetch<SubscriptionResponse>(`/admin/salons/${props.salonId}/subscription`, {
    method: 'PATCH',
    body: { planId: selectedPlanId.value },
  })
  submitting.value = false
  confirmingPlanChange.value = false
  if (result) {
    data.value = result
    pushToast('پلن این سالن به‌روزرسانی شد')
  }
}

const confirmingCancel = ref(false)
async function cancelSubscription() {
  submitting.value = true
  const { data: result } = await apiFetch<SubscriptionResponse>(`/admin/salons/${props.salonId}/subscription/cancel`, { method: 'POST' })
  submitting.value = false
  confirmingCancel.value = false
  if (result) {
    data.value = result
    pushToast('اشتراک این سالن لغو شد؛ سالن به پلن پیش‌فرض بازگشت')
  }
}

// --- Salon-specific entitlement override (advanced, rare) -------------------
const editingOverrides = ref(false)
const overridesText = ref('')
const overridesError = ref('')

function openOverridesEditor() {
  overridesText.value = data.value?.subscription.entitlementOverrides
    ? JSON.stringify(data.value.subscription.entitlementOverrides, null, 2)
    : ''
  overridesError.value = ''
  editingOverrides.value = true
}

async function saveOverrides() {
  const trimmed = overridesText.value.trim()
  let parsed: Record<string, unknown> | null = null
  if (trimmed !== '') {
    try {
      const value = JSON.parse(trimmed)
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        overridesError.value = 'باید یک شیء JSON معتبر باشد، یا برای پاک‌کردن، خالی بگذارید'
        return
      }
      parsed = value
    } catch {
      overridesError.value = 'JSON وارد‌شده معتبر نیست'
      return
    }
  }
  overridesError.value = ''
  submitting.value = true
  const { data: result } = await apiFetch<SubscriptionResponse>(`/admin/salons/${props.salonId}/subscription/overrides`, {
    method: 'PATCH',
    body: { overrides: parsed },
  })
  submitting.value = false
  if (result) {
    data.value = result
    editingOverrides.value = false
    pushToast('استثنای امکانات این سالن ذخیره شد')
  }
}

function formatEntitlements(entitlements: Record<string, unknown>): string {
  const keys = Object.keys(entitlements)
  return keys.length === 0 ? 'بدون محدودیت' : keys.map((k) => `${k}: ${JSON.stringify(entitlements[k])}`).join('، ')
}

// --- Billing periods (Phase 7 -- architecture-only: admin creates a period and later
// records what was actually paid/comp'd outside the platform; there is no real Zarinpal
// subscription-charge flow anywhere in this card). ------------------------------------
interface BillingPeriod {
  id: string
  periodStart: string
  periodEnd: string
  baseAmountToman: number
  discountPercent: number | null
  amountToman: number
  status: 'pending' | 'paid' | 'comped' | 'void'
  resolvedAt: string | null
}
const billingPeriods = ref<BillingPeriod[]>([])
const billingLoading = ref(true)

async function loadBillingPeriods() {
  billingLoading.value = true
  const { data } = await apiFetch<BillingPeriod[]>(`/admin/salons/${props.salonId}/subscription/billing-periods`, { silent: true })
  billingPeriods.value = data ?? []
  billingLoading.value = false
}

function formatBillingDate(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso))
}
const BILLING_STATUS_LABEL: Record<BillingPeriod['status'], { label: string; tone: 'neutral' | 'success' | 'info' | 'warning' }> = {
  pending: { label: 'در انتظار', tone: 'warning' },
  paid: { label: 'پرداخت‌شده', tone: 'success' },
  comped: { label: 'رایگان (comp)', tone: 'info' },
  void: { label: 'باطل‌شده', tone: 'neutral' },
}

const creatingPeriod = ref(false)
const newPeriodStart = ref('')
const newPeriodEnd = ref('')
const newPeriodCoupon = ref('')

async function createBillingPeriod() {
  if (!newPeriodStart.value || !newPeriodEnd.value) return
  submitting.value = true
  const { data } = await apiFetch<BillingPeriod>(`/admin/salons/${props.salonId}/subscription/billing-periods`, {
    method: 'POST',
    body: {
      periodStart: new Date(`${newPeriodStart.value}T00:00:00.000`).toISOString(),
      periodEnd: new Date(`${newPeriodEnd.value}T00:00:00.000`).toISOString(),
      couponCode: newPeriodCoupon.value.trim() || undefined,
    },
  })
  submitting.value = false
  if (data) {
    billingPeriods.value.unshift(data)
    newPeriodStart.value = ''
    newPeriodEnd.value = ''
    newPeriodCoupon.value = ''
    creatingPeriod.value = false
    pushToast('دوره صورتحساب جدید ثبت شد')
  }
}

// Settling a period is settle-once on the backend (a resolved period is never overwritten,
// same as an issued invoice), so it gets the same confirm-before-commit step every other
// irreversible action in this card already has. One pending confirmation at a time.
type ResolvedPeriodStatus = 'paid' | 'comped' | 'void'
const RESOLVE_CONFIRM_COPY: Record<ResolvedPeriodStatus, string> = {
  paid: 'این دوره پرداخت‌شده ثبت شود؟ این تسویه قابل بازگشت نیست.',
  comped: 'این دوره رایگان (comp) ثبت شود؟ این تسویه قابل بازگشت نیست.',
  void: 'این دوره باطل شود؟ این تسویه قابل بازگشت نیست.',
}
const pendingResolve = ref<{ periodId: string; status: ResolvedPeriodStatus } | null>(null)

async function resolvePeriod(period: BillingPeriod) {
  const pending = pendingResolve.value
  if (!pending || pending.periodId !== period.id) return
  submitting.value = true
  const { data } = await apiFetch<BillingPeriod>(
    `/admin/salons/${props.salonId}/subscription/billing-periods/${period.id}/status`,
    { method: 'PATCH', body: { status: pending.status } },
  )
  submitting.value = false
  pendingResolve.value = null
  if (data) Object.assign(period, data)
}
</script>

<template>
  <AppCard>
    <div v-if="loading" data-testid="subscription-loading" class="flex items-center justify-center gap-2 py-10 text-sm text-(--color-text-muted)">
      <AppIcon name="spinner" :size="20" class="animate-spin" />
      در حال بارگذاری اشتراک…
    </div>

    <div v-else-if="loadError" data-testid="subscription-error" class="flex flex-col items-center justify-center gap-3 py-10 text-center">
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-(--tone-danger-bg) text-(--tone-danger-text)">
        <AppIcon name="warning" :size="22" />
      </div>
      <p class="text-sm text-(--color-text-muted)">بارگذاری اشتراک این آرایشگاه با خطا مواجه شد.</p>
      <AppButton type="button" variant="secondary" data-testid="subscription-retry" @click="load">تلاش مجدد</AppButton>
    </div>

    <template v-else-if="data">
      <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div class="flex min-w-0 items-start gap-3">
          <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--color-border-soft) text-(--color-accent-text)">
            <AppIcon name="plan" :size="22" />
          </div>
          <div class="min-w-0">
            <h3 class="text-base font-bold text-(--color-text)">اشتراک</h3>
            <p class="mt-0.5 text-xs text-(--color-text-muted)">
              پلن فعلی: {{ data.plan.name }}
              <span v-if="data.plan.monthlyPriceToman > 0" dir="ltr" class="tnum">({{ formatToman(data.plan.monthlyPriceToman) }} تومان/ماه)</span>
            </p>
          </div>
        </div>
        <StatusBadge
          data-testid="subscription-status"
          :label="data.subscription.status === 'active' ? 'فعال' : 'لغوشده'"
          :tone="data.subscription.status === 'active' ? 'success' : 'neutral'"
        />
      </div>

      <p class="mt-3 text-xs text-(--color-text-muted)">
        امکانات موثر (پس از اعمال استثنا در صورت وجود): {{ formatEntitlements(data.resolvedEntitlements) }}
      </p>
      <p v-if="data.subscription.entitlementOverrides" data-testid="has-overrides-note" class="mt-1 text-xs text-(--tone-warning-text)">
        این سالن یک استثنای امکانات اختصاصی دارد.
      </p>

      <div class="mt-4 space-y-3 border-t border-(--color-border-soft) pt-4">
        <div class="flex flex-wrap items-end gap-2.5">
          <AppSelect v-model="selectedPlanId" label="تغییر پلن" :options="planOptions" width="12rem" />
          <template v-if="!confirmingPlanChange">
            <AppButton
              type="button"
              variant="secondary"
              data-testid="change-plan-button"
              :disabled="submitting || selectedPlanId === data.plan.id"
              @click="confirmingPlanChange = true"
            >
              اعمال
            </AppButton>
          </template>
          <template v-else>
            <AppButton type="button" variant="primary" data-testid="confirm-plan-change" :disabled="submitting" @click="applyPlanChange">
              تأیید تغییر پلن
            </AppButton>
            <AppButton type="button" variant="ghost" :disabled="submitting" @click="confirmingPlanChange = false">انصراف</AppButton>
          </template>
        </div>

        <div class="flex flex-wrap items-center gap-2.5">
          <template v-if="data.subscription.status === 'active'">
            <template v-if="!confirmingCancel">
              <AppButton type="button" variant="ghost" class="text-(--tone-danger-text)!" data-testid="cancel-subscription-button" @click="confirmingCancel = true">
                لغو اشتراک
              </AppButton>
            </template>
            <template v-else>
              <span class="text-xs font-semibold text-(--tone-danger-text)">اشتراک لغو و سالن به پلن پیش‌فرض بازگردانده شود؟</span>
              <AppButton type="button" variant="danger" :disabled="submitting" data-testid="confirm-cancel-subscription" @click="cancelSubscription">تأیید</AppButton>
              <AppButton type="button" variant="ghost" :disabled="submitting" @click="confirmingCancel = false">انصراف</AppButton>
            </template>
          </template>
          <p v-else class="text-xs text-(--color-text-muted)">اشتراک لغو شده است؛ برای فعال‌سازی مجدد یک پلن را از بالا انتخاب و اعمال کنید.</p>
        </div>

        <div v-if="!editingOverrides">
          <AppButton type="button" variant="ghost" data-testid="edit-overrides-button" @click="openOverridesEditor">
            استثنای امکانات این سالن (پیشرفته)
          </AppButton>
        </div>
        <div v-else class="space-y-2">
          <label class="block text-xs font-semibold text-(--color-text-muted)">
            استثنای امکانات این سالن (JSON، خالی = پاک‌کردن)
          </label>
          <textarea
            v-model="overridesText"
            data-testid="overrides-input"
            rows="3"
            dir="ltr"
            class="w-full rounded-xl border border-(--color-text-muted) p-3 font-mono text-xs"
          />
          <p v-if="overridesError" data-testid="overrides-error" class="text-xs text-(--tone-danger-text)">{{ overridesError }}</p>
          <div class="flex gap-2.5">
            <AppButton type="button" variant="primary" :disabled="submitting" data-testid="save-overrides-button" @click="saveOverrides">ذخیره</AppButton>
            <AppButton type="button" variant="ghost" :disabled="submitting" @click="editingOverrides = false">انصراف</AppButton>
          </div>
        </div>

        <div class="border-t border-(--color-border-soft) pt-4">
          <div class="mb-2 flex items-center justify-between">
            <h4 class="text-sm font-bold text-(--color-text)">دوره‌های صورتحساب</h4>
            <AppButton v-if="!creatingPeriod" type="button" variant="ghost" data-testid="new-billing-period-button" @click="creatingPeriod = true">
              <template #icon><AppIcon name="plus" :size="14" /></template>
              دوره جدید
            </AppButton>
          </div>
          <p class="mb-2 text-xs text-(--color-text-muted)">
            ثبت و تسویه این دوره‌ها کاملا دستی است -- هیچ اتصال واقعی به درگاه پرداخت برای شارژ اشتراک وجود ندارد.
          </p>

          <AppCard v-if="creatingPeriod" :padded="false" class="mb-3 space-y-2.5 p-3">
            <div class="grid gap-2.5 sm:grid-cols-2">
              <div>
                <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">شروع دوره</label>
                <JalaliDatePicker v-model="newPeriodStart" placeholder="انتخاب تاریخ" class="w-full" />
              </div>
              <div>
                <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">پایان دوره</label>
                <JalaliDatePicker v-model="newPeriodEnd" placeholder="انتخاب تاریخ" class="w-full" />
              </div>
            </div>
            <AppInput v-model="newPeriodCoupon" label="کد تخفیف اشتراک (اختیاری)" data-testid="new-period-coupon-input" />
            <div class="flex gap-2.5">
              <AppButton
                type="button"
                variant="primary"
                :disabled="submitting || !newPeriodStart || !newPeriodEnd"
                data-testid="submit-new-billing-period"
                @click="createBillingPeriod"
              >
                ثبت دوره
              </AppButton>
              <AppButton type="button" variant="ghost" :disabled="submitting" @click="creatingPeriod = false">انصراف</AppButton>
            </div>
          </AppCard>

          <div v-if="billingLoading" class="flex items-center justify-center py-6 text-(--color-text-muted)">
            <AppIcon name="spinner" :size="18" class="animate-spin" />
          </div>
          <p v-else-if="billingPeriods.length === 0" class="py-2 text-xs text-(--color-text-muted)">هنوز دوره صورتحسابی برای این سالن ثبت نشده است.</p>
          <div v-else class="space-y-2">
            <AppCard v-for="period in billingPeriods" :key="period.id" data-testid="billing-period-row" :padded="false" class="p-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p class="tnum text-xs text-(--color-text-muted)">{{ formatBillingDate(period.periodStart) }} تا {{ formatBillingDate(period.periodEnd) }}</p>
                  <p class="mt-0.5 text-sm font-bold text-(--color-text)">
                    <span dir="ltr" class="tnum">{{ formatToman(period.amountToman) }}</span> تومان
                    <span v-if="period.discountPercent" class="tnum text-xs font-normal text-(--tone-success-text)">
                      ({{ period.discountPercent.toLocaleString('fa-IR') }}٪ تخفیف اعمال‌شده)
                    </span>
                  </p>
                </div>
                <div class="flex items-center gap-2">
                  <StatusBadge :label="BILLING_STATUS_LABEL[period.status].label" :tone="BILLING_STATUS_LABEL[period.status].tone" />
                  <template v-if="period.status === 'pending' && pendingResolve?.periodId === period.id">
                    <span class="text-xs font-semibold text-(--tone-danger-text)">{{ RESOLVE_CONFIRM_COPY[pendingResolve.status] }}</span>
                    <AppButton
                      type="button"
                      :variant="pendingResolve.status === 'void' ? 'danger' : 'primary'"
                      :disabled="submitting"
                      :data-testid="`confirm-resolve-${period.id}`"
                      @click="resolvePeriod(period)"
                    >
                      تأیید
                    </AppButton>
                    <AppButton type="button" variant="ghost" :disabled="submitting" @click="pendingResolve = null">انصراف</AppButton>
                  </template>
                  <template v-else-if="period.status === 'pending'">
                    <AppButton type="button" variant="secondary" :disabled="submitting" :data-testid="`mark-paid-${period.id}`" @click="pendingResolve = { periodId: period.id, status: 'paid' }">
                      پرداخت‌شده
                    </AppButton>
                    <AppButton type="button" variant="ghost" :disabled="submitting" :data-testid="`mark-comped-${period.id}`" @click="pendingResolve = { periodId: period.id, status: 'comped' }">
                      رایگان
                    </AppButton>
                    <AppButton type="button" variant="ghost" class="text-(--tone-danger-text)!" :disabled="submitting" :data-testid="`mark-void-${period.id}`" @click="pendingResolve = { periodId: period.id, status: 'void' }">
                      باطل
                    </AppButton>
                  </template>
                </div>
              </div>
            </AppCard>
          </div>
        </div>
      </div>
    </template>
  </AppCard>
</template>
