<script setup lang="ts">
import { pickDefaultDate, formatSlotTime, formatDateLabel, type DayAvailability } from '../../utils/slot-format'

// `selectedSlot` mirrors the parent's own `selectedSlot` ref (booking/[slug]/[serviceId].vue)
// so this component can render which slot is actually selected -- previously the parent
// tracked selection itself from the `select` emit but never fed it back in, leaving the
// clicked button with zero visual/ARIA confirmation of its own selected state.
// workerId is optional -- omitted means "any available staff", the unchanged default.
// Set from the parent's own worker picker; refetching on change (not just on mount) is
// what actually enforces the choice, since a slot free for "any staff" can be exactly
// the slot a specific chosen worker is busy in.
const props = defineProps<{ salonId: string; serviceId: string; selectedSlot?: string | null; workerId?: string | null }>()
const emit = defineEmits<{ select: [iso: string] }>()

const { apiFetch } = useApi()
const days = ref<DayAvailability[]>([])
const selectedDate = ref<string | null>(null)
const loading = ref(true)
const hasError = ref(false)

async function fetchSlots() {
  loading.value = true
  const { data, error } = await apiFetch<DayAvailability[]>(`/salons/${props.salonId}/availability`, {
    query: { serviceId: props.serviceId, workerId: props.workerId || undefined },
    silent: true,
  })
  hasError.value = !!error
  days.value = data ?? []
  selectedDate.value = pickDefaultDate(days.value)
  loading.value = false
}

watch(() => props.workerId, fetchSlots, { immediate: true })

const daysWithSlots = computed(() => days.value.filter((d) => d.slots.length > 0))
const slotsForSelectedDate = computed(() => days.value.find((d) => d.date === selectedDate.value)?.slots ?? [])
const hasAnySlots = computed(() => daysWithSlots.value.length > 0)

function selectDate(date: string) {
  selectedDate.value = date
}
</script>

<template>
  <div v-if="loading" class="py-6 text-center text-sm text-(--color-text-muted)">در حال بارگذاری...</div>
  <div v-else-if="hasError" class="py-6 text-center text-sm text-(--color-text-muted)">مشکلی پیش آمد، دوباره تلاش کنید</div>
  <div v-else-if="!hasAnySlots" class="py-6 text-center text-sm text-(--color-text-muted)">نوبت خالی — این سالن در ۱۴ روز آینده نوبت آزاد ندارد</div>
  <div v-else class="space-y-3">
    <div class="flex gap-2 overflow-x-auto">
      <button
        v-for="day in daysWithSlots"
        :key="day.date"
        type="button"
        :aria-pressed="selectedDate === day.date"
        class="inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors"
        :class="selectedDate === day.date
          ? 'bg-(--color-accent-strong) text-white'
          : 'border border-(--color-border) bg-(--color-surface-card) text-(--color-text) hover:bg-(--color-surface-subtle)'"
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
        :aria-pressed="selectedSlot === slot"
        class="inline-flex min-h-11 items-center justify-center rounded-xl border p-2 text-sm font-medium transition-colors"
        :class="selectedSlot === slot
          ? 'border-transparent bg-(--color-accent-strong) text-white'
          : 'border-(--color-border) bg-(--color-surface-card) text-(--color-text) hover:bg-(--color-surface-subtle)'"
        @click="emit('select', slot)"
      >
        {{ formatSlotTime(slot) }}
      </button>
    </div>
  </div>
</template>
