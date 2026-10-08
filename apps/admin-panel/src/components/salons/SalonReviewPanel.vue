<!-- apps/admin-panel/src/components/salons/SalonReviewPanel.vue -->
<!-- Everything an admin needs to decide on a listing, read-only and in the order the review
     checklist walks it: who owns it, where it is, what it looks like, what it sells, when it
     opens, and how it has behaved. One card with divided sections -- no nested cards. -->
<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import SafeImage from '@/components/ui/SafeImage.vue'
import ScrollTable from '@/components/ui/ScrollTable.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { formatToman } from '@/utils/format-toman'
import { pricingTypeLabel, userStatusLabel } from '@/utils/labels'
import {
  DEFAULT_TILE_ATTRIBUTION,
  DEFAULT_TILE_URL,
  PREVIEW_ZOOM,
  RISK_STATS,
  type SalonReviewData,
  externalMapUrl,
  fillTileUrl,
  groupWorkingHours,
  tileForPoint,
} from '@/utils/salon-review'
import { buildEnv } from '@/utils/build-env'

const props = defineProps<{ salon: SalonReviewData }>()

const tileTemplate = buildEnv(import.meta.env.VITE_MAP_TILE_URL, DEFAULT_TILE_URL)
const tileAttribution = buildEnv(import.meta.env.VITE_MAP_TILE_ATTRIBUTION, DEFAULT_TILE_ATTRIBUTION)

// A read-only preview is a single map tile with the pin placed at the point's offset inside
// it -- enough to judge "is this on a street in the right city" without shipping a map
// library into a panel that otherwise has none. The external link is the interactive view.
const preview = computed(() => {
  const loc = props.salon.location
  if (!loc) return null
  const t = tileForPoint(loc.lat, loc.lng, PREVIEW_ZOOM)
  return { url: fillTileUrl(tileTemplate, PREVIEW_ZOOM, t.x, t.y), left: (t.offsetX / 256) * 100, top: (t.offsetY / 256) * 100 }
})

const days = computed(() => groupWorkingHours(props.salon.hours))
const photos = computed(() => [...props.salon.photos].sort((a, b) => a.sortOrder - b.sortOrder))

function priceText(s: SalonReviewData['services'][number]): string {
  if (s.pricingType === 'quote' || s.price === null) return 'پس از استعلام'
  if (s.pricingType === 'from') return `از ${formatToman(s.price)} تومان`
  if (s.pricingType === 'range' && s.priceMax !== null) return `${formatToman(s.price)} تا ${formatToman(s.priceMax)} تومان`
  return `${formatToman(s.price)} تومان`
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(iso))
}
</script>

<template>
  <div data-testid="review-panel" class="divide-y divide-(--color-border-soft) [&>section]:py-5 [&>section:first-child]:pt-0 [&>section:last-child]:pb-0">
    <section aria-labelledby="rv-owner">
      <h3 id="rv-owner" class="text-sm font-bold text-(--color-text)">مالک و تماس</h3>
      <dl class="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt class="text-xs text-(--color-text-muted)">نام مالک</dt>
          <dd class="mt-1 break-words font-semibold">{{ salon.owner.name || '—' }}</dd>
        </div>
        <div>
          <dt class="text-xs text-(--color-text-muted)">شماره مالک</dt>
          <dd class="mt-1 flex flex-wrap items-center gap-2">
            <a
              data-testid="owner-phone"
              :href="`tel:${salon.owner.phone}`"
              dir="ltr"
              class="tnum inline-flex min-h-11 items-center gap-1.5 font-semibold text-(--color-accent-text) hover:underline"
            >
              <AppIcon name="phone" :size="15" />{{ salon.owner.phone }}
            </a>
            <StatusBadge
              data-testid="owner-status"
              :label="userStatusLabel(salon.owner.status).label"
              :tone="userStatusLabel(salon.owner.status).tone"
            />
          </dd>
        </div>
        <div>
          <dt class="text-xs text-(--color-text-muted)">تلفن تماس سالن</dt>
          <dd class="mt-1 font-semibold">
            <a v-if="salon.contactPhone" data-testid="contact-phone" :href="`tel:${salon.contactPhone}`" dir="ltr" class="tnum inline-flex min-h-11 items-center text-(--color-accent-text) hover:underline">{{ salon.contactPhone }}</a>
            <span v-else data-testid="contact-phone-missing" class="text-(--color-text-muted)">ثبت نشده</span>
          </dd>
        </div>
        <div>
          <dt class="text-xs text-(--color-text-muted)">تاریخ ثبت درخواست</dt>
          <dd class="mt-1 font-semibold">{{ formatDate(salon.createdAt) }}</dd>
        </div>
      </dl>
    </section>

    <section aria-labelledby="rv-location">
      <h3 id="rv-location" class="text-sm font-bold text-(--color-text)">موقعیت</h3>
      <p class="mt-2 break-words text-sm text-(--color-text)">{{ salon.city }} — {{ salon.address }}</p>
      <div v-if="preview && salon.location" class="mt-3 flex flex-wrap items-start gap-3">
        <div
          data-testid="map-preview"
          class="relative h-40 w-40 shrink-0 overflow-hidden rounded-xl border border-(--color-border) bg-(--color-border-soft)"
        >
          <img :src="preview.url" alt="پیش‌نمایش نقشه" class="h-full w-full object-cover" />
          <span
            data-testid="map-pin"
            class="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-(--color-fill-text) bg-(--color-danger-strong) shadow-(--shadow-md)"
            :style="{ left: `${preview.left}%`, top: `${preview.top}%` }"
          />
          <span class="absolute bottom-0 start-0 bg-(--color-surface-card)/80 px-1 text-[10px] text-(--color-text-muted)" dir="ltr">{{ tileAttribution }}</span>
        </div>
        <div class="min-w-0 text-sm">
          <p dir="ltr" class="tnum text-xs text-(--color-text-muted)">{{ salon.location.lat.toFixed(5) }}, {{ salon.location.lng.toFixed(5) }}</p>
          <a
            data-testid="map-link"
            :href="externalMapUrl(salon.location.lat, salon.location.lng)"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-1 inline-flex min-h-11 items-center font-semibold text-(--color-accent-text) hover:underline"
          >
            مشاهده روی نقشه
          </a>
        </div>
      </div>
      <p v-else data-testid="no-location" class="mt-2 text-sm text-(--tone-warning-text)">موقعیت روی نقشه ثبت نشده است.</p>
    </section>

    <section aria-labelledby="rv-photos">
      <h3 id="rv-photos" class="text-sm font-bold text-(--color-text)">تصاویر</h3>
      <p v-if="photos.length === 0" data-testid="no-photos" class="mt-2 text-sm text-(--tone-warning-text)">تصویری بارگذاری نشده است.</p>
      <ul v-else class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <li v-for="(photo, i) in photos" :key="photo.id" data-testid="photo-item" class="aspect-square overflow-hidden rounded-xl border border-(--color-border)">
          <SafeImage :src="photo.url" :alt="`تصویر سالن ${(i + 1).toLocaleString('fa-IR')}`" />
        </li>
      </ul>
    </section>

    <section aria-labelledby="rv-services">
      <h3 id="rv-services" class="text-sm font-bold text-(--color-text)">خدمات و قیمت‌ها</h3>
      <p v-if="salon.services.length === 0" data-testid="no-services" class="mt-2 text-sm text-(--tone-warning-text)">خدمتی ثبت نشده است.</p>
      <div v-else class="mt-3">
        <ScrollTable label="خدمات سالن">
          <table class="w-full text-start text-sm">
            <thead>
              <tr class="border-b border-(--color-border) text-xs text-(--color-text-muted)">
                <th scope="col" class="py-2 pe-4 font-semibold">خدمت</th>
                <th scope="col" class="py-2 pe-4 font-semibold">نوع قیمت</th>
                <th scope="col" class="py-2 pe-4 font-semibold">قیمت</th>
                <th scope="col" class="py-2 font-semibold">مدت</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in salon.services" :key="s.id" data-testid="service-row" class="border-b border-(--color-border-soft) last:border-0" :class="!s.isActive && 'opacity-60'">
                <td class="py-2.5 pe-4 font-semibold">
                  {{ s.name }}
                  <span v-if="!s.isActive" class="ms-1 text-xs font-normal text-(--color-text-muted)">(غیرفعال)</span>
                </td>
                <td class="py-2.5 pe-4 text-(--color-text-muted)">{{ pricingTypeLabel(s.pricingType) }}</td>
                <td class="tnum py-2.5 pe-4">{{ priceText(s) }}</td>
                <td class="tnum py-2.5 text-(--color-text-muted)">{{ s.durationMinutes.toLocaleString('fa-IR') }} دقیقه</td>
              </tr>
            </tbody>
          </table>
        </ScrollTable>
      </div>
    </section>

    <section aria-labelledby="rv-hours">
      <h3 id="rv-hours" class="text-sm font-bold text-(--color-text)">ساعت کاری</h3>
      <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <template v-for="d in days" :key="d.day">
          <dt class="text-(--color-text-muted)">{{ d.label }}</dt>
          <dd data-testid="hours-day" class="tnum font-semibold" :class="d.ranges.length === 0 && 'font-normal text-(--color-text-muted)'">
            <template v-if="d.ranges.length === 0">تعطیل</template>
            <template v-else>{{ d.ranges.map((r) => `${r.open} تا ${r.close}`).join(' و ') }}</template>
          </dd>
        </template>
      </dl>
    </section>

    <section aria-labelledby="rv-risk">
      <h3 id="rv-risk" class="text-sm font-bold text-(--color-text)">رفتار سالن در ۹۰ روز گذشته</h3>
      <dl class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div v-for="stat in RISK_STATS" :key="stat.key" data-testid="risk-stat" class="min-w-0">
          <dt class="text-xs text-(--color-text-muted)">{{ stat.label }}</dt>
          <dd
            class="tnum mt-0.5 text-lg font-bold"
            :class="stat.warn && salon.riskSummary[stat.key] > 0 ? 'text-(--tone-danger-text)' : 'text-(--color-text)'"
          >
            {{ salon.riskSummary[stat.key].toLocaleString('fa-IR') }}
          </dd>
        </div>
      </dl>
    </section>
  </div>
</template>
