<!-- apps/provider-panel/src/pages/EarningsView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { useApi } from '@/composables/useApi'
import { invoiceStatusLabel, jalaliMonthLabel } from '@/utils/labels'

interface Earnings {
  totalCollected: number
  commissionPercent: number
  commissionAmount: number
  netPayout: number
}

interface Invoice {
  id: string
  jalaliYear: number
  jalaliMonth: number
  totalNetPayable: number
  paidTotal: number
  status: 'issued' | 'partially_paid' | 'paid' | 'void'
}

const { apiFetch } = useApi()
const earnings = ref<Earnings | null>(null)
const loading = ref(true)
const loadError = ref(false)

// Read-only settlement history -- no interaction here, recording a payment is an admin
// action (InvoiceStatusActions.vue in admin-panel). Fetched alongside earnings but kept
// in its own ref/error state so one endpoint failing doesn't blank out the other.
const invoices = ref<Invoice[]>([])
const invoicesError = ref(false)

async function load() {
  loading.value = true
  loadError.value = false

  const [earningsRes, invoicesRes] = await Promise.all([
    apiFetch<Earnings>('/salons/mine/earnings', { silent: true }),
    apiFetch<Invoice[]>('/salons/mine/invoices', { silent: true }),
  ])

  if (earningsRes.error) {
    loadError.value = true
    loading.value = false
    return
  }
  earnings.value = earningsRes.data

  invoicesError.value = !!invoicesRes.error
  invoices.value = invoicesRes.data ?? []

  loading.value = false
}

onMounted(load)

function toman(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return '—'
  return `${amount.toLocaleString('fa-IR')} تومان`
}
</script>

<template>
  <!-- The one screen PRODUCT.md names for a desktop review session: the three figures go
       side by side from sm (a 430px phone in landscape already has room), and the container
       stops them stretching to an unreadable 1888px on a 1920px monitor. -->
  <div class="mx-auto w-full max-w-5xl space-y-4 p-4 lg:p-6">
    <h1 class="text-lg font-bold text-(--color-text)">درآمد</h1>

    <div v-if="loading" class="flex items-center justify-center py-14 text-(--color-text-muted)">
      <AppIcon name="spinner" :size="20" class="animate-spin" />
    </div>

    <div v-else-if="loadError" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">اطلاعات درآمد بارگذاری نشد.</p>
      <AppButton variant="secondary" data-testid="retry-earnings" @click="load">
        تلاش دوباره
      </AppButton>
    </div>

    <EmptyState v-else-if="!earnings" icon="earnings" message="اطلاعات درآمدی برای نمایش وجود ندارد." />

    <div v-else class="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
      <!-- The headline figure spans both columns at sm/md (where three across would squeeze
           a long toman number into two wrapped lines) and joins the row at lg. -->
      <AppCard class="bg-(--color-surface-subtle) sm:col-span-2 lg:col-span-1">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-(--color-surface-card) text-(--color-text-muted)">
            <AppIcon name="earnings" :size="18" />
          </div>
          <!-- min-w-0 + break-words: a large toman figure is a long unbreakable digit run,
               and it must wrap inside the card rather than widen it. -->
          <div class="min-w-0">
            <p class="text-xs text-(--color-text-muted)">مجموع دریافتی</p>
            <p class="tnum break-words text-xl font-bold text-(--color-text)">{{ toman(earnings.totalCollected) }}</p>
          </div>
        </div>
      </AppCard>

      <AppCard>
        <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 sm:flex-col sm:items-start">
          <p class="text-sm text-(--color-text-muted)">کارمزد پلتفرم ({{ earnings.commissionPercent }}٪)</p>
          <p class="tnum break-words text-lg font-bold text-(--color-text-muted)">−{{ toman(earnings.commissionAmount) }}</p>
        </div>
      </AppCard>

      <AppCard>
        <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 sm:flex-col sm:items-start">
          <p class="text-sm font-semibold text-(--color-text)">مبلغ قابل پرداخت</p>
          <p class="tnum break-words text-xl font-bold text-(--tone-success-text)">{{ toman(earnings.netPayout) }}</p>
        </div>
      </AppCard>
    </div>

    <div v-if="!loading && !loadError" class="space-y-3">
      <h2 class="text-base font-bold text-(--color-text)">تسویه‌حساب‌های ماهانه</h2>
      <p v-if="invoicesError" class="text-sm text-(--tone-danger-text)">تاریخچه تسویه‌حساب بارگذاری نشد.</p>
      <EmptyState
        v-else-if="invoices.length === 0"
        icon="earnings"
        message="هنوز صورتحسابی صادر نشده است."
      />
      <AppCard v-else :padded="false" class="overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-right text-sm">
            <thead>
              <tr class="border-b border-(--color-border) bg-(--color-border-soft) text-xs text-(--color-text-muted)">
                <th scope="col" class="px-4 py-3 font-semibold">دوره</th>
                <th scope="col" class="px-4 py-3 font-semibold">خالص قابل‌پرداخت</th>
                <th scope="col" class="px-4 py-3 font-semibold">پرداخت‌شده</th>
                <th scope="col" class="px-4 py-3 font-semibold">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="invoice in invoices"
                :key="invoice.id"
                data-testid="invoice-row"
                class="border-b border-(--color-border-soft) last:border-0"
              >
                <td class="tnum px-4 py-3 text-(--color-text)">{{ jalaliMonthLabel(invoice.jalaliYear, invoice.jalaliMonth) }}</td>
                <td class="tnum px-4 py-3 font-semibold text-(--color-text)">{{ toman(invoice.totalNetPayable) }}</td>
                <td class="tnum px-4 py-3 text-(--color-text-muted)">{{ toman(invoice.paidTotal) }}</td>
                <td class="px-4 py-3">
                  <StatusBadge :label="invoiceStatusLabel(invoice.status).label" :tone="invoiceStatusLabel(invoice.status).tone" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </AppCard>
    </div>
  </div>
</template>
