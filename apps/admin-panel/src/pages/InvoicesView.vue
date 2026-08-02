<!-- apps/admin-panel/src/pages/InvoicesView.vue -->
<!-- Monthly per-salon settlement statements (financial_transactions -> invoice_items ->
     invoices). This is NOT the platform billing the salon -- the platform holds deposits
     it collected on the salon's behalf; totalNetPayable is what it owes back. "Record
     payment" means an admin already bank-transferred that amount and is logging it, not
     initiating a transfer (see InvoiceStatusActions.vue). List/filter/paginate shape
     mirrors WalletView.vue exactly. -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Pagination from '@/components/ui/Pagination.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import InvoiceStatusActions from '@/components/invoices/InvoiceStatusActions.vue'
import { invoiceStatusLabel, invoicePaymentMethodLabel, jalaliMonthLabel } from '@/utils/labels'

type InvoiceStatus = 'issued' | 'partially_paid' | 'paid' | 'void'

interface InvoiceRow {
  id: string
  salonId: string
  salonName: string
  jalaliYear: number
  jalaliMonth: number
  totalGrossAmount: number
  totalCommissionAmount: number
  totalNetPayable: number
  paidTotal: number
  status: InvoiceStatus
}

interface InvoiceListResponse {
  items: InvoiceRow[]
  total: number
  page: number
  pageSize: number
}

interface InvoiceItemRow {
  id: string
  grossAmount: number
  commissionAmount: number
  netAmount: number
  createdAt: string
}

interface InvoicePaymentRow {
  id: string
  amount: number
  method: string
  referenceNumber: string | null
  note: string | null
  createdAt: string
}

const STATUS_OPTIONS = [
  { value: '', label: 'همه وضعیت‌ها' },
  { value: 'issued', label: 'صادرشده' },
  { value: 'partially_paid', label: 'پرداخت جزئی' },
  { value: 'paid', label: 'پرداخت‌شده' },
  { value: 'void', label: 'باطل‌شده' },
]

const { apiFetch } = useApi()
const invoices = ref<InvoiceRow[]>([])
const loading = ref(true)
const page = ref(1)
const total = ref(0)
const pageSize = 20
const statusFilter = ref<'' | InvoiceStatus>('')

async function load() {
  loading.value = true
  const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) })
  if (statusFilter.value) params.set('status', statusFilter.value)

  const { data } = await apiFetch<InvoiceListResponse>(`/admin/invoices?${params.toString()}`, { silent: true })
  invoices.value = data?.items ?? []
  total.value = data?.total ?? 0
  loading.value = false
}

function loadFromFilterChange() {
  if (page.value !== 1) page.value = 1
  else load()
}

onMounted(load)
watch(statusFilter, loadFromFilterChange)
watch(page, load)

function toman(n: number): string {
  return `${n.toLocaleString('fa-IR')} تومان`
}

const hasActiveFilters = computed(() => !!statusFilter.value)
function clearFilters() {
  statusFilter.value = ''
}

// Expanded row detail -- one invoice open at a time, fetched on demand rather than
// bundled into the list response (items/payments are only ever needed once an admin
// actually wants to look).
const expandedId = ref<string | null>(null)
const detailItems = ref<InvoiceItemRow[]>([])
const detailPayments = ref<InvoicePaymentRow[]>([])
const detailLoading = ref(false)

async function loadDetail(invoiceId: string) {
  detailLoading.value = true
  const [itemsRes, paymentsRes] = await Promise.all([
    apiFetch<{ items: InvoiceItemRow[] }>(`/admin/invoices/${invoiceId}`, { silent: true }),
    apiFetch<InvoicePaymentRow[]>(`/admin/invoices/${invoiceId}/payments`, { silent: true }),
  ])
  detailItems.value = itemsRes.data?.items ?? []
  detailPayments.value = paymentsRes.data ?? []
  detailLoading.value = false
}

function toggleExpand(invoice: InvoiceRow) {
  if (expandedId.value === invoice.id) {
    expandedId.value = null
    return
  }
  expandedId.value = invoice.id
  loadDetail(invoice.id)
}

// Refreshes both the row (new totals/status) and the still-open detail panel (the new
// payment row) -- expandedId is already this invoice's id, so no toggling needed.
async function onPaymentRecorded(invoiceId: string) {
  await Promise.all([load(), loadDetail(invoiceId)])
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso))
}
</script>

<template>
  <div class="space-y-5 p-8">
    <AppCard>
      <div class="flex flex-wrap items-end gap-3">
        <AppSelect v-model="statusFilter" label="وضعیت" :options="STATUS_OPTIONS" width="10rem" />
        <AppButton v-if="hasActiveFilters" type="button" variant="ghost" @click="clearFilters">
          <template #icon><AppIcon name="reset" :size="15" /></template>
          پاک‌کردن فیلترها
        </AppButton>
      </div>
    </AppCard>

    <EmptyState v-if="!loading && invoices.length === 0" icon="invoice" message="هنوز صورتحسابی صادر نشده است." />

    <AppCard v-else :padded="false" class="overflow-hidden">
      <div class="relative">
        <div
          v-if="loading"
          data-testid="table-loading"
          class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-(--color-surface-card)/70"
        >
          <AppIcon name="spinner" :size="22" class="animate-spin text-(--color-text-muted)" />
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-right text-sm transition-opacity" :class="{ 'opacity-50': loading }">
            <thead>
              <tr class="border-b border-(--color-border) bg-(--color-border-soft) text-xs text-(--color-text-muted)">
                <th scope="col" class="px-5 py-3 font-semibold">سالن</th>
                <th scope="col" class="px-5 py-3 font-semibold">دوره</th>
                <th scope="col" class="px-5 py-3 font-semibold">مبلغ ناخالص</th>
                <th scope="col" class="px-5 py-3 font-semibold">کارمزد پلتفرم</th>
                <th scope="col" class="px-5 py-3 font-semibold">خالص قابل‌پرداخت</th>
                <th scope="col" class="px-5 py-3 font-semibold">پرداخت‌شده</th>
                <th scope="col" class="px-5 py-3 font-semibold">وضعیت</th>
                <th scope="col" class="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="invoice in invoices" :key="invoice.id">
                <tr class="border-b border-(--color-border-soft) transition-colors last:border-0 hover:bg-(--color-border-soft)">
                  <td class="px-5 py-3.5 font-semibold text-(--color-text)">{{ invoice.salonName }}</td>
                  <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ jalaliMonthLabel(invoice.jalaliYear, invoice.jalaliMonth) }}</td>
                  <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ toman(invoice.totalGrossAmount) }}</td>
                  <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ toman(invoice.totalCommissionAmount) }}</td>
                  <td class="tnum px-5 py-3.5 font-semibold text-(--color-text)">{{ toman(invoice.totalNetPayable) }}</td>
                  <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ toman(invoice.paidTotal) }}</td>
                  <td class="px-5 py-3.5">
                    <StatusBadge :label="invoiceStatusLabel(invoice.status).label" :tone="invoiceStatusLabel(invoice.status).tone" />
                  </td>
                  <td class="px-5 py-3.5">
                    <AppButton
                      type="button"
                      variant="secondary"
                      data-testid="toggle-invoice-detail"
                      :title="expandedId === invoice.id ? 'بستن جزئیات' : 'مشاهده جزئیات'"
                      :aria-label="expandedId === invoice.id ? 'بستن جزئیات' : 'مشاهده جزئیات'"
                      @click="toggleExpand(invoice)"
                    >
                      <template #icon>
                        <AppIcon :name="expandedId === invoice.id ? 'chevron-left' : 'chevron-right'" :size="15" />
                      </template>
                    </AppButton>
                  </td>
                </tr>
                <tr v-if="expandedId === invoice.id" data-testid="invoice-detail-row">
                  <td colspan="8" class="border-b border-(--color-border-soft) bg-(--color-border-soft)/40 px-5 py-4">
                    <p v-if="detailLoading" class="flex items-center gap-2 text-sm text-(--color-text-muted)">
                      <AppIcon name="spinner" :size="16" class="animate-spin" />
                      در حال بارگذاری...
                    </p>
                    <div v-else class="space-y-4">
                      <div>
                        <p class="mb-2 text-xs font-semibold text-(--color-text-muted)">اقلام این صورتحساب ({{ detailItems.length }} رزرو)</p>
                        <ul v-if="detailItems.length" class="tnum space-y-1 text-xs text-(--color-text-muted)">
                          <li v-for="item in detailItems" :key="item.id">
                            {{ formatDateTime(item.createdAt) }} — ناخالص {{ toman(item.grossAmount) }}، کارمزد {{ toman(item.commissionAmount) }}، خالص {{ toman(item.netAmount) }}
                          </li>
                        </ul>
                        <p v-else class="text-xs text-(--color-text-muted)">موردی ثبت نشده است.</p>
                      </div>

                      <div v-if="detailPayments.length">
                        <p class="mb-2 text-xs font-semibold text-(--color-text-muted)">پرداخت‌های ثبت‌شده</p>
                        <ul class="tnum space-y-1 text-xs text-(--color-text-muted)">
                          <li v-for="payment in detailPayments" :key="payment.id">
                            {{ formatDateTime(payment.createdAt) }} — {{ toman(payment.amount) }} ({{ invoicePaymentMethodLabel(payment.method) }})
                            <span v-if="payment.referenceNumber">— پیگیری: {{ payment.referenceNumber }}</span>
                            <span v-if="payment.note">— {{ payment.note }}</span>
                          </li>
                        </ul>
                      </div>

                      <InvoiceStatusActions
                        :invoice-id="invoice.id"
                        :status="invoice.status"
                        @recorded="onPaymentRecorded(invoice.id)"
                      />
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="(p) => (page = p)" />
      </div>
    </AppCard>
  </div>
</template>
