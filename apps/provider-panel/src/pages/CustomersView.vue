<!-- apps/provider-panel/src/pages/CustomersView.vue -->
<!-- Salon CRM (Phase 5 of the monetization initiative -- see
     docs/technical-overview/32-salon-crm.md). The dashboard summary card is deliberately
     precise about financial terminology: "gross booking value" (full agreed price),
     "online collected" (the deposit actually captured), "commission" (frozen ledger),
     and "estimated salon revenue" (labeled estimated on purpose -- the cash portion is
     never actually observed by this platform). -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useApi } from '@/composables/useApi'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { customerSegmentLabel } from '@/utils/labels'
import { formatToman } from '@/utils/format-toman'

interface Customer {
  userId: string
  name: string | null
  phone: string
  bookingsCount: number
  completedCount: number
  lastVisitAt: string | null
  grossValue: number
  segment: 'new' | 'returning' | 'lapsed'
}
interface DashboardSummary {
  bookingsCount: number
  grossBookingValue: number
  onlineCollected: number
  commission: number
  estimatedSalonRevenue: number
}
interface SmsQuota { quota: number; used: number; remaining: number }

const { apiFetch } = useApi()
const customers = ref<Customer[]>([])
const summary = ref<DashboardSummary | null>(null)
const smsQuota = ref<SmsQuota | null>(null)
const loading = ref(true)
const loadError = ref(false)

async function load() {
  loading.value = true
  loadError.value = false
  const [customersRes, summaryRes, quotaRes] = await Promise.all([
    apiFetch<Customer[]>('/salons/mine/customers', { silent: true }),
    apiFetch<DashboardSummary>('/salons/mine/dashboard-summary', { silent: true }),
    apiFetch<SmsQuota>('/salons/mine/sms-quota', { silent: true }),
  ])
  if (customersRes.error) {
    loadError.value = true
    loading.value = false
    return
  }
  customers.value = customersRes.data ?? []
  summary.value = summaryRes.data
  smsQuota.value = quotaRes.data
  loading.value = false
}
onMounted(load)

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso))
}
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-4 p-4 lg:p-6">
    <h1 class="text-lg font-bold text-(--color-text)">مشتریان</h1>
    <p v-if="smsQuota" data-testid="sms-quota-summary" class="text-xs text-(--color-text-muted)">
      پیامک این ماه: <span dir="ltr" class="tnum">{{ smsQuota.remaining }}</span> از <span dir="ltr" class="tnum">{{ smsQuota.quota }}</span> باقی مانده
    </p>

    <div v-if="loading" class="flex items-center justify-center py-14 text-(--color-text-muted)">
      <AppIcon name="spinner" :size="20" class="animate-spin" />
    </div>

    <div v-else-if="loadError" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">اطلاعات مشتریان بارگذاری نشد.</p>
      <AppButton variant="secondary" data-testid="retry-customers" @click="load">تلاش دوباره</AppButton>
    </div>

    <template v-else>
      <div v-if="summary" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AppCard class="bg-(--color-surface-subtle)">
          <p class="text-xs text-(--color-text-muted)">ارزش ناخالص نوبت‌ها (۳۰ روز اخیر)</p>
          <p class="mt-1 break-words text-lg font-bold text-(--color-text)"><span dir="ltr" class="tnum">{{ formatToman(summary.grossBookingValue) }}</span> تومان</p>
        </AppCard>
        <AppCard class="bg-(--color-surface-subtle)">
          <p class="text-xs text-(--color-text-muted)">دریافتی آنلاین</p>
          <p class="mt-1 break-words text-lg font-bold text-(--color-text)"><span dir="ltr" class="tnum">{{ formatToman(summary.onlineCollected) }}</span> تومان</p>
        </AppCard>
        <AppCard class="bg-(--color-surface-subtle)">
          <p class="text-xs text-(--color-text-muted)">کارمزد پلتفرم</p>
          <p class="mt-1 break-words text-lg font-bold text-(--color-text-muted)"><span dir="ltr" class="tnum">{{ formatToman(summary.commission) }}</span> تومان</p>
        </AppCard>
        <AppCard class="bg-(--color-surface-subtle)">
          <p class="text-xs text-(--color-text-muted)">درآمد تخمینی سالن</p>
          <p class="mt-1 break-words text-lg font-bold text-(--tone-success-text)"><span dir="ltr" class="tnum">{{ formatToman(summary.estimatedSalonRevenue) }}</span> تومان</p>
          <p class="mt-1 text-xs text-(--color-text-muted)">تخمینی -- بخش نقدی هرگز توسط پلتفرم مشاهده نمی‌شود.</p>
        </AppCard>
      </div>

      <EmptyState v-if="customers.length === 0" icon="customers" message="هنوز مشتری‌ای برای این سالن ثبت نشده است." />

      <AppCard v-else :padded="false" class="overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-right text-sm">
            <thead>
              <tr class="border-b border-(--color-border) bg-(--color-border-soft) text-xs text-(--color-text-muted)">
                <th scope="col" class="px-4 py-3 font-semibold">مشتری</th>
                <th scope="col" class="px-4 py-3 font-semibold">تعداد نوبت</th>
                <th scope="col" class="px-4 py-3 font-semibold">آخرین مراجعه</th>
                <th scope="col" class="px-4 py-3 font-semibold">ارزش کل</th>
                <th scope="col" class="px-4 py-3 font-semibold">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="c in customers"
                :key="c.userId"
                data-testid="customer-row"
                class="border-b border-(--color-border-soft) last:border-0"
              >
                <td class="px-4 py-3">
                  <RouterLink :to="`/customers/${c.userId}`" class="font-semibold text-(--color-accent-text) hover:underline">
                    {{ c.name || 'بدون نام' }}
                  </RouterLink>
                  <p dir="ltr" class="tnum text-xs text-(--color-text-muted)">{{ c.phone }}</p>
                </td>
                <td class="tnum px-4 py-3 text-(--color-text-muted)">{{ c.bookingsCount.toLocaleString('fa-IR') }}</td>
                <td class="tnum px-4 py-3 text-(--color-text-muted)">{{ formatDate(c.lastVisitAt) }}</td>
                <td class="px-4 py-3 text-(--color-text-muted)"><span dir="ltr" class="tnum">{{ formatToman(c.grossValue) }}</span> تومان</td>
                <td class="px-4 py-3">
                  <StatusBadge :label="customerSegmentLabel(c.segment).label" :tone="customerSegmentLabel(c.segment).tone" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </AppCard>
    </template>
  </div>
</template>
