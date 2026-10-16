<!-- apps/provider-panel/src/components/plan/UsageMeter.vue -->
<!-- One usage-vs-allowance bar. Only ever fed real numbers from an API (never an estimate):
     `limit: null` means the plan sets no ceiling, and then no bar is drawn at all. -->
<script setup lang="ts">
import { computed } from 'vue'
import { formatNumber } from '@/utils/digits'

const props = defineProps<{
  label: string
  used: number
  limit: number | null
  /** Persian unit after the numbers, e.g. «پیامک». */
  unit: string
  /** Small print under the bar (period, what counts). */
  hint?: string
}>()

const percent = computed(() => {
  if (props.limit === null) return 0
  if (props.limit <= 0) return 100
  return Math.min(100, Math.round((props.used / props.limit) * 100))
})
const state = computed<'ok' | 'high' | 'full'>(() => {
  if (props.limit === null) return 'ok'
  if (props.used >= props.limit) return 'full'
  return percent.value >= 80 ? 'high' : 'ok'
})
// accent-TEXT, not the peach fill: the bar must clear 3:1 against its blush track (WCAG 1.4.11).
const BAR_CLASS = { ok: 'bg-(--color-accent-text)', high: 'bg-(--tone-warning-text)', full: 'bg-(--tone-danger-text)' }
const valueText = computed(() =>
  props.limit === null
    ? `${formatNumber(props.used)} ${props.unit}، بدون سقف`
    : `${formatNumber(props.used)} از ${formatNumber(props.limit)} ${props.unit}`,
)
</script>

<template>
  <div class="space-y-2" data-testid="usage-meter" :data-state="state">
    <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <p class="text-sm font-semibold text-(--color-text)">{{ label }}</p>
      <p class="tnum text-sm text-(--color-text-muted)" data-testid="usage-meter-value">{{ valueText }}</p>
    </div>
    <div
      v-if="limit !== null"
      role="meter"
      :aria-label="label"
      aria-valuemin="0"
      :aria-valuemax="limit"
      :aria-valuenow="Math.min(used, limit)"
      :aria-valuetext="valueText"
      class="h-2.5 overflow-hidden rounded-full bg-(--color-surface-subtle)"
    >
      <div class="h-full rounded-full transition-[width] duration-200 ease-out motion-reduce:transition-none" :class="BAR_CLASS[state]" :style="{ width: `${percent}%` }" />
    </div>
    <p v-if="state === 'full'" class="text-xs font-medium text-(--tone-danger-text)" data-testid="usage-meter-full">سهمیه تمام شده است.</p>
    <p v-else-if="hint" class="text-xs text-(--color-text-muted)">{{ hint }}</p>
  </div>
</template>
