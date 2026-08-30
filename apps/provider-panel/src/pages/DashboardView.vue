<!-- apps/provider-panel/src/pages/DashboardView.vue -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
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
const loadError = ref(false)

async function load() {
  loading.value = true
  loadError.value = false

  const [bookingsRes, servicesRes] = await Promise.all([
    apiFetch<Booking[]>('/salons/mine/bookings', { silent: true }),
    apiFetch<Service[]>('/salons/mine/services', { silent: true }),
  ])

  if (bookingsRes.error || servicesRes.error) {
    loadError.value = true
    loading.value = false
    return
  }

  bookings.value = bookingsRes.data ?? []
  services.value = servicesRes.data ?? []
  loading.value = false
}

onMounted(load)

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
    .filter(
      (b) =>
        b.status === 'confirmed' &&
        new Date(b.startsAt) > new Date() &&
        new Date(b.startsAt).toDateString() !== todayKey,
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 5),
)

const QUICK_LINKS: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/customers', label: 'مشتریان', icon: 'customers' },
  { to: '/hours', label: 'ساعات کاری', icon: 'hours' },
  { to: '/photos', label: 'تصاویر', icon: 'photos' },
  { to: '/stories', label: 'استوری‌ها', icon: 'stories' },
  { to: '/portfolio', label: 'نمونه کارها', icon: 'portfolio' },
  { to: '/coupons', label: 'کدهای تخفیف', icon: 'coupons' },
  { to: '/team', label: 'تیم', icon: 'team' },
  { to: '/settings', label: 'تنظیمات', icon: 'settings' },
  { to: '/plan', label: 'پلن من', icon: 'plan' },
]
// Pinned to the salon's timezone, not the browser's -- see BookingsView's equivalent.
function formatBookingTime(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', { timeStyle: 'short', timeZone: 'Asia/Tehran' }).format(
    new Date(iso),
  )
}
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-6 p-4 lg:p-6">
    <h1 class="text-lg font-bold text-(--color-text)">داشبورد</h1>

    <!-- These nine tiles are the only route to the screens the nav bar doesn't carry, so
         they matter at every width: 3-up on a phone (90px tiles at 320px, enough for a
         two-line label), then more columns rather than taller tiles as the viewport grows,
         landing on a single 9-across row on a laptop. -->
    <div class="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-9 lg:gap-3">
      <RouterLink
        v-for="link in QUICK_LINKS"
        :key="link.to"
        :to="link.to"
        class="flex flex-col items-center gap-1.5 rounded-2xl border-2 border-(--color-border) bg-(--color-surface-card) py-4 text-center shadow-(--shadow-sm) transition-colors hover:border-(--color-accent)"
      >
        <div class="flex h-9 w-9 items-center justify-center rounded-full bg-(--tone-info-bg) text-(--color-text-muted)">
          <AppIcon :name="link.icon" :size="18" />
        </div>
        <span class="px-1 text-center text-xs font-semibold text-balance text-(--color-text)">{{ link.label }}</span>
      </RouterLink>
    </div>

    <div v-if="loadError" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">اطلاعات نوبت‌ها بارگذاری نشد.</p>
      <AppButton variant="secondary" data-testid="retry-dashboard" @click="load">
        تلاش دوباره
      </AppButton>
    </div>

    <!-- Today and next-up sit side by side from lg: the between-clients phone check reads
         them in sequence, but a desktop session should see both without scrolling. -->
    <div v-else class="grid gap-6 lg:grid-cols-2 lg:items-start">
      <section>
        <h2 class="mb-2 flex items-center gap-2 text-sm font-bold text-(--color-text)">
          <AppIcon name="bookings" :size="16" class="text-(--color-text-muted)" />
          نوبت‌های امروز
        </h2>
        <div v-if="loading" class="flex items-center justify-center py-8 text-(--color-text-muted)">
          <AppIcon name="spinner" :size="20" class="animate-spin" />
        </div>
        <EmptyState v-else-if="todaysBookings.length === 0" icon="bookings" message="نوبتی برای امروز ثبت نشده است." />
        <div v-else class="space-y-2">
          <AppCard v-for="b in todaysBookings" :key="b.id" :padded="false" class="p-3">
            <div class="flex items-center justify-between gap-2">
              <p class="min-w-0 break-words text-sm font-semibold text-(--color-text)">{{ serviceName(b.serviceId) }}</p>
              <p class="tnum shrink-0 text-sm font-bold text-(--color-accent-text)">{{ formatBookingTime(b.startsAt) }}</p>
            </div>
          </AppCard>
        </div>
      </section>

      <section>
        <h2 class="mb-2 flex items-center gap-2 text-sm font-bold text-(--color-text)">
          <AppIcon name="bookings" :size="16" class="text-(--color-text-muted)" />
          نوبت‌های بعدی
        </h2>
        <div v-if="loading" class="flex items-center justify-center py-8 text-(--color-text-muted)">
          <AppIcon name="spinner" :size="20" class="animate-spin" />
        </div>
        <EmptyState v-else-if="upcomingBookings.length === 0" icon="bookings" message="نوبت بعدی ثبت نشده است." />
        <div v-else class="space-y-2">
          <AppCard v-for="b in upcomingBookings" :key="b.id" :padded="false" class="p-3">
            <div class="flex items-center justify-between gap-2">
              <p class="min-w-0 break-words text-sm font-semibold text-(--color-text)">{{ serviceName(b.serviceId) }}</p>
              <p class="tnum shrink-0 text-sm text-(--color-text-muted)">{{ new Date(b.startsAt).toLocaleDateString('fa-IR') }}</p>
            </div>
          </AppCard>
        </div>
      </section>
    </div>
  </div>
</template>
