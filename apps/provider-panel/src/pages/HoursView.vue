<!-- apps/provider-panel/src/pages/HoursView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ScheduleStep from '@/components/onboarding/ScheduleStep.vue'
import { useApi } from '@/composables/useApi'

interface WorkingHour {
  weekday: number
  openTime: string
  closeTime: string
}
interface ScheduleException {
  id: string
  date: string
  isClosed: boolean
}

const { apiFetch } = useApi()
const hours = ref(
  Array.from({ length: 7 }, (_, weekday) => ({ weekday, openTime: '09:00', closeTime: '20:00', enabled: false })),
)
const exceptions = ref<ScheduleException[]>([])
const newExceptionDate = ref('')

async function loadHours() {
  const { data } = await apiFetch<WorkingHour[]>('/salons/mine/hours', { silent: true })
  if (!data) return
  for (const day of hours.value) {
    const match = data.find((h) => h.weekday === day.weekday)
    // Postgres `time` columns round-trip through pg as HH:MM:SS, but the PUT
    // validation (HourRangeDto) and the <input type="time"> fields only accept HH:MM.
    if (match) {
      Object.assign(day, {
        weekday: match.weekday,
        openTime: match.openTime.slice(0, 5),
        closeTime: match.closeTime.slice(0, 5),
        enabled: true,
      })
    }
  }
}

async function loadExceptions() {
  const { data } = await apiFetch<ScheduleException[]>('/salons/mine/exceptions', { silent: true })
  exceptions.value = data ?? []
}

onMounted(() => {
  loadHours()
  loadExceptions()
})

async function saveHours() {
  const enabled = hours.value
    .filter((h) => h.enabled)
    .map(({ weekday, openTime, closeTime }) => ({ weekday, openTime, closeTime }))
  await apiFetch('/salons/mine/hours', { method: 'PUT', body: { hours: enabled } })
}

async function addException() {
  if (!newExceptionDate.value) return
  await apiFetch('/salons/mine/exceptions', { method: 'POST', body: { date: newExceptionDate.value, isClosed: true } })
  newExceptionDate.value = ''
  await loadExceptions()
}

async function removeException(id: string) {
  await apiFetch(`/salons/mine/exceptions/${id}`, { method: 'DELETE' })
  await loadExceptions()
}
</script>

<template>
  <div class="space-y-6 p-4">
    <section>
      <h1 class="mb-2 text-lg font-bold">ساعات کاری هفتگی</h1>
      <ScheduleStep v-model="hours" />
      <button
        type="button"
        data-testid="save-hours"
        class="mt-3 rounded-lg bg-(--color-accent) px-4 py-2 text-white"
        @click="saveHours"
      >
        ذخیره ساعات کاری
      </button>
    </section>

    <section>
      <h2 class="mb-2 font-bold">تعطیلی‌های موردی</h2>
      <div class="flex gap-2">
        <input v-model="newExceptionDate" type="date" class="flex-1 rounded-lg border p-2" />
        <button type="button" class="rounded-lg border px-3" @click="addException">افزودن</button>
      </div>
      <ul class="mt-2 space-y-1">
        <li v-for="e in exceptions" :key="e.id" class="flex items-center justify-between rounded border p-2 text-sm">
          {{ e.date }}
          <button type="button" class="text-red-600" @click="removeException(e.id)">حذف</button>
        </li>
      </ul>
    </section>
  </div>
</template>
