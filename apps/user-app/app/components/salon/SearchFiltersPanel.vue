<script setup lang="ts">
// The "more filters" panel on the home page: search radius and a price band, both real
// /search parameters (radiusKm, priceMin/priceMax). Edits are a DRAFT until «اعمال», so
// typing a price costs one search, not one per digit.
//
// Price honesty mirrors the API's own rule (search.service.ts): a salon matches when at least
// one active service's KNOWN price fits the band -- a fixed price (after its discount) either
// way, a «از …» floor only as a minimum, a range's own bounds, and a «توافقی» service never.
// The hint under the fields says that much, so a «از» price is never read as a promise.
import { toEnglishDigits, toPersianDigits } from '~/utils/digits'
import { formatToman } from '~/utils/format-toman'
import { DEFAULT_RADIUS_KM, MAX_SEARCH_PRICE as MAX_PRICE, RADIUS_OPTIONS, type SearchFilters } from '~/utils/search-filters'

const props = defineProps<{ modelValue: SearchFilters }>()
const emit = defineEmits<{ 'update:modelValue': [SearchFilters]; close: [] }>()

const radius = ref(props.modelValue.radiusKm)
// The fields show Persian digits like every other number in the app; parsePrice reads either.
const asText = (n: number | null) => (n === null ? '' : toPersianDigits(n))
const minText = ref(asText(props.modelValue.priceMin))
const maxText = ref(asText(props.modelValue.priceMax))

// Re-seed the draft whenever the applied value changes from outside (a chip removed above
// the results while the panel is open).
watch(
  () => props.modelValue,
  (v) => {
    radius.value = v.radiusKm
    minText.value = asText(v.priceMin)
    maxText.value = asText(v.priceMax)
  },
)

/** Persian/Arabic digits and separators typed on an Iranian keyboard → a plain integer. */
function parsePrice(text: string): number | null {
  const digits = toEnglishDigits(text).replace(/\D/g, '')
  return digits ? Number(digits) : null
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

const priceMin = computed(() => parsePrice(minText.value))
const priceMax = computed(() => parsePrice(maxText.value))

const error = computed(() => {
  if ((priceMin.value ?? 0) > MAX_PRICE || (priceMax.value ?? 0) > MAX_PRICE) return `حداکثر قیمت قابل جستجو ${formatToman(MAX_PRICE)} تومان است.`
  if (priceMin.value !== null && priceMax.value !== null && priceMin.value > priceMax.value) return 'حداقل قیمت نباید از حداکثر بیشتر باشد.'
  return ''
})

const draft = computed<SearchFilters>(() => ({ radiusKm: radius.value, priceMin: priceMin.value, priceMax: priceMax.value }))
const dirty = computed(() => {
  const a = props.modelValue
  const b = draft.value
  return a.radiusKm !== b.radiusKm || a.priceMin !== b.priceMin || a.priceMax !== b.priceMax
})

function apply() {
  if (error.value) return
  if (dirty.value) emit('update:modelValue', draft.value)
  emit('close')
}

function reset() {
  radius.value = DEFAULT_RADIUS_KM
  minText.value = ''
  maxText.value = ''
}

const ids = { radius: useId(), min: useId(), max: useId(), hint: useId(), error: useId() }
</script>

<template>
  <form
    data-testid="search-filters"
    class="space-y-5 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-4 shadow-(--shadow-sm) sm:p-5"
    novalidate
    @submit.prevent="apply"
  >
    <fieldset>
      <legend :id="ids.radius" class="mb-2 text-sm font-semibold text-(--color-text)">فاصله تا سالن</legend>
      <div class="flex flex-wrap gap-2" role="group" :aria-labelledby="ids.radius">
        <button
          v-for="r in RADIUS_OPTIONS"
          :key="r"
          type="button"
          :aria-pressed="radius === r"
          :data-testid="`radius-${r}`"
          class="min-h-10 rounded-full px-3.5 text-sm transition-colors duration-150"
          :class="radius === r
            ? 'bg-(--color-text) font-semibold text-(--color-surface-card)'
            : 'border border-(--color-border) bg-(--color-surface-card) text-(--color-text-muted) hover:text-(--color-text)'"
          @click="radius = r"
        >
          تا {{ r.toLocaleString('fa-IR') }} کیلومتر
        </button>
      </div>
    </fieldset>

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
        سالن‌هایی نمایش داده می‌شوند که دست‌کم یک خدمت با قیمت مشخص در این بازه دارند. قیمت‌های «از …» فقط برای حداقل حساب می‌شوند و خدمات «توافقی» در فیلتر قیمت نمی‌آیند.
      </p>
    </fieldset>

    <div class="flex flex-wrap items-center justify-between gap-2 border-t border-(--color-border-soft) pt-4">
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
        <BaseButton type="submit" size="md" :disabled="!!error" data-testid="filters-apply">اعمال فیلترها</BaseButton>
      </div>
    </div>
  </form>
</template>
