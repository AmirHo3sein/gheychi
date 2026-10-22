<script setup lang="ts">
// The "more filters" panel on the home page: search radius, a price band and the «توافقی»
// opt-in, all real /search parameters (radiusKm, priceMin/priceMax, includeQuote). Edits are a
// DRAFT until «اعمال», so typing a number costs one search, not one per digit.
//
// Price honesty mirrors the API's own rule (search.service.ts): a salon matches when at least
// one active service's KNOWN price fits the band -- a fixed price (after its discount) either
// way, a «از …» floor only as a minimum, a range's own bounds, and a «توافقی» service never.
// The hint under the fields says that much, so a «از» price is never read as a promise.
// «توافقی» is an explicit opt-in instead: with a band it adds quote salons (band OR quote),
// alone it narrows the list to them.
import { toEnglishDigits, toPersianDigits } from '~/utils/digits'
import { formatToman } from '~/utils/format-toman'
import { DEFAULT_RADIUS_KM, MAX_RADIUS_KM, MAX_SEARCH_PRICE as MAX_PRICE, MIN_RADIUS_KM, type SearchFilters } from '~/utils/search-filters'

// `inSheet`: rendered inside the phone BottomSheet -- no card chrome of its own, and the
// actions stay pinned to the bottom edge while the fields scroll.
const props = defineProps<{ modelValue: SearchFilters; inSheet?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [SearchFilters]; close: [] }>()

// The fields show Persian digits like every other number in the app; parseNumber reads either.
const asText = (n: number | null) => (n === null ? '' : toPersianDigits(n))
const radiusText = ref(asText(props.modelValue.radiusKm))
const minText = ref(asText(props.modelValue.priceMin))
const maxText = ref(asText(props.modelValue.priceMax))
const includeQuote = ref(props.modelValue.includeQuote)

// Re-seed the draft whenever the applied value changes from outside (a chip removed above
// the results while the panel is open).
watch(
  () => props.modelValue,
  (v) => {
    radiusText.value = asText(v.radiusKm)
    minText.value = asText(v.priceMin)
    maxText.value = asText(v.priceMax)
    includeQuote.value = v.includeQuote
  },
)

/** Persian/Arabic digits and separators typed on an Iranian keyboard → a plain integer. */
function parseNumber(text: string): number | null {
  const digits = toEnglishDigits(text).replace(/\D/g, '')
  return digits ? Number(digits) : null
}
function onRadiusInput(e: Event) {
  const el = e.target as HTMLInputElement
  // 3 digits is enough to show the over-50 error rather than silently trimming to a valid value.
  const clean = toPersianDigits(toEnglishDigits(el.value).replace(/\D/g, '').slice(0, 3))
  radiusText.value = clean
  el.value = clean
}
function onPriceInput(which: 'min' | 'max', e: Event) {
  const el = e.target as HTMLInputElement
  // Capped at 13 digits only to keep the field sane: anything over 10 digits is already above
  // the maximum and must show that error, never be silently cut down to a different number.
  const clean = toPersianDigits(toEnglishDigits(el.value).replace(/\D/g, '').slice(0, 13))
  if (which === 'min') minText.value = clean
  else maxText.value = clean
  el.value = clean
}

const priceMin = computed(() => parseNumber(minText.value))
const priceMax = computed(() => parseNumber(maxText.value))
// An emptied field means "the default distance", not an error.
const radius = computed(() => parseNumber(radiusText.value) ?? DEFAULT_RADIUS_KM)

const radiusError = computed(() =>
  radius.value < MIN_RADIUS_KM || radius.value > MAX_RADIUS_KM
    ? `فاصله باید بین ${toPersianDigits(MIN_RADIUS_KM)} تا ${toPersianDigits(MAX_RADIUS_KM)} کیلومتر باشد.`
    : '',
)

const error = computed(() => {
  if ((priceMin.value ?? 0) > MAX_PRICE || (priceMax.value ?? 0) > MAX_PRICE) return `حداکثر قیمت قابل جستجو ${formatToman(MAX_PRICE)} تومان است.`
  if (priceMin.value !== null && priceMax.value !== null && priceMin.value > priceMax.value) return 'حداقل قیمت نباید از حداکثر بیشتر باشد.'
  return ''
})

const hasBand = computed(() => priceMin.value !== null || priceMax.value !== null)

const draft = computed<SearchFilters>(() => ({ radiusKm: radius.value, priceMin: priceMin.value, priceMax: priceMax.value, includeQuote: includeQuote.value }))
const dirty = computed(() => {
  const a = props.modelValue
  const b = draft.value
  return a.radiusKm !== b.radiusKm || a.priceMin !== b.priceMin || a.priceMax !== b.priceMax || a.includeQuote !== b.includeQuote
})

function apply() {
  if (error.value || radiusError.value) return
  if (dirty.value) emit('update:modelValue', draft.value)
  emit('close')
}

function reset() {
  radiusText.value = asText(DEFAULT_RADIUS_KM)
  minText.value = ''
  maxText.value = ''
  includeQuote.value = false
}

const ids = { radius: useId(), radiusError: useId(), min: useId(), max: useId(), hint: useId(), error: useId(), quote: useId() }
</script>

<template>
  <form
    data-testid="search-filters"
    class="space-y-5"
    :class="inSheet ? 'px-4 pt-1' : 'rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-4 shadow-(--shadow-sm) sm:p-5'"
    novalidate
    @submit.prevent="apply"
  >
    <div>
      <label :for="ids.radius" class="mb-2 block text-sm font-semibold text-(--color-text)">فاصله تا سالن</label>
      <div class="relative max-w-56">
        <input
          :id="ids.radius"
          :value="radiusText"
          type="text"
          inputmode="numeric"
          dir="ltr"
          autocomplete="off"
          :placeholder="toPersianDigits(DEFAULT_RADIUS_KM)"
          data-testid="radius-input"
          :aria-describedby="radiusError ? ids.radiusError : undefined"
          :aria-invalid="!!radiusError || undefined"
          class="h-11 w-full rounded-xl border bg-(--color-surface-card) pl-16 pr-3 text-right text-(--color-text) placeholder:text-(--color-text-muted) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent-text)"
          :class="radiusError ? 'border-(--color-danger)' : 'border-(--color-border-control) focus:border-(--color-accent-text)'"
          @input="onRadiusInput"
        >
        <!-- Physical sides on purpose: the input is dir=ltr, so start/end would point the other way. -->
        <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-(--color-text-muted)" aria-hidden="true">کیلومتر</span>
      </div>
      <p v-if="radiusError" :id="ids.radiusError" role="alert" class="mt-1 flex items-center gap-1 text-xs text-(--color-danger)" data-testid="radius-error">
        <BaseIcon name="alert-circle" :size="14" class="shrink-0" />
        {{ radiusError }}
      </p>
      <p v-else class="mt-1 text-xs text-(--color-text-muted)">از {{ toPersianDigits(MIN_RADIUS_KM) }} تا {{ toPersianDigits(MAX_RADIUS_KM) }} کیلومتر از موقعیت شما</p>
    </div>

    <fieldset>
      <legend class="mb-2 text-sm font-semibold text-(--color-text)">بازهٔ قیمت خدمت (تومان)</legend>
      <div class="grid grid-cols-2 gap-3">
        <div class="min-w-0">
          <label :for="ids.min" class="mb-1 block text-xs text-(--color-text-muted)">از</label>
          <input
            :id="ids.min"
            :value="minText"
            type="text"
            inputmode="numeric"
            dir="ltr"
            autocomplete="off"
            placeholder="مثلاً ۲۰۰۰۰۰"
            data-testid="price-min"
            :aria-describedby="`${ids.hint}${error ? ` ${ids.error}` : ''}`"
            :aria-invalid="!!error || undefined"
            class="h-11 w-full rounded-xl border bg-(--color-surface-card) px-3 text-end text-(--color-text) placeholder:text-(--color-text-muted) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent-text)"
            :class="error ? 'border-(--color-danger)' : 'border-(--color-border-control) focus:border-(--color-accent-text)'"
            @input="onPriceInput('min', $event)"
          >
          <p class="tnum mt-1 min-h-4 truncate text-xs text-(--color-text-muted)" aria-hidden="true">{{ priceMin !== null ? `${formatToman(priceMin)} تومان` : '' }}</p>
        </div>
        <div class="min-w-0">
          <label :for="ids.max" class="mb-1 block text-xs text-(--color-text-muted)">تا</label>
          <input
            :id="ids.max"
            :value="maxText"
            type="text"
            inputmode="numeric"
            dir="ltr"
            autocomplete="off"
            placeholder="مثلاً ۱۵۰۰۰۰۰"
            data-testid="price-max"
            :aria-describedby="`${ids.hint}${error ? ` ${ids.error}` : ''}`"
            :aria-invalid="!!error || undefined"
            class="h-11 w-full rounded-xl border bg-(--color-surface-card) px-3 text-end text-(--color-text) placeholder:text-(--color-text-muted) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent-text)"
            :class="error ? 'border-(--color-danger)' : 'border-(--color-border-control) focus:border-(--color-accent-text)'"
            @input="onPriceInput('max', $event)"
          >
          <p class="tnum mt-1 min-h-4 truncate text-xs text-(--color-text-muted)" aria-hidden="true">{{ priceMax !== null ? `${formatToman(priceMax)} تومان` : '' }}</p>
        </div>
      </div>
      <p v-if="error" :id="ids.error" role="alert" class="mt-1 flex items-center gap-1 text-xs text-(--color-danger)" data-testid="price-error">
        <BaseIcon name="alert-circle" :size="14" class="shrink-0" />
        {{ error }}
      </p>
      <p :id="ids.hint" class="mt-2 text-xs leading-6 text-(--color-text-muted)">
        سالن‌هایی نمایش داده می‌شوند که دست‌کم یک خدمت با قیمت مشخص در این بازه دارند. قیمت‌های «از …» فقط برای حداقل حساب می‌شوند.
      </p>

      <label
        :for="ids.quote"
        class="mt-3 flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-(--color-border) p-3 transition-colors hover:bg-(--color-surface-subtle)"
      >
        <input
          :id="ids.quote"
          v-model="includeQuote"
          type="checkbox"
          data-testid="price-quote"
          class="mt-0.5 h-4 w-4 shrink-0 accent-(--color-accent-strong)"
        >
        <span class="min-w-0">
          <span class="block text-sm font-medium text-(--color-text)">قیمت توافقی</span>
          <span class="mt-0.5 block text-xs leading-5 text-(--color-text-muted)" data-testid="price-quote-hint">
            {{ hasBand
              ? 'سالن‌هایی که خدمت با قیمت توافقی دارند هم نمایش داده شوند.'
              : 'فقط سالن‌هایی نمایش داده شوند که خدمت با قیمت توافقی دارند.' }}
          </span>
        </span>
      </label>
    </fieldset>

    <div
      class="flex flex-wrap items-center justify-between gap-2 border-t border-(--color-border-soft) pt-4"
      :class="inSheet ? 'sticky bottom-0 -mx-4 bg-(--color-surface-card) px-4 pb-[max(1rem,env(safe-area-inset-bottom))]' : ''"
    >
      <button
        type="button"
        data-testid="filters-reset"
        class="min-h-11 rounded-xl px-3 text-sm font-medium text-(--color-text-muted) transition-colors hover:text-(--color-text)"
        @click="reset"
      >
        بازنشانی
      </button>
      <div class="flex gap-2">
        <BaseButton type="button" variant="secondary" size="md" @click="emit('close')">انصراف</BaseButton>
        <BaseButton type="submit" size="md" :disabled="!!error || !!radiusError" data-testid="filters-apply">اعمال فیلترها</BaseButton>
      </div>
    </div>
  </form>
</template>
