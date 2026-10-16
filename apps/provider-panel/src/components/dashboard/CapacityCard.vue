<!-- apps/provider-panel/src/components/dashboard/CapacityCard.vue -->
<!-- «ظرفیت خالی»: how much of the next 7 Tehran days' chair-time is still unbooked, straight from
     GET /salons/mine/capacity (open hours x the salon's concurrent-capacity setting, minus
     slot-blocking bookings -- see the API's capacity.util.ts). Owns its own read and its own
     error state so the dashboard's other sections never wait on, or fail with, this one.

     Deliberately minutes/percent, never "N empty slots": a slot count depends on which
     service's duration you walk the day with, so there is no single honest slot number. A day
     with nothing on offer (no working hours, or closed) reads «تعطیل», never «۰٪». -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useApi } from '@/composables/useApi'
import { formatNumber } from '@/utils/digits'

interface DayCapacity {
  date: string
  weekday: number
  closedReason: 'no_hours' | 'closed_exception' | null
  openMinutes: number
  capacityMinutes: number
  bookedMinutes: number
  freeMinutes: number
  freePercent: number | null
  bookingsCount: number
}
interface SalonCapacity {
  from: string
  to: string
  capacity: number
  days: DayCapacity[]
  totals: { openMinutes: number; capacityMinutes: number; bookedMinutes: number; freeMinutes: number; freePercent: number | null }
}

const { apiFetch } = useApi()
const data = ref<SalonCapacity | null>(null)
const loading = ref(true)
const error = ref(false)

async function load() {
  loading.value = true
  error.value = false
  const res = await apiFetch<SalonCapacity>('/salons/mine/capacity', { silent: true })
  // A response without a day list is not something this card can draw honestly.
  if (res.error || !res.data || !Array.isArray(res.data.days)) {
    error.value = true
    data.value = null
  } else {
    data.value = res.data
  }
  loading.value = false
}

onMounted(load)

const nothingOnOffer = computed(() => !!data.value && data.value.totals.capacityMinutes === 0)

const dayFmt = new Intl.DateTimeFormat('fa-IR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Tehran' })
function dayLabel(date: string): string {
  return dayFmt.format(new Date(`${date}T12:00:00Z`))
}

function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${formatNumber(m)} دقیقه`
  return m === 0 ? `${formatNumber(h)} ساعت` : `${formatNumber(h)} ساعت و ${formatNumber(m)} دقیقه`
}

function rowTitle(d: DayCapacity): string {
  if (d.freePercent === null) return `${dayLabel(d.date)}: تعطیل`
  return `${dayLabel(d.date)}: ${hoursLabel(d.freeMinutes)} خالی از ${hoursLabel(d.capacityMinutes)}، ${formatNumber(d.bookingsCount)} نوبت`
}
</script>

<template>
  <AppCard class="space-y-4" data-testid="capacity-card">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-base font-bold text-(--color-text)">ظرفیت خالی ۷ روز آینده</h2>
        <p class="mt-1 text-xs leading-5 text-(--color-text-muted)">
          چه سهمی از وقت صندلی‌ها در ساعات کاری هنوز رزرو نشده است.
        </p>
      </div>
      <p
        v-if="data && data.totals.freePercent !== null"
        data-testid="capacity-total"
        class="tnum shrink-0 text-end text-2xl font-bold leading-none text-(--color-text)"
      >
        {{ formatNumber(data.totals.freePercent) }}٪
        <span class="mt-1 block text-[11px] font-normal text-(--color-text-muted)">خالی در کل هفته</span>
      </p>
    </div>

    <div v-if="loading" role="status" aria-label="در حال بارگذاری ظرفیت" class="space-y-2" data-testid="capacity-skeleton">
      <div v-for="n in 7" :key="n" class="h-6 animate-pulse rounded-lg bg-(--color-surface-subtle)" />
    </div>

    <div v-else-if="error" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">ظرفیت خالی بارگذاری نشد.</p>
      <AppButton variant="secondary" size="sm" touch data-testid="retry-capacity" @click="load">تلاش دوباره</AppButton>
    </div>

    <div v-else-if="nothingOnOffer" data-testid="capacity-empty" class="rounded-xl bg-(--color-surface-subtle) p-4 text-sm leading-6 text-(--color-text-muted)">
      در ۷ روز آینده ساعت کاری باز ثبت نشده است، پس ظرفیتی برای محاسبه وجود ندارد.
      <RouterLink to="/hours" class="font-semibold text-(--color-accent-text) underline-offset-4 hover:underline">تنظیم ساعات کاری</RouterLink>
    </div>

    <template v-else-if="data">
      <!-- The bar draws what is TAKEN (solid) on a light track that is the free share, so an
           empty day is an empty bar -- never a full dark bar that reads as "fully booked". The
           text beside it carries the value itself («۷۵٪ خالی»), so the bar is never the only carrier. -->
      <ul class="space-y-1.5" aria-label="ظرفیت خالی هر روز">
        <li
          v-for="(d, i) in data.days"
          :key="d.date"
          data-testid="capacity-day"
          :title="rowTitle(d)"
          class="grid grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 rounded-lg px-1.5 py-1"
          :class="i === 0 ? 'bg-(--color-accent-soft)' : ''"
          :aria-label="rowTitle(d)"
        >
          <span class="truncate text-xs" :class="i === 0 ? 'font-bold text-(--color-text)' : 'text-(--color-text-muted)'">
            {{ i === 0 ? 'امروز' : dayLabel(d.date) }}
          </span>
          <span
            class="h-2.5 overflow-hidden rounded-full"
            :class="d.freePercent === null ? 'border border-dashed border-(--color-border)' : 'bg-(--color-border-soft)'"
            aria-hidden="true"
          >
            <span
              v-if="d.freePercent !== null && d.freePercent < 100"
              data-testid="capacity-booked-bar"
              class="block h-full rounded-full bg-(--color-accent-text)"
              :style="{ width: `${Math.max(100 - d.freePercent, 3)}%` }"
            />
          </span>
          <span class="tnum text-end text-xs font-semibold whitespace-nowrap" :class="d.freePercent === null ? 'text-(--color-text-muted)' : 'text-(--color-text)'">
            {{ d.freePercent === null ? 'تعطیل' : `${formatNumber(d.freePercent)}٪ خالی` }}
          </span>
        </li>
      </ul>
      <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-(--color-text-muted)" aria-label="راهنمای نمودار" data-testid="capacity-legend">
        <li class="inline-flex items-center gap-1.5"><span class="h-2.5 w-4 rounded-full bg-(--color-accent-text)" aria-hidden="true" />رزروشده</li>
        <li class="inline-flex items-center gap-1.5"><span class="h-2.5 w-4 rounded-full bg-(--color-border-soft)" aria-hidden="true" />خالی</li>
        <li class="inline-flex items-center gap-1.5"><span class="h-2.5 w-4 rounded-full border border-dashed border-(--color-border)" aria-hidden="true" />تعطیل</li>
      </ul>

      <p class="text-xs leading-5 text-(--color-text-muted)">
        بر اساس ساعات کاری، روزهای تعطیل و ظرفیت همزمان {{ formatNumber(data.capacity) }} نفر. فقط نوبت‌های تأییدشده و در
        انتظار تأیید یا پرداخت وقت اشغال‌شده حساب می‌شوند؛ امروز کامل حساب می‌شود، حتی ساعت‌های گذشته.
      </p>

      <RouterLink
        to="/bookings?view=week"
        data-testid="capacity-week-link"
        class="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-(--color-accent-text) underline-offset-4 hover:underline"
      >
        <AppIcon name="calendar" :size="16" />
        دیدن برنامهٔ این هفته
        <AppIcon name="chevron-left" :size="14" />
      </RouterLink>
    </template>
  </AppCard>
</template>
