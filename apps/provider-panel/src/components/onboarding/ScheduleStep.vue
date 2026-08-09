<!-- apps/provider-panel/src/components/onboarding/ScheduleStep.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '../ui/AppIcon.vue'
import { WEEKDAY_DISPLAY_ORDER, WEEKDAY_LABELS, type WorkingHourRow } from '@/utils/working-hours'

const model = defineModel<WorkingHourRow[]>({
  required: true,
})

withDefaults(defineProps<{ invalidWeekdays?: number[] }>(), { invalidWeekdays: () => [] })

// model[i].weekday === i always holds (both callers build it via Array.from({length:7}, (_,
// weekday) => ({weekday, ...})), so reindexing into Saturday-first order for RENDER ONLY is
// just a lookup -- the array elements are the same reactive objects either way, so v-model
// bindings below still mutate the real, weekday-int-keyed entries in `model`.
const orderedDays = computed(() => WEEKDAY_DISPLAY_ORDER.map((weekday) => model.value[weekday]!))

// A second (or third) range on the same day is how a lunch break / split shift is expressed
// -- the API has always supported multiple working_hours rows per weekday, this is just the
// UI catching up. Starting the new range right after the day's last one ends (when there's
// room before midnight) turns "add a lunch break" into "confirm the times" instead of typing
// both fields from scratch; with no room left, or no existing range, it falls back to a plain
// default.
function addRange(day: WorkingHourRow) {
  const last = day.ranges[day.ranges.length - 1]
  const openTime = last && last.closeTime < '22:00' ? last.closeTime : '09:00'
  day.ranges.push({ openTime, closeTime: '20:00' })
}

function removeRange(day: WorkingHourRow, index: number) {
  day.ranges.splice(index, 1)
}
</script>

<template>
  <div class="max-w-2xl space-y-2">
    <div
      v-for="day in orderedDays"
      :key="day.weekday"
      :data-testid="`day-${day.weekday}`"
      class="flex flex-col gap-2 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-3 transition-colors sm:flex-row sm:items-start sm:gap-3"
      :class="[!day.enabled && 'opacity-60', invalidWeekdays.includes(day.weekday) && 'border-(--color-danger)']"
    >
      <!--
        Below sm the day name takes its own row and the time fields stack under it. One row
        genuinely cannot fit on a phone: a native `<input type="time">` has an intrinsic
        min-content width of ~85px that flex-1 can't shrink past, so 96px of label + 2x85px +
        the «تا» separator + gaps overflowed the card (and the page) at every width below
        ~400px -- and in RTL that overflow escapes off the LEFT edge, where it is easy to
        miss. min-w-0 on the inputs lets them actually shrink inside their row.
      -->
      <label class="flex min-h-11 shrink-0 items-center gap-2 text-sm font-medium text-(--color-text) sm:w-24">
        <input v-model="day.enabled" type="checkbox" class="h-4 w-4 accent-(--color-accent)" />
        {{ WEEKDAY_LABELS[day.weekday] }}
      </label>
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <div v-for="(dayRange, i) in day.ranges" :key="i" class="flex min-w-0 items-center gap-2 sm:gap-3">
          <input
            v-model="dayRange.openTime"
            :disabled="!day.enabled"
            :aria-invalid="invalidWeekdays.includes(day.weekday) || undefined"
            type="time"
            class="tnum min-h-11 w-full min-w-0 flex-1 rounded-xl border border-(--color-border) bg-(--color-surface) p-2 text-sm disabled:opacity-50"
          />
          <span class="shrink-0 text-xs text-(--color-text-muted)">تا</span>
          <input
            v-model="dayRange.closeTime"
            :disabled="!day.enabled"
            :aria-invalid="invalidWeekdays.includes(day.weekday) || undefined"
            type="time"
            class="tnum min-h-11 w-full min-w-0 flex-1 rounded-xl border border-(--color-border) bg-(--color-surface) p-2 text-sm disabled:opacity-50"
          />
          <!-- Only offered once there's a second range to remove -- a day always needs at
               least one range while enabled, so removing the only one would just be a
               confusing way to spell "disable this day" (the checkbox already does that). -->
          <button
            v-if="day.ranges.length > 1"
            type="button"
            data-testid="remove-range"
            :disabled="!day.enabled"
            :aria-label="`حذف این بازه از ${WEEKDAY_LABELS[day.weekday]}`"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-(--color-text-muted) transition-colors hover:bg-(--color-border-soft) disabled:opacity-50"
            @click="removeRange(day, i)"
          >
            <AppIcon name="x" :size="16" />
          </button>
        </div>
        <button
          v-if="day.enabled"
          type="button"
          data-testid="add-range"
          class="flex min-h-11 w-fit items-center gap-1.5 rounded-xl px-2 text-xs font-medium text-(--color-accent-text) transition-colors hover:bg-(--color-border-soft)"
          @click="addRange(day)"
        >
          <AppIcon name="plus" :size="14" />
          افزودن بازه (مثلاً استراحت ناهار)
        </button>
      </div>
    </div>
  </div>
</template>
