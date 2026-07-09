<!-- apps/provider-panel/src/components/onboarding/ScheduleStep.vue -->
<script setup lang="ts">
const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']

const model = defineModel<Array<{ weekday: number; openTime: string; closeTime: string; enabled: boolean }>>({
  required: true,
})
</script>

<template>
  <div class="space-y-2">
    <div
      v-for="day in model"
      :key="day.weekday"
      :data-testid="`day-${day.weekday}`"
      class="flex items-center gap-3 rounded-xl border border-(--color-border) bg-(--color-surface-card) p-3 transition-colors"
      :class="!day.enabled && 'opacity-60'"
    >
      <label class="flex w-24 shrink-0 items-center gap-2 text-sm font-medium text-(--color-text)">
        <input v-model="day.enabled" type="checkbox" class="h-4 w-4 accent-(--color-accent)" />
        {{ WEEKDAYS[day.weekday] }}
      </label>
      <input
        v-model="day.openTime"
        :disabled="!day.enabled"
        type="time"
        class="tnum flex-1 rounded-lg border border-(--color-border) bg-(--color-surface) p-2 text-sm disabled:opacity-50"
      />
      <span class="text-xs text-(--color-muted)">تا</span>
      <input
        v-model="day.closeTime"
        :disabled="!day.enabled"
        type="time"
        class="tnum flex-1 rounded-lg border border-(--color-border) bg-(--color-surface) p-2 text-sm disabled:opacity-50"
      />
    </div>
  </div>
</template>
