<!-- apps/provider-panel/src/components/ui/JalaliDatePicker.vue -->
<!-- A small hand-built Shamsi (Jalali) calendar picker backed by jalaali-js for the date
     math. No maintained pre-styled Jalali picker exists for Vue 3 -- the well-known ones
     (vue-persian-datetime-picker etc.) haven't been published since 2022 -- so this is a
     purpose-built replacement for the native <input type="date">, which only ever shows
     the Gregorian calendar. The public contract (modelValue as a Gregorian "YYYY-MM-DD"
     string) matches the native date input exactly, so callers don't need to change.
     Mirrors admin-panel's component of the same name -- kept as this app's own copy per
     this repo's cross-app isolation convention. -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { toGregorian, toJalaali, jalaaliMonthLength } from 'jalaali-js'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{ modelValue: string; placeholder?: string; ariaLabel?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']
const WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج']
const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹']

function toPersianDigits(n: number | string): string {
  return String(n).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)])
}

function todayJalali() {
  return toJalaali(new Date())
}

const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const open = ref(false)

const selectedJalali = computed(() => {
  if (!props.modelValue) return null
  const [gy, gm, gd] = props.modelValue.split('-').map(Number)
  return toJalaali(gy, gm, gd)
})

const viewYear = ref(selectedJalali.value?.jy ?? todayJalali().jy)
const viewMonth = ref(selectedJalali.value?.jm ?? todayJalali().jm)

const displayLabel = computed(() => {
  if (!selectedJalali.value) return ''
  const { jy, jm, jd } = selectedJalali.value
  return `${toPersianDigits(jd)} ${MONTHS[jm - 1]} ${toPersianDigits(jy)}`
})

interface DayCell {
  jd: number
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
  gregorian: string
}

const days = computed<DayCell[]>(() => {
  const today = todayJalali()
  const length = jalaaliMonthLength(viewYear.value, viewMonth.value)
  const firstOfMonthGregorian = toGregorian(viewYear.value, viewMonth.value, 1)
  const firstWeekday = (new Date(firstOfMonthGregorian.gy, firstOfMonthGregorian.gm - 1, firstOfMonthGregorian.gd).getDay() + 1) % 7

  const cells: DayCell[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push({ jd: 0, inMonth: false, isToday: false, isSelected: false, gregorian: '' })

  for (let jd = 1; jd <= length; jd++) {
    const g = toGregorian(viewYear.value, viewMonth.value, jd)
    const gregorian = `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`
    cells.push({
      jd,
      inMonth: true,
      isToday: today.jy === viewYear.value && today.jm === viewMonth.value && today.jd === jd,
      isSelected: gregorian === props.modelValue,
      gregorian,
    })
  }
  return cells
})

function prevMonth() {
  if (viewMonth.value === 1) {
    viewMonth.value = 12
    viewYear.value -= 1
  } else {
    viewMonth.value -= 1
  }
}

function nextMonth() {
  if (viewMonth.value === 12) {
    viewMonth.value = 1
    viewYear.value += 1
  } else {
    viewMonth.value += 1
  }
}

// Closing from inside the popover (pick / Escape / footer actions) hands focus back to the
// trigger so a keyboard user isn't dropped at the top of the page; an outside click closes
// without stealing focus from whatever was just clicked.
function close(returnFocus = true) {
  open.value = false
  if (returnFocus) trigger.value?.focus()
}

function pick(day: DayCell) {
  if (!day.inMonth) return
  emit('update:modelValue', day.gregorian)
  close()
}

function goToday() {
  const t = todayJalali()
  viewYear.value = t.jy
  viewMonth.value = t.jm
  const g = toGregorian(t.jy, t.jm, t.jd)
  emit('update:modelValue', `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`)
  close()
}

function clear() {
  emit('update:modelValue', '')
  close()
}

const popover = ref<HTMLElement | null>(null)
// The popover is 16rem wide but its triggers can be as narrow as a card's own width, and
// they sit inside rows that can end up anywhere along the page. Anchored at its trigger's
// inline-start edge it grows toward the inline-END, which in RTL is to the LEFT -- so on a
// narrow viewport it escapes off the left edge, and the calendar grid ends up half
// unreachable. Measure the rendered box once it's open and translate it back inside;
// wherever there is room the shift is 0 and nothing moves.
const popoverShiftX = ref(0)
const VIEWPORT_MARGIN_PX = 8

async function keepPopoverOnScreen() {
  popoverShiftX.value = 0
  if (!open.value) return
  await nextTick()
  const el = popover.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (rect.left < VIEWPORT_MARGIN_PX) {
    popoverShiftX.value = VIEWPORT_MARGIN_PX - rect.left
  } else if (rect.right > window.innerWidth - VIEWPORT_MARGIN_PX) {
    popoverShiftX.value = window.innerWidth - VIEWPORT_MARGIN_PX - rect.right
  }
}

function toggle() {
  if (!open.value && selectedJalali.value) {
    viewYear.value = selectedJalali.value.jy
    viewMonth.value = selectedJalali.value.jm
  }
  open.value = !open.value
  keepPopoverOnScreen()
  if (open.value) focusIntoPopover()
}

// Selected day, else today, else the first day of the month -- the cell a keyboard user
// most likely wants to start from.
async function focusIntoPopover() {
  await nextTick()
  const el = popover.value
  if (!el) return
  const target =
    el.querySelector<HTMLElement>('[data-selected="true"]') ??
    el.querySelector<HTMLElement>('[data-today="true"]') ??
    el.querySelector<HTMLElement>('button.tnum:not([disabled])')
  target?.focus()
}

function onDocumentClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) close(false)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) {
    // Don't let an enclosing dialog/handler also react to the same keypress.
    e.stopPropagation()
    close()
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocumentClick)
  window.addEventListener('resize', keepPopoverOnScreen)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentClick)
  window.removeEventListener('resize', keepPopoverOnScreen)
})
</script>

<template>
  <div ref="root" class="relative" @keydown="onKeydown">
    <button
      ref="trigger"
      type="button"
      class="flex w-full items-center gap-2 rounded-xl border border-(--color-border) bg-(--color-surface-card) p-2 text-sm"
      :aria-label="ariaLabel"
      :title="displayLabel || undefined"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="toggle"
    >
      <AppIcon name="calendar" :size="15" class="shrink-0 text-(--color-text-muted)" />
      <span class="min-w-0 truncate" :class="displayLabel ? 'text-(--color-text)' : 'text-(--color-text-muted)'">
        {{ displayLabel || placeholder || 'انتخاب تاریخ' }}
      </span>
    </button>

    <!-- max-width caps the box itself below 17rem of viewport; `popoverShiftX` above keeps
         the box from being *positioned* off-screen. -->
    <div
      v-if="open"
      ref="popover"
      data-testid="date-popover"
      role="dialog"
      aria-label="انتخاب تاریخ"
      class="absolute z-50 mt-1.5 w-[21rem] max-w-[calc(100vw-1rem)] rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-2 shadow-(--shadow-md)"
      :style="popoverShiftX === 0 ? undefined : { transform: `translateX(${popoverShiftX}px)` }"
    >
      <!-- RTL: the first DOM child sits at the physical right, so "previous" is there with a
           rotated chevron pointing right, and "next" is at the left pointing left -- the same
           convention as BookingsView's day stepper and ReviewsView's pagination. 44px targets. -->
      <div class="mb-2 flex items-center justify-between">
        <button type="button" aria-label="ماه قبل" class="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-(--color-border-soft)" @click="prevMonth">
          <AppIcon name="chevron-left" :size="18" class="rotate-180 text-(--color-text-muted)" />
        </button>
        <p class="text-sm font-bold text-(--color-text)">{{ MONTHS[viewMonth - 1] }} {{ toPersianDigits(viewYear) }}</p>
        <button type="button" aria-label="ماه بعد" class="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-(--color-border-soft)" @click="nextMonth">
          <AppIcon name="chevron-left" :size="18" class="text-(--color-text-muted)" />
        </button>
      </div>

      <div class="grid grid-cols-7 gap-px text-center">
        <span v-for="w in WEEKDAYS" :key="w" class="py-1 text-xs font-semibold text-(--color-text-muted)">{{ w }}</span>
        <button
          v-for="(day, i) in days"
          :key="i"
          type="button"
          :disabled="!day.inMonth"
          :data-selected="day.isSelected || undefined"
          :data-today="day.isToday || undefined"
          class="tnum flex h-10 min-w-0 items-center justify-center rounded-lg text-sm transition-colors disabled:cursor-default"
          :class="[
            !day.inMonth && 'invisible',
            day.isSelected ? 'bg-(--color-accent) font-bold text-(--color-fill-text)' : 'hover:bg-(--color-border-soft)',
            day.isToday && !day.isSelected && 'font-bold text-(--color-accent-text)',
          ]"
          @click="pick(day)"
        >
          {{ toPersianDigits(day.jd) }}
        </button>
      </div>

      <div class="mt-2 flex justify-between border-t border-(--color-border-soft) pt-2">
        <button type="button" class="min-h-11 px-3 text-xs font-semibold text-(--color-accent-text)" @click="goToday">امروز</button>
        <button type="button" class="min-h-11 px-3 text-xs font-semibold text-(--color-text-muted)" @click="clear">پاک کردن</button>
      </div>
    </div>
  </div>
</template>
