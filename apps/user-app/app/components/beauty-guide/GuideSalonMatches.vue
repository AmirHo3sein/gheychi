<!-- apps/user-app/app/components/beauty-guide/GuideSalonMatches.vue
     "Who on Gheychi can do this": salons chosen deterministically by the API from REAL
     services. Prices are each service's own catalog price; nothing is ever summed into a
     total. Only fixed-price services go to the existing booking flow; the rest send the
     customer to the salon page to coordinate first, exactly like the salon page does. -->
<script setup lang="ts">
import { buildBookingLink } from '../../utils/attribution'
import type { GuideMatches, MatchedService } from '../../utils/beauty-guide'

defineProps<{ salons: GuideMatches['salons']; guideId: string; conceptNames: Record<string, string> }>()

// Same rule as the salon page's service list: the thumbnail column exists only when at least
// one matched service IN THIS SALON BLOCK has a photo (placeholders then fill the gaps so the
// names line up); a block with none keeps today's plain text rows.
function hasImages(services: MatchedService[]): boolean {
  return services.some((s) => !!s.imageUrl)
}
</script>

<template>
  <ul class="space-y-4">
    <!-- From sm up: the salon card as a fixed-width column beside its matching services, so a
         lone card never stretches into a giant photo tile across the whole section. -->
    <li
      v-for="match in salons"
      :key="match.salon.id"
      class="space-y-2 sm:grid sm:grid-cols-[14rem_minmax(0,1fr)] sm:items-start sm:gap-4 sm:space-y-0"
      data-testid="guide-salon-match"
    >
      <SalonCard :salon="match.salon" :heading-level="3" />
      <div class="min-w-0 space-y-2">
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
            <div :class="hasImages(match.services) ? 'flex items-start gap-3' : undefined">
              <GuideServiceThumb v-if="hasImages(match.services)" :image-url="service.imageUrl" :name="service.name" />
              <div :class="hasImages(match.services) ? 'min-w-0 flex-1' : undefined">
                <div class="flex items-center justify-between gap-3" :class="hasImages(match.services) ? 'flex-wrap gap-y-1' : undefined">
                  <span class="min-w-0 break-words text-(--color-text)">
                    {{ service.name }} ({{ service.durationMin.toLocaleString('fa-IR') }} دقیقه)
                  </span>
                  <ServicePriceTag :service="service" />
                </div>
                <p class="mt-1 text-xs font-semibold text-(--color-accent-text)">رزرو نوبت</p>
              </div>
            </div>
          </NuxtLink>
          <NuxtLink
            v-else
            :to="`/salons/${match.salon.slug}`"
            data-testid="guide-service-coordinate"
            class="block rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-3 text-sm shadow-(--shadow-sm)"
          >
            <div :class="hasImages(match.services) ? 'flex items-start gap-3' : undefined">
              <GuideServiceThumb v-if="hasImages(match.services)" :image-url="service.imageUrl" :name="service.name" />
              <div :class="hasImages(match.services) ? 'min-w-0 flex-1' : undefined">
                <div class="flex items-center justify-between gap-3" :class="hasImages(match.services) ? 'flex-wrap gap-y-1' : undefined">
                  <span class="min-w-0 break-words text-(--color-text)">{{ service.name }}</span>
                  <ServicePriceTag :service="service" />
                </div>
                <p class="mt-1 text-xs text-(--color-text-muted)">برای رزرو این خدمت باید ابتدا با سالن هماهنگ کنید.</p>
              </div>
            </div>
          </NuxtLink>
        </li>
      </ul>
      </div>
    </li>
  </ul>
</template>
