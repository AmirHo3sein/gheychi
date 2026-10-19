<!--
  Part-of-a-whole ring with its legend. Each legend row is the real label/count/percent in
  text, so the colours are never the only carrier of meaning, and hovering or focusing a row
  lifts its segment (and the centre figure switches to it).
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatNumber } from '@/utils/digits'

export interface DonutSegment {
  key: string
  label: string
  value: number
  /** A CSS colour, normally a --chart-* token. */
  color: string
}

const props = withDefaults(
  defineProps<{
    segments: DonutSegment[]
    centerLabel: string
    caption: string
    size?: number
  }>(),
  { size: 168 },
)

const STROKE = 18
const radius = computed(() => (props.size - STROKE) / 2 - 4)
const circumference = computed(() => 2 * Math.PI * radius.value)
const total = computed(() => props.segments.reduce((n, s) => n + s.value, 0))
const highlighted = ref<string | null>(null)

const arcs = computed(() => {
  // A small gap between segments, but never when one segment is the whole ring.
  const visible = props.segments.filter((s) => s.value > 0)
  const gap = visible.length > 1 ? 3 : 0
  let offset = 0
  return props.segments.map((s) => {
    const len = total.value === 0 ? 0 : (s.value / total.value) * circumference.value
    const arc = { ...s, dash: Math.max(0, len - gap), offset }
    offset += len
    return arc
  })
})

function percent(value: number): number {
  return total.value === 0 ? 0 : Math.round((value / total.value) * 100)
}

const center = computed(() => {
  const s = props.segments.find((x) => x.key === highlighted.value)
  return s ? { value: s.value, label: s.label } : { value: total.value, label: props.centerLabel }
})
</script>

<template>
  <figure class="flex flex-col items-center gap-5 sm:flex-row sm:items-center" data-testid="donut-chart">
    <div class="relative shrink-0" :style="{ width: `${size}px`, height: `${size}px` }">
      <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`" class="-rotate-90" aria-hidden="true">
        <circle :cx="size / 2" :cy="size / 2" :r="radius" fill="none" stroke="var(--color-surface-subtle)" :stroke-width="STROKE" />
        <circle
          v-for="a in arcs"
          v-show="a.dash > 0"
          :key="a.key"
          :cx="size / 2"
          :cy="size / 2"
          :r="radius"
          fill="none"
          :stroke="a.color"
          :stroke-width="highlighted === a.key ? STROKE + 5 : STROKE"
          :stroke-dasharray="`${a.dash} ${circumference}`"
          :stroke-dashoffset="-a.offset"
          :opacity="highlighted && highlighted !== a.key ? 0.35 : 1"
          class="chart-fade transition-[stroke-width,opacity] duration-200"
        />
      </svg>
      <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span class="tnum text-2xl font-extrabold text-(--color-text)" data-testid="donut-center">{{ formatNumber(center.value) }}</span>
        <span class="max-w-24 text-xs text-(--color-text-muted)">{{ center.label }}</span>
      </div>
    </div>

    <figcaption class="sr-only">{{ caption }}</figcaption>
    <!-- Capped width: on a wide card the counts used to sit a whole card-width away from their labels. -->
    <ul class="w-full min-w-0 flex-1 space-y-1 sm:max-w-72">
      <li v-for="s in segments" :key="s.key">
        <button
          type="button"
          data-testid="donut-legend"
          class="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2 text-start text-sm transition-colors duration-150 hover:bg-(--color-surface-subtle) focus-visible:bg-(--color-surface-subtle)"
          :aria-pressed="highlighted === s.key"
          @mouseenter="highlighted = s.key"
          @mouseleave="highlighted = null"
          @focus="highlighted = s.key"
          @blur="highlighted = null"
          @click="highlighted = highlighted === s.key ? null : s.key"
        >
          <span class="h-3 w-3 shrink-0 rounded-full" :style="{ background: s.color }" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate text-(--color-text)">{{ s.label }}</span>
          <span class="tnum font-semibold text-(--color-text)">{{ formatNumber(s.value) }}</span>
          <span class="tnum w-11 text-end text-xs text-(--color-text-muted)">{{ formatNumber(percent(s.value)) }}٪</span>
        </button>
      </li>
    </ul>
  </figure>
</template>
