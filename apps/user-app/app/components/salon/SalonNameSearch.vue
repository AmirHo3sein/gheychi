<script setup lang="ts">
// Business-name search field for the home page (hero and logged-in header share it), with a
// type-ahead: as the customer types, up to six matching salons/barbershops appear in a card
// under the field (GET /search/suggestions -- the same rules as the results list: approved,
// the searched gender, within the selected area). Picking one opens its page; Enter or
// «دیدن همهٔ نتایج» still announces a submit and the page filters its list as before.
//
// The field names a BUSINESS («سالن، آرایشگاه یا …») rather than only «سالن»: a barbershop or a
// solo specialist is listed under their business name too. It is not a service search --
// /search's `q` matches business names only, so the copy promises nothing more.
//
// ARIA 1.2 combobox: the input owns a listbox; the arrow keys move a visual cursor
// (aria-activedescendant) while focus stays in the field, so typing is never interrupted.
import type { SearchResult } from '~/utils/types'
import { highlightMatch } from '~/utils/highlight-match'

export interface SuggestionContext {
  lat: number
  lng: number
  gender: 'women' | 'men'
}

const props = withDefaults(
  defineProps<{ large?: boolean; maxlength?: number; context?: SuggestionContext | null }>(),
  { large: false, maxlength: 100, context: null },
)
const emit = defineEmits<{ submit: [] }>()
const model = defineModel<string>({ default: '' })

const { apiFetch } = useApi()
const router = useRouter()
const inputId = useId()
const listId = `${inputId}-list`
const root = ref<HTMLElement | null>(null)

/** One Persian letter matches half the catalogue; two is where a name starts to narrow. */
const MIN_CHARS = 2
const DEBOUNCE_MS = 250

const term = computed(() => model.value.trim().slice(0, props.maxlength))
const focused = ref(false)
const dismissed = ref(false)
const loading = ref(false)
const failed = ref(false)
const suggestions = ref<SearchResult[]>([])
/** The term `suggestions` belongs to -- so a stale list is never shown under a newer term. */
const resultsFor = ref('')
const active = ref(-1)

let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

function reset() {
  seq++
  clearTimeout(timer)
  loading.value = false
  suggestions.value = []
  resultsFor.value = ''
}

async function fetchSuggestions(q: string, ctx: SuggestionContext) {
  const mine = ++seq
  const { data, error } = await apiFetch<{ items: SearchResult[] }>('/search/suggestions', {
    query: { q, lat: ctx.lat, lng: ctx.lng, gender: ctx.gender },
    silent: true,
    redirectOn401: false,
  })
  // A slower request for an older term must never overwrite the newer one's list.
  if (mine !== seq) return
  loading.value = false
  failed.value = !!error
  suggestions.value = data?.items ?? []
  resultsFor.value = q
}

// Only while the field has focus: a value restored or set from outside (a cleared search,
// back navigation) is not someone typing, and needs no request.
watch([term, () => props.context, focused], ([q, ctx, isFocused], [prevQ, prevCtx]) => {
  active.value = -1
  if (!isFocused) {
    clearTimeout(timer)
    return
  }
  // Re-focusing an unchanged term reuses the list already fetched for it.
  if (q === prevQ && ctx === prevCtx && resultsFor.value === q) return
  if (!ctx || q.length < MIN_CHARS) {
    reset()
    return
  }
  dismissed.value = false
  loading.value = true
  failed.value = false
  clearTimeout(timer)
  timer = setTimeout(() => void fetchSuggestions(q, ctx), DEBOUNCE_MS)
})
onBeforeUnmount(() => clearTimeout(timer))

const open = computed(() => focused.value && !dismissed.value && !!props.context && term.value.length >= MIN_CHARS)
const showingCurrent = computed(() => resultsFor.value === term.value)
/** Options = the salons, then the «all results» row. */
const optionCount = computed(() => (showingCurrent.value ? suggestions.value.length : 0) + 1)
const allResultsIndex = computed(() => optionCount.value - 1)
function optionId(i: number) {
  return `${listId}-${i}`
}

const status = computed(() => {
  if (!open.value || loading.value || !showingCurrent.value) return ''
  if (failed.value) return 'پیشنهادها بارگذاری نشد.'
  const n = suggestions.value.length
  return n === 0 ? 'موردی پیدا نشد.' : `${n.toLocaleString('fa-IR')} پیشنهاد. با کلیدهای بالا و پایین مرور کنید.`
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (open.value) {
      e.preventDefault()
      dismissed.value = true
      active.value = -1
    }
    return
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  if (!props.context || term.value.length < MIN_CHARS) return
  e.preventDefault()
  dismissed.value = false
  const n = optionCount.value
  active.value = e.key === 'ArrowDown' ? (active.value + 1) % n : active.value <= 0 ? n - 1 : active.value - 1
}

function goTo(salon: SearchResult) {
  dismissed.value = true
  void router.push(`/salons/${salon.slug}`)
}

function onSubmit() {
  const i = active.value
  if (open.value && showingCurrent.value && i >= 0 && i < suggestions.value.length) {
    goTo(suggestions.value[i]!)
    return
  }
  dismissed.value = true
  active.value = -1
  emit('submit')
}

function onFocusOut(e: FocusEvent) {
  // Keep the card while focus moves INTO it (a click on a suggestion); close it otherwise.
  const next = e.relatedTarget as Node | null
  if (next && root.value?.contains(next)) return
  focused.value = false
  active.value = -1
}
</script>

<template>
  <div ref="root" class="relative" @focusout="onFocusOut">
    <form role="search" class="flex gap-2" data-testid="home-search" @submit.prevent="onSubmit">
      <label :for="inputId" class="sr-only">جستجو بر اساس نام سالن، آرایشگاه یا کسب‌وکار</label>
      <div class="relative min-w-0 flex-1">
        <span class="pointer-events-none absolute inset-y-0 start-3.5 flex items-center text-(--color-text-muted)">
          <BaseIcon name="search" :size="18" />
        </span>
        <input
          :id="inputId"
          v-model="model"
          type="search"
          enterkeyhint="search"
          autocomplete="off"
          :maxlength="maxlength"
          placeholder="نام سالن، آرایشگاه یا کسب‌وکار"
          data-testid="home-search-input"
          role="combobox"
          aria-autocomplete="list"
          :aria-expanded="open"
          :aria-controls="listId"
          :aria-activedescendant="open && active >= 0 ? optionId(active) : undefined"
          class="w-full rounded-xl border border-(--color-border-control) bg-(--color-surface-card) ps-11 pe-4 text-(--color-text) placeholder:text-(--color-text-muted) focus:border-(--color-accent-text) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent-text)"
          :class="large ? 'h-12' : 'h-11'"
          @focus="focused = true; dismissed = false"
          @keydown="onKeydown"
        />
      </div>
      <BaseButton type="submit" class="shrink-0" :class="large ? '!h-12' : ''" data-testid="home-search-submit">جستجو</BaseButton>
    </form>

    <p class="sr-only" aria-live="polite">{{ status }}</p>

    <!-- Overlays the content under the field; the page never shifts while typing. -->
    <div
      v-show="open"
      data-testid="search-suggestions"
      class="absolute inset-x-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-(--color-border) bg-(--color-surface-card) shadow-(--shadow-lg)"
    >
      <!-- Skeleton only for a term with nothing to show yet; a refresh keeps the old list. -->
      <div v-if="loading && !showingCurrent" class="space-y-1 p-2" aria-hidden="true" data-testid="search-suggestions-loading">
        <div v-for="n in 3" :key="n" class="flex items-center gap-3 rounded-xl p-2">
          <div class="h-12 w-12 shrink-0 animate-pulse rounded-xl bg-(--color-surface-subtle)" />
          <div class="flex-1 space-y-2">
            <div class="h-3 w-1/2 animate-pulse rounded bg-(--color-surface-subtle)" />
            <div class="h-3 w-1/3 animate-pulse rounded bg-(--color-border-soft)" />
          </div>
        </div>
      </div>

      <ul :id="listId" role="listbox" aria-label="پیشنهادهای جستجو" class="max-h-[min(26rem,60dvh)] overflow-y-auto p-2">
        <template v-if="showingCurrent">
          <li
            v-for="(s, i) in suggestions"
            :id="optionId(i)"
            :key="s.id"
            role="option"
            :aria-selected="active === i"
            data-testid="search-suggestion"
          >
            <NuxtLink
              :to="`/salons/${s.slug}`"
              tabindex="-1"
              class="flex items-center gap-3 rounded-xl border-s-[3px] p-2 transition-colors duration-150"
              :class="active === i ? 'border-(--color-accent-text) bg-(--color-accent-soft)' : 'border-transparent hover:bg-(--color-surface-subtle)'"
              @click="dismissed = true"
              @mousemove="active = i"
            >
              <span class="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-(--color-surface-subtle)">
                <SafeImage v-if="s.coverPhoto" :src="s.coverPhoto" alt="" :width="96" :height="96" loading="lazy" :placeholder-icon-size="16" class="h-full w-full object-cover" />
                <SalonImagePlaceholder v-else :icon-size="16" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5">
                  <span class="truncate text-sm font-semibold text-(--color-text)">
                    <template v-for="(part, k) in highlightMatch(s.name, term)" :key="k">
                      <mark v-if="part.match" class="rounded-sm bg-(--color-accent-soft) px-0.5 font-extrabold text-(--color-text)">{{ part.text }}</mark>
                      <template v-else>{{ part.text }}</template>
                    </template>
                  </span>
                  <span v-if="s.isFeatured" class="shrink-0 rounded-full bg-(--color-ad-strong) px-1.5 text-xs font-bold text-(--color-fill-text)">تبلیغ</span>
                </span>
                <span class="mt-0.5 flex items-center gap-1 truncate text-xs text-(--color-text-muted)">
                  <BaseIcon name="map-pin" :size="12" class="shrink-0" />
                  <span class="truncate">{{ s.city }}<template v-if="s.address"> · {{ s.address }}</template></span>
                </span>
              </span>
              <RatingLabel :average="s.ratingAvg" :count="s.ratingCount" class="shrink-0 text-xs" />
            </NuxtLink>
          </li>

          <li v-if="!loading && suggestions.length === 0" class="px-3 py-4 text-center text-sm text-(--color-text-muted)" data-testid="search-suggestions-empty">
            <template v-if="failed">پیشنهادها بارگذاری نشد؛ می‌توانید همچنان جستجو کنید.</template>
            <template v-else>کسب‌وکاری با نام «{{ term }}» در این محدوده پیدا نشد.</template>
          </li>
        </template>

        <li
          :id="optionId(allResultsIndex)"
          role="option"
          :aria-selected="active === allResultsIndex"
          data-testid="search-suggestions-all"
          class="mt-1 border-t border-(--color-border-soft) pt-1"
        >
          <button
            type="button"
            tabindex="-1"
            class="flex min-h-11 w-full items-center gap-2 rounded-xl border-s-[3px] px-3 text-start text-sm font-semibold text-(--color-accent-text) transition-colors duration-150"
            :class="active === allResultsIndex ? 'border-(--color-accent-text) bg-(--color-accent-soft)' : 'border-transparent hover:bg-(--color-surface-subtle)'"
            @click="onSubmit"
            @mousemove="active = allResultsIndex"
          >
            <BaseIcon name="search" :size="16" class="shrink-0" />
            <span class="min-w-0 flex-1 truncate">دیدن همهٔ نتایج برای «{{ term }}»</span>
            <BaseIcon name="chevron-back" :size="16" class="shrink-0" />
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
