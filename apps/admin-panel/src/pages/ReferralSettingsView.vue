<!-- apps/admin-panel/src/pages/ReferralSettingsView.vue -->
<!-- Referral Settings admin screen (design spec §4/§8: GET/PATCH /admin/referral-reward-types
     -- 3 fixed rows, User/Salon Owner/Worker, PATCH-only, audited). Structurally closest to
     ConfigView.vue (a small, fixed set of server rows edited in place with a Save button, no
     create/delete), adapted into one card per row since each row here carries far more fields
     than a single number.

     R12/Product Decision 1: all three rows ship enabled=false with zero-value rewards --
     this is the expected default, not a broken/empty form, so a disabled row leads with a
     clear, explanatory banner instead of just looking unfilled. -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import type { SelectOption } from '@/components/ui/AppSelect.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { qualifyingEventLabel, referralTypeLabel, rewardKindLabel, rewardKindUnit } from '@/utils/labels'

type ReferralType = 'user' | 'salon_owner' | 'worker'
type RewardKind = 'wallet_credit' | 'percent_discount' | 'fixed_discount' | 'cashback' | 'loyalty_points'
type QualifyingEvent = 'first_completed_booking' | 'first_paid_booking'

const REWARD_KINDS: RewardKind[] = ['wallet_credit', 'percent_discount', 'fixed_discount', 'cashback', 'loyalty_points']
const REWARD_KIND_OPTIONS: SelectOption[] = REWARD_KINDS.map((kind) => ({ value: kind, label: rewardKindLabel(kind) }))

const QUALIFYING_EVENTS: QualifyingEvent[] = ['first_completed_booking', 'first_paid_booking']
const QUALIFYING_EVENT_OPTIONS: SelectOption[] = QUALIFYING_EVENTS.map((event) => ({
  value: event,
  label: qualifyingEventLabel(event),
}))

// The fixed display order for the three rows -- GET returns them ordered by referral_type
// (alphabetical: salon_owner, user, worker), which isn't the order a product/support person
// thinks in. This mirrors the design spec's own "User / Salon Owner / Worker" ordering.
const TYPE_ORDER: ReferralType[] = ['user', 'salon_owner', 'worker']

interface RewardTypeRow {
  referralType: ReferralType
  enabled: boolean
  referrerRewardKind: RewardKind
  referrerRewardValue: number
  referrerRewardMax: number | null
  referredRewardKind: RewardKind
  referredRewardValue: number
  referredRewardMax: number | null
  qualifyingEvent: QualifyingEvent
  grantHoldbackHours: number
  expirationDays: number | null
  maxReferralsPerReferrer: number | null
  updatedAt: string
}

const { apiFetch } = useApi()
const { push: pushToast } = useToast()

const rows = ref<RewardTypeRow[]>([])
const loading = ref(true)
const savingType = ref<ReferralType | null>(null)

async function load() {
  loading.value = true
  const { data } = await apiFetch<RewardTypeRow[]>('/admin/referral-reward-types', { silent: true })
  const byType = new Map((data ?? []).map((row) => [row.referralType, row]))
  rows.value = TYPE_ORDER.map((type) => byType.get(type)).filter((row): row is RewardTypeRow => !!row)
  loading.value = false
}

// Empty-string number inputs land here as '' via v-model.number (Vue's .number modifier
// only coerces strings that parse cleanly) -- normalized to null (clears the field
// server-side) rather than silently becoming 0 or NaN. 0 itself is preserved as a real value.
function normalizeNullable(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function save(row: RewardTypeRow) {
  if (savingType.value) return
  savingType.value = row.referralType
  const { data } = await apiFetch<RewardTypeRow>(`/admin/referral-reward-types/${row.referralType}`, {
    method: 'PATCH',
    body: {
      enabled: row.enabled,
      referrerRewardKind: row.referrerRewardKind,
      referrerRewardValue: Number(row.referrerRewardValue) || 0,
      referrerRewardMax: normalizeNullable(row.referrerRewardMax),
      referredRewardKind: row.referredRewardKind,
      referredRewardValue: Number(row.referredRewardValue) || 0,
      referredRewardMax: normalizeNullable(row.referredRewardMax),
      qualifyingEvent: row.qualifyingEvent,
      grantHoldbackHours: Number(row.grantHoldbackHours) || 0,
      expirationDays: normalizeNullable(row.expirationDays),
      maxReferralsPerReferrer: normalizeNullable(row.maxReferralsPerReferrer),
    },
  })
  savingType.value = null
  if (data) {
    const index = rows.value.findIndex((r) => r.referralType === row.referralType)
    if (index !== -1) rows.value[index] = data
    pushToast(`تنظیمات «${referralTypeLabel(row.referralType)}» ذخیره شد`)
  }
}

onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-5 p-8">
    <div v-for="row in rows" :key="row.referralType" class="space-y-5">
      <AppCard>
        <div class="mb-4 flex items-center justify-between gap-3">
          <p class="flex items-center gap-2 text-sm font-bold text-(--color-text)">
            <AppIcon name="gift" :size="17" class="text-(--color-accent)" />
            {{ referralTypeLabel(row.referralType) }}
          </p>
          <div class="flex items-center gap-2.5">
            <StatusBadge :label="row.enabled ? 'فعال' : 'غیرفعال'" :tone="row.enabled ? 'success' : 'neutral'" />
            <button
              type="button"
              role="switch"
              :aria-checked="row.enabled"
              :data-testid="`enabled-toggle-${row.referralType}`"
              class="relative h-6 w-11 shrink-0 rounded-full transition-colors"
              :class="row.enabled ? 'bg-(--color-accent)' : 'bg-(--color-border)'"
              @click="row.enabled = !row.enabled"
            >
              <span class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" :class="row.enabled ? 'left-0.5' : 'right-0.5'" />
            </button>
          </div>
        </div>

        <!-- R12: all three types ship disabled with zero-value rewards by default -- an
             explanatory banner so this reads as "not configured yet", not "broken". -->
        <div
          v-if="!row.enabled"
          data-testid="disabled-banner"
          class="mb-4 flex items-start gap-2.5 rounded-xl bg-(--tone-warning-bg) px-4 py-3 text-sm text-(--tone-warning-text)"
        >
          <AppIcon name="warning" :size="16" class="mt-0.5 shrink-0" />
          <span>
            این نوع معرفی غیرفعال است و پاداشی اعطا نمی‌شود -- مقادیر صفر در ادامه پیش‌فرض و طبیعی است.
            پس از تنظیم مقادیر واقعی، کلید فعال‌سازی را بزنید و ذخیره کنید.
          </span>
        </div>

        <div class="grid gap-5 sm:grid-cols-2">
          <div class="space-y-3 rounded-xl border border-(--color-border-soft) p-4">
            <p class="text-xs font-semibold text-(--color-text-muted)">پاداش معرف</p>
            <div>
              <label class="mb-1.5 block text-xs text-(--color-text-muted)">نوع پاداش</label>
              <AppSelect v-model="row.referrerRewardKind" :options="REWARD_KIND_OPTIONS" width="100%" />
            </div>
            <div class="flex items-end gap-2">
              <div class="flex-1">
                <label class="mb-1.5 block text-xs text-(--color-text-muted)">مقدار ({{ rewardKindUnit(row.referrerRewardKind) }})</label>
                <input
                  v-model.number="row.referrerRewardValue"
                  :data-testid="`referrer-value-${row.referralType}`"
                  type="number"
                  min="0"
                  class="tnum w-full rounded-xl border border-(--color-border) p-2.5 text-sm"
                />
              </div>
              <div class="flex-1">
                <label class="mb-1.5 block text-xs text-(--color-text-muted)">سقف (اختیاری)</label>
                <input
                  v-model.number="row.referrerRewardMax"
                  type="number"
                  min="0"
                  placeholder="نامحدود"
                  class="tnum w-full rounded-xl border border-(--color-border) p-2.5 text-sm"
                />
              </div>
            </div>
          </div>

          <div class="space-y-3 rounded-xl border border-(--color-border-soft) p-4">
            <p class="text-xs font-semibold text-(--color-text-muted)">پاداش معرفی‌شده</p>
            <div>
              <label class="mb-1.5 block text-xs text-(--color-text-muted)">نوع پاداش</label>
              <AppSelect v-model="row.referredRewardKind" :options="REWARD_KIND_OPTIONS" width="100%" />
            </div>
            <div class="flex items-end gap-2">
              <div class="flex-1">
                <label class="mb-1.5 block text-xs text-(--color-text-muted)">مقدار ({{ rewardKindUnit(row.referredRewardKind) }})</label>
                <input
                  v-model.number="row.referredRewardValue"
                  :data-testid="`referred-value-${row.referralType}`"
                  type="number"
                  min="0"
                  class="tnum w-full rounded-xl border border-(--color-border) p-2.5 text-sm"
                />
              </div>
              <div class="flex-1">
                <label class="mb-1.5 block text-xs text-(--color-text-muted)">سقف (اختیاری)</label>
                <input
                  v-model.number="row.referredRewardMax"
                  type="number"
                  min="0"
                  placeholder="نامحدود"
                  class="tnum w-full rounded-xl border border-(--color-border) p-2.5 text-sm"
                />
              </div>
            </div>
          </div>
        </div>

        <div class="mt-5 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">رویداد شرط پاداش</label>
            <AppSelect v-model="row.qualifyingEvent" :options="QUALIFYING_EVENT_OPTIONS" width="100%" />
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">مهلت انتظار اعطا (ساعت)</label>
            <input
              v-model.number="row.grantHoldbackHours"
              type="number"
              min="0"
              class="tnum w-full rounded-xl border border-(--color-border) p-2.5 text-sm"
            />
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">انقضا (روز، اختیاری)</label>
            <input
              v-model.number="row.expirationDays"
              type="number"
              min="0"
              placeholder="هرگز"
              class="tnum w-full rounded-xl border border-(--color-border) p-2.5 text-sm"
            />
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">سقف تعداد معرفی هر معرف (اختیاری)</label>
            <input
              v-model.number="row.maxReferralsPerReferrer"
              type="number"
              min="0"
              placeholder="نامحدود"
              class="tnum w-full rounded-xl border border-(--color-border) p-2.5 text-sm"
            />
          </div>
        </div>

        <div class="mt-5 flex justify-end">
          <button
            type="button"
            :data-testid="`save-${row.referralType}`"
            :disabled="savingType === row.referralType"
            class="rounded-xl bg-(--color-accent) px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            @click="save(row)"
          >
            ذخیره تغییرات
          </button>
        </div>
      </AppCard>
    </div>
  </div>
</template>
