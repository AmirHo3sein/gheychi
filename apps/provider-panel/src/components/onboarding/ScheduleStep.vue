<!-- apps/provider-panel/src/components/onboarding/ScheduleStep.vue -->
<script setup lang="ts">
const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']

const model = defineModel<Array<{ weekday: number; openTime: string; closeTime: string; enabled: boolean }>>({
  required: true,
})
</script>

<template>
  <div class="space-y-2">
    <div v-for="day in model" :key="day.weekday" class="flex items-center gap-2" :data-testid="`day-${day.weekday}`">
      <label class="flex w-24 items-center gap-2">
        <input v-model="day.enabled" type="checkbox" />
        {{ WEEKDAYS[day.weekday] }}
      </label>
      <input v-model="day.openTime" :disabled="!day.enabled" type="time" class="rounded-lg border p-2" />
      <span>تا</span>
      <input v-model="day.closeTime" :disabled="!day.enabled" type="time" class="rounded-lg border p-2" />
    </div>
  </div>
</template>
