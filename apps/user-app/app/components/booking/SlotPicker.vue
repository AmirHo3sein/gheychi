<script setup lang="ts">
import { pickDefaultDate, formatSlotTime, formatDateLabel, type DayAvailability } from '../../utils/slot-format'

const props = defineProps<{ salonId: string; serviceId: string }>()
const emit = defineEmits<{ select: [iso: string] }>()

const { apiFetch } = useApi()
const days = ref<DayAvailability[]>([])
const selectedDate = ref<string | null>(null)
const loading = ref(true)
const hasError = ref(false)

onMounted(async () => {
  loading.value = true
  const { data, error } = await apiFetch<DayAvailability[]>(`/salons/${props.salonId}/availability`, {
    query: { serviceId: props.serviceId },
    silent: true,
  })
  hasError.value = !!error
  days.value = data ?? []
  selectedDate.value = pickDefaultDate(days.value)
  loading.value = false
})

const daysWithSlots = computed(() => days.value.filter((d) => d.slots.length > 0))
const slotsForSelectedDate = computed(() => days.value.find((d) => d.date === selectedDate.value)?.slots ?? [])
const hasAnySlots = computed(() => daysWithSlots.value.length > 0)

function selectDate(date: string) {
  selectedDate.value = date
}
</script>

<template>
  <div v-if="loading" class="py-6 text-center text-sm">در حال بارگذاری...</div>
  <div v-else-if="hasError" class="py-6 text-center text-sm">مشکلی پیش آمد، دوباره تلاش کنید</div>
  <div v-else-if="!hasAnySlots" class="py-6 text-center text-sm">نوبت خالی — این سالن در ۱۴ روز آینده نوبت آزاد ندارد</div>
  <div v-else class="space-y-3">
    <div class="flex gap-2 overflow-x-auto">
      <button
        v-for="day in daysWithSlots"
        :key="day.date"
        type="button"
        class="whitespace-nowrap rounded-full px-3 py-1 text-sm"
        :class="selectedDate === day.date ? 'bg-(--color-accent) text-white' : 'bg-(--color-surface-card)'"
        @click="selectDate(day.date)"
      >
        {{ formatDateLabel(day.date) }}
      </button>
    </div>
    <div class="grid grid-cols-4 gap-2">
      <button
        v-for="slot in slotsForSelectedDate"
        :key="slot"
        type="button"
        data-testid="slot-button"
        class="rounded-lg bg-(--color-surface-card) p-2 text-sm"
        @click="emit('select', slot)"
      >
        {{ formatSlotTime(slot) }}
      </button>
    </div>
  </div>
</template>
