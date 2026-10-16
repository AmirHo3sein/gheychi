<!-- apps/user-app/app/components/salon/ServicePriceTag.vue
     A service's real catalog price, pricing-type aware (FIXED with its discount badge and
     struck-through original, FROM floor, RANGE, QUOTE). Extracted verbatim from the salon
     page's service list so Beauty Guide renders prices identically instead of a third copy;
     utils/service-price.ts is the plain-text twin of this markup. -->
<script setup lang="ts">
import type { PricedService } from '../../utils/service-price'
import { applyDiscount } from '../../utils/discount'
import { formatToman } from '../../utils/format-toman'

defineProps<{ service: PricedService }>()
</script>

<template>
  <span class="flex flex-wrap items-center justify-end gap-2">
    <span
      v-if="service.discountPercent"
      class="whitespace-nowrap rounded-full bg-(--color-danger-soft) px-2 py-0.5 text-xs font-bold text-(--color-danger)"
    >
      ٪{{ service.discountPercent.toLocaleString('fa-IR') }} تخفیف
    </span>
    <span v-if="service.pricingType === 'fixed'" class="flex flex-col items-end whitespace-nowrap leading-tight">
      <span v-if="service.discountPercent" class="text-xs text-(--color-text-muted) line-through">
        <span dir="ltr" class="tnum">{{ formatToman(service.price!) }}</span> تومان
      </span>
      <span class="font-bold text-(--color-text)">
        <span dir="ltr" class="tnum">{{ formatToman(applyDiscount(service.price!, service.discountPercent)) }}</span> تومان
      </span>
    </span>
    <span v-else-if="service.pricingType === 'from'" class="font-bold text-(--color-text) whitespace-nowrap">
      از <span dir="ltr" class="tnum">{{ formatToman(service.price!) }}</span> تومان
    </span>
    <!-- A RANGE is the one price that can outgrow a narrow column: at 320px beside a service
         thumbnail the text column is ~186px, and «۱۰۰٬۰۰۰٬۰۰۰ تا ۱٬۰۰۰٬۰۰۰٬۰۰۰ تومان» on one
         nowrap line was clipped by the list's overflow-hidden. So it is two unbreakable units
         («floor تا» and «ceiling تومان») that wrap onto a second line between them when -- and
         only when -- they don't fit. Never a smaller font, never a break inside an amount. -->
    <span
      v-else-if="service.pricingType === 'range'"
      data-testid="price-range"
      class="flex flex-wrap items-baseline justify-end gap-x-1 font-bold text-(--color-text)"
    >
      <span data-testid="price-range-part" class="whitespace-nowrap"><span dir="ltr" class="tnum">{{ formatToman(service.price!) }}</span> تا</span>
      <!-- A real space in the text (copy/paste, screen readers); a whitespace-only text run is
           not a flex item, so the visual gap is still gap-x-1's alone. -->
      {{ ' ' }}<span data-testid="price-range-part" class="whitespace-nowrap"><span dir="ltr" class="tnum">{{ formatToman(service.priceMax!) }}</span> تومان</span>
    </span>
    <span v-else class="font-bold text-(--color-text) whitespace-nowrap">قیمت توافقی</span>
  </span>
</template>
