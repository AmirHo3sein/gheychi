<!-- apps/provider-panel/src/pages/HoursView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ScheduleStep from '@/components/onboarding/ScheduleStep.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'

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
const { push: pushToast } = useToast()
const hours = ref(
  Array.from({ length: 7 }, (_, weekday) => ({ weekday, openTime: '09:00', closeTime: '20:00', enabled: false })),
)
const exceptions = ref<ScheduleException[]>([])
const newExceptionDate = ref('')
const saving = ref(false)

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
  saving.value = true
  const enabled = hours.value
    .filter((h) => h.enabled)
    .map(({ weekday, openTime, closeTime }) => ({ weekday, openTime, closeTime }))
  const { error } = await apiFetch('/salons/mine/hours', { method: 'PUT', body: { hours: enabled } })
  saving.value = false
  if (!error) pushToast('ساعات کاری ذخیره شد')
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
    <h1 class="text-lg font-bold text-(--color-text)">ساعات کاری</h1>

    <section>
      <h2 class="mb-2 text-sm font-bold text-(--color-text)">ساعات کاری هفتگی</h2>
      <ScheduleStep v-model="hours" />
      <AppButton type="button" data-testid="save-hours" block class="mt-3" :disabled="saving" :loading="saving" @click="saveHours">
        {{ saving ? 'در حال ذخیره…' : 'ذخیره ساعات کاری' }}
      </AppButton>
    </section>

    <section>
      <h2 class="mb-2 text-sm font-bold text-(--color-text)">تعطیلی‌های موردی</h2>
      <div class="flex gap-2">
        <AppInput v-model="newExceptionDate" type="date" class="tnum flex-1" />
        <AppButton type="button" variant="secondary" @click="addException">
          <AppIcon name="plus" :size="16" />
        </AppButton>
      </div>
      <EmptyState v-if="exceptions.length === 0" icon="hours" message="تعطیلی موردی ثبت نشده است." class="mt-3" />
      <div v-else class="mt-3 space-y-2">
        <AppCard v-for="e in exceptions" :key="e.id" :padded="false" class="flex items-center justify-between p-3">
          <span class="tnum text-sm text-(--color-text)">{{ e.date }}</span>
          <AppButton type="button" variant="danger" @click="removeException(e.id)">
            <AppIcon name="trash" :size="16" />
          </AppButton>
        </AppCard>
      </div>
    </section>
  </div>
</template>
