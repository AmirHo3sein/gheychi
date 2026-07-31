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
import { configKeyMeta } from '@/utils/labels'

interface ConfigRow {
  key: string
  value: number
}

// Percent-shaped keys get a 0-100 ceiling; every other key just gets a >= 0 floor. Same
// money-moving stakes as AdjustBalanceCard.vue -- an out-of-range value must never reach
// the confirm screen, let alone the PATCH.
const PERCENT_KEYS = new Set(['deposit_percent', 'commission_percent'])
function boundsFor(key: string): { min: number; max: number | null } {
  return PERCENT_KEYS.has(key) ? { min: 0, max: 100 } : { min: 0, max: null }
}

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
  rows.value = data.map((r) => ({ ...r }))
  originalRows.value = data.map((r) => ({ ...r }))
  rowText.value = Object.fromEntries(data.map((r) => [r.key, String(r.value)]))
  rowInvalid.value = Object.fromEntries(data.map((r) => [r.key, false]))
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
  const { min, max } = boundsFor(row.key)
  const parsed = Number(trimmed)
  // Number('') === 0 -- an explicit emptiness check keeps a select-all-delete mid-edit from
  // silently coercing to a valid-looking "0". Same branch also catches a non-numeric paste
  // and a value outside this key's sane bounds; none of these ever touch `row.value`.
  if (trimmed === '' || Number.isNaN(parsed) || parsed < min || (max !== null && parsed > max)) {
    rowInvalid.value[row.key] = true
    return
  }
  rowInvalid.value[row.key] = false
  row.value = parsed
}

function rowError(key: string): string | undefined {
  if (!rowInvalid.value[key]) return undefined
  const text = (rowText.value[key] ?? '').trim()
  const { min, max } = boundsFor(key)
  if (text === '') return 'این مقدار نمی‌تواند خالی باشد'
  if (Number.isNaN(Number(text))) return 'یک عدد معتبر وارد کنید'
  return max !== null ? `باید بین ${min} تا ${max} باشد` : `باید حداقل ${min} باشد`
}

// Only the rows whose value actually differs from what's persisted -- the confirm summary
// must list precisely what will change, not the full config table.
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
    body: { updates: rows.value.map((r) => ({ key: r.key, value: r.value })) },
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

<!-- p-8 from `sm` up (unchanged); 32px of gutter on each side of a 320px screen is a
     quarter of the usable width, so it relaxes to p-4 below that. -->
<template>
  <div class="mx-auto max-w-2xl space-y-5 p-4 sm:p-8">
    <div v-if="loading" data-testid="config-loading" class="flex items-center justify-center gap-2 py-16 text-sm text-(--color-text-muted)">
      <AppIcon name="spinner" :size="20" class="animate-spin" />
      در حال بارگذاری تنظیمات…
    </div>

    <div v-else-if="loadError" data-testid="config-load-error" role="alert" class="space-y-3 rounded-xl bg-(--tone-danger-bg) p-5 text-center">
      <p class="flex items-center justify-center gap-2 text-sm text-(--tone-danger-text)">
        <AppIcon name="warning" :size="16" />
        بارگذاری تنظیمات پلتفرم با خطا مواجه شد.
      </p>
      <AppButton type="button" variant="secondary" data-testid="config-retry-button" @click="load">
        تلاش مجدد
      </AppButton>
    </div>

    <template v-else-if="!confirming">
      <AppCard :padded="false">
        <!-- flex-wrap: the label column plus the fixed 96px field + unit is ~250px of
             unshrinkable content, so below `sm` the field drops under its label instead of
             the row overflowing the card. One line, exactly as today, from `sm` up. -->
        <div v-for="(row, i) in rows" :key="row.key" class="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-5" :class="i > 0 && 'border-t border-(--color-border-soft)'">
          <div class="min-w-0">
            <p class="text-sm font-semibold text-(--color-text)">{{ configKeyMeta(row.key).label }}</p>
            <p v-if="configKeyMeta(row.key).hint" class="mt-0.5 text-xs text-(--color-text-muted)">{{ configKeyMeta(row.key).hint }}</p>
          </div>
          <div class="flex shrink-0 items-start gap-2">
            <AppInput
              :model-value="rowText[row.key]"
              type="number"
              class="tnum w-24 text-left"
              :aria-label="configKeyMeta(row.key).label"
              :error="rowError(row.key)"
              @update:model-value="(v) => onRowInput(row, v)"
            />
            <span v-if="configKeyMeta(row.key).unit" class="mt-3 w-14 text-xs text-(--color-text-muted)">{{ configKeyMeta(row.key).unit }}</span>
          </div>
        </div>
      </AppCard>

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
            از <span class="font-semibold text-(--color-text)">{{ originalValueOf(row.key)?.toLocaleString('fa-IR') }} {{ configKeyMeta(row.key).unit }}</span>
            به <span class="font-semibold text-(--tone-warning-text)">{{ row.value.toLocaleString('fa-IR') }} {{ configKeyMeta(row.key).unit }}</span>
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
