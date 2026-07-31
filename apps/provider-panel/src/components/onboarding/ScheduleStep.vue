<!-- apps/provider-panel/src/components/onboarding/ScheduleStep.vue -->
<script setup lang="ts">
import { WEEKDAY_LABELS, type WorkingHourRow } from '@/utils/working-hours'

const model = defineModel<WorkingHourRow[]>({
  required: true,
})

withDefaults(defineProps<{ invalidWeekdays?: number[] }>(), { invalidWeekdays: () => [] })
</script>

<template>
  <div class="max-w-2xl space-y-2">
    <div
      v-for="day in model"
      :key="day.weekday"
      :data-testid="`day-${day.weekday}`"
      class="flex flex-col gap-2 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-3 transition-colors sm:flex-row sm:items-center sm:gap-3"
      :class="[!day.enabled && 'opacity-60', invalidWeekdays.includes(day.weekday) && 'border-(--color-danger)']"
    >
      <!--
        Below sm the day name takes its own row and the two time fields share the next one.
        One row genuinely cannot fit on a phone: a native `<input type="time">` has an
        intrinsic min-content width of ~85px that flex-1 can't shrink past, so 96px of label
        + 2x85px + the «تا» separator + gaps overflowed the card (and the page) at every
        width below ~400px -- and in RTL that overflow escapes off the LEFT edge, where it
        is easy to miss. min-w-0 on the inputs lets them actually shrink inside their row.
      -->
      <label class="flex min-h-11 shrink-0 items-center gap-2 text-sm font-medium text-(--color-text) sm:w-24">
        <input v-model="day.enabled" type="checkbox" class="h-4 w-4 accent-(--color-accent)" />
        {{ WEEKDAY_LABELS[day.weekday] }}
      </label>
      <div class="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <input
          v-model="day.openTime"
          :disabled="!day.enabled"
          :aria-invalid="invalidWeekdays.includes(day.weekday) || undefined"
          type="time"
          class="tnum min-h-11 w-full min-w-0 flex-1 rounded-xl border border-(--color-border) bg-(--color-surface) p-2 text-sm disabled:opacity-50"
        />
        <span class="shrink-0 text-xs text-(--color-text-muted)">تا</span>
        <input
          v-model="day.closeTime"
          :disabled="!day.enabled"
          :aria-invalid="invalidWeekdays.includes(day.weekday) || undefined"
          type="time"
          class="tnum min-h-11 w-full min-w-0 flex-1 rounded-xl border border-(--color-border) bg-(--color-surface) p-2 text-sm disabled:opacity-50"
        />
      </div>
    </div>
  </div>
</template>
