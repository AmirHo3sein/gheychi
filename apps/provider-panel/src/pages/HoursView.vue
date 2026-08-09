<!-- apps/provider-panel/src/pages/HoursView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ScheduleStep from '@/components/onboarding/ScheduleStep.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import { toPersianDigits } from '@/utils/digits'
import { validateWorkingHours } from '@/utils/working-hours'

interface WorkingHour {
  weekday: number
  openTime: string
  closeTime: string
}
interface TimeRange {
  openTime: string
  closeTime: string
}
interface ScheduleException {
  id: string
  date: string
  isClosed: boolean
  startTime: string | null
  endTime: string | null
  reason: string | null
}

const { apiFetch } = useApi()
const { push: pushToast } = useToast()
const hours = ref(
  Array.from({ length: 7 }, (_, weekday) => ({ weekday, enabled: false, ranges: [{ openTime: '09:00', closeTime: '20:00' }] as TimeRange[] })),
)
const exceptions = ref<ScheduleException[]>([])
const newExceptionDate = ref('')
// Defaults to a whole-day closure (unchanged existing behavior) -- checking this reveals the
// start/end time fields for a partial-day closure instead (a supplier visit, a mid-day repair).
const newExceptionPartialDay = ref(false)
const newExceptionStartTime = ref('13:00')
const newExceptionEndTime = ref('14:00')
const newExceptionReason = ref('')
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
    // A day can now have more than one working_hours row (a lunch-break split shift) --
    // every match for this weekday becomes one range, not just the first. GET /salons/mine/hours
    // already orders by (weekday, openTime), so `matches` arrives in display order for free.
    // Postgres `time` columns round-trip through pg as HH:MM:SS, but the PUT validation
    // (HourRangeDto) and the <input type="time"> fields only accept HH:MM.
    const matches = (data ?? []).filter((h) => h.weekday === day.weekday)
    if (matches.length > 0) {
      day.enabled = true
      day.ranges = matches.map((m) => ({ openTime: m.openTime.slice(0, 5), closeTime: m.closeTime.slice(0, 5) }))
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
    .flatMap((h) => h.ranges.map((r) => ({ weekday: h.weekday, openTime: r.openTime, closeTime: r.closeTime })))
  const { error } = await apiFetch('/salons/mine/hours', { method: 'PUT', body: { hours: enabled } })
  saving.value = false
  if (!error) pushToast('ساعات کاری ذخیره شد')
}

async function addException() {
  if (!newExceptionDate.value) return
  const body: { date: string; isClosed: true; startTime?: string; endTime?: string; reason?: string } = {
    date: newExceptionDate.value,
    isClosed: true,
  }
  if (newExceptionPartialDay.value) {
    body.startTime = newExceptionStartTime.value
    body.endTime = newExceptionEndTime.value
  }
  if (newExceptionReason.value.trim()) body.reason = newExceptionReason.value.trim()

  const { error } = await apiFetch('/salons/mine/exceptions', { method: 'POST', body })
  // A rejected submission (e.g. an inverted partial-day range) keeps the form filled in --
  // apiFetch's own toast already explains why, so clearing the owner's typed date/times here
  // would just make them re-enter everything to retry the same mistake.
  if (error) return

  newExceptionDate.value = ''
  newExceptionPartialDay.value = false
  newExceptionStartTime.value = '13:00'
  newExceptionEndTime.value = '14:00'
  newExceptionReason.value = ''
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

// Postgres `time` columns round-trip through pg as HH:MM:SS -- same truncation loadHours()
// already does for working_hours. A plain string slice, not an Intl call, so it renders
// ASCII digits unless converted explicitly.
function exceptionTimeRangeLabel(e: ScheduleException): string | null {
  if (!e.startTime || !e.endTime) return null
  return `${toPersianDigits(e.startTime.slice(0, 5))} تا ${toPersianDigits(e.endTime.slice(0, 5))}`
}
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-6 p-4 lg:p-6">
    <h1 class="text-lg font-bold text-(--color-text)">ساعات کاری</h1>

    <div v-if="loadError" class="space-y-3 rounded-2xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">اطلاعات ساعات کاری بارگذاری نشد.</p>
      <AppButton type="button" variant="secondary" data-testid="retry-hours" @click="loadAll">تلاش دوباره</AppButton>
    </div>

    <!-- Two independent setup surfaces. Stacked on phone/tablet-portrait; side by side from
         lg, so a desktop setup session sees the whole week and its exceptions at once
         rather than a narrow column with most of a 1920px screen left empty. -->
    <div v-else class="grid gap-6 lg:grid-cols-2 lg:items-start">
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
          <AppCard :padded="false" class="space-y-3 p-3.5">
            <div>
              <label class="mb-1.5 block text-sm font-medium text-(--color-text)">تاریخ تعطیلی</label>
              <JalaliDatePicker v-model="newExceptionDate" aria-label="تاریخ تعطیلی" />
            </div>

            <label class="flex min-h-11 items-center gap-2 text-sm text-(--color-text)">
              <input v-model="newExceptionPartialDay" type="checkbox" data-testid="exception-partial-day" class="h-4 w-4 accent-(--color-accent)" />
              فقط بخشی از روز تعطیل است
            </label>

            <!--
              Same field styling as ScheduleStep.vue's own time inputs, for visual consistency
              between the two forms on this page. Defaults to a whole-day closure (unchanged
              existing behavior) until this is checked.
            -->
            <div v-if="newExceptionPartialDay" class="flex min-w-0 items-center gap-2 sm:gap-3">
              <input
                v-model="newExceptionStartTime"
                type="time"
                data-testid="exception-start-time"
                aria-label="ساعت شروع تعطیلی"
                class="tnum min-h-11 w-full min-w-0 flex-1 rounded-xl border border-(--color-border) bg-(--color-surface) p-2 text-sm"
              />
              <span class="shrink-0 text-xs text-(--color-text-muted)">تا</span>
              <input
                v-model="newExceptionEndTime"
                type="time"
                data-testid="exception-end-time"
                aria-label="ساعت پایان تعطیلی"
                class="tnum min-h-11 w-full min-w-0 flex-1 rounded-xl border border-(--color-border) bg-(--color-surface) p-2 text-sm"
              />
            </div>

            <AppInput
              v-model="newExceptionReason"
              label="دلیل (اختیاری)"
              placeholder="مثلاً تعمیرات یا تعطیلات"
              data-testid="exception-reason"
            />

            <AppButton type="button" variant="secondary" block data-testid="add-exception" @click="addException">
              <template #icon><AppIcon name="plus" :size="16" /></template>
              افزودن تعطیلی
            </AppButton>
          </AppCard>

          <EmptyState v-if="exceptions.length === 0" icon="hours" message="تعطیلی موردی ثبت نشده است." class="mt-3" />
          <div v-else class="mt-3 space-y-2">
            <AppCard v-for="e in exceptions" :key="e.id" :padded="false" class="flex items-center justify-between gap-2 p-3">
              <div class="min-w-0">
                <p class="tnum text-sm text-(--color-text)">
                  {{ exceptionDateLabel(e) }}
                  <span v-if="exceptionTimeRangeLabel(e)" class="text-(--color-text-muted)"> — {{ exceptionTimeRangeLabel(e) }}</span>
                </p>
                <p v-if="e.reason" class="mt-0.5 truncate text-xs text-(--color-text-muted)">{{ e.reason }}</p>
              </div>
              <AppButton type="button" variant="danger" class="shrink-0" aria-label="حذف تعطیلی" @click="removeException(e.id)">
                <AppIcon name="trash" :size="16" />
              </AppButton>
            </AppCard>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>
