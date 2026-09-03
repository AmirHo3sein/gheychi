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

// Same stale-response guard as index.vue's search: tapping worker A then B fires two
// availability requests, and if A's lands last it would overwrite B's slots with A's --
// offering the customer exactly the times their chosen worker is busy in.
let requestSeq = 0

async function fetchSlots() {
  const seq = ++requestSeq
  loading.value = true
  const { data, error } = await apiFetch<DayAvailability[]>(`/salons/${props.salonId}/availability`, {
    query: { serviceId: props.serviceId, workerId: props.workerId || undefined },
    silent: true,
  })
  if (seq !== requestSeq) return
  hasError.value = !!error
  days.value = data ?? []
  selectedDate.value = pickDefaultDate(days.value)
  loading.value = false
}

watch(() => props.workerId, fetchSlots, { immediate: true })

const daysWithSlots = computed(() => days.value.filter((d) => d.slots.length > 0))
const hasAnySlots = computed(() => daysWithSlots.value.length > 0)

// ISO instants sort correctly as plain strings (same UTC 'Z' notation throughout, from this
// same endpoint) -- the API doesn't promise its own slots array is time-ordered, and it
// wasn't: a salon's real availability response has shown up here as e.g.
// [17:30, 17:00, 16:30, 16:00, 19:30, ...], which read as random to a customer scanning for
// "the earliest opening."
const slotsForSelectedDate = computed(() => {
  const slots = days.value.find((d) => d.date === selectedDate.value)?.slots ?? []
  return [...slots].sort()
})

// Groups a day's (now-sorted) slots into the three day-parts a customer actually thinks in,
// so a long list reads as "morning / afternoon / evening" instead of one flat wall of times --
// each bucket only appears when it actually has a slot in it.
const DAY_PART_ORDER = ['صبح', 'بعدازظهر', 'عصر و شب'] as const
type DayPart = (typeof DAY_PART_ORDER)[number]

function dayPartOf(iso: string): DayPart {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Tehran' }).format(new Date(iso)),
  )
  if (hour < 12) return 'صبح'
  if (hour < 17) return 'بعدازظهر'
  return 'عصر و شب'
}

const slotBuckets = computed(() => {
  const byPart = new Map<DayPart, string[]>()
  for (const slot of slotsForSelectedDate.value) {
    const part = dayPartOf(slot)
    const bucket = byPart.get(part)
    if (bucket) bucket.push(slot)
    else byPart.set(part, [slot])
  }
  return DAY_PART_ORDER.filter((part) => byPart.has(part)).map((part) => ({ part, slots: byPart.get(part)! }))
})

function selectDate(date: string) {
  selectedDate.value = date
}

// Selected-state fill shared by date pills and time-slot buttons: a bold, neutral "chosen"
// look (not the brand accent) -- this screen's one accent seal is reserved for the final
// "پرداخت و رزرو" button below, so picking a date or a time never competes with it.
const CHOSEN_FILL = 'border-transparent bg-(--color-text) text-(--color-surface)'
const UNCHOSEN_FILL = 'border-(--color-border) bg-(--color-surface-card) text-(--color-text) hover:bg-(--color-surface-subtle)'
</script>

<template>
  <div v-if="loading" class="py-6 text-center text-sm text-(--color-text-muted)">در حال بارگذاری...</div>
  <div v-else-if="hasError" class="py-6 text-center text-sm text-(--color-text-muted)">مشکلی پیش آمد، دوباره تلاش کنید</div>
  <div v-else-if="!hasAnySlots" class="rounded-2xl border border-dashed border-(--color-border) py-8 text-center text-sm text-(--color-text-muted)">
    نوبت خالی — این سالن در ۱۴ روز آینده نوبت آزاد ندارد
  </div>
  <div v-else class="space-y-5">
    <section>
      <h2 class="mb-2 flex items-center gap-1.5 text-sm font-bold text-(--color-text)">
        <BaseIcon name="calendar" :size="16" class="text-(--color-text-muted)" />
        چه روزی؟
      </h2>
      <div class="flex gap-2 overflow-x-auto pb-0.5">
        <button
          v-for="day in daysWithSlots"
          :key="day.date"
          type="button"
          :aria-pressed="selectedDate === day.date"
          class="inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors"
          :class="selectedDate === day.date ? CHOSEN_FILL : UNCHOSEN_FILL"
          @click="selectDate(day.date)"
        >
          {{ formatDateLabel(day.date) }}
        </button>
      </div>
    </section>

    <section>
      <h2 class="mb-2 flex items-center gap-1.5 text-sm font-bold text-(--color-text)">
        <BaseIcon name="clock" :size="16" class="text-(--color-text-muted)" />
        چه ساعتی؟
      </h2>
      <div class="space-y-3">
        <div v-for="bucket in slotBuckets" :key="bucket.part">
          <p class="mb-1.5 text-xs font-medium text-(--color-text-muted)">{{ bucket.part }}</p>
          <div class="grid grid-cols-4 gap-2">
            <button
              v-for="slot in bucket.slots"
              :key="slot"
              type="button"
              data-testid="slot-button"
              :aria-pressed="selectedSlot === slot"
              class="tnum inline-flex min-h-11 items-center justify-center rounded-xl border p-2 text-sm font-medium transition-colors"
              :class="selectedSlot === slot ? CHOSEN_FILL : UNCHOSEN_FILL"
              @click="emit('select', slot)"
            >
              {{ formatSlotTime(slot) }}
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
