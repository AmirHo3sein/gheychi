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
import { formatNumber, toPersianDigits } from '@/utils/digits'

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

// ---- «مشتریان غیرفعال» highlight -------------------------------------------------
// The server's own `lapsed` segment (no visit for LAPSED_AFTER_DAYS = 60, crm.service.ts).
// Deliberately ONE-TO-ONE only: a call link, or opening that customer's page to write a
// single SMS within the monthly quota. There is NO bulk / segment / promotional send here,
// and there must not be one until a per-customer marketing-consent model exists (consent
// timestamp, opt-out, suppression) -- the data model today has none, so a "message all
// lapsed customers" button would be unsolicited marketing SMS.
const LAPSED_PREVIEW_SIZE = 3
const lapsed = ref<Customer[]>([])
const lapsedTotal = ref(0)

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
  const lapsedParams = new URLSearchParams({ segment: 'lapsed', sort: 'recent', page: '1', pageSize: String(LAPSED_PREVIEW_SIZE) })
  const [summaryRes, quotaRes, lapsedRes] = await Promise.all([
    apiFetch<DashboardSummary>('/salons/mine/dashboard-summary', { silent: true }),
    apiFetch<SmsQuota>('/salons/mine/sms-quota', { silent: true }),
    // Silent and optional: a failure only hides the highlight card.
    apiFetch<CustomerPage>(`/salons/mine/customers?${lapsedParams}`, { silent: true }),
  ])
  summary.value = summaryRes.data
  smsQuota.value = quotaRes.data
  lapsed.value = lapsedRes.data?.items ?? []
  lapsedTotal.value = lapsedRes.data?.total ?? 0
}

function showAllLapsed() {
  search.value = ''
  segment.value = 'lapsed'
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
  return new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso))
}
</script>

<template>
  <div class="mx-auto w-full max-w-6xl space-y-4 p-4 lg:p-6">
    <div class="flex flex-wrap items-end justify-between gap-2">
      <h1 class="text-lg font-bold text-(--color-text)">مشتریان</h1>
      <p v-if="smsQuota" data-testid="sms-quota-summary" class="text-xs text-(--color-text-muted)">
        پیامک این ماه: <span class="tnum">{{ formatNumber(smsQuota.remaining) }}</span> از <span class="tnum">{{ formatNumber(smsQuota.quota) }}</span> باقی مانده
      </p>
    </div>

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


    <!-- One-to-one win-back prompts only -- see LAPSED_PREVIEW_SIZE's comment (no bulk SMS). -->
    <section
      v-if="lapsedTotal > 0"
      data-testid="lapsed-customers-card"
      aria-labelledby="lapsed-customers-title"
      class="rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-4 shadow-(--shadow-sm)"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 id="lapsed-customers-title" class="flex items-center gap-2 text-base font-bold text-(--color-text)">
            مشتریان غیرفعال
            <span class="tnum rounded-full bg-(--tone-warning-bg) px-2 py-0.5 text-xs font-semibold text-(--tone-warning-text)" data-testid="lapsed-total">
              {{ formatNumber(lapsedTotal) }}
            </span>
          </h2>
          <p class="mt-0.5 text-xs leading-5 text-(--color-text-muted)">
            بیش از ۶۰ روز است که مراجعه نکرده‌اند. با یک تماس یا پیامک شخصی جویای حالشان شوید.
          </p>
        </div>
        <AppButton variant="secondary" size="sm" touch data-testid="show-all-lapsed" @click="showAllLapsed">
          نمایش همه در فهرست
        </AppButton>
      </div>

      <ul class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <li
          v-for="c in lapsed"
          :key="c.userId"
          data-testid="lapsed-customer"
          class="flex flex-col gap-2 rounded-xl border border-(--color-border-soft) bg-(--color-surface) p-3"
        >
          <div class="min-w-0">
            <RouterLink :to="`/customers/${c.userId}`" class="inline-flex min-h-10 items-center break-words text-sm font-semibold text-(--color-accent-text) hover:underline">
              {{ c.name || 'بدون نام' }}
            </RouterLink>
            <p class="tnum text-xs text-(--color-text-muted)">آخرین مراجعه: {{ formatDate(c.lastVisitAt) }}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <a
              :href="`tel:${c.phone}`"
              :aria-label="`تماس با ${c.name || c.phone}`"
              data-testid="lapsed-call"
              class="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-(--color-border-control) px-3 text-xs font-semibold text-(--color-text) hover:bg-(--color-surface-subtle)"
            >
              <AppIcon name="phone" :size="14" />
              تماس
            </a>
            <!-- Opens the customer page with the single-SMS composer focused; the send itself
                 stays there, quota-checked by the server as before. -->
            <RouterLink
              v-if="!smsQuota || smsQuota.remaining > 0"
              :to="{ path: `/customers/${c.userId}`, query: { compose: 'sms' } }"
              :aria-label="`نوشتن پیامک برای ${c.name || c.phone}`"
              data-testid="lapsed-sms"
              class="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-(--color-border-control) px-3 text-xs font-semibold text-(--color-text) hover:bg-(--color-surface-subtle)"
            >
              پیامک
            </RouterLink>
          </div>
        </li>
      </ul>
      <p v-if="smsQuota && smsQuota.remaining <= 0" data-testid="lapsed-sms-exhausted" class="mt-2 text-xs text-(--color-text-muted)">
        سهمیهٔ پیامک این ماه تمام شده است؛ تماس تلفنی همچنان در دسترس است.
      </p>
    </section>

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
        mascot="happy"
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
          <!-- One markup, two layouts: below md each <tr> is a stacked block whose cells print their
               own column name (data-label); from md up it is the plain table. The explicit
               ARIA roles keep table semantics for assistive tech while display:block would
               otherwise drop them. -->
          <table role="table" class="block w-full text-right text-sm md:table">
            <thead role="rowgroup" class="hidden md:table-header-group">
              <tr role="row" class="border-b border-(--color-border) bg-(--color-border-soft) text-xs text-(--color-text-muted)">
                <th role="columnheader" scope="col" class="px-4 py-3 font-semibold">مشتری</th>
                <!-- Both counts are shown because they answer different questions and used
                     to be conflated under a bare "تعداد نوبت": the first includes upcoming
                     and cancelled bookings, the second is only appointments that happened. -->
                <th role="columnheader" scope="col" class="px-4 py-3 font-semibold">کل نوبت‌ها</th>
                <th role="columnheader" scope="col" class="px-4 py-3 font-semibold">مراجعه‌های انجام‌شده</th>
                <th role="columnheader" scope="col" class="px-4 py-3 font-semibold">اولین مراجعه</th>
                <th role="columnheader" scope="col" class="px-4 py-3 font-semibold">آخرین مراجعه</th>
                <th role="columnheader" scope="col" class="px-4 py-3 font-semibold">ارزش کل</th>
                <th role="columnheader" scope="col" class="px-4 py-3 font-semibold">وضعیت</th>
              </tr>
            </thead>
            <tbody role="rowgroup" class="block md:table-row-group">
              <tr
                v-for="c in customers"
                :key="c.userId"
                data-testid="customer-row"
                role="row"
                class="block border-b border-(--color-border-soft) p-4 last:border-0 md:table-row md:p-0"
              >
                <td role="cell" class="block py-1 md:table-cell md:px-4 md:py-3">
                  <RouterLink :to="`/customers/${c.userId}`" class="inline-flex min-h-10 items-center font-semibold text-(--color-accent-text) hover:underline">
                    {{ c.name || 'بدون نام' }}
                  </RouterLink>
                  <p dir="ltr" class="tnum text-xs text-(--color-text-muted)">{{ toPersianDigits(c.phone) }}</p>
                </td>
                <td role="cell" data-label="کل نوبت‌ها" class="flex items-center justify-between gap-3 py-1 before:text-xs before:text-(--color-text-muted) before:content-[attr(data-label)] md:table-cell md:px-4 md:py-3 md:before:content-none tnum text-(--color-text-muted)">{{ c.bookingsCount.toLocaleString('fa-IR') }}</td>
                <td role="cell" data-label="مراجعه‌های انجام‌شده" class="flex items-center justify-between gap-3 py-1 before:text-xs before:text-(--color-text-muted) before:content-[attr(data-label)] md:table-cell md:px-4 md:py-3 md:before:content-none tnum text-(--color-text-muted)">{{ c.visitsCount.toLocaleString('fa-IR') }}</td>
                <td role="cell" data-label="اولین مراجعه" class="flex items-center justify-between gap-3 py-1 before:text-xs before:text-(--color-text-muted) before:content-[attr(data-label)] md:table-cell md:px-4 md:py-3 md:before:content-none tnum text-(--color-text-muted)">{{ formatDate(c.firstVisitAt) }}</td>
                <td role="cell" data-label="آخرین مراجعه" class="flex items-center justify-between gap-3 py-1 before:text-xs before:text-(--color-text-muted) before:content-[attr(data-label)] md:table-cell md:px-4 md:py-3 md:before:content-none tnum text-(--color-text-muted)">{{ formatDate(c.lastVisitAt) }}</td>
                <td role="cell" data-label="ارزش کل" class="flex items-center justify-between gap-3 py-1 before:text-xs before:text-(--color-text-muted) before:content-[attr(data-label)] md:table-cell md:px-4 md:py-3 md:before:content-none text-(--color-text-muted)"><span><span dir="ltr" class="tnum">{{ formatToman(c.grossValue) }}</span> تومان</span></td>
                <td role="cell" data-label="وضعیت" class="flex items-center justify-between gap-3 py-1 before:text-xs before:text-(--color-text-muted) before:content-[attr(data-label)] md:table-cell md:px-4 md:py-3 md:before:content-none">
                  <StatusBadge :label="customerSegmentLabel(c.segment).label" :tone="customerSegmentLabel(c.segment).tone" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </AppCard>

      <div v-if="total > 0" class="flex flex-wrap items-center justify-between gap-3">
        <p data-testid="customer-range" class="text-xs text-(--color-text-muted)">
          نمایش <span class="tnum">{{ formatNumber(rangeStart) }}</span>–<span class="tnum">{{ formatNumber(rangeEnd) }}</span>
          از <span class="tnum">{{ formatNumber(total) }}</span> مشتری
        </p>
        <div v-if="totalPages > 1" class="flex items-center gap-2">
          <AppButton variant="secondary" data-testid="prev-page" :disabled="page <= 1" @click="goToPage(page - 1)">قبلی</AppButton>
          <span class="tnum text-xs text-(--color-text-muted)">صفحه {{ formatNumber(page) }} از {{ formatNumber(totalPages) }}</span>
          <AppButton variant="secondary" data-testid="next-page" :disabled="page >= totalPages" @click="goToPage(page + 1)">بعدی</AppButton>
        </div>
      </div>
    </template>
  </div>
</template>
