<!-- apps/provider-panel/src/pages/PlanView.vue -->
<!-- Read-only: the owner sees their current plan and what it includes, but has no control
     here to change plan, cancel, or set any override -- all of that is admin-only
     (docs/technical-overview/30-subscription-plan-foundation.md), matching the "salon owner
     picks only booking mode, nothing commercial" decision. -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import UsageMeter from '@/components/plan/UsageMeter.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { useApi } from '@/composables/useApi'
import { formatToman } from '@/utils/format-toman'
import { entitlementLabel, formatEntitlementValue } from '@/utils/entitlement-label'

interface Plan { id: string; key: string; name: string; description: string | null; monthlyPriceToman: number }
interface Subscription { status: 'active' | 'canceled' }
interface SubscriptionResponse { subscription: Subscription; plan: Plan; resolvedEntitlements: Record<string, unknown> }
interface BillingPeriod {
  id: string
  periodStart: string
  periodEnd: string
  amountToman: number
  discountPercent: number | null
  status: 'pending' | 'paid' | 'comped' | 'void'
}

const { apiFetch } = useApi()
const data = ref<SubscriptionResponse | null>(null)
const loading = ref(true)
const loadError = ref(false)
const billingPeriods = ref<BillingPeriod[]>([])

// ---- usage meters ------------------------------------------------------------------
// Only usage the API actually reports is metered: SMS (GET /salons/mine/sms-quota -- the
// same endpoint the customers page uses) and, when the plan caps the CRM, the customer list's
// own total. Nothing else in the plan has a usage endpoint, so nothing else gets a bar.
interface SmsQuota { quota: number; used: number; remaining: number }
const smsQuota = ref<SmsQuota | null>(null)
const crmCustomerCount = ref<number | null>(null)

async function loadSmsQuota() {
  const { data: result } = await apiFetch<SmsQuota>('/salons/mine/sms-quota', { silent: true })
  smsQuota.value = result
}

const crmCap = computed<number | null>(() => {
  const value = data.value?.resolvedEntitlements.crmCustomerCap
  return typeof value === 'number' ? value : null
})

// The list endpoint applies the cap before paging, so its `total` is the number of customers
// the CRM currently shows (never more than the cap) -- exactly what the meter claims.
async function loadCrmCount() {
  if (crmCap.value === null) return
  const { data: page } = await apiFetch<{ total: number }>('/salons/mine/customers?page=1&pageSize=1', { silent: true })
  crmCustomerCount.value = page ? page.total : null
}

async function load() {
  loading.value = true
  loadError.value = false
  const { data: result, error } = await apiFetch<SubscriptionResponse>('/salons/mine/subscription', { silent: true })
  if (error || !result) {
    loadError.value = true
    loading.value = false
    return
  }
  data.value = result
  loading.value = false
  void loadCrmCount()
}

async function loadBillingPeriods() {
  const { data: result } = await apiFetch<BillingPeriod[]>('/salons/mine/subscription/billing-periods', { silent: true })
  billingPeriods.value = result ?? []
}

onMounted(() => {
  load()
  loadBillingPeriods()
  loadSmsQuota()
})

const entitlementEntries = () => Object.entries(data.value?.resolvedEntitlements ?? {})

/** Jalali month name of "now" in Tehran -- the SMS quota resets per Jalali month. */
const currentJalaliMonth = new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', month: 'long' }).format(new Date())

function formatBillingDate(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso))
}
const BILLING_STATUS_LABEL: Record<BillingPeriod['status'], { label: string; tone: 'neutral' | 'success' | 'info' | 'warning' }> = {
  pending: { label: 'در انتظار', tone: 'warning' },
  paid: { label: 'پرداخت‌شده', tone: 'success' },
  comped: { label: 'رایگان', tone: 'info' },
  void: { label: 'باطل‌شده', tone: 'neutral' },
}
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-4 p-4 lg:p-6">
    <h1 class="text-lg font-bold text-(--color-text)">پلن من</h1>

    <div v-if="loading" class="flex items-center justify-center py-14 text-(--color-text-muted)">
      <AppIcon name="spinner" :size="20" class="animate-spin" />
    </div>

    <div v-else-if="loadError" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">اطلاعات پلن بارگذاری نشد.</p>
      <AppButton variant="secondary" data-testid="retry-plan" @click="load">تلاش دوباره</AppButton>
    </div>

    <template v-else-if="data">
      <div class="grid gap-4 lg:grid-cols-2 lg:items-start">
        <!-- Plan identity: the one place the brand gold is used on this screen (a fill with
             charcoal on it, never gold text on a light surface). -->
        <AppCard :padded="false" class="overflow-hidden" data-testid="plan-hero">
          <div class="h-1.5 bg-(--color-gold)" aria-hidden="true" />
          <div class="p-4">
            <div class="flex items-center gap-3">
              <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-(--color-gold) text-(--color-fill-text)" aria-hidden="true">
                <AppIcon name="plan" :size="22" />
              </div>
              <div class="min-w-0">
                <span class="inline-block rounded-full bg-(--color-gold) px-2.5 py-0.5 text-xs font-semibold text-(--color-fill-text)">پلن فعلی</span>
                <p class="mt-1 break-words text-xl font-bold text-(--color-text)">{{ data.plan.name }}</p>
              </div>
            </div>
            <p v-if="data.plan.description" class="mt-3 text-sm leading-6 text-(--color-text)">{{ data.plan.description }}</p>
            <p class="mt-3 text-base font-bold text-(--color-text)">
              <span v-if="data.plan.monthlyPriceToman === 0">رایگان</span>
              <span v-else><span class="tnum">{{ formatToman(data.plan.monthlyPriceToman) }}</span> تومان در ماه</span>
            </p>
            <p v-if="data.subscription.status === 'canceled'" data-testid="canceled-note" class="mt-3 text-xs text-(--tone-warning-text)">
              اشتراک قبلی این سالن توسط پلتفرم لغو شده و به‌طور موقت روی پلن پیش‌فرض قرار دارد. برای تغییر با پشتیبانی تماس بگیرید.
            </p>
            <!-- Honest: there is no self-serve upgrade or payment in the panel. -->
            <div class="mt-4 flex items-start gap-2 rounded-xl bg-(--color-surface-subtle) p-3 text-xs leading-5 text-(--color-text-muted)" data-testid="plan-change-note">
              <AppIcon name="phone" :size="16" class="mt-0.5 shrink-0 text-(--color-accent-text)" />
              <p><span class="font-semibold text-(--color-text)">تغییر پلن با پشتیبانی</span> — تغییر یا ارتقای پلن از داخل پنل ممکن نیست و توسط پشتیبانی قیچی انجام می‌شود.</p>
            </div>
          </div>
        </AppCard>

        <AppCard class="space-y-5" data-testid="plan-usage">
          <h2 class="text-base font-bold text-(--color-text)">مصرف این دوره</h2>
          <UsageMeter
            v-if="smsQuota"
            data-testid="sms-usage-meter"
            label="پیامک به مشتریان"
            :used="smsQuota.used"
            :limit="smsQuota.quota"
            unit="پیامک"
            :hint="`سهمیهٔ ماه ${currentJalaliMonth}؛ ابتدای هر ماه شمسی از نو شروع می‌شود.`"
          />
          <UsageMeter
            v-if="crmCap !== null && crmCustomerCount !== null"
            data-testid="crm-usage-meter"
            label="مشتریان قابل نمایش در CRM"
            :used="crmCustomerCount"
            :limit="crmCap"
            unit="مشتری"
          />
          <p v-if="!smsQuota && (crmCap === null || crmCustomerCount === null)" class="text-sm text-(--color-text-muted)">
            اطلاعات مصرف در دسترس نیست.
          </p>
        </AppCard>
      </div>

      <div>
        <h2 class="mb-2 text-base font-bold text-(--color-text)">امکانات این پلن</h2>
        <AppCard v-if="entitlementEntries().length === 0" :padded="false" class="p-4">
          <p class="text-sm text-(--color-text-muted)">این پلن هنوز محدودیت یا امکان خاصی تعریف‌شده ندارد.</p>
        </AppCard>
        <AppCard v-else :padded="false" class="divide-y divide-(--color-border-soft)">
          <div
            v-for="[key, value] in entitlementEntries()"
            :key="key"
            data-testid="entitlement-row"
            class="flex items-center justify-between gap-3 px-4 py-3 text-sm"
          >
            <span class="text-(--color-text-muted)">{{ entitlementLabel(key) }}</span>
            <span class="tnum inline-flex items-center gap-1 font-semibold" :class="value === false ? 'text-(--color-text-muted)' : 'text-(--color-text)'">
              <AppIcon v-if="typeof value === 'boolean'" :name="value ? 'check' : 'x'" :size="15" :class="value ? 'text-(--tone-success-text)' : ''" />
              {{ formatEntitlementValue(value) }}
            </span>
          </div>
        </AppCard>
      </div>

      <div v-if="billingPeriods.length > 0">
        <h2 class="mb-2 text-base font-bold text-(--color-text)">تاریخچه صورتحساب</h2>
        <p class="mb-2 text-xs text-(--color-text-muted)">این تاریخچه به‌صورت دستی توسط پلتفرم ثبت می‌شود.</p>
        <div class="grid gap-2 sm:grid-cols-2">
          <AppCard v-for="period in billingPeriods" :key="period.id" data-testid="billing-period-row" :padded="false" class="p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p class="tnum text-xs text-(--color-text-muted)">{{ formatBillingDate(period.periodStart) }} تا {{ formatBillingDate(period.periodEnd) }}</p>
                <p class="mt-0.5 text-sm font-bold text-(--color-text)">
                  <span class="tnum">{{ formatToman(period.amountToman) }}</span> تومان
                </p>
              </div>
              <StatusBadge :label="BILLING_STATUS_LABEL[period.status].label" :tone="BILLING_STATUS_LABEL[period.status].tone" />
            </div>
          </AppCard>
        </div>
      </div>
    </template>
  </div>
</template>
