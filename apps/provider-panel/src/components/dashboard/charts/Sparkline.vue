<!-- Tiny decorative trend line for a metric tile. aria-hidden: the tile's own text already
     states the figure and its change, and the full series is in the main trend chart. -->
<script setup lang="ts">
import { computed, useId } from 'vue'
import { monotonePath } from '@/utils/chart'

const props = withDefaults(defineProps<{ values: number[]; width?: number; height?: number }>(), { width: 96, height: 28 })
const uid = useId()

const path = computed(() => {
  const v = props.values
  if (v.length < 2) return ''
  const max = Math.max(...v)
  const pad = 2
  const h = props.height - pad * 2
  // RTL like the main chart: oldest on the right. monotonePath wants ascending x.
  return monotonePath(
    v.map((y, i) => ({ x: props.width - (i / (v.length - 1)) * props.width, y: pad + h - (max === 0 ? 0 : (y / max) * h) })).reverse(),
  )
})
const area = computed(() => (path.value ? `${path.value}L${props.width},${props.height}L0,${props.height}Z` : ''))
</script>

<template>
  <svg v-if="path" :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" class="block overflow-visible" aria-hidden="true" data-testid="sparkline">
    <defs>
      <linearGradient :id="`${uid}-s`" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--chart-area)" stop-opacity="0.5" />
        <stop offset="100%" stop-color="var(--chart-area)" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path :d="area" :fill="`url(#${uid}-s)`" class="chart-fade" />
    <path :d="path" fill="none" stroke="var(--chart-line)" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" pathLength="1" class="chart-draw" />
  </svg>
</template>
