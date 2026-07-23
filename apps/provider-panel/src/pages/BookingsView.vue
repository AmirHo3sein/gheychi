<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { useApi } from '@/composables/useApi'
import { bookingStatusLabel } from '@/utils/labels'

interface Booking {
  id: string
  serviceId: string
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

async function load() {
  const { data } = await apiFetch<Booking[]>('/salons/mine/bookings', { silent: true })
  bookings.value = data ?? []
  loading.value = false
}

onMounted(async () => {
  const [, workersRes] = await Promise.all([
    load(),
    apiFetch<Worker[]>('/salons/mine/workers', { silent: true }),
  ])
  workers.value = (workersRes.data ?? []).filter((w) => w.active)
})

async function markStatus(id: string, status: 'completed' | 'no_show') {
  await apiFetch(`/salons/mine/bookings/${id}`, { method: 'PATCH', body: { status } })
  await load()
}

async function cancelBooking(id: string) {
  if (!confirm('لغو این نوبت ممکن است مشمول جریمه شود. ادامه می‌دهید؟')) return
  await apiFetch(`/bookings/${id}/cancel`, { method: 'POST' })
  await load()
}

async function assignWorker(booking: Booking, event: Event) {
  const workerId = (event.target as HTMLSelectElement).value
  if (!workerId) return
  const { data } = await apiFetch<Booking>(`/salons/mine/bookings/${booking.id}/assign-worker`, {
    method: 'PATCH',
    body: { workerId },
  })
  if (data) {
    booking.workerId = data.workerId
    booking.workerName = data.workerName
  }
}
</script>

<template>
  <div class="space-y-3 p-4">
    <h1 class="text-lg font-bold text-(--color-text)">نوبت‌ها</h1>

    <EmptyState v-if="!loading && bookings.length === 0" icon="bookings" message="هنوز نوبتی ثبت نشده است." />

    <AppCard v-for="b in bookings" :key="b.id" :data-testid="`booking-${b.id}`" :padded="false" class="space-y-3 p-4">
      <div class="flex items-center justify-between">
        <p class="tnum text-sm font-semibold text-(--color-text)">{{ new Date(b.startsAt).toLocaleString('fa-IR') }}</p>
        <StatusBadge :label="bookingStatusLabel(b.status).label" :tone="bookingStatusLabel(b.status).tone" />
      </div>
      <div v-if="b.status === 'confirmed' && workers.length > 0">
        <label class="mb-1.5 block text-xs font-semibold text-(--color-muted)">تخصیص کارمند</label>
        <select
          :value="b.workerId ?? ''"
          data-testid="assign-worker"
          class="native-select w-full rounded-lg border border-(--color-border) bg-(--color-surface) p-1.5 text-sm"
          @change="assignWorker(b, $event)"
        >
          <option value="">بدون تخصیص کارمند</option>
          <option v-for="w in workers" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>
      </div>
      <div v-if="b.status === 'confirmed'" class="flex gap-2">
        <button
          data-testid="mark-completed"
          type="button"
          class="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-(--color-border) py-2 text-sm font-semibold text-(--color-text) hover:bg-(--color-border-soft)"
          @click="markStatus(b.id, 'completed')"
        >
          <AppIcon name="check" :size="15" />
          انجام شد
        </button>
        <button
          data-testid="mark-no-show"
          type="button"
          class="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-(--color-border) py-2 text-sm font-semibold text-(--color-text) hover:bg-(--color-border-soft)"
          @click="markStatus(b.id, 'no_show')"
        >
          <AppIcon name="x" :size="15" />
          عدم حضور
        </button>
        <button
          data-testid="cancel-booking"
          type="button"
          class="flex items-center justify-center rounded-xl border border-(--color-border) px-3 text-sm font-semibold text-(--tone-danger-text) hover:bg-(--tone-danger-bg)"
          @click="cancelBooking(b.id)"
        >
          لغو
        </button>
      </div>
    </AppCard>
  </div>
</template>
