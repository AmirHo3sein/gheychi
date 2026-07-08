<!-- apps/provider-panel/src/pages/DashboardView.vue -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useApi } from '@/composables/useApi'

interface Booking {
  id: string
  serviceId: string
  startsAt: string
  status: string
}
interface Service {
  id: string
  name: string
}

const { apiFetch } = useApi()
const bookings = ref<Booking[]>([])
const services = ref<Service[]>([])
const loading = ref(true)

onMounted(async () => {
  const [bookingsRes, servicesRes] = await Promise.all([
    apiFetch<Booking[]>('/salons/mine/bookings', { silent: true }),
    apiFetch<Service[]>('/salons/mine/services', { silent: true }),
  ])
  bookings.value = bookingsRes.data ?? []
  services.value = servicesRes.data ?? []
  loading.value = false
})

function serviceName(id: string) {
  return services.value.find((s) => s.id === id)?.name ?? '—'
}

const todayKey = new Date().toDateString()

const todaysBookings = computed(() =>
  bookings.value
    .filter((b) => b.status === 'confirmed' && new Date(b.startsAt).toDateString() === todayKey)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
)

const upcomingBookings = computed(() =>
  bookings.value
    .filter((b) => b.status === 'confirmed' && new Date(b.startsAt) > new Date())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 5),
)
</script>

<template>
  <div class="space-y-6 p-4">
    <div class="flex items-center justify-between">
      <h1 class="text-lg font-bold">داشبورد</h1>
      <div class="flex gap-3 text-sm">
        <RouterLink to="/hours">ساعات کاری</RouterLink>
        <RouterLink to="/photos">تصاویر</RouterLink>
        <RouterLink to="/settings">تنظیمات</RouterLink>
      </div>
    </div>

    <section>
      <h2 class="mb-2 font-bold">نوبت‌های امروز</h2>
      <p v-if="!loading && todaysBookings.length === 0" class="text-sm text-gray-500">نوبتی برای امروز ثبت نشده است.</p>
      <ul class="space-y-2">
        <li v-for="b in todaysBookings" :key="b.id" class="rounded-lg border p-3">
          {{ serviceName(b.serviceId) }} — {{ new Date(b.startsAt).toLocaleTimeString('fa-IR') }}
        </li>
      </ul>
    </section>

    <section>
      <h2 class="mb-2 font-bold">نوبت‌های بعدی</h2>
      <ul class="space-y-2">
        <li v-for="b in upcomingBookings" :key="b.id" class="rounded-lg border p-3">
          {{ serviceName(b.serviceId) }} — {{ new Date(b.startsAt).toLocaleDateString('fa-IR') }}
        </li>
      </ul>
    </section>
  </div>
</template>
