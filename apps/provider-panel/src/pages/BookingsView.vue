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
}

const { apiFetch } = useApi()
const bookings = ref<Booking[]>([])
const loading = ref(true)

async function load() {
  const { data } = await apiFetch<Booking[]>('/salons/mine/bookings', { silent: true })
  bookings.value = data ?? []
  loading.value = false
}

onMounted(load)

async function markStatus(id: string, status: 'completed' | 'no_show') {
  await apiFetch(`/salons/mine/bookings/${id}`, { method: 'PATCH', body: { status } })
  await load()
}

async function cancelBooking(id: string) {
  if (!confirm('لغو این نوبت ممکن است مشمول جریمه شود. ادامه می‌دهید؟')) return
  await apiFetch(`/bookings/${id}/cancel`, { method: 'POST' })
  await load()
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
