<!-- apps/admin-panel/src/components/ui/JalaliDatePicker.vue -->
<!-- A small hand-built Shamsi (Jalali) calendar picker backed by jalaali-js for the date
     math. No maintained pre-styled Jalali picker exists for Vue 3 -- the well-known ones
     (vue-persian-datetime-picker etc.) haven't been published since 2022 -- so this is a
     purpose-built replacement for the native <input type="date">, which only ever shows
     the Gregorian calendar. The public contract (modelValue as a Gregorian "YYYY-MM-DD"
     string) matches the native date input exactly, so callers don't need to change. -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
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

function pick(day: DayCell) {
  if (!day.inMonth) return
  emit('update:modelValue', day.gregorian)
  open.value = false
}

function goToday() {
  const t = todayJalali()
  viewYear.value = t.jy
  viewMonth.value = t.jm
  const g = toGregorian(t.jy, t.jm, t.jd)
  emit('update:modelValue', `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`)
  open.value = false
}

function clear() {
  emit('update:modelValue', '')
  open.value = false
}

function toggle() {
  if (!open.value && selectedJalali.value) {
    viewYear.value = selectedJalali.value.jy
    viewMonth.value = selectedJalali.value.jm
  }
  open.value = !open.value
}

function onDocumentClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('mousedown', onDocumentClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocumentClick))
</script>

<template>
  <div ref="root" class="relative" @keydown="onKeydown">
    <button
      type="button"
      class="flex w-full items-center gap-2 rounded-xl border border-(--color-border) p-2 text-sm"
      :aria-label="ariaLabel"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="toggle"
    >
      <AppIcon name="calendar" :size="15" class="shrink-0 text-(--color-text-muted)" />
      <span :class="displayLabel ? 'text-(--color-text)' : 'text-(--color-text-muted)'">
        {{ displayLabel || placeholder || 'انتخاب تاریخ' }}
      </span>
    </button>

    <div
      v-if="open"
      class="absolute z-50 mt-1.5 w-64 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-3 shadow-(--shadow-md)"
    >
      <div class="mb-2 flex items-center justify-between">
        <button type="button" aria-label="ماه بعد" class="rounded-lg p-1.5 hover:bg-(--color-border-soft)" @click="nextMonth">
          <AppIcon name="chevron-left" :size="16" class="rotate-180 text-(--color-text-muted)" />
        </button>
        <p class="text-sm font-bold text-(--color-text)">{{ MONTHS[viewMonth - 1] }} {{ toPersianDigits(viewYear) }}</p>
        <button type="button" aria-label="ماه قبل" class="rounded-lg p-1.5 hover:bg-(--color-border-soft)" @click="prevMonth">
          <AppIcon name="chevron-left" :size="16" class="text-(--color-text-muted)" />
        </button>
      </div>

      <div class="grid grid-cols-7 gap-1 text-center">
        <span v-for="w in WEEKDAYS" :key="w" class="py-1 text-xs font-semibold text-(--color-text-muted)">{{ w }}</span>
        <button
          v-for="(day, i) in days"
          :key="i"
          type="button"
          :disabled="!day.inMonth"
          class="tnum flex h-8 items-center justify-center rounded-lg text-sm transition-colors disabled:cursor-default"
          :class="[
            !day.inMonth && 'invisible',
            day.isSelected ? 'bg-(--color-accent) font-bold text-white' : 'hover:bg-(--color-border-soft)',
            day.isToday && !day.isSelected && 'font-bold text-(--color-accent)',
          ]"
          @click="pick(day)"
        >
          {{ toPersianDigits(day.jd) }}
        </button>
      </div>

      <div class="mt-2 flex justify-between border-t border-(--color-border-soft) pt-2">
        <button type="button" class="text-xs font-semibold text-(--color-accent)" @click="goToday">امروز</button>
        <button type="button" class="text-xs font-semibold text-(--color-text-muted)" @click="clear">پاک کردن</button>
      </div>
    </div>
  </div>
</template>
