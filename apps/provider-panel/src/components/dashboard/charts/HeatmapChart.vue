<!--
  Weekday × hour heatmap of appointments ("when are customers in the chair?").

  A real <table> -- rows are the Iranian week (شنبه first), columns the hours -- so screen
  readers get row/column headers and the count in every cell for free; the colour is an
  addition on top. Cells are not tab stops (98 of them would bury the page); hovering one
  writes its reading into the caption line under the grid instead.

  Hours shown: the salon's own active span widened to at least 09:00–21:00, so a quiet salon
  still reads as a working day and nothing outside it is clipped.
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatNumber } from '@/utils/digits'

export interface HeatCell {
  /** 0 = Sunday … 6 = Saturday (Postgres DOW), Tehran local. */
  weekday: number
  hour: number
  count: number
}

const props = defineProps<{ cells: HeatCell[]; caption: string }>()

// Display order: the Iranian week. Labels indexed by Postgres DOW.
const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5]
const DAY_LABELS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']
const DAY_SHORT = ['ی', 'د', 'س', 'چ', 'پ', 'ج', 'ش']

const hours = computed(() => {
  const used = props.cells.filter((c) => c.count > 0).map((c) => c.hour)
  const lo = Math.min(9, ...used)
  const hi = Math.max(21, ...used)
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
})

const lookup = computed(() => {
  const m = new Map<string, number>()
  for (const c of props.cells) m.set(`${c.weekday}-${c.hour}`, c.count)
  return m
})
const max = computed(() => Math.max(0, ...props.cells.map((c) => c.count)))

function countAt(day: number, hour: number): number {
  return lookup.value.get(`${day}-${hour}`) ?? 0
}

/** Five steps rather than a continuous ramp: easier to read, and the legend can show them. */
function level(count: number): number {
  if (count === 0 || max.value === 0) return 0
  return Math.max(1, Math.ceil((count / max.value) * 4))
}
const LEVEL_MIX = [0, 22, 45, 70, 100]
function cellStyle(count: number) {
  const l = level(count)
  if (l === 0) return { background: 'var(--color-surface-subtle)' }
  return { background: `color-mix(in srgb, var(--chart-line) ${LEVEL_MIX[l]}%, var(--color-accent-soft))` }
}

function hourLabel(h: number): string {
  return `${formatNumber(h)}`
}
function describe(day: number, hour: number): string {
  const c = countAt(day, hour)
  return `${DAY_LABELS[day]}، ساعت ${formatNumber(hour)} تا ${formatNumber(hour + 1)}: ${c === 0 ? 'بدون نوبت' : `${formatNumber(c)} نوبت`}`
}

const hovered = ref<{ day: number; hour: number } | null>(null)
const readout = computed(() => (hovered.value ? describe(hovered.value.day, hovered.value.hour) : null))
</script>

<template>
  <div data-testid="heatmap">
    <!-- Scrolls inside the card on a narrow phone rather than squeezing cells unreadably. -->
    <div class="relative -mx-1 overflow-x-auto px-1 pb-1">
      <table class="w-full min-w-[30rem] border-separate border-spacing-1" @mouseleave="hovered = null">
        <caption class="sr-only">{{ caption }}</caption>
        <thead>
          <tr>
            <th scope="col" class="w-10"><span class="sr-only">روز</span></th>
            <th v-for="h in hours" :key="h" scope="col" class="tnum text-center text-xs font-normal text-(--color-text-muted)">
              <span :class="h % 2 === 1 ? 'max-sm:invisible' : ''">{{ hourLabel(h) }}</span>
              <span class="sr-only"> تا {{ formatNumber(h + 1) }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in WEEK_ORDER" :key="d">
            <th scope="row" class="pe-1 text-start text-xs font-medium whitespace-nowrap text-(--color-text-muted)">
              <span class="sm:hidden" aria-hidden="true">{{ DAY_SHORT[d] }}</span>
              <span class="max-sm:sr-only">{{ DAY_LABELS[d] }}</span>
            </th>
            <td
              v-for="h in hours"
              :key="h"
              :data-testid="countAt(d, h) > 0 ? 'heatmap-cell-active' : undefined"
              class="h-7 rounded-md transition-[outline] duration-100"
              :class="hovered && hovered.day === d && hovered.hour === h ? 'outline-2 outline-(--color-text)' : ''"
              :style="cellStyle(countAt(d, h))"
              @mouseenter="hovered = { day: d, hour: h }"
              @click="hovered = { day: d, hour: h }"
            >
              <span class="sr-only">{{ countAt(d, h) === 0 ? 'بدون نوبت' : `${formatNumber(countAt(d, h))} نوبت` }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-(--color-text-muted)">
      <p class="min-h-5" aria-hidden="true" data-testid="heatmap-readout">{{ readout ?? 'برای دیدن جزئیات، نشانگر را روی خانه‌ها ببرید.' }}</p>
      <div class="flex items-center gap-1.5" aria-hidden="true">
        <span>کم</span>
        <span v-for="l in 5" :key="l" class="h-3 w-4 rounded-sm" :style="l === 1 ? { background: 'var(--color-surface-subtle)' } : { background: `color-mix(in srgb, var(--chart-line) ${LEVEL_MIX[l - 1]}%, var(--color-accent-soft))` }" />
        <span>زیاد</span>
      </div>
    </div>
  </div>
</template>
