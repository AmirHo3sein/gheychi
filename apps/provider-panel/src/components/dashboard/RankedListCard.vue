<script setup lang="ts">
import { computed } from 'vue'
import AppCard from '@/components/ui/AppCard.vue'
import { formatNumber } from '@/utils/digits'

const props = defineProps<{
  title: string
  emptyText: string
  /** `detail` is an optional secondary figure under the bar (e.g. the value in toman). */
  rows: Array<{ key: string; name: string; count: number; detail?: string }>
  /** data-testid applied to each row. */
  rowTestId: string
}>()

// Bars are relative to the leader, so the top row always spans the full width and the rest
// read as "how close to the most popular".
const max = computed(() => Math.max(1, ...props.rows.map((r) => r.count)))
</script>

<template>
  <AppCard>
    <h2 class="mb-3 text-sm font-bold text-(--color-text)">{{ title }}</h2>
    <p v-if="rows.length === 0" class="text-xs text-(--color-text-muted)">{{ emptyText }}</p>
    <ol v-else class="space-y-3">
      <li v-for="(row, i) in rows" :key="row.key" :data-testid="rowTestId">
        <div class="mb-1 flex items-baseline justify-between gap-2 text-sm">
          <span class="flex min-w-0 items-baseline gap-2">
            <span class="tnum w-4 shrink-0 text-xs text-(--color-text-muted)" aria-hidden="true">{{ formatNumber(i + 1) }}</span>
            <span class="min-w-0 break-words text-(--color-text)">{{ row.name }}</span>
          </span>
          <span class="tnum shrink-0 font-semibold text-(--color-text)">{{ formatNumber(row.count) }} نوبت</span>
        </div>
        <div class="ms-6 h-2 overflow-hidden rounded-full bg-(--color-surface-subtle)" aria-hidden="true">
          <div
            class="chart-grow h-full rounded-full"
            :class="i === 0 ? 'bg-(--chart-line)' : 'bg-(--chart-area)'"
            :style="{ width: `${(row.count / max) * 100}%`, animationDelay: `${i * 60}ms` }"
          />
        </div>
        <p v-if="row.detail" class="tnum ms-6 mt-1 text-xs text-(--color-text-muted)">{{ row.detail }}</p>
      </li>
    </ol>
  </AppCard>
</template>
