<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useApi } from '@/composables/useApi'

interface Booking {
  id: string
  serviceId: string
  startsAt: string
  status: string
}

const { apiFetch } = useApi()
const bookings = ref<Booking[]>([])

async function load() {
  const { data } = await apiFetch<Booking[]>('/salons/mine/bookings', { silent: true })
  bookings.value = data ?? []
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
    <h1 class="text-lg font-bold">نوبت‌ها</h1>
    <div v-for="b in bookings" :key="b.id" :data-testid="`booking-${b.id}`" class="rounded-lg border p-3">
      <p>{{ new Date(b.startsAt).toLocaleString('fa-IR') }} — {{ b.status }}</p>
      <div v-if="b.status === 'confirmed'" class="mt-2 flex gap-2">
        <button data-testid="mark-completed" type="button" class="rounded-lg border px-3 py-1 text-sm" @click="markStatus(b.id, 'completed')">
          انجام شد
        </button>
        <button data-testid="mark-no-show" type="button" class="rounded-lg border px-3 py-1 text-sm" @click="markStatus(b.id, 'no_show')">
          عدم حضور
        </button>
        <button
          data-testid="cancel-booking"
          type="button"
          class="rounded-lg border px-3 py-1 text-sm text-red-600"
          @click="cancelBooking(b.id)"
        >
          لغو
        </button>
      </div>
    </div>
  </div>
</template>
