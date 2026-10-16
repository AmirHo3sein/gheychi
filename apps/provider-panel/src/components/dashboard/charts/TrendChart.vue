<!--
  Day-by-day area chart for the dashboard, hand-rolled SVG (no chart library: a few hundred
  lines keep the palette, RTL and accessibility fully ours at ~0 KB of dependency).

  RTL: time runs the way this app reads -- the oldest day on the right, today on the left --
  and the value axis sits on the right edge, beside the start of each gridline.

  Interaction: pointer (mouse/touch) or keyboard (focus the chart, then arrow keys / Home /
  End) moves one shared cursor; the tooltip and a polite live region report that day. A
  visually hidden table carries every value for screen readers, so the SVG itself is
  decorative to them.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { formatCompact, labelIndices, monotonePath, niceScale, type Pt } from '@/utils/chart'

export interface TrendPoint {
  /** Stable key (the date). */
  key: string
  /** Short axis label, e.g. «۲۴ مهر». */
  label: string
  /** Full label for the tooltip, e.g. «پنجشنبه ۲۴ مهر». */
  longLabel: string
  value: number
}

const props = withDefaults(
  defineProps<{
    points: TrendPoint[]
    /** The previous period's values, aligned by index (day 1 with day 1). */
    previous?: number[]
    seriesLabel: string
    previousLabel?: string
    /** Full value for tooltip/table, e.g. «۳ نوبت» or «۱٬۲۰۰٬۰۰۰ تومان». */
    formatValue: (value: number) => string
    /** Whole-number axis (counts). */
    integer?: boolean
    caption: string
    height?: number
  }>(),
  { previous: () => [], previousLabel: 'دورهٔ قبل', integer: false, height: 240 },
)

const uid = useId()
const root = ref<HTMLElement | null>(null)
const width = ref(640)
let observer: ResizeObserver | null = null

onMounted(() => {
  if (!root.value) return
  width.value = root.value.clientWidth || 640
  if (typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width
    if (w) width.value = w
  })
  observer.observe(root.value)
})
onBeforeUnmount(() => observer?.disconnect())

const PAD = { top: 14, bottom: 30, start: 52, end: 10 } // start = right edge (RTL)
const plotW = computed(() => Math.max(10, width.value - PAD.start - PAD.end))
const plotH = computed(() => Math.max(10, props.height - PAD.top - PAD.bottom))
const n = computed(() => props.points.length)
const hasPrevious = computed(() => props.previous.some((v) => v > 0))

const scale = computed(() => {
  const all = props.points.map((p) => p.value).concat(hasPrevious.value ? props.previous.slice(0, n.value) : [])
  return niceScale(Math.max(0, ...all), 4, props.integer)
})

/** Index 0 (oldest) sits at the right edge; the last index (today) at the left. */
function xAt(i: number): number {
  if (n.value <= 1) return PAD.end + plotW.value / 2
  return PAD.end + plotW.value - (i / (n.value - 1)) * plotW.value
}
function yAt(v: number): number {
  return PAD.top + plotH.value - (v / scale.value.max) * plotH.value
}
const baseline = computed(() => PAD.top + plotH.value)

function pathFor(values: number[]): string {
  // monotonePath wants ascending x, which in RTL is newest → oldest.
  const pts: Pt[] = values.map((v, i) => ({ x: xAt(i), y: yAt(v) })).reverse()
  return monotonePath(pts)
}

const linePath = computed(() => pathFor(props.points.map((p) => p.value)))
const areaPath = computed(() => {
  if (n.value === 0) return ''
  const left = xAt(n.value - 1)
  const right = xAt(0)
  return `${linePath.value}L${right},${baseline.value}L${left},${baseline.value}Z`
})
const previousPath = computed(() => (hasPrevious.value ? pathFor(props.previous.slice(0, n.value)) : ''))

const ticks = computed(() => {
  const out: Array<{ y: number; label: string }> = []
  for (let v = 0; v <= scale.value.max + 1e-9; v += scale.value.step) {
    out.push({ y: yAt(v), label: formatCompact(v) })
  }
  return out
})

const xLabels = computed(() =>
  labelIndices(n.value, Math.floor(plotW.value / 74)).map((i) => ({ i, x: xAt(i), label: props.points[i]!.label })),
)

const allZero = computed(() => n.value > 0 && props.points.every((p) => p.value === 0))

// ---- cursor -------------------------------------------------------------------------------
const active = ref<number | null>(null)

function indexFromClientX(clientX: number): number | null {
  const el = root.value
  if (!el || n.value === 0) return null
  const rect = el.getBoundingClientRect()
  const x = clientX - rect.left
  if (n.value === 1) return 0
  const t = (PAD.end + plotW.value - x) / plotW.value
  return Math.min(n.value - 1, Math.max(0, Math.round(t * (n.value - 1))))
}
function onPointer(e: PointerEvent) {
  active.value = indexFromClientX(e.clientX)
}
function onLeave(e: PointerEvent) {
  // A touch "leave" fires right after the tap -- keep the tooltip until the next tap.
  if (e.pointerType === 'mouse') active.value = null
}
function onKey(e: KeyboardEvent) {
  if (n.value === 0) return
  const cur = active.value ?? n.value - 1
  // RTL: the left arrow moves towards today (higher index), the right arrow back in time.
  const next =
    e.key === 'ArrowLeft' ? Math.min(n.value - 1, cur + 1)
    : e.key === 'ArrowRight' ? Math.max(0, cur - 1)
    : e.key === 'Home' ? 0
    : e.key === 'End' ? n.value - 1
    : null
  if (next === null) return
  e.preventDefault()
  active.value = next
}

const activePoint = computed(() => (active.value === null ? null : props.points[active.value] ?? null))
const activePrevious = computed(() =>
  active.value === null || !hasPrevious.value ? null : (props.previous[active.value] ?? null),
)
const tooltipStyle = computed(() => {
  if (active.value === null) return {}
  const x = xAt(active.value)
  const w = 168
  const left = Math.min(Math.max(x - w / 2, 0), width.value - w)
  return { left: `${left}px`, width: `${w}px` }
})
const liveText = computed(() => {
  const p = activePoint.value
  if (!p) return ''
  const prev = activePrevious.value
  return `${p.longLabel}: ${props.formatValue(p.value)}${prev !== null ? `، ${props.previousLabel}: ${props.formatValue(prev)}` : ''}`
})
</script>

<template>
  <div>
    <div
      ref="root"
      class="relative touch-pan-y select-none rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent-text)"
      :style="{ height: `${height}px` }"
      tabindex="0"
      role="group"
      :aria-label="`${caption}. برای مرور روزها از کلیدهای جهت استفاده کنید.`"
      :aria-describedby="`${uid}-live`"
      data-testid="trend-chart"
      @pointermove="onPointer"
      @pointerdown="onPointer"
      @pointerleave="onLeave"
      @keydown="onKey"
      @blur="active = null"
    >
      <svg :width="width" :height="height" class="block overflow-visible" aria-hidden="true">
        <defs>
          <linearGradient :id="`${uid}-fill`" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--chart-area)" stop-opacity="0.55" />
            <stop offset="100%" stop-color="var(--chart-area)" stop-opacity="0.04" />
          </linearGradient>
        </defs>

        <!-- Gridlines + value axis on the right (RTL start). -->
        <g>
          <template v-for="t in ticks" :key="t.label + t.y">
            <line :x1="PAD.end" :x2="PAD.end + plotW" :y1="t.y" :y2="t.y" stroke="var(--chart-grid)" stroke-width="1" />
            <text
              :x="width - 4"
              :y="t.y"
              dy="0.32em"
              text-anchor="end"
              fill="var(--chart-axis)"
              class="tnum text-xs"
            >{{ t.label }}</text>
          </template>
        </g>

        <!-- Date axis. -->
        <g>
          <text
            v-for="l in xLabels"
            :key="l.i"
            :x="l.x"
            :y="height - 8"
            :text-anchor="l.i === 0 ? 'end' : l.i === points.length - 1 ? 'start' : 'middle'"
            fill="var(--chart-axis)"
            class="text-xs"
          >{{ l.label }}</text>
        </g>

        <!-- Keyed on the data, so a period switch replays the draw-in. -->
        <g :key="points.map((p) => p.key + p.value).join('|')">
          <path v-if="previousPath" :d="previousPath" fill="none" stroke="var(--chart-previous)" stroke-width="1.75" stroke-dasharray="5 5" stroke-linecap="round" class="chart-fade" data-testid="trend-previous" />
          <path :d="areaPath" :fill="`url(#${uid}-fill)`" class="chart-fade" />
          <path :d="linePath" fill="none" stroke="var(--chart-line)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" pathLength="1" class="chart-draw" data-testid="trend-line" />
        </g>

        <!-- Cursor. -->
        <g v-if="activePoint && active !== null">
          <line :x1="xAt(active)" :x2="xAt(active)" :y1="PAD.top" :y2="baseline" stroke="var(--chart-axis)" stroke-width="1" stroke-dasharray="3 3" opacity="0.6" />
          <circle v-if="activePrevious !== null" :cx="xAt(active)" :cy="yAt(activePrevious)" r="4" fill="var(--color-surface-card)" stroke="var(--chart-previous)" stroke-width="2" />
          <circle :cx="xAt(active)" :cy="yAt(activePoint.value)" r="5.5" fill="var(--chart-line)" stroke="var(--color-surface-card)" stroke-width="2.5" />
        </g>
      </svg>

      <p
        v-if="allZero"
        data-testid="trend-empty"
        class="pointer-events-none absolute inset-x-0 top-1/3 mx-auto w-fit rounded-full bg-(--color-surface-card)/90 px-3 py-1 text-xs text-(--color-text-muted) shadow-(--shadow-sm)"
      >در این دوره هنوز موردی ثبت نشده است.</p>

      <div
        v-if="activePoint"
        class="pointer-events-none absolute top-1 z-10 rounded-xl border border-(--color-border) bg-(--color-surface-card) px-3 py-2 text-xs shadow-(--shadow-md)"
        :style="tooltipStyle"
        data-testid="trend-tooltip"
      >
        <p class="mb-1 font-semibold text-(--color-text)">{{ activePoint.longLabel }}</p>
        <p class="flex items-center justify-between gap-2">
          <span class="flex items-center gap-1.5 text-(--color-text-muted)"><span class="h-2 w-2 rounded-full bg-(--chart-line)" />{{ seriesLabel }}</span>
          <span class="tnum font-bold text-(--color-text)">{{ formatValue(activePoint.value) }}</span>
        </p>
        <p v-if="activePrevious !== null" class="mt-0.5 flex items-center justify-between gap-2">
          <span class="flex items-center gap-1.5 text-(--color-text-muted)"><span class="h-0.5 w-2.5 bg-(--chart-previous)" />{{ previousLabel }}</span>
          <span class="tnum text-(--color-text-muted)">{{ formatValue(activePrevious) }}</span>
        </p>
      </div>
    </div>

    <p :id="`${uid}-live`" class="sr-only" aria-live="polite">{{ liveText }}</p>
    <table class="sr-only">
      <caption>{{ caption }}</caption>
      <thead>
        <tr>
          <th scope="col">روز</th>
          <th scope="col">{{ seriesLabel }}</th>
          <th v-if="hasPrevious" scope="col">{{ previousLabel }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(p, i) in points" :key="p.key">
          <th scope="row">{{ p.longLabel }}</th>
          <td>{{ formatValue(p.value) }}</td>
          <td v-if="hasPrevious">{{ formatValue(previous[i] ?? 0) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
