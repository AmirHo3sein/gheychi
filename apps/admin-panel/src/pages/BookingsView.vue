<!-- apps/admin-panel/src/pages/BookingsView.vue -->
<!-- The booking browser: the way an operator actually FINDS a booking. Before this page
     existed, BookingTimelineView (routed at /bookings/:id) was reachable only by pasting a
     UUID obtained outside the product, which made handling a dispute or chasing a stuck
     refund effectively impossible. Every row here links into that timeline.

     Read-only, deliberately and permanently -- GET /admin/bookings is the only admin
     booking route, because every transition is guarded by invariants in the backend's
     booking state machine that a generic admin write would bypass. Nothing on this page
     should ever grow an action button. -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useApi } from '@/composables/useApi'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'
import Pagination from '@/components/ui/Pagination.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { debounce } from '@/utils/debounce'
import { formatToman } from '@/utils/format-toman'
import {
  bookingAttributionSourceLabel,
  bookingConfirmationModeLabel,
  bookingSourceLabel,
  bookingStatusLabel,
  paymentStatusLabel,
} from '@/utils/labels'

interface BookingPayment {
  status: string
  amount: number
  paidAt: string | null
  refundRequestedAt: string | null
  refundedAt: string | null
  refundRefId: string | null
}

interface BookingRow {
  id: string
  startsAt: string
  endsAt: string
  status: string
  confirmationMode: string
  source: string
  attributionSource: string | null
  priceSnapshot: number
  depositAmount: number
  createdAt: string
  salonId: string
  salonName: string | null
  serviceId: string
  serviceName: string | null
  workerId: string | null
  workerName: string | null
  userId: string
  customerName: string | null
  customerPhone: string | null
  // Null means the booking has NO payment row at all (a pending_approval request, a
  // zero-deposit booking, an offline-payment one) -- a real state, not missing data, and
  // rendered as "—" rather than as a zero that would read as "paid nothing".
  payment: BookingPayment | null
  commissionAmount: number | null
}

interface BookingListResponse {
  items: BookingRow[]
  total: number
  page: number
  pageSize: number
}

const STATUS_OPTIONS = [
  { value: '', label: 'همه وضعیت‌ها' },
  { value: 'pending_approval', label: 'در انتظار تایید آرایشگاه' },
  { value: 'pending_payment', label: 'در انتظار پرداخت' },
  { value: 'confirmed', label: 'تایید شده' },
  { value: 'completed', label: 'انجام شده' },
  { value: 'cancelled_by_user', label: 'لغو شده توسط مشتری' },
  { value: 'cancelled_by_salon', label: 'لغو شده توسط آرایشگاه' },
  { value: 'rejected_by_salon', label: 'رد شده توسط آرایشگاه' },
  { value: 'expired', label: 'منقضی شده' },
  { value: 'no_show', label: 'عدم حضور' },
]
const PAYMENT_STATUS_OPTIONS = [
  { value: '', label: 'همه پرداخت‌ها' },
  { value: 'initiated', label: 'در انتظار پرداخت' },
  { value: 'paid', label: 'پرداخت‌شده' },
  { value: 'refund_pending', label: 'در انتظار استرداد' },
  { value: 'refunded', label: 'مسترد شده' },
  { value: 'failed', label: 'ناموفق' },
]
const SOURCE_OPTIONS = [
  { value: '', label: 'همه منابع' },
  { value: 'online', label: 'رزرو آنلاین' },
  { value: 'manual', label: 'ثبت توسط آرایشگاه' },
]
const MODE_OPTIONS = [
  { value: '', label: 'همه حالت‌ها' },
  { value: 'automatic', label: 'تایید خودکار' },
  { value: 'manual_approval', label: 'تایید دستی آرایشگاه' },
]

// The backend validates salonId/userId as real UUIDs and 400s anything else, so a
// half-typed id must not be sent at all -- otherwise every keystroke of a pasted id would
// paint the error state before the paste finishes.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const route = useRoute()
const { apiFetch } = useApi()
const bookings = ref<BookingRow[]>([])
const loading = ref(true)
// A fetch failure must not be silently repainted as an empty list -- see SalonsView.vue's
// identical loadError pattern. Here it matters even more: "no bookings match" is a
// conclusion an operator would act on while investigating a dispute.
const loadError = ref(false)
const page = ref(1)
const total = ref(0)
const pageSize = 20

const statusFilter = ref('')
const paymentStatusFilter = ref('')
const sourceFilter = ref('')
const modeFilter = ref('')
// Pre-filled from the query string so another screen can deep-link straight into this
// salon's (or customer's) bookings, e.g. /bookings?salonId=<id>.
const salonIdFilter = ref(typeof route.query.salonId === 'string' ? route.query.salonId : '')
const userIdFilter = ref(typeof route.query.userId === 'string' ? route.query.userId : '')
const fromFilter = ref('')
const toFilter = ref('')

// Guards against out-of-order responses: the debounced id filters and the immediate
// select/date filters can both call load() in quick succession, and a slower earlier
// request could resolve after a faster later one. Only the response matching the latest
// request id is committed; anything stale is dropped silently. (UsersView.vue's pattern.)
const requestId = ref(0)

async function load() {
  loading.value = true
  loadError.value = false
  const currentRequestId = ++requestId.value

  const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) })
  if (statusFilter.value) params.set('status', statusFilter.value)
  if (paymentStatusFilter.value) params.set('paymentStatus', paymentStatusFilter.value)
  if (sourceFilter.value) params.set('source', sourceFilter.value)
  if (modeFilter.value) params.set('confirmationMode', modeFilter.value)
  if (UUID_RE.test(salonIdFilter.value.trim())) params.set('salonId', salonIdFilter.value.trim())
  if (UUID_RE.test(userIdFilter.value.trim())) params.set('userId', userIdFilter.value.trim())
  // Both bounds are anchored in LOCAL time -- `new Date('YYYY-MM-DD')` alone parses as UTC
  // midnight and would silently drop 00:00-03:29 local appointments on the from-day
  // (UTC+3:30). Same handling as UsersView.vue's joined-date range.
  if (fromFilter.value) params.set('from', new Date(`${fromFilter.value}T00:00:00.000`).toISOString())
  if (toFilter.value) params.set('to', new Date(`${toFilter.value}T23:59:59.999`).toISOString())

  const { data, error } = await apiFetch<BookingListResponse>(`/admin/bookings?${params.toString()}`, { silent: true })
  if (currentRequestId !== requestId.value) return
  if (error) {
    loadError.value = true
    bookings.value = []
    total.value = 0
  } else {
    bookings.value = data?.items ?? []
    total.value = data?.total ?? 0
  }
  loading.value = false
}

function loadFromFilterChange() {
  // Any filter change invalidates the current page position. When we're past page 1, just
  // reset it -- the page watcher below triggers the (single) reload; calling load() here
  // too would fire a redundant concurrent second request.
  if (page.value !== 1) page.value = 1
  else load()
}

function clearFilters() {
  statusFilter.value = ''
  paymentStatusFilter.value = ''
  sourceFilter.value = ''
  modeFilter.value = ''
  salonIdFilter.value = ''
  userIdFilter.value = ''
  fromFilter.value = ''
  toFilter.value = ''
}

const hasActiveFilters = computed(
  () =>
    !!statusFilter.value ||
    !!paymentStatusFilter.value ||
    !!sourceFilter.value ||
    !!modeFilter.value ||
    !!salonIdFilter.value ||
    !!userIdFilter.value ||
    !!fromFilter.value ||
    !!toFilter.value,
)

// Minute precision (not the timeline's second precision): this is an appointment time, and
// two bookings never need their ordering disambiguated to the second here.
function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

function toman(amount: number): string {
  return `${formatToman(amount)} تومان`
}

onMounted(load)
watch([salonIdFilter, userIdFilter], debounce(loadFromFilterChange, 350))
watch([statusFilter, paymentStatusFilter, sourceFilter, modeFilter, fromFilter, toFilter], loadFromFilterChange)
watch(page, load)
</script>

<template>
  <div class="space-y-5 p-8">
    <AppCard :padded="false" class="p-4">
      <div class="flex flex-wrap items-end gap-3">
        <AppSelect v-model="statusFilter" :options="STATUS_OPTIONS" label="وضعیت رزرو" width="13rem" />
        <div data-testid="payment-status-filter">
          <AppSelect v-model="paymentStatusFilter" :options="PAYMENT_STATUS_OPTIONS" label="وضعیت پرداخت" width="12rem" />
        </div>
        <AppSelect v-model="sourceFilter" :options="SOURCE_OPTIONS" label="منبع ثبت" width="11rem" />
        <AppSelect v-model="modeFilter" :options="MODE_OPTIONS" label="حالت تایید" width="11rem" />
        <div class="w-56">
          <AppInput v-model="salonIdFilter" label="شناسه آرایشگاه" placeholder="UUID" />
        </div>
        <div class="w-56">
          <AppInput v-model="userIdFilter" label="شناسه مشتری" placeholder="UUID" />
        </div>
        <div class="min-w-0">
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">بازه زمان نوبت</label>
          <!-- Same nested wrap as UsersView.vue's date pair: the outer bar wraps, but this
               from/to pair would otherwise stay one unbreakable block and be the first
               thing to push past the card on a narrow window. -->
          <div class="flex flex-wrap items-center gap-1.5">
            <JalaliDatePicker v-model="fromFilter" placeholder="از تاریخ" aria-label="از تاریخ نوبت" class="w-40" />
            <span class="text-(--color-text-muted)">تا</span>
            <JalaliDatePicker v-model="toFilter" placeholder="تا تاریخ" aria-label="تا تاریخ نوبت" class="w-40" />
          </div>
        </div>
        <AppButton v-if="hasActiveFilters" type="button" variant="ghost" data-testid="clear-filters" @click="clearFilters">
          <template #icon><AppIcon name="reset" :size="15" /></template>
          پاک کردن فیلترها
        </AppButton>
      </div>
    </AppCard>

    <AppCard
      v-if="loadError"
      :padded="false"
      data-testid="load-error"
      role="alert"
      class="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center"
    >
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-(--tone-danger-bg) text-(--tone-danger-text)">
        <AppIcon name="warning" :size="22" />
      </div>
      <p class="text-sm text-(--color-text-muted)">خطا در دریافت فهرست رزروها.</p>
      <AppButton type="button" variant="secondary" data-testid="retry-load" @click="load">تلاش دوباره</AppButton>
    </AppCard>

    <EmptyState v-else-if="!loading && bookings.length === 0" icon="calendar" message="رزروی با این فیلترها یافت نشد." />

    <AppCard v-else :padded="false" class="overflow-hidden">
      <div class="relative">
        <div
          v-if="loading"
          data-testid="table-loading"
          class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-(--color-surface-card)/70"
        >
          <AppIcon name="spinner" :size="22" class="animate-spin text-(--color-text-muted)" />
        </div>
        <!-- The table gets its OWN horizontal scroller (CouponsView.vue's idiom): this is a
             wide table, and AppCard's overflow-hidden (there for the rounded corners) would
             CLIP the trailing columns -- including the timeline link -- rather than let the
             operator reach them. -->
        <div class="overflow-x-auto">
          <table class="w-full text-right text-sm transition-opacity" :class="{ 'opacity-50': loading }">
            <thead>
              <tr class="border-b border-(--color-border) bg-(--color-border-soft) text-xs text-(--color-text-muted)">
                <th scope="col" class="px-5 py-3 font-semibold">مشتری</th>
                <th scope="col" class="px-5 py-3 font-semibold">آرایشگاه</th>
                <th scope="col" class="px-5 py-3 font-semibold">خدمت</th>
                <th scope="col" class="px-5 py-3 font-semibold">زمان نوبت</th>
                <th scope="col" class="px-5 py-3 font-semibold">وضعیت</th>
                <th scope="col" class="px-5 py-3 font-semibold">مبلغ / پیش‌پرداخت</th>
                <th scope="col" class="px-5 py-3 font-semibold">پرداخت</th>
                <th scope="col" class="px-5 py-3 font-semibold">کارمزد</th>
                <th scope="col" class="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="booking in bookings"
                :key="booking.id"
                data-testid="booking-row"
                class="border-b border-(--color-border-soft) transition-colors last:border-0 hover:bg-(--color-border-soft)"
              >
                <td class="px-5 py-3.5">
                  <p class="font-semibold text-(--color-text)">{{ booking.customerName ?? '—' }}</p>
                  <!-- dir="ltr": a Persian-digit-free phone number reads right-to-left
                       otherwise and the leading 0 lands at the wrong end. -->
                  <p v-if="booking.customerPhone" dir="ltr" class="tnum mt-0.5 text-right text-xs text-(--color-text-muted)">
                    {{ booking.customerPhone }}
                  </p>
                </td>
                <td class="px-5 py-3.5">
                  <p class="text-(--color-text)">{{ booking.salonName ?? '—' }}</p>
                  <p class="mt-0.5 text-xs text-(--color-text-muted)">
                    {{ bookingSourceLabel(booking.source) }}
                    <template v-if="booking.attributionSource">
                      · {{ bookingAttributionSourceLabel(booking.attributionSource) }}
                    </template>
                  </p>
                </td>
                <td class="px-5 py-3.5">
                  <p class="text-(--color-text-muted)">{{ booking.serviceName ?? '—' }}</p>
                  <p v-if="booking.workerName" class="mt-0.5 text-xs text-(--color-text-muted)">{{ booking.workerName }}</p>
                </td>
                <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ formatDateTime(booking.startsAt) }}</td>
                <td class="px-5 py-3.5">
                  <StatusBadge :label="bookingStatusLabel(booking.status).label" :tone="bookingStatusLabel(booking.status).tone" />
                  <p class="mt-1 text-xs text-(--color-text-muted)">
                    {{ bookingConfirmationModeLabel(booking.confirmationMode).label }}
                  </p>
                </td>
                <td class="tnum px-5 py-3.5 text-(--color-text-muted)">
                  <p class="text-(--color-text)">{{ toman(booking.priceSnapshot) }}</p>
                  <p class="mt-0.5 text-xs">پیش‌پرداخت {{ toman(booking.depositAmount) }}</p>
                </td>
                <td class="px-5 py-3.5">
                  <template v-if="booking.payment">
                    <StatusBadge
                      :label="paymentStatusLabel(booking.payment.status).label"
                      :tone="paymentStatusLabel(booking.payment.status).tone"
                    />
                    <p class="tnum mt-1 text-xs text-(--color-text-muted)">{{ toman(booking.payment.amount) }}</p>
                  </template>
                  <!-- No payment row at all -- a real state (pending_approval never gets
                       one), so it must not render as a zero-toman payment. -->
                  <span v-else data-testid="no-payment" class="text-xs text-(--color-text-muted)">بدون پرداخت آنلاین</span>
                </td>
                <td class="tnum px-5 py-3.5 text-(--color-text-muted)">
                  {{ booking.commissionAmount === null ? '—' : toman(booking.commissionAmount) }}
                </td>
                <td class="px-5 py-3.5">
                  <RouterLink
                    :to="{ name: 'booking-timeline', params: { id: booking.id } }"
                    data-testid="timeline-link"
                    class="inline-flex items-center gap-1.5 text-xs font-semibold text-(--color-accent-text) hover:underline"
                  >
                    <AppIcon name="history" :size="14" />
                    تاریخچه
                  </RouterLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="(p) => (page = p)" />
    </AppCard>
  </div>
</template>
