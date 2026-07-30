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
import { validateWorkingHours } from '@/utils/working-hours'

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
const hoursError = ref('')
const invalidWeekdays = ref<number[]>([])

// Gates both sections until the first load settles -- saving/rendering against the
// all-days-disabled seed state before the real schedule arrives would silently wipe it.
const loading = ref(true)
const loadError = ref(false)

async function loadHours(): Promise<boolean> {
  const { data, error } = await apiFetch<WorkingHour[]>('/salons/mine/hours', { silent: true })
  if (error) return false
  for (const day of hours.value) {
    const match = data?.find((h) => h.weekday === day.weekday)
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
  return true
}

async function loadExceptions(): Promise<boolean> {
  const { data, error } = await apiFetch<ScheduleException[]>('/salons/mine/exceptions', { silent: true })
  if (error) return false
  exceptions.value = data ?? []
  return true
}

async function loadAll() {
  loading.value = true
  loadError.value = false
  const [hoursOk, exceptionsOk] = await Promise.all([loadHours(), loadExceptions()])
  loadError.value = !hoursOk || !exceptionsOk
  loading.value = false
}

onMounted(loadAll)

async function saveHours() {
  // Same rule the onboarding wizard's step 2 gates on -- see utils/working-hours.ts.
  const validation = validateWorkingHours(hours.value)
  hoursError.value = validation.message
  invalidWeekdays.value = validation.invalid
  if (validation.message) return

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
  if (!window.confirm('این تعطیلی حذف شود؟')) return
  await apiFetch(`/salons/mine/exceptions/${id}`, { method: 'DELETE' })
  await loadExceptions()
}

function exceptionDateLabel(e: ScheduleException): string {
  return new Date(e.date).toLocaleDateString('fa-IR')
}
</script>

<template>
  <div class="space-y-6 p-4">
    <h1 class="text-lg font-bold text-(--color-text)">ساعات کاری</h1>

    <div v-if="loadError" class="space-y-3 rounded-2xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">اطلاعات ساعات کاری بارگذاری نشد.</p>
      <AppButton type="button" variant="secondary" data-testid="retry-hours" @click="loadAll">تلاش دوباره</AppButton>
    </div>

    <template v-else>
      <section>
        <h2 class="mb-2 text-sm font-bold text-(--color-text)">ساعات کاری هفتگی</h2>
        <div
          v-if="loading"
          class="max-w-2xl rounded-2xl border border-dashed border-(--color-border) py-10 text-center text-sm text-(--color-text-muted)"
        >
          در حال بارگذاری…
        </div>
        <template v-else>
          <ScheduleStep v-model="hours" :invalid-weekdays="invalidWeekdays" />
          <p
            v-if="hoursError"
            class="mt-2 max-w-2xl flex items-center gap-2 rounded-xl bg-(--tone-danger-bg) p-3 text-sm text-(--tone-danger-text)"
          >
            {{ hoursError }}
          </p>
          <AppButton
            type="button"
            data-testid="save-hours"
            block
            class="mt-3 max-w-2xl"
            :disabled="saving"
            :loading="saving"
            @click="saveHours"
          >
            {{ saving ? 'در حال ذخیره…' : 'ذخیره ساعات کاری' }}
          </AppButton>
        </template>
      </section>

      <section>
        <h2 class="mb-2 text-sm font-bold text-(--color-text)">تعطیلی‌های موردی</h2>
        <div v-if="loading" class="rounded-2xl border border-dashed border-(--color-border) py-10 text-center text-sm text-(--color-text-muted)">
          در حال بارگذاری…
        </div>
        <template v-else>
          <div class="flex gap-2">
            <AppInput v-model="newExceptionDate" label="تاریخ تعطیلی" type="date" class="tnum flex-1" />
            <AppButton type="button" variant="secondary" aria-label="افزودن تعطیلی" @click="addException">
              <AppIcon name="plus" :size="16" />
            </AppButton>
          </div>
          <EmptyState v-if="exceptions.length === 0" icon="hours" message="تعطیلی موردی ثبت نشده است." class="mt-3" />
          <div v-else class="mt-3 space-y-2">
            <AppCard v-for="e in exceptions" :key="e.id" :padded="false" class="flex items-center justify-between p-3">
              <span class="tnum text-sm text-(--color-text)">{{ exceptionDateLabel(e) }}</span>
              <AppButton type="button" variant="danger" aria-label="حذف تعطیلی" @click="removeException(e.id)">
                <AppIcon name="trash" :size="16" />
              </AppButton>
            </AppCard>
          </div>
        </template>
      </section>
    </template>
  </div>
</template>
