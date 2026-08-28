<!-- apps/admin-panel/src/components/salons/SalonBookingSettingsCard.vue -->
<!-- Uniform Consequence Rule (DESIGN.md): these two numbers move the real deadlines stamped
     onto this salon's future bookings, so the card gets the same confirm-before-commit shape
     as ConfigView.vue -- a `confirming` toggle between the editable rows and a summary scoped
     to only the rows that actually changed.

     The salon's confirmation MODE is displayed but never editable here: the owner picks the
     workflow, the platform picks the deadlines. That split is enforced by the backend having
     two separate routes (PATCH /salons/mine vs this admin one), and this card must not blur
     it by offering a control the owner owns. -->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { toPersianDigits } from '@/utils/digits'
import { bookingConfirmationModeLabel } from '@/utils/labels'

const props = defineProps<{ salonId: string }>()

/**
 * GET/PATCH /admin/salons/:id/booking-settings. The raw `*Override` columns are kept
 * separate from the resolved `*Minutes` values on purpose: without both, "explicitly
 * overridden to 30" is indistinguishable from "inheriting the global 30", which is exactly
 * the distinction this card exists to show.
 */
interface BookingSettings {
  salonId: string
  bookingConfirmationMode: 'automatic' | 'manual_approval'
  approvalTimeoutOverride: number | null
  paymentTimeoutOverride: number | null
  approvalTimeoutMinutes: number
  paymentTimeoutMinutes: number
  globalApprovalTimeoutMinutes: number
  globalPaymentTimeoutMinutes: number
  approvalTimeoutIsOverridden: boolean
  paymentTimeoutIsOverridden: boolean
}

type TimeoutKey = 'approval' | 'payment'

/** Matches the backend DTO's @Min(1)/@Max(1440) -- an out-of-range value must never reach
 *  the confirm screen, let alone the PATCH. */
const MIN_MINUTES = 1
const MAX_MINUTES = 1440

const FIELDS = [
  {
    key: 'approval' as const,
    bodyKey: 'approvalTimeoutMinutes' as const,
    label: 'مهلت تایید درخواست',
    hint: 'فرصت آرایشگاه برای تایید یا رد یک درخواست رزرو',
  },
  {
    key: 'payment' as const,
    bodyKey: 'paymentTimeoutMinutes' as const,
    label: 'مهلت پرداخت',
    hint: 'فرصت مشتری برای پرداخت پس از باز شدن پنجره پرداخت',
  },
]

/** One row per overridable timeout. `value` is the OVERRIDE, so `null` is a real, valid
 *  state meaning "inherit the global default" -- unlike ConfigView, empty is not an error. */
interface TimeoutRow {
  key: TimeoutKey
  value: number | null
}

const { apiFetch } = useApi()
const { push: pushToast } = useToast()
const settings = ref<BookingSettings | null>(null)
const rows = ref<TimeoutRow[]>([])
// Snapshot of what's currently persisted server-side -- diffed against `rows` to know which
// rows actually changed, both to gate the save button and to build the confirm summary.
const originalRows = ref<TimeoutRow[]>([])
// Raw text the admin is actually looking at, keyed by row -- decoupled from `rows[].value`
// so an out-of-range field displays exactly what was typed instead of snapping back to the
// last valid value. `rows[].value` only ever holds the last *valid* parsed override.
const rowText = ref<Record<string, string>>({})
const rowInvalid = ref<Record<string, boolean>>({})
const loading = ref(true)
const loadError = ref(false)
const saving = ref(false)
const confirming = ref(false)

const confirmHeadingEl = ref<HTMLElement | null>(null)
const saveButtonEl = ref<InstanceType<typeof AppButton> | null>(null)

function applySettings(data: BookingSettings) {
  settings.value = data
  const fresh: TimeoutRow[] = [
    { key: 'approval', value: data.approvalTimeoutOverride },
    { key: 'payment', value: data.paymentTimeoutOverride },
  ]
  rows.value = fresh.map((r) => ({ ...r }))
  originalRows.value = fresh.map((r) => ({ ...r }))
  // An absent override is an empty field, never a "0" -- the placeholder carries the
  // inherited value instead, so the box itself stays honestly blank.
  rowText.value = Object.fromEntries(fresh.map((r) => [r.key, r.value === null ? '' : String(r.value)]))
  rowInvalid.value = Object.fromEntries(fresh.map((r) => [r.key, false]))
}

async function load() {
  loading.value = true
  loadError.value = false
  const { data, error } = await apiFetch<BookingSettings>(`/admin/salons/${props.salonId}/booking-settings`, { silent: true })
  if (error || !data) {
    loadError.value = true
    loading.value = false
    return
  }
  applySettings(data)
  loading.value = false
}

function originalValueOf(key: TimeoutKey): number | null {
  return originalRows.value.find((r) => r.key === key)?.value ?? null
}

function onRowInput(row: TimeoutRow, raw: string | number) {
  // A type="number" AppInput makes Vue's v-model auto-cast a successfully-parsed value to a
  // real JS number while leaving an empty/unparseable value as the original string --
  // normalize to a string up front so this function has one shape to validate.
  const text = String(raw)
  rowText.value[row.key] = text
  const trimmed = text.trim()
  // Empty is the "clear the override" gesture, not an error: it resolves to an explicit
  // null in the PATCH body, which is what makes the salon inherit the global default again.
  if (trimmed === '') {
    rowInvalid.value[row.key] = false
    row.value = null
    return
  }
  const parsed = Number(trimmed)
  if (Number.isNaN(parsed) || !Number.isInteger(parsed) || parsed < MIN_MINUTES || parsed > MAX_MINUTES) {
    rowInvalid.value[row.key] = true
    return
  }
  rowInvalid.value[row.key] = false
  row.value = parsed
}

function rowError(key: TimeoutKey): string | undefined {
  if (!rowInvalid.value[key]) return undefined
  const text = (rowText.value[key] ?? '').trim()
  const parsed = Number(text)
  if (Number.isNaN(parsed)) return 'یک عدد معتبر وارد کنید'
  if (!Number.isInteger(parsed)) return 'مقدار باید عدد صحیح باشد'
  return `باید بین ${toPersianDigits(MIN_MINUTES)} تا ${toPersianDigits(MAX_MINUTES)} دقیقه باشد`
}

/** Clearing the field IS the clear-the-override gesture; this is just an explicit, obvious
 *  way to perform it (an empty box alone doesn't advertise what it will do). */
function clearOverride(row: TimeoutRow) {
  onRowInput(row, '')
}

function fieldOf(key: TimeoutKey) {
  return FIELDS.find((f) => f.key === key)!
}

function effectiveMinutesOf(key: TimeoutKey): number | null {
  if (!settings.value) return null
  return key === 'approval' ? settings.value.approvalTimeoutMinutes : settings.value.paymentTimeoutMinutes
}

function globalMinutesOf(key: TimeoutKey): number | null {
  if (!settings.value) return null
  return key === 'approval' ? settings.value.globalApprovalTimeoutMinutes : settings.value.globalPaymentTimeoutMinutes
}

function isOverridden(key: TimeoutKey): boolean {
  if (!settings.value) return false
  return key === 'approval' ? settings.value.approvalTimeoutIsOverridden : settings.value.paymentTimeoutIsOverridden
}

function formatMinutes(minutes: number | null): string {
  return minutes === null ? '—' : `${minutes.toLocaleString('fa-IR')} دقیقه`
}

/**
 * The persisted effective value with its provenance -- «۶۰ دقیقه» when this salon carries
 * its own override, «۳۰ دقیقه (پیش‌فرض سراسری)» when it inherits. Reads from the server's
 * own resolved payload, never from the in-progress edit, so it always states what is
 * actually in force right now.
 */
function effectiveText(key: TimeoutKey): string {
  const base = formatMinutes(effectiveMinutesOf(key))
  return isOverridden(key) ? base : `${base} (پیش‌فرض سراسری)`
}

/** How an override value reads in the confirm summary, where `null` must state what the
 *  salon will fall back to rather than showing a bare dash. */
function formatOverride(key: TimeoutKey, value: number | null): string {
  if (value !== null) return formatMinutes(value)
  return `پیش‌فرض سراسری (${formatMinutes(globalMinutesOf(key))})`
}

// Only the rows whose override actually differs from what's persisted -- the confirm
// summary must list precisely what will change, and the PATCH sends only these, so an
// untouched field is left `undefined` (leave alone) rather than rewritten to its own value.
const changedRows = computed(() => rows.value.filter((r) => originalValueOf(r.key) !== r.value))
const hasChanges = computed(() => changedRows.value.length > 0)
const hasInvalidRows = computed(() => Object.values(rowInvalid.value).some(Boolean))
const canSave = computed(() => hasChanges.value && !hasInvalidRows.value)

function askConfirm() {
  // Nothing changed, or an unresolved out-of-range field -- no-op (the button is disabled
  // for both cases too, but this guards direct calls/races).
  if (!canSave.value) return
  confirming.value = true
}

function cancelConfirm() {
  confirming.value = false
}

async function confirmSave() {
  saving.value = true
  // `undefined` means "not supplied, leave alone" and an explicit `null` means "clear the
  // override" on the backend, so only changed keys go into the body and a cleared row must
  // keep its literal null rather than being dropped by the object build.
  const body: Record<string, number | null> = {}
  for (const row of changedRows.value) body[fieldOf(row.key).bodyKey] = row.value

  const { data, error } = await apiFetch<BookingSettings>(`/admin/salons/${props.salonId}/booking-settings`, {
    method: 'PATCH',
    body,
  })
  saving.value = false
  if (error) return
  pushToast('تنظیمات رزرو ذخیره شد')
  // The PATCH response already carries the re-resolved effective values, so the provenance
  // line updates without a second GET. The re-read is a defensive fallback only: without a
  // fresh snapshot the diff would still report the just-saved change as pending.
  if (data) applySettings(data)
  else await load()
  confirming.value = false
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

<template>
  <AppCard>
    <div v-if="loading" data-testid="booking-settings-loading" class="flex items-center justify-center gap-2 py-10 text-sm text-(--color-text-muted)">
      <AppIcon name="spinner" :size="20" class="animate-spin" />
      در حال بارگذاری تنظیمات رزرو…
    </div>

    <div v-else-if="loadError" data-testid="booking-settings-error" role="alert" class="flex flex-col items-center justify-center gap-3 py-10 text-center">
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-(--tone-danger-bg) text-(--tone-danger-text)">
        <AppIcon name="warning" :size="22" />
      </div>
      <p class="text-sm text-(--color-text-muted)">بارگذاری تنظیمات رزرو این آرایشگاه با خطا مواجه شد.</p>
      <AppButton type="button" variant="secondary" data-testid="booking-settings-retry" @click="load">تلاش مجدد</AppButton>
    </div>

    <template v-else-if="settings">
      <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div class="flex min-w-0 items-start gap-3">
          <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--color-border-soft) text-(--color-accent-text)">
            <AppIcon name="calendar" :size="22" />
          </div>
          <div class="min-w-0">
            <h3 class="text-base font-bold text-(--color-text)">تنظیمات رزرو</h3>
            <p class="mt-0.5 text-xs text-(--color-text-muted)">حالت تایید را آرایشگاه‌دار انتخاب می‌کند؛ مهلت‌ها را پلتفرم تعیین می‌کند.</p>
          </div>
        </div>
        <!-- Read-only by design: this badge reports the owner's own choice, it is not a
             control, and the admin has no route that could change it. -->
        <StatusBadge
          class="shrink-0"
          data-testid="booking-settings-mode"
          :label="bookingConfirmationModeLabel(settings.bookingConfirmationMode).label"
          :tone="bookingConfirmationModeLabel(settings.bookingConfirmationMode).tone"
        />
      </div>

      <div
        v-if="settings.bookingConfirmationMode === 'automatic'"
        data-testid="booking-settings-automatic-note"
        class="mt-4 flex gap-2.5 rounded-xl bg-(--color-border-soft) p-3.5"
      >
        <AppIcon name="warning" :size="17" class="mt-0.5 shrink-0 text-(--color-text-muted)" />
        <p class="text-sm text-(--color-text-muted)">
          این آرایشگاه روی تایید خودکار است، بنابراین مهلت تایید درخواست فعلا استفاده نمی‌شود؛ مقدار آن برای زمانی که آرایشگاه‌دار حالت را تغییر دهد نگه داشته می‌شود.
        </p>
      </div>

      <template v-if="!confirming">
        <div class="mt-5 space-y-4 border-t border-(--color-border-soft) pt-4">
          <!-- flex-wrap: the label column plus the fixed field + unit + clear button is a
               few hundred px of unshrinkable content, so on a narrow viewport the field
               drops under its label instead of the row overflowing the card. -->
          <div v-for="row in rows" :key="row.key" class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div class="min-w-0">
              <p class="text-sm font-semibold text-(--color-text)">{{ fieldOf(row.key).label }}</p>
              <p class="mt-0.5 text-xs text-(--color-text-muted)">{{ fieldOf(row.key).hint }}</p>
              <p :data-testid="`booking-settings-effective-${row.key}`" class="tnum mt-1 text-xs font-semibold text-(--color-accent-text)">
                مقدار موثر: {{ effectiveText(row.key) }}
              </p>
            </div>
            <div class="flex shrink-0 items-start gap-2">
              <AppInput
                :model-value="rowText[row.key]"
                type="number"
                class="tnum w-28 text-left"
                :data-testid="`booking-settings-input-${row.key}`"
                :aria-label="fieldOf(row.key).label"
                :placeholder="String(globalMinutesOf(row.key) ?? '')"
                :error="rowError(row.key)"
                @update:model-value="(v) => onRowInput(row, v)"
              />
              <span class="mt-2.5 w-10 text-xs text-(--color-text-muted)">دقیقه</span>
              <AppButton
                v-if="rowText[row.key] !== ''"
                type="button"
                variant="ghost"
                :data-testid="`booking-settings-clear-${row.key}`"
                @click="clearOverride(row)"
              >
                <template #icon><AppIcon name="reset" :size="15" /></template>
                پیش‌فرض
              </AppButton>
            </div>
          </div>
        </div>

        <p class="mt-4 text-xs text-(--color-text-muted)">
          خالی گذاشتن هر مقدار یعنی این آرایشگاه از پیش‌فرض سراسری پیروی کند. مهلت‌های ثبت‌شده روی رزروهای موجود تغییر نمی‌کنند و فقط رزروهای بعدی را متاثر می‌کنند.
        </p>

        <div class="mt-4">
          <AppButton
            ref="saveButtonEl"
            variant="primary"
            data-testid="booking-settings-save-button"
            :disabled="saving || !canSave"
            @click="askConfirm"
          >
            ذخیره تنظیمات رزرو
          </AppButton>
        </div>
      </template>

      <div v-else class="mt-5 space-y-3.5 border-t border-(--color-border-soft) pt-4">
        <p ref="confirmHeadingEl" tabindex="-1" class="text-sm font-semibold text-(--tone-warning-text) focus:outline-none">
          این تغییرات روی مهلت‌های رزروهای بعدی این آرایشگاه اثر می‌گذارد. لطفا موارد زیر را بررسی و تایید کنید:
        </p>
        <AppCard :padded="false" data-testid="booking-settings-confirm-summary">
          <div
            v-for="(row, i) in changedRows"
            :key="row.key"
            data-testid="booking-settings-confirm-row"
            class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-4 sm:px-5"
            :class="i > 0 && 'border-t border-(--color-border-soft)'"
          >
            <p class="min-w-0 text-sm font-semibold text-(--color-text)">{{ fieldOf(row.key).label }}</p>
            <p class="tnum min-w-0 text-sm text-(--color-text-muted)">
              از <span class="font-semibold text-(--color-text)">{{ formatOverride(row.key, originalValueOf(row.key)) }}</span>
              به <span class="font-semibold text-(--tone-warning-text)">{{ formatOverride(row.key, row.value) }}</span>
            </p>
          </div>
        </AppCard>
        <div class="flex flex-wrap gap-2.5">
          <AppButton type="button" data-testid="booking-settings-confirm-submit" :disabled="saving" :loading="saving" @click="confirmSave">
            تایید و ذخیره
          </AppButton>
          <AppButton type="button" variant="ghost" data-testid="booking-settings-confirm-cancel" :disabled="saving" @click="cancelConfirm">
            انصراف
          </AppButton>
        </div>
      </div>
    </template>
  </AppCard>
</template>
