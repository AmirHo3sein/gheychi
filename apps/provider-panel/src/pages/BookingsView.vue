<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect, { type SelectOption } from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import { toEnglishDigits } from '@/utils/digits'
import { bookingStatusLabel } from '@/utils/labels'
import { formatToman } from '@/utils/format-toman'
import { tehranDateString } from '@/utils/tehran-date'

interface Booking {
  id: string
  serviceId: string
  serviceName: string
  priceSnapshot: number
  startsAt: string
  status: string
  workerId: string | null
  workerName: string | null
  // A shadow account created via findOrCreateByPhone (SalonWorkersController's own
  // customer-by-phone idiom, reused for manual bookings) may never get a name -- phone
  // is the one field that's always real, since bookings.user_id always resolves to a
  // genuine users row.
  customerName: string | null
  customerPhone: string
  source: 'online' | 'manual'
}
interface Worker {
  id: string
  name: string
  active: boolean
}
interface Service {
  id: string
  name: string
}

const { apiFetch } = useApi()
const { push: pushToast } = useToast()
const bookings = ref<Booking[]>([])
const workers = ref<Worker[]>([])
const services = ref<Service[]>([])
const loading = ref(true)
const loadError = ref(false)
const submittingId = ref<string | null>(null)

async function fetchBookings(): Promise<boolean> {
  const { data, error } = await apiFetch<Booking[]>('/salons/mine/bookings', { silent: true })
  if (error) return false
  bookings.value = data ?? []
  return true
}

async function fetchWorkers(): Promise<boolean> {
  const { data, error } = await apiFetch<Worker[]>('/salons/mine/workers', { silent: true })
  if (error) return false
  workers.value = (data ?? []).filter((w) => w.active)
  return true
}

async function fetchServices(): Promise<boolean> {
  const { data, error } = await apiFetch<Service[]>('/salons/mine/services', { silent: true })
  if (error) return false
  services.value = data ?? []
  return true
}

async function loadAll() {
  loading.value = true
  loadError.value = false
  const [bookingsOk, workersOk, servicesOk] = await Promise.all([fetchBookings(), fetchWorkers(), fetchServices()])
  loadError.value = !bookingsOk || !workersOk || !servicesOk
  loading.value = false
}

onMounted(loadAll)

// Backend returns startsAt DESC (furthest-future first), which buries the next
// imminent booking under farther-future ones -- re-sort ascending so the soonest
// booking always surfaces first.
const sortedBookings = computed(() => [...bookings.value].sort((a, b) => a.startsAt.localeCompare(b.startsAt)))

// The leading empty entry is the old native <option value="">: it is what an unassigned
// booking displays, so it stays a real option rather than a placeholder. Picking it is a
// no-op, exactly as before -- assignWorker ignores an empty value.
const workerOptions = computed<SelectOption[]>(() => [
  { value: '', label: 'بدون تخصیص کارمند' },
  ...workers.value.map((w) => ({ value: w.id, label: w.name })),
])

const serviceOptions = computed<SelectOption[]>(() => services.value.map((s) => ({ value: s.id, label: s.name })))

// Deliberately no leading "بدون تخصیص کارمند" entry here (unlike workerOptions above) --
// this field's own null default already reads as "no worker chosen" via AppSelect's
// placeholder, and a selectable '' value would submit workerId: '' and fail the DTO's
// @IsUUID check (which only skips empty/undefined, not an empty string).
const manualWorkerOptions = computed<SelectOption[]>(() => workers.value.map((w) => ({ value: w.id, label: w.name })))

async function markStatus(id: string, status: 'completed' | 'no_show') {
  submittingId.value = id
  try {
    await apiFetch(`/salons/mine/bookings/${id}`, { method: 'PATCH', body: { status } })
    await fetchBookings()
  } finally {
    submittingId.value = null
  }
}

async function cancelBooking(id: string) {
  if (!confirm('لغو این نوبت ممکن است مشمول جریمه شود. ادامه می‌دهید؟')) return
  submittingId.value = id
  try {
    await apiFetch(`/bookings/${id}/cancel`, { method: 'POST' })
    await fetchBookings()
  } finally {
    submittingId.value = null
  }
}

// AppSelect emits the chosen option's raw value (or null when cleared), not a DOM event.
async function assignWorker(booking: Booking, workerId: string | number | null) {
  if (!workerId) return
  submittingId.value = booking.id
  try {
    const { data } = await apiFetch<Booking>(`/salons/mine/bookings/${booking.id}/assign-worker`, {
      method: 'PATCH',
      body: { workerId },
    })
    if (data) {
      booking.workerId = data.workerId
      booking.workerName = data.workerName
    }
  } finally {
    submittingId.value = null
  }
}
// Slot instants are real UTC (see availability.util.ts); pin the salon's own timezone rather
// than relying on the browser's, so a provider viewing from another timezone still sees the
// appointment time their salon actually operates on.
function formatBookingDateTime(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tehran',
  }).format(new Date(iso))
}

// -- Manual/offline booking: the owner recording a customer who called or walked in --

const manualForm = reactive({
  phone: '',
  name: '',
  serviceId: null as string | null,
  workerId: null as string | null,
  date: '',
  time: '09:00',
  notes: '',
})
const manualFormError = ref('')
const manualSubmitting = ref(false)

async function submitManualBooking() {
  manualFormError.value = ''
  const phone = toEnglishDigits(manualForm.phone.trim())
  if (!phone) {
    manualFormError.value = 'شماره موبایل مشتری الزامی است'
    return
  }
  if (!manualForm.serviceId) {
    manualFormError.value = 'انتخاب خدمت الزامی است'
    return
  }
  if (!manualForm.date || !manualForm.time) {
    manualFormError.value = 'تاریخ و ساعت نوبت الزامی است'
    return
  }

  // Iran's UTC offset is fixed at +03:30 (no DST since 2022) -- an explicit offset turns
  // the owner's picked wall-clock date+time directly into the real instant the server
  // expects, the same instant iranWallClockToInstant would produce for the online flow.
  const startsAt = new Date(`${manualForm.date}T${manualForm.time}:00+03:30`).toISOString()

  manualSubmitting.value = true
  const { data, error } = await apiFetch<Booking>('/salons/mine/bookings', {
    method: 'POST',
    body: {
      phone,
      name: manualForm.name.trim() || undefined,
      serviceId: manualForm.serviceId,
      workerId: manualForm.workerId ?? undefined,
      startsAt,
      notes: manualForm.notes.trim() || undefined,
    },
  })
  manualSubmitting.value = false
  // A rejected submission (e.g. a genuine double-booking conflict) keeps the form filled
  // in -- apiFetch's own toast already explains why, so clearing it here would just make
  // the owner re-enter everything to retry the same booking.
  if (error) return

  if (data) {
    bookings.value.unshift(data)
    // Otherwise a booking created for a different day than the one currently shown in
    // day view would vanish from sight with nothing but a toast to explain why -- jump
    // straight to it so the owner sees the confirmation, not just hears about it.
    if (!showAllBookings.value) selectedDate.value = tehranDateString(new Date(data.startsAt))
  }
  manualForm.phone = ''
  manualForm.name = ''
  manualForm.serviceId = null
  manualForm.workerId = null
  manualForm.time = '09:00'
  manualForm.notes = ''
  pushToast('نوبت با موفقیت ثبت شد')
}

// -- Day view: a date-picker + prev/next-day nav over the bookings this page already
// fetches in one call, filtered client-side to the selected Tehran-calendar-day. --

const selectedDate = ref(tehranDateString(new Date()))
// Defaults to the original unfiltered grid -- additive, not a replacement (see this
// component's own history/PRODUCT.md discussion). The day view is a one-click toggle away.
const showAllBookings = ref(true)

function stepDay(delta: number) {
  const [y, m, d] = selectedDate.value.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + delta))
  selectedDate.value = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

function goToToday() {
  selectedDate.value = tehranDateString(new Date())
}

const selectedDateLabel = computed(() =>
  new Intl.DateTimeFormat('fa-IR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Tehran' }).format(
    new Date(`${selectedDate.value}T12:00:00Z`),
  ),
)

const bookingsForSelectedDate = computed(() =>
  sortedBookings.value.filter((b) => tehranDateString(new Date(b.startsAt)) === selectedDate.value),
)

const displayedBookings = computed(() => (showAllBookings.value ? sortedBookings.value : bookingsForSelectedDate.value))
</script>

<template>
  <div class="mx-auto w-full max-w-6xl space-y-4 p-4 lg:p-6">
    <h1 class="text-lg font-bold text-(--color-text)">نوبت‌ها</h1>

    <div v-if="loadError" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">نوبت‌ها بارگذاری نشد.</p>
      <AppButton type="button" variant="secondary" data-testid="retry-bookings" @click="loadAll">
        تلاش دوباره
      </AppButton>
    </div>

    <template v-else>
      <div v-if="loading" class="flex items-center justify-center py-8 text-(--color-text-muted)">
        <AppIcon name="spinner" :size="20" class="animate-spin" />
      </div>

      <template v-else>
        <!-- Always-visible, not a modal -- same shape as HoursView.vue's ad-hoc-closures
             form. Capped and centered independently of the page's own wide container. -->
        <AppCard class="mx-auto max-w-2xl space-y-3">
          <h2 class="font-bold text-(--color-text)">ثبت نوبت حضوری/تلفنی</h2>
          <AppInput
            v-model="manualForm.phone"
            label="شماره موبایل مشتری"
            type="tel"
            inputmode="tel"
            class="tnum"
            placeholder="09xxxxxxxxx"
            data-testid="manual-booking-phone"
          />
          <AppInput v-model="manualForm.name" label="نام مشتری (اختیاری)" data-testid="manual-booking-name" />

          <div>
            <label id="manual-service-label" class="mb-1.5 block text-sm font-medium text-(--color-text)">خدمت</label>
            <AppSelect
              v-model="manualForm.serviceId"
              :options="serviceOptions"
              placeholder="انتخاب خدمت"
              aria-labelledby="manual-service-label"
              data-testid="manual-booking-service"
            />
          </div>

          <div v-if="workers.length > 0">
            <label id="manual-worker-label" class="mb-1.5 block text-sm font-medium text-(--color-text)">کارمند (اختیاری)</label>
            <AppSelect
              v-model="manualForm.workerId"
              :options="manualWorkerOptions"
              aria-labelledby="manual-worker-label"
              data-testid="manual-booking-worker"
            />
          </div>

          <div class="flex min-w-0 items-end gap-2 sm:gap-3">
            <div class="min-w-0 flex-1">
              <label class="mb-1.5 block text-sm font-medium text-(--color-text)">تاریخ</label>
              <JalaliDatePicker v-model="manualForm.date" aria-label="تاریخ نوبت" data-testid="manual-booking-date" />
            </div>
            <div class="min-w-0 flex-1">
              <label class="mb-1.5 block text-sm font-medium text-(--color-text)">ساعت</label>
              <input
                v-model="manualForm.time"
                type="time"
                aria-label="ساعت نوبت"
                data-testid="manual-booking-time"
                class="tnum min-h-11 w-full min-w-0 rounded-xl border border-(--color-border) bg-(--color-surface) p-2 text-sm"
              />
            </div>
          </div>

          <AppInput v-model="manualForm.notes" label="یادداشت (اختیاری)" placeholder="مثلاً تماس تلفنی" data-testid="manual-booking-notes" />

          <p v-if="manualFormError" class="flex items-center gap-2 rounded-xl bg-(--tone-danger-bg) p-3 text-sm text-(--tone-danger-text)">
            {{ manualFormError }}
          </p>

          <AppButton
            type="button"
            block
            data-testid="submit-manual-booking"
            :disabled="manualSubmitting"
            :loading="manualSubmitting"
            @click="submitManualBooking"
          >
            <template #icon><AppIcon name="plus" :size="16" /></template>
            ثبت نوبت
          </AppButton>
        </AppCard>

        <!-- Day view: filters the same single fetch above to one Tehran-calendar-day.
             "نمایش همه نوبت‌ها" switches back to today's original unfiltered grid --
             additive, existing behavior stays reachable. -->
        <div class="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3">
          <div v-if="!showAllBookings" class="flex min-w-0 items-center gap-1.5">
            <AppButton type="button" variant="ghost" aria-label="روز قبل" data-testid="prev-day" @click="stepDay(-1)">
              <AppIcon name="chevron-left" :size="16" />
            </AppButton>
            <div class="w-40 shrink-0">
              <JalaliDatePicker v-model="selectedDate" aria-label="انتخاب روز" data-testid="day-picker" />
            </div>
            <AppButton type="button" variant="ghost" aria-label="روز بعد" data-testid="next-day" @click="stepDay(1)">
              <AppIcon name="chevron-left" :size="16" class="rotate-180" />
            </AppButton>
            <AppButton type="button" variant="ghost" data-testid="jump-today" @click="goToToday">امروز</AppButton>
          </div>
          <p v-else class="text-sm text-(--color-text-muted)">همه نوبت‌ها</p>

          <label class="flex min-h-11 shrink-0 items-center gap-2 text-sm text-(--color-text)">
            <input v-model="showAllBookings" type="checkbox" data-testid="toggle-show-all" class="h-4 w-4 accent-(--color-accent)" />
            نمایش همه نوبت‌ها
          </label>
        </div>
        <p v-if="!showAllBookings" class="mx-auto max-w-2xl text-sm font-semibold text-(--color-text)">{{ selectedDateLabel }}</p>

        <EmptyState
          v-if="displayedBookings.length === 0"
          icon="bookings"
          :message="showAllBookings ? 'هنوز نوبتی ثبت نشده است.' : 'نوبتی برای این روز ثبت نشده است.'"
        />

        <!-- One column on phone; more columns (i.e. more visible bookings, not wider cards)
             as the viewport grows -- PRODUCT.md treats the desktop review session as equally
             real, and a single 1888px-wide card would waste all of it. auto-fit + justify-
             center rather than a fixed md:/xl: count: a lone or odd trailing booking would
             otherwise strand in the RTL start (right) column with visibly empty space beside
             it -- this still goes multi-column once there are enough bookings to fill a row. -->
        <div v-else class="grid items-start justify-center gap-3 [grid-template-columns:repeat(auto-fit,minmax(280px,360px))]">
          <AppCard v-for="b in displayedBookings" :key="b.id" :data-testid="`booking-${b.id}`" :padded="false" class="space-y-3 p-4">
            <div class="flex items-start justify-between gap-3">
              <!-- min-w-0 + break-words: a long salon-authored service name must wrap inside
                   the card, never push the badge out of it. -->
              <div class="min-w-0">
                <p class="break-words text-sm font-bold text-(--color-text)">{{ b.serviceName }}</p>
                <p class="text-xs text-(--color-text-muted)"><span dir="ltr" class="tnum">{{ formatToman(b.priceSnapshot) }}</span> تومان</p>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-1.5">
                <StatusBadge :label="bookingStatusLabel(b.status).label" :tone="bookingStatusLabel(b.status).tone" />
                <StatusBadge v-if="b.source === 'manual'" label="ثبت دستی" tone="neutral" />
              </div>
            </div>

            <p class="text-sm text-(--color-text)">
              {{ b.customerName || 'بدون نام' }}
              <span v-if="b.customerPhone" dir="ltr" class="tnum text-(--color-text-muted)"> — {{ b.customerPhone }}</span>
            </p>
            <p class="tnum text-sm text-(--color-text-muted)">{{ formatBookingDateTime(b.startsAt) }}</p>

            <div v-if="b.status === 'confirmed' && workers.length > 0">
              <!-- AppSelect's root is vue-multiselect's role="combobox" div, not a labelable
                   native control, so <label for> can no longer reach it; aria-labelledby is
                   the right ARIA association and falls through onto that root div. -->
              <label :id="`worker-select-${b.id}`" class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">تخصیص کارمند</label>
              <AppSelect
                :model-value="b.workerId ?? ''"
                :options="workerOptions"
                :disabled="submittingId === b.id"
                :aria-labelledby="`worker-select-${b.id}`"
                data-testid="assign-worker"
                @update:model-value="assignWorker(b, $event)"
              />
            </div>
            <p v-else-if="b.workerName" class="text-sm text-(--color-text-muted)">
              کارمند: <span class="font-semibold text-(--color-text)">{{ b.workerName }}</span>
            </p>

            <!--
              A grid, not a flex row: the three labelled buttons need ~300px side by side and
              the card only offers ~256px at 320px, so a single row overflowed the page. Two
              per row on a phone with the destructive «لغو» on its own full-width row (which
              also stops it sitting a thumb-width from «انجام شد»); one row from sm up.

              The two labels are left to wrap naturally (no forced mid-word line break) --
              CSS Grid's default `align-items: stretch` already equalizes both buttons'
              height to whichever one wraps, so a forced break isn't needed for that and
              only made the label read as visually broken.
            -->
            <div v-if="b.status === 'confirmed'" class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <AppButton
                data-testid="mark-completed"
                type="button"
                variant="secondary"
                :disabled="submittingId === b.id"
                :loading="submittingId === b.id"
                @click="markStatus(b.id, 'completed')"
              >
                <template #icon><AppIcon name="check" :size="15" /></template>
                <span class="text-center">انجام شد</span>
              </AppButton>
              <AppButton
                data-testid="mark-no-show"
                type="button"
                variant="secondary"
                :disabled="submittingId === b.id"
                :loading="submittingId === b.id"
                @click="markStatus(b.id, 'no_show')"
              >
                <template #icon><AppIcon name="x" :size="15" /></template>
                <span class="text-center">عدم حضور</span>
              </AppButton>
              <AppButton
                data-testid="cancel-booking"
                type="button"
                variant="danger"
                class="col-span-2 sm:col-span-1"
                :disabled="submittingId === b.id"
                :loading="submittingId === b.id"
                @click="cancelBooking(b.id)"
              >
                لغو
              </AppButton>
            </div>
          </AppCard>
        </div>
      </template>
    </template>
  </div>
</template>
