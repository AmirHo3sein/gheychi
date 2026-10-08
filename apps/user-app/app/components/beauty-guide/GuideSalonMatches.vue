<!-- apps/user-app/app/components/beauty-guide/GuideSalonMatches.vue
     "Who on Gheychi can do this": salons chosen deterministically by the API from REAL
     services. Prices are each service's own catalog price; nothing is ever summed into a
     total. Only fixed-price services go to the existing booking flow; the rest send the
     customer to the salon page to coordinate first, exactly like the salon page does. -->
<script setup lang="ts">
import { buildBookingLink } from '../../utils/attribution'
import type { GuideMatches } from '../../utils/beauty-guide'

defineProps<{ salons: GuideMatches['salons']; guideId: string; conceptNames: Record<string, string> }>()
</script>

<template>
  <ul class="space-y-4">
    <li v-for="match in salons" :key="match.salon.id" class="space-y-2" data-testid="guide-salon-match">
      <SalonCard :salon="match.salon" />
      <p class="px-1 text-xs text-(--color-text-muted)">
        خدمات مرتبط با: {{ match.matchedConceptKeys.map((k) => conceptNames[k] ?? k).join('، ') }}
      </p>
      <ul class="space-y-2">
        <li v-for="service in match.services" :key="service.id">
          <NuxtLink
            v-if="service.bookableOnline"
            :to="buildBookingLink(match.salon.slug, service.id, null, { beautyGuideId: guideId })"
            data-testid="guide-service-book"
            class="block rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-3 text-sm shadow-(--shadow-sm) transition-shadow hover:shadow-(--shadow-md)"
          >
            <div class="flex items-center justify-between gap-3">
              <span class="min-w-0 break-words text-(--color-text)">
                {{ service.name }} ({{ service.durationMin.toLocaleString('fa-IR') }} دقیقه)
              </span>
              <ServicePriceTag :service="service" />
            </div>
            <p class="mt-1 text-xs font-semibold text-(--color-accent-text)">رزرو نوبت</p>
          </NuxtLink>
          <NuxtLink
            v-else
            :to="`/salons/${match.salon.slug}`"
            data-testid="guide-service-coordinate"
            class="block rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-3 text-sm shadow-(--shadow-sm)"
          >
            <div class="flex items-center justify-between gap-3">
              <span class="min-w-0 break-words text-(--color-text)">{{ service.name }}</span>
              <ServicePriceTag :service="service" />
            </div>
            <p class="mt-1 text-xs text-(--color-text-muted)">برای رزرو این خدمت باید ابتدا با سالن هماهنگ کنید.</p>
          </NuxtLink>
        </li>
      </ul>
    </li>
  </ul>
</template>
