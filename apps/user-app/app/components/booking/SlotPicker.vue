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
// `clear` tells the parent to drop its selected slot: that instant belonged to the day /
// staff member / availability snapshot the customer has just moved away from, so leaving it
// selected would let a visible "confirm" card submit a time nothing on screen shows any more.
const emit = defineEmits<{ select: [iso: string]; clear: [] }>()

const { apiFetch } = useApi()
const days = ref<DayAvailability[]>([])
const selectedDate = ref<string | null>(null)
const loading = ref(true)
const hasError = ref(false)

// Same stale-response guard as index.vue's search: tapping worker A then B fires two
// availability requests, and if A's lands last it would overwrite B's slots with A's --
// offering the customer exactly the times their chosen worker is busy in.
let requestSeq = 0

let hasLoadedOnce = false

async function fetchSlots() {
  const seq = ++requestSeq
  // Any refetch (worker change, retry) invalidates a previously picked instant; the very
  // first load has nothing to invalidate.
  if (hasLoadedOnce) emit('clear')
  hasLoadedOnce = true
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
  if (date === selectedDate.value) return
  selectedDate.value = date
  emit('clear')
}

// Selected-state treatment shared by date pills and time-slot buttons: the brand's soft peach
// tint with an accent-text outline. It used to be a solid charcoal fill, which read as a
// second, heavier "primary" next to the peach submit button; the solid peach fill itself
// stays reserved for that final "پرداخت و رزرو" action, so choosing never competes with it.
const CHOSEN_FILL = 'border-(--color-accent-text) bg-(--color-accent-soft) font-bold text-(--color-text) ring-1 ring-(--color-accent-text)'
const UNCHOSEN_FILL = 'border-(--color-border) bg-(--color-surface-card) text-(--color-text) hover:bg-(--color-surface-subtle)'
</script>

<template>
  <!-- Shape-matched skeleton, not a one-line "loading" label. Availability is fetched on the
       client only (this watch is not awaited during SSR), so the server HTML always holds the
       loading state; the old ~68px text line then grew into the full date/time picker (~350-500px
       at 320px) once the fetch landed, pushing everything below it -- including the layout's
       footer -- down after first paint (CLS ~0.2 at 320x640). Each block below mirrors the
       loaded markup's own boxes (h2 row + mb-2, a row of h-11 date pills, then two day-part
       buckets of two h-11 rows in the same 4-column grid), so the swap is close to height-neutral
       for a typical day. Purely presentational: the fetch, its timing and the slots are unchanged. -->
  <div v-if="loading" role="status" data-testid="slots-skeleton">
    <span class="sr-only">در حال بارگذاری...</span>
    <div aria-hidden="true" class="space-y-5">
      <section>
        <div class="mb-2 h-5 w-20 rounded-md bg-(--color-surface-subtle)" />
        <div class="flex gap-2 overflow-hidden pb-0.5">
          <div v-for="n in 4" :key="n" class="h-11 w-24 shrink-0 rounded-full bg-(--color-surface-subtle)" />
        </div>
      </section>
      <section>
        <div class="mb-2 h-5 w-20 rounded-md bg-(--color-surface-subtle)" />
        <div class="space-y-3">
          <div v-for="bucket in 2" :key="bucket">
            <div class="mb-1.5 h-4 w-12 rounded bg-(--color-surface-subtle)" />
            <div class="grid grid-cols-4 gap-2">
              <div v-for="n in 8" :key="n" data-testid="slot-skeleton-cell" class="h-11 rounded-xl bg-(--color-surface-subtle)" />
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
  <div v-else-if="hasError" role="alert" class="space-y-3 py-6 text-center text-sm text-(--color-text-muted)">
    <p>بارگذاری نوبت‌ها ممکن نشد؛ دوباره تلاش کنید.</p>
    <button
      type="button"
      data-testid="slots-retry"
      class="inline-flex min-h-11 items-center justify-center rounded-xl border border-(--color-border) bg-(--color-surface-subtle) px-4 font-semibold text-(--color-text) transition-colors hover:bg-(--color-border)"
      @click="fetchSlots"
    >
      تلاش دوباره
    </button>
  </div>
  <div v-else-if="!hasAnySlots" class="rounded-2xl border border-dashed border-(--color-border) py-8 text-center text-sm text-(--color-text-muted)">
    در ۱۴ روز آینده نوبت آزادی وجود ندارد
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
