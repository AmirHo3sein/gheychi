<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { useApi } from '@/composables/useApi'
import { bookingStatusLabel } from '@/utils/labels'

interface Booking {
  id: string
  serviceId: string
  serviceName: string
  priceSnapshot: number
  startsAt: string
  status: string
  workerId: string | null
  workerName: string | null
}
interface Worker {
  id: string
  name: string
  active: boolean
}

const { apiFetch } = useApi()
const bookings = ref<Booking[]>([])
const workers = ref<Worker[]>([])
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

async function loadAll() {
  loading.value = true
  loadError.value = false
  const [bookingsOk, workersOk] = await Promise.all([fetchBookings(), fetchWorkers()])
  loadError.value = !bookingsOk || !workersOk
  loading.value = false
}

onMounted(loadAll)

// Backend returns startsAt DESC (furthest-future first), which buries the next
// imminent booking under farther-future ones -- re-sort ascending so the soonest
// booking always surfaces first.
const sortedBookings = computed(() => [...bookings.value].sort((a, b) => a.startsAt.localeCompare(b.startsAt)))

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

async function assignWorker(booking: Booking, event: Event) {
  const workerId = (event.target as HTMLSelectElement).value
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
</script>

<template>
  <div class="space-y-3 p-4">
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
        <EmptyState v-if="bookings.length === 0" icon="bookings" message="هنوز نوبتی ثبت نشده است." />

        <AppCard v-for="b in sortedBookings" :key="b.id" :data-testid="`booking-${b.id}`" :padded="false" class="space-y-3 p-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-sm font-bold text-(--color-text)">{{ b.serviceName }}</p>
              <p class="tnum text-xs text-(--color-text-muted)">{{ b.priceSnapshot.toLocaleString('fa-IR') }} تومان</p>
            </div>
            <StatusBadge :label="bookingStatusLabel(b.status).label" :tone="bookingStatusLabel(b.status).tone" />
          </div>
          <p class="tnum text-sm text-(--color-text-muted)">{{ formatBookingDateTime(b.startsAt) }}</p>

          <div v-if="b.status === 'confirmed' && workers.length > 0">
            <label :for="`worker-select-${b.id}`" class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">تخصیص کارمند</label>
            <select
              :id="`worker-select-${b.id}`"
              :value="b.workerId ?? ''"
              :disabled="submittingId === b.id"
              data-testid="assign-worker"
              class="native-select w-full rounded-xl border border-(--color-border) bg-(--color-surface) p-1.5 text-sm"
              @change="assignWorker(b, $event)"
            >
              <option value="">بدون تخصیص کارمند</option>
              <option v-for="w in workers" :key="w.id" :value="w.id">{{ w.name }}</option>
            </select>
          </div>
          <p v-else-if="b.workerName" class="text-sm text-(--color-text-muted)">
            کارمند: <span class="font-semibold text-(--color-text)">{{ b.workerName }}</span>
          </p>

          <div v-if="b.status === 'confirmed'" class="flex gap-2">
            <AppButton
              data-testid="mark-completed"
              type="button"
              variant="secondary"
              class="flex-1"
              :disabled="submittingId === b.id"
              :loading="submittingId === b.id"
              @click="markStatus(b.id, 'completed')"
            >
              <template #icon><AppIcon name="check" :size="15" /></template>
              انجام شد
            </AppButton>
            <AppButton
              data-testid="mark-no-show"
              type="button"
              variant="secondary"
              class="flex-1"
              :disabled="submittingId === b.id"
              :loading="submittingId === b.id"
              @click="markStatus(b.id, 'no_show')"
            >
              <template #icon><AppIcon name="x" :size="15" /></template>
              عدم حضور
            </AppButton>
            <AppButton
              data-testid="cancel-booking"
              type="button"
              variant="danger"
              :disabled="submittingId === b.id"
              :loading="submittingId === b.id"
              @click="cancelBooking(b.id)"
            >
              لغو
            </AppButton>
          </div>
        </AppCard>
      </template>
    </template>
  </div>
</template>
