<!-- apps/provider-panel/src/pages/CustomersView.vue -->
<!-- Salon CRM (Phase 5 of the monetization initiative -- see
     docs/technical-overview/32-salon-crm.md). The dashboard summary card is deliberately
     precise about financial terminology: "gross booking value" (full agreed price),
     "online deposit collected" (the DEPOSIT actually captured -- never the salon's cash
     portion, which this platform cannot observe), "commission" (frozen ledger), and
     "estimated salon revenue" (labeled estimated on purpose, for the same reason).

     Search/segment/sort/pagination are all server-side: a salon with hundreds of customers
     used to get one unfiltered 2,000-row dump and no way to find anyone in it. -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useApi } from '@/composables/useApi'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { customerSegmentLabel } from '@/utils/labels'
import { debounce } from '@/utils/debounce'
import { formatToman } from '@/utils/format-toman'

interface Customer {
  userId: string
  name: string | null
  phone: string
  /** Every booking ever made here, in any status -- including future and cancelled ones. */
  bookingsCount: number
  completedCount: number
  /** Bookings that actually happened: past, and never cancelled. */
  visitsCount: number
  firstVisitAt: string | null
  lastVisitAt: string | null
  grossValue: number
  segment: 'new' | 'returning' | 'lapsed'
}
interface CustomerPage {
  items: Customer[]
  total: number
  page: number
  pageSize: number
}
interface DashboardSummary {
  bookingsCount: number
  grossBookingValue: number
  onlineCollected: number
  commission: number
  estimatedSalonRevenue: number
}
interface SmsQuota { quota: number; used: number; remaining: number }

const PAGE_SIZE = 20

const { apiFetch } = useApi()
const customers = ref<Customer[]>([])
const total = ref(0)
const page = ref(1)
const summary = ref<DashboardSummary | null>(null)
const smsQuota = ref<SmsQuota | null>(null)
const loading = ref(true)
const loadError = ref(false)

const search = ref('')
// Typed as AppSelect's own model type rather than plain string -- it emits
// `string | number | null` for the generic option list it accepts.
const segment = ref<string | number | null>('')
const sort = ref<string | number | null>('recent')

const SEGMENT_OPTIONS = [
  { value: '', label: 'همه مشتریان' },
  { value: 'new', label: 'مشتری جدید' },
  { value: 'returning', label: 'مشتری وفادار' },
  { value: 'lapsed', label: 'مدتی است نیامده' },
]
const SORT_OPTIONS = [
  { value: 'recent', label: 'آخرین مراجعه' },
  { value: 'bookings', label: 'بیشترین نوبت' },
  { value: 'value', label: 'بیشترین ارزش' },
  { value: 'name', label: 'نام' },
]

/**
 * Monotonic request id. Typing in the search box fires overlapping requests and they can
 * come back out of order -- without this, a slow response for "مر" can land after the fast
 * one for "مریم" and repaint the table with the wrong (older) results while the box still
 * reads "مریم". Every response checks that it is still the newest before touching state.
 */
let requestSeq = 0

async function loadCustomers() {
  const seq = ++requestSeq
  loading.value = true
  loadError.value = false

  const params = new URLSearchParams({
    page: String(page.value),
    pageSize: String(PAGE_SIZE),
    sort: String(sort.value ?? 'recent'),
  })
  if (search.value.trim()) params.set('q', search.value.trim())
  if (segment.value) params.set('segment', String(segment.value))

  const { data, error } = await apiFetch<CustomerPage>(`/salons/mine/customers?${params}`, { silent: true })
  if (seq !== requestSeq) return

  if (error) {
    loadError.value = true
    loading.value = false
    return
  }
  customers.value = data?.items ?? []
  total.value = data?.total ?? 0
  loading.value = false
}

// The summary and quota don't depend on any filter, so they're fetched once rather than on
// every keystroke -- refiltering the list must not re-fetch (or re-render) the KPI tiles.
async function loadHeader() {
  const [summaryRes, quotaRes] = await Promise.all([
    apiFetch<DashboardSummary>('/salons/mine/dashboard-summary', { silent: true }),
    apiFetch<SmsQuota>('/salons/mine/sms-quota', { silent: true }),
  ])
  summary.value = summaryRes.data
  smsQuota.value = quotaRes.data
}

async function load() {
  await Promise.all([loadHeader(), loadCustomers()])
}
onMounted(load)

const runSearch = debounce(() => {
  page.value = 1
  void loadCustomers()
}, 300)
watch(search, runSearch)

// Changing a dropdown is a deliberate act, not a keystroke -- applied immediately, and
// always back to page 1 so the user can't land on an out-of-range page of a smaller result.
watch([segment, sort], () => {
  page.value = 1
  void loadCustomers()
})

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const rangeStart = computed(() => (total.value === 0 ? 0 : (page.value - 1) * PAGE_SIZE + 1))
const rangeEnd = computed(() => Math.min(page.value * PAGE_SIZE, total.value))
const isFiltered = computed(() => search.value.trim() !== '' || Boolean(segment.value))

function goToPage(next: number) {
  if (next < 1 || next > totalPages.value) return
  page.value = next
  void loadCustomers()
}

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

    <div v-if="summary" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <AppCard class="bg-(--color-surface-subtle)">
        <p class="text-xs text-(--color-text-muted)">ارزش ناخالص نوبت‌ها (۳۰ روز اخیر)</p>
        <p class="mt-1 break-words text-lg font-bold text-(--color-text)"><span dir="ltr" class="tnum">{{ formatToman(summary.grossBookingValue) }}</span> تومان</p>
      </AppCard>
      <AppCard class="bg-(--color-surface-subtle)">
        <!-- "دریافتی آنلاین" alone read as total revenue. What the platform actually
             captures online is the deposit; the rest is cash paid to the salon and is
             invisible here. -->
        <p class="text-xs text-(--color-text-muted)">بیعانهٔ آنلاین دریافتی</p>
        <p class="mt-1 break-words text-lg font-bold text-(--color-text)"><span dir="ltr" class="tnum">{{ formatToman(summary.onlineCollected) }}</span> تومان</p>
        <p class="mt-1 text-xs text-(--color-text-muted)">فقط بیعانهٔ پرداخت‌شده در سایت — مبلغ نقدی دریافتی در سالن در این رقم نیست.</p>
      </AppCard>
      <AppCard class="bg-(--color-surface-subtle)">
        <p class="text-xs text-(--color-text-muted)">کارمزد پلتفرم</p>
        <p class="mt-1 break-words text-lg font-bold text-(--color-text-muted)"><span dir="ltr" class="tnum">{{ formatToman(summary.commission) }}</span> تومان</p>
      </AppCard>
      <AppCard class="bg-(--color-surface-subtle)">
        <p class="text-xs text-(--color-text-muted)">درآمد تخمینی سالن</p>
        <p class="mt-1 break-words text-lg font-bold text-(--tone-success-text)"><span dir="ltr" class="tnum">{{ formatToman(summary.estimatedSalonRevenue) }}</span> تومان</p>
        <p class="mt-1 text-xs text-(--color-text-muted)">تخمینی — بخش نقدی هرگز توسط پلتفرم مشاهده نمی‌شود.</p>
      </AppCard>
    </div>

    <!-- Filters stay mounted while the list reloads: hiding them behind the spinner would
         steal focus from the search box mid-typing. -->
    <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <div class="lg:col-span-2">
        <AppInput v-model="search" data-testid="customer-search" icon="customers" placeholder="جستجوی نام یا شماره تماس" />
      </div>
      <AppSelect
        v-model="segment"
        :options="SEGMENT_OPTIONS"
        :searchable="false"
        aria-label="فیلتر وضعیت مشتری"
        data-testid="customer-segment-filter"
      />
      <AppSelect v-model="sort" :options="SORT_OPTIONS" :searchable="false" aria-label="ترتیب نمایش" data-testid="customer-sort" />
    </div>

    <div v-if="loading" class="flex items-center justify-center py-14 text-(--color-text-muted)">
      <AppIcon name="spinner" :size="20" class="animate-spin" />
    </div>

    <div v-else-if="loadError" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">اطلاعات مشتریان بارگذاری نشد.</p>
      <!-- Retries the header too: if the list failed, the summary/quota fetches most likely
           failed for the same reason, and there is no other control that would refetch them. -->
      <AppButton variant="secondary" data-testid="retry-customers" @click="load">تلاش دوباره</AppButton>
    </div>

    <template v-else>
      <!-- Two different empty states: "you have no customers" is a milestone, "your filter
           matched nothing" is a dead end the user needs to be able to back out of. -->
      <EmptyState
        v-if="customers.length === 0 && !isFiltered"
        icon="customers"
        message="هنوز مشتری‌ای برای این سالن ثبت نشده است."
      />
      <div
        v-else-if="customers.length === 0"
        data-testid="no-results"
        class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-6 text-center"
      >
        <p class="text-sm text-(--color-text-muted)">مشتری‌ای با این جستجو پیدا نشد.</p>
        <AppButton variant="secondary" data-testid="clear-filters" @click="search = ''; segment = ''">حذف فیلترها</AppButton>
      </div>

      <AppCard v-else :padded="false" class="overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-right text-sm">
            <thead>
              <tr class="border-b border-(--color-border) bg-(--color-border-soft) text-xs text-(--color-text-muted)">
                <th scope="col" class="px-4 py-3 font-semibold">مشتری</th>
                <!-- Both counts are shown because they answer different questions and used
                     to be conflated under a bare "تعداد نوبت": the first includes upcoming
                     and cancelled bookings, the second is only appointments that happened. -->
                <th scope="col" class="px-4 py-3 font-semibold">کل نوبت‌ها</th>
                <th scope="col" class="px-4 py-3 font-semibold">مراجعه‌های انجام‌شده</th>
                <th scope="col" class="px-4 py-3 font-semibold">اولین مراجعه</th>
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
                <td class="tnum px-4 py-3 text-(--color-text-muted)">{{ c.visitsCount.toLocaleString('fa-IR') }}</td>
                <td class="tnum px-4 py-3 text-(--color-text-muted)">{{ formatDate(c.firstVisitAt) }}</td>
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

      <div v-if="total > 0" class="flex flex-wrap items-center justify-between gap-3">
        <p data-testid="customer-range" class="text-xs text-(--color-text-muted)">
          نمایش <span dir="ltr" class="tnum">{{ rangeStart }}</span>–<span dir="ltr" class="tnum">{{ rangeEnd }}</span>
          از <span dir="ltr" class="tnum">{{ total }}</span> مشتری
        </p>
        <div v-if="totalPages > 1" class="flex items-center gap-2">
          <AppButton variant="secondary" data-testid="prev-page" :disabled="page <= 1" @click="goToPage(page - 1)">قبلی</AppButton>
          <span class="tnum text-xs text-(--color-text-muted)">صفحه {{ page }} از {{ totalPages }}</span>
          <AppButton variant="secondary" data-testid="next-page" :disabled="page >= totalPages" @click="goToPage(page + 1)">بعدی</AppButton>
        </div>
      </div>
    </template>
  </div>
</template>
