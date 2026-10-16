<script setup lang="ts">
import AppCard from '@/components/ui/AppCard.vue'
import Sparkline from './charts/Sparkline.vue'

defineProps<{
  label: string
  value: string
  hint?: string
  deltaText: string
  /** Tailwind text-colour class for the delta line (good / bad / neutral). */
  deltaClass: string
  /** Optional day-by-day series for a decorative sparkline (oldest first). */
  spark?: number[]
}>()
</script>

<template>
  <!-- No dir="ltr" around the value: it is a Persian string ("۳۵۰٬۰۰۰ تومان", "۵۰٪"), and
       forcing LTR put «تومان» on the wrong side of the number. -->
  <AppCard class="flex flex-col">
    <p class="text-xs text-(--color-text-muted)">{{ label }}</p>
    <p class="tnum mt-1 break-words text-lg font-bold text-(--color-text)">{{ value }}</p>
    <p v-if="hint" class="mt-0.5 text-xs text-(--color-text-muted)">{{ hint }}</p>
    <div class="mt-auto flex items-end justify-between gap-2 pt-1">
      <p class="text-xs" :class="deltaClass">{{ deltaText }}</p>
      <Sparkline v-if="spark && spark.some((v) => v > 0)" :values="spark" class="hidden shrink-0 sm:block" />
    </div>
  </AppCard>
</template>
