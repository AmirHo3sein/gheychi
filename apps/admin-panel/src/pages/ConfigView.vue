<!-- apps/admin-panel/src/pages/ConfigView.vue -->
<!-- Uniform Consequence Rule (DESIGN.md): PATCHing platform config is a money/behavior-moving
     action just like a wallet adjustment, so it gets the same confirm-before-commit shape as
     AdjustBalanceCard.vue -- a `confirming` toggle between the editable row list and a
     confirm-summary screen, scoped to only the rows that actually changed. -->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppMoneyInput from '@/components/ui/AppMoneyInput.vue'
import { configKeyMeta } from '@/utils/labels'
import { formatToman } from '@/utils/format-toman'
import { toEnglishDigits, toPersianDigits } from '@/utils/digits'

interface ConfigRow {
  key: string
  value: number
}

// Percent-shaped keys get a 0-100 ceiling; every other key just gets a >= 0 floor. Same
// money-moving stakes as AdjustBalanceCard.vue -- an out-of-range value must never reach
// the confirm screen, let alone the PATCH.
const PERCENT_KEYS = new Set(['deposit_percent', 'commission_percent'])
// Keys whose server-side DTO bounds are tighter than ">= 0" -- mirrored exactly here
// (admin-config.dto.ts) so an out-of-range value is caught before the confirm screen
// rather than as a generic 400 toast. All of these are integers server-side.
const EXPLICIT_BOUNDS: Record<string, { min: number; max: number }> = {
  beauty_guide_daily_limit_per_user: { min: 0, max: 1000 },
  beauty_guide_daily_limit_global: { min: 0, max: 1000000 },
  beauty_guide_retention_days: { min: 1, max: 3650 },
  booking_max_active_per_user: { min: 1, max: 50 },
  booking_max_active_per_salon_per_user: { min: 1, max: 20 },
  no_show_grace_minutes: { min: 0, max: 1440 },
}
// Boolean feature flags have their own screen and endpoint; the numeric PATCH rejects them
// (a flag value fails @IsNumber and, worse, a typo'd key used to brick boot). They must never
// be listed or submitted from this form even if the list endpoint ever returns one.
const isNumericConfigKey = (key: string) => !key.startsWith('feature_')
function boundsFor(key: string): { min: number; max: number | null; integer: boolean } {
  if (EXPLICIT_BOUNDS[key]) return { ...EXPLICIT_BOUNDS[key], integer: true }
  return PERCENT_KEYS.has(key) ? { min: 0, max: 100, integer: false } : { min: 0, max: null, integer: false }
}

// Sections for the edit screen, in display order. Keys inside a section keep this order; any
// key the API returns that no section lists (a newly added config key) lands in «سایر» rather
// than disappearing.
const SECTIONS: { id: string; title: string; hint: string; keys: string[] }[] = [
  { id: 'money', title: 'بیعانه و کمیسیون', hint: 'مبلغ‌هایی که از مشتری و سالن گرفته می‌شود', keys: ['deposit_percent', 'deposit_min_toman', 'commission_percent'] },
  {
    id: 'booking',
    title: 'رزرو و نوبت',
    hint: 'مهلت‌ها و سقف نوبت‌های هم‌زمان',
    keys: [
      'cancellation_window_hours',
      'booking_hold_ttl_minutes',
      'booking_approval_timeout_minutes',
      'booking_max_active_per_user',
      'booking_max_active_per_salon_per_user',
    ],
  },
  { id: 'no-show', title: 'عدم حضور', hint: '', keys: ['no_show_grace_minutes'] },
  {
    id: 'beauty',
    title: 'راهنمای زیبایی',
    hint: 'هر تحلیل یک فراخوانی پولی هوش مصنوعی است',
    keys: ['beauty_guide_daily_limit_per_user', 'beauty_guide_daily_limit_global', 'beauty_guide_retention_days'],
  },
  { id: 'sms', title: 'پیامک', hint: '', keys: ['reminder_lead_hours'] },
]

const { apiFetch } = useApi()
const { push: pushToast } = useToast()
const rows = ref<ConfigRow[]>([])
// Snapshot of what's currently persisted server-side -- diffed against `rows` to know which
// rows actually changed, both to gate the save button and to build the confirm summary.
const originalRows = ref<ConfigRow[]>([])
// Raw text the admin is actually looking at, keyed by row -- decoupled from `rows[].value`
// so a cleared or out-of-range field displays exactly what was typed (including empty)
// instead of silently coercing to 0 (Number('') === 0) or snapping back to the last valid
// value. `rows[].value` only ever holds the last *valid* parsed number for a given key.
const rowText = ref<Record<string, string>>({})
const rowInvalid = ref<Record<string, boolean>>({})
const loading = ref(true)
const loadError = ref(false)
const saving = ref(false)
const confirming = ref(false)

const confirmHeadingEl = ref<HTMLElement | null>(null)
const saveButtonEl = ref<InstanceType<typeof AppButton> | null>(null)

async function load() {
  loading.value = true
  loadError.value = false
  const { data, error } = await apiFetch<ConfigRow[]>('/admin/config', { silent: true })
  if (error || !data) {
    loadError.value = true
    loading.value = false
    return
  }
  const numeric = data.filter((r) => isNumericConfigKey(r.key))
  rows.value = numeric.map((r) => ({ ...r }))
  originalRows.value = numeric.map((r) => ({ ...r }))
  rowText.value = Object.fromEntries(numeric.map((r) => [r.key, String(r.value)]))
  rowInvalid.value = Object.fromEntries(numeric.map((r) => [r.key, false]))
  loading.value = false
}

function originalValueOf(key: string): number | undefined {
  return originalRows.value.find((r) => r.key === key)?.value
}

function onRowInput(row: ConfigRow, raw: string | number) {
  // A dynamically-typed AppInput (`:type="type"`) with type="number" makes Vue's v-model
  // auto-cast a successfully-parsed value to a real JS number (via looseToNumber) while
  // leaving an empty/unparseable value as the original string -- normalize to a string
  // up front so this function has one consistent shape to validate.
  const text = String(raw)
  rowText.value[row.key] = text
  const trimmed = text.trim()
  const { min, max, integer } = boundsFor(row.key)
  const parsed = Number(trimmed)
  // Number('') === 0 -- an explicit emptiness check keeps a select-all-delete mid-edit from
  // silently coercing to a valid-looking "0". Same branch also catches a non-numeric paste
  // and a value outside this key's sane bounds; none of these ever touch `row.value`.
  if (
    trimmed === '' ||
    Number.isNaN(parsed) ||
    (integer && !Number.isInteger(parsed)) ||
    parsed < min ||
    (max !== null && parsed > max)
  ) {
    rowInvalid.value[row.key] = true
    return
  }
  rowInvalid.value[row.key] = false
  row.value = parsed
}

// Persian/Arabic-Indic digits and the Persian decimal mark (٫) -> ASCII, so an admin typing on
// a Persian keyboard gets exactly the same validation as one typing Latin digits.
function onConfigText(row: ConfigRow, raw: string | number) {
  onRowInput(row, toEnglishDigits(String(raw)).replace(/٫/g, '.'))
}

function rowError(key: string): string | undefined {
  if (!rowInvalid.value[key]) return undefined
  const text = (rowText.value[key] ?? '').trim()
  const { min, max, integer } = boundsFor(key)
  if (text === '') return 'این مقدار نمی‌تواند خالی باشد'
  if (Number.isNaN(Number(text))) return 'یک عدد معتبر وارد کنید'
  if (integer && !Number.isInteger(Number(text))) return 'یک عدد صحیح وارد کنید'
  return max !== null ? `باید بین ${toPersianDigits(min)} تا ${toPersianDigits(max)} باشد` : `باید حداقل ${toPersianDigits(min)} باشد`
}

// deposit_min_toman is the only toman-denominated config key today (the rest are %, hours,
// minutes) -- render it Latin-digit/comma-grouped (formatToman) like every other price in
// the app; every other unit stays this app's ordinary Persian-digit format.
function formatConfigValue(key: string, value: number | undefined): string {
  if (value === undefined) return ''
  return configKeyMeta(key).unit === 'تومان' ? formatToman(value) : value.toLocaleString('fa-IR')
}

// Only the rows whose value actually differs from what's persisted -- the confirm summary
// must list precisely what will change, not the full config table.
const sections = computed(() => {
  const listed = new Set(SECTIONS.flatMap((sec) => sec.keys))
  const out = SECTIONS.map((sec) => ({
    ...sec,
    rows: sec.keys.map((k) => rows.value.find((r) => r.key === k)).filter((r): r is ConfigRow => !!r),
  }))
  out.push({ id: 'other', title: 'سایر', hint: '', keys: [], rows: rows.value.filter((r) => !listed.has(r.key)) })
  return out.filter((sec) => sec.rows.length > 0)
})

const changedRows = computed(() => rows.value.filter((r) => originalValueOf(r.key) !== r.value))
const hasChanges = computed(() => changedRows.value.length > 0)
const hasInvalidRows = computed(() => Object.values(rowInvalid.value).some(Boolean))
const canSave = computed(() => hasChanges.value && !hasInvalidRows.value)

function askConfirm() {
  // Nothing changed, or an unresolved empty/out-of-range field -- no-op (the button is
  // disabled for both cases too, but this guards direct calls/races).
  if (!canSave.value) return
  confirming.value = true
}

function cancelConfirm() {
  confirming.value = false
}

async function confirmSave() {
  saving.value = true
  const { error } = await apiFetch('/admin/config', {
    method: 'PATCH',
    body: { updates: rows.value.filter((r) => isNumericConfigKey(r.key)).map((r) => ({ key: r.key, value: r.value })) },
  })
  saving.value = false
  if (!error) {
    pushToast('تغییرات ذخیره شد')
    originalRows.value = rows.value.map((r) => ({ ...r }))
    confirming.value = false
  }
}

// Focus follows the confirm-step swap instead of silently dropping to <body> when Vue swaps
// the v-if/v-else subtree: the confirm screen's heading takes focus going in, the save
// button gets it back coming out (cancel, or a successful save closing the confirm screen).
watch(confirming, async (isConfirming) => {
  await nextTick()
  if (isConfirming) {
    confirmHeadingEl.value?.focus()
  } else {
    saveButtonEl.value?.$el?.focus()
  }
})

onMounted(load)
</script>

<!-- p-4 -> sm:p-6 -> lg:p-8 scale; 32px of gutter on each side of a 320px screen is a
     quarter of the usable width, so it relaxes to p-4 below that. -->
<template>
  <div class="mx-auto max-w-3xl space-y-5 p-4 sm:p-6 lg:p-8">
    <div v-if="loading" data-testid="config-loading" class="flex items-center justify-center gap-2 py-16 text-sm text-(--color-text-muted)">
      <AppIcon name="spinner" :size="20" class="animate-spin" />
      در حال بارگذاری تنظیمات…
    </div>

    <AppCard
      v-else-if="loadError"
      :padded="false"
      data-testid="config-load-error"
      role="alert"
      class="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center"
    >
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-(--tone-danger-bg) text-(--tone-danger-text)">
        <AppIcon name="warning" :size="22" />
      </div>
      <p class="text-sm text-(--color-text-muted)">بارگذاری تنظیمات پلتفرم با خطا مواجه شد.</p>
      <AppButton type="button" variant="secondary" data-testid="config-retry-button" @click="load">
        تلاش مجدد
      </AppButton>
    </AppCard>

    <template v-else-if="!confirming">
      <p class="text-sm text-(--color-text-muted)">
        این مقادیر رفتار کل پلتفرم را کنترل می‌کنند -- تغییرات پیش از ذخیره برای بازبینی نمایش داده می‌شوند.
      </p>

      <!-- One row layout everywhere: label + hint on the start side, the field and its unit in
           a fixed-width column on the end side, so every input lines up down the page whatever
           the hint length. Below sm the field drops under its label, for every row alike. -->
      <section v-for="section in sections" :key="section.id" :data-testid="`config-section-${section.id}`" class="space-y-2">
        <div class="flex flex-wrap items-baseline gap-x-2 px-1">
          <h2 class="text-sm font-bold text-(--color-text)">{{ section.title }}</h2>
          <p v-if="section.hint" class="text-xs text-(--color-text-muted)">{{ section.hint }}</p>
        </div>
        <AppCard :padded="false">
          <div
            v-for="(row, i) in section.rows"
            :key="row.key"
            class="grid grid-cols-1 items-center gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_11rem] sm:gap-6 sm:px-5"
            :class="i > 0 && 'border-t border-(--color-border-soft)'"
          >
            <div class="flex min-w-0 items-center gap-3">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--color-border-soft) text-(--color-accent-text)">
                <AppIcon :name="configKeyMeta(row.key).icon" :size="18" />
              </span>
              <div class="min-w-0">
                <p class="text-sm font-semibold text-(--color-text)">{{ configKeyMeta(row.key).label }}</p>
                <p v-if="configKeyMeta(row.key).hint" class="mt-0.5 text-xs leading-5 text-(--color-text-muted)">{{ configKeyMeta(row.key).hint }}</p>
              </div>
            </div>
            <div class="flex items-start gap-2 ps-13 sm:ps-0">
              <AppMoneyInput
                v-if="configKeyMeta(row.key).unit === 'تومان'"
                :model-value="rowText[row.key]"
                class="w-28"
                :aria-label="configKeyMeta(row.key).label"
                :error="rowError(row.key)"
                @update:model-value="(v) => onRowInput(row, v)"
              />
              <!-- type="text", not "number": a number input can only ever display Latin digits.
                   The field shows Persian digits and accepts either set (plus the Persian decimal
                   mark) -- onConfigText normalizes to ASCII before validation, so the parsing
                   and bounds logic below never sees anything but plain digits. -->
              <AppInput
                v-else
                :model-value="toPersianDigits(rowText[row.key] ?? '')"
                type="text"
                :inputmode="boundsFor(row.key).integer ? 'numeric' : 'decimal'"
                dir="ltr"
                data-testid="config-input"
                class="tnum w-28 text-left"
                :aria-label="configKeyMeta(row.key).label"
                :error="rowError(row.key)"
                @update:model-value="(v) => onConfigText(row, v)"
              />
              <span v-if="configKeyMeta(row.key).unit" class="mt-3 w-12 shrink-0 text-xs text-(--color-text-muted)">{{ configKeyMeta(row.key).unit }}</span>
            </div>
          </div>
        </AppCard>
      </section>

      <AppButton ref="saveButtonEl" variant="primary" data-testid="config-save-button" :disabled="saving || !canSave" @click="askConfirm">
        ذخیره تغییرات
      </AppButton>
    </template>

    <div v-else class="space-y-3.5">
      <p ref="confirmHeadingEl" tabindex="-1" class="text-sm font-semibold text-(--tone-warning-text) focus:outline-none">
        این تغییرات روی رفتار پلتفرم اثر می‌گذارد. لطفا موارد زیر را بررسی و تایید کنید:
      </p>
      <AppCard :padded="false" data-testid="config-confirm-summary">
        <div
          v-for="(row, i) in changedRows"
          :key="row.key"
          data-testid="config-confirm-row"
          class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-4 sm:px-5"
          :class="i > 0 && 'border-t border-(--color-border-soft)'"
        >
          <p class="min-w-0 text-sm font-semibold text-(--color-text)">{{ configKeyMeta(row.key).label }}</p>
          <p class="tnum min-w-0 text-sm text-(--color-text-muted)">
            از <span class="font-semibold text-(--color-text)">{{ formatConfigValue(row.key, originalValueOf(row.key)) }} {{ configKeyMeta(row.key).unit }}</span>
            به <span class="font-semibold text-(--tone-warning-text)">{{ formatConfigValue(row.key, row.value) }} {{ configKeyMeta(row.key).unit }}</span>
          </p>
        </div>
      </AppCard>
      <div class="flex flex-wrap gap-2.5">
        <AppButton type="button" data-testid="config-confirm-submit" :disabled="saving" :loading="saving" @click="confirmSave">
          تایید و ذخیره
        </AppButton>
        <AppButton type="button" variant="ghost" data-testid="config-confirm-cancel" :disabled="saving" @click="cancelConfirm">
          انصراف
        </AppButton>
      </div>
    </div>
  </div>
</template>
