<!-- apps/provider-panel/src/pages/DashboardView.vue -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon, { type IconName } from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
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

const QUICK_LINKS: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/hours', label: 'ساعات کاری', icon: 'hours' },
  { to: '/photos', label: 'تصاویر', icon: 'photos' },
  { to: '/stories', label: 'استوری‌ها', icon: 'stories' },
  { to: '/portfolio', label: 'نمونه کارها', icon: 'portfolio' },
  { to: '/settings', label: 'تنظیمات', icon: 'settings' },
]
</script>

<template>
  <div class="space-y-6 p-4">
    <h1 class="text-lg font-bold text-(--color-text)">داشبورد</h1>

    <div class="grid grid-cols-3 gap-2">
      <RouterLink
        v-for="link in QUICK_LINKS"
        :key="link.to"
        :to="link.to"
        class="flex flex-col items-center gap-1.5 rounded-2xl border border-(--color-border) bg-(--color-surface-card) py-4 text-center shadow-(--shadow-panel) transition-colors hover:border-(--color-accent)"
      >
        <div class="flex h-9 w-9 items-center justify-center rounded-full bg-(--tone-info-bg) text-(--color-accent)">
          <AppIcon :name="link.icon" :size="18" />
        </div>
        <span class="text-xs font-semibold text-(--color-text)">{{ link.label }}</span>
      </RouterLink>
    </div>

    <section>
      <h2 class="mb-2 flex items-center gap-2 text-sm font-bold text-(--color-text)">
        <AppIcon name="bookings" :size="16" class="text-(--color-accent)" />
        نوبت‌های امروز
      </h2>
      <EmptyState v-if="!loading && todaysBookings.length === 0" icon="bookings" message="نوبتی برای امروز ثبت نشده است." />
      <div v-else class="space-y-2">
        <AppCard v-for="b in todaysBookings" :key="b.id" :padded="false" class="p-3">
          <div class="flex items-center justify-between">
            <p class="text-sm font-semibold text-(--color-text)">{{ serviceName(b.serviceId) }}</p>
            <p class="tnum text-sm font-bold text-(--color-accent)">{{ new Date(b.startsAt).toLocaleTimeString('fa-IR') }}</p>
          </div>
        </AppCard>
      </div>
    </section>

    <section>
      <h2 class="mb-2 flex items-center gap-2 text-sm font-bold text-(--color-text)">
        <AppIcon name="dashboard" :size="16" class="text-(--color-accent)" />
        نوبت‌های بعدی
      </h2>
      <EmptyState v-if="!loading && upcomingBookings.length === 0" icon="bookings" message="نوبت بعدی ثبت نشده است." />
      <div v-else class="space-y-2">
        <AppCard v-for="b in upcomingBookings" :key="b.id" :padded="false" class="p-3">
          <div class="flex items-center justify-between">
            <p class="text-sm font-semibold text-(--color-text)">{{ serviceName(b.serviceId) }}</p>
            <p class="tnum text-sm text-(--color-muted)">{{ new Date(b.startsAt).toLocaleDateString('fa-IR') }}</p>
          </div>
        </AppCard>
      </div>
    </section>
  </div>
</template>
