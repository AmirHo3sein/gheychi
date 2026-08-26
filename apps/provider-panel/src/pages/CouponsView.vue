<!-- apps/provider-panel/src/pages/CouponsView.vue -->
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { useApi } from '@/composables/useApi'
import { useFeatureFlags } from '@/composables/useFeatureFlags'
import type { Tone } from '@/utils/labels'

interface Coupon {
  id: string
  code: string
  // GET /salons/mine/coupons excludes referral-issued (fixed_discount) coupons, so this
  // is always non-null in practice -- but the DB column itself dropped its NOT NULL
  // constraint (Slice 6, coupons_discount_shape_chk), so this stays nullable in the type
  // and discountLabel() below stays null-safe as cheap defense in depth.
  discountPercent: number | null
  expiresAt: string | null
  maxRedemptions: number | null
  isActive: boolean
  createdAt: string
  redeemedCount: number
}

const { apiFetch } = useApi()
const { flags: featureFlags } = useFeatureFlags()
const coupons = ref<Coupon[]>([])
const loading = ref(true)
const loadError = ref(false)
const creating = ref(false)
const createError = ref('')
const deactivatingId = ref<string | null>(null)
const newCoupon = reactive({
  code: '',
  discountPercent: null as number | null,
  expiresAt: '',
  maxRedemptions: null as number | null,
})

async function load() {
  loading.value = true
  loadError.value = false
  const { data, error } = await apiFetch<Coupon[]>('/salons/mine/coupons', { silent: true })
  if (error) {
    loadError.value = true
    loading.value = false
    return
  }
  coupons.value = data ?? []
  loading.value = false
}

// AppInput's model is always a string -- these proxy newCoupon's number|null fields so
// the numeric inputs can v-model onto AppInput without weakening their underlying type.
const discountPercentInput = computed<string>({
  get: () => (newCoupon.discountPercent === null ? '' : String(newCoupon.discountPercent)),
  set: (v) => {
    newCoupon.discountPercent = v === '' ? null : Number(v)
  },
})

const maxRedemptionsInput = computed<string>({
  get: () => (newCoupon.maxRedemptions === null ? '' : String(newCoupon.maxRedemptions)),
  set: (v) => {
    newCoupon.maxRedemptions = v === '' ? null : Number(v)
  },
})

onMounted(load)

function expiryLabel(c: Coupon): string {
  return c.expiresAt ? new Date(c.expiresAt).toLocaleDateString('fa-IR') : 'بدون انقضا'
}

function usageLabel(c: Coupon): string {
  if (c.maxRedemptions === null) return 'نامحدود'
  return `${c.redeemedCount.toLocaleString('fa-IR')} / ${c.maxRedemptions.toLocaleString('fa-IR')}`
}

// Null-safe: this list only ever contains manually-created (percent-only) coupons in
// practice, but discountPercent is no longer NOT NULL at the DB level, so guard rather
// than risk rendering "٪null".
function discountLabel(c: Coupon): string {
  return c.discountPercent === null ? '—' : `٪${c.discountPercent.toLocaleString('fa-IR')} تخفیف`
}

// isActive is a raw DB flag that the API only ever flips to false explicitly (via
// deactivate) -- it is NOT auto-cleared when expiresAt passes or maxRedemptions is hit,
// those are only enforced at redemption time. So the badge must derive an honest status
// client-side rather than trust isActive alone, or an expired/exhausted coupon reads as
// "فعال" (success, green) when it can no longer actually be redeemed.
function couponStatus(c: Coupon): { label: string; tone: Tone } {
  if (!c.isActive) return { label: 'غیرفعال', tone: 'neutral' }
  if (c.expiresAt && new Date(c.expiresAt).getTime() <= Date.now()) {
    return { label: 'منقضی شده', tone: 'warning' }
  }
  if (c.maxRedemptions !== null && c.redeemedCount >= c.maxRedemptions) {
    return { label: 'به سقف استفاده رسیده', tone: 'warning' }
  }
  return { label: 'فعال', tone: 'success' }
}

async function createCoupon() {
  createError.value = ''
  if (!newCoupon.code.trim()) {
    createError.value = 'کد تخفیف را وارد کنید.'
    return
  }
  if (!newCoupon.discountPercent) {
    createError.value = 'درصد تخفیف را وارد کنید.'
    return
  }
  if (newCoupon.discountPercent < 1 || newCoupon.discountPercent > 100) {
    createError.value = 'درصد تخفیف باید بین ۱ تا ۱۰۰ باشد.'
    return
  }
  if (newCoupon.maxRedemptions !== null && newCoupon.maxRedemptions < 1) {
    createError.value = 'سقف استفاده باید حداقل ۱ باشد.'
    return
  }

  const body: Record<string, unknown> = {
    code: newCoupon.code.trim(),
    discountPercent: Number(newCoupon.discountPercent),
  }
  // The date input hands over a bare YYYY-MM-DD, which `new Date()` parses as UTC midnight --
  // i.e. 03:30 local on the chosen day here (Iran is UTC+3:30). Redemption rejects as soon as
  // expiresAt is in the past, so a coupon "valid through 10 Mordad" would have died at 03:30
  // that morning while this list still displayed 10 Mordad as its expiry. Building the instant
  // from local end-of-day keeps the coupon alive for the whole day the provider picked; the
  // stored value stays a real UTC instant, matching the codebase's convention (see
  // apps/api/src/booking/availability.util.ts) and the admin panel's coupon form.
  if (newCoupon.expiresAt) body.expiresAt = new Date(`${newCoupon.expiresAt}T23:59:59.999`).toISOString()
  if (newCoupon.maxRedemptions) body.maxRedemptions = Number(newCoupon.maxRedemptions)

  creating.value = true
  // Not silent: a 409 (duplicate code) needs to surface inline, not just via the
  // generic toast -- the toast still fires too (useApi's default non-silent behavior).
  const { data, error } = await apiFetch<Coupon>('/salons/mine/coupons', { method: 'POST', body })
  creating.value = false
  if (error) {
    createError.value = error.status === 409 ? 'این کد تخفیف قبلاً استفاده شده است.' : 'افزودن کد تخفیف انجام نشد. دوباره تلاش کنید.'
    return
  }
  if (data) coupons.value.unshift({ ...data, redeemedCount: 0 })

  newCoupon.code = ''
  newCoupon.discountPercent = null
  newCoupon.expiresAt = ''
  newCoupon.maxRedemptions = null
}

async function deactivate(coupon: Coupon) {
  if (deactivatingId.value) return
  if (!window.confirm('این کد تخفیف غیرفعال شود؟')) return
  deactivatingId.value = coupon.id
  const { error } = await apiFetch(`/salons/mine/coupons/${coupon.id}`, { method: 'DELETE' })
  deactivatingId.value = null
  // Only mutate local state on a real success -- previously this unconditionally set
  // isActive=false even when the request failed, silently lying about the outcome.
  if (!error) coupon.isActive = false
}
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-4 p-4 lg:p-6">
    <!-- text-center, not just start-aligned: the content below (the add-form, the coupon
         grid) is independently centered within this wide container, not stretched to fill
         it -- a start-aligned heading above centered content reads as visibly offset from
         it ("the title is on the right"). -->
    <h1 class="text-center text-lg font-bold text-(--color-text)">کدهای تخفیف</h1>

    <!-- Coupon management stays fully functional while the flag is off (only redemption
         at checkout is gated server-side, see coupons.service.ts) -- this just explains
         why a customer can't redeem anything right now. -->
    <p
      v-if="!featureFlags.couponsEnabled"
      data-testid="coupons-disabled-banner"
      role="status"
      class="mx-auto flex max-w-2xl items-center gap-2 rounded-xl bg-(--tone-warning-bg) p-3 text-sm text-(--tone-warning-text)"
    >
      <AppIcon name="warning" :size="16" class="shrink-0" />
      کدهای تخفیف موقتاً غیرفعال است؛ می‌توانید همچنان کد بسازید، اما مشتریان نمی‌توانند از آن استفاده کنند.
    </p>

    <!-- Capped AND centered independently of the page container: a single-column form whose
         inputs span 1024px reads as broken, and capping without centering hugs the RTL start
         (right) edge with visibly empty space on the other side. -->
    <AppCard class="mx-auto max-w-2xl space-y-3">
      <h2 class="font-bold text-(--color-text)">افزودن کد تخفیف جدید</h2>
      <div>
        <AppInput v-model="newCoupon.code" label="کد تخفیف" placeholder="مثلاً SUMMER20" class="uppercase" />
        <p class="mt-1 text-xs text-(--color-text-muted)">کد به‌صورت خودکار با حروف بزرگ ذخیره می‌شود.</p>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <AppInput
          v-model="discountPercentInput"
          label="٪ تخفیف"
          type="number"
          inputmode="numeric"
          min="1"
          max="100"
          class="tnum"
        />
        <AppInput
          v-model="maxRedemptionsInput"
          label="سقف استفاده (اختیاری)"
          type="number"
          inputmode="numeric"
          min="1"
          class="tnum"
        />
      </div>
      <div>
        <label class="mb-1.5 block text-sm font-medium text-(--color-text)">تاریخ انقضا (اختیاری)</label>
        <JalaliDatePicker v-model="newCoupon.expiresAt" placeholder="بدون انقضا" />
      </div>
      <p v-if="createError" class="flex items-center gap-2 rounded-xl bg-(--tone-danger-bg) p-3 text-sm text-(--tone-danger-text)">
        {{ createError }}
      </p>
      <AppButton type="button" variant="primary" block :loading="creating" :disabled="creating" @click="createCoupon">افزودن</AppButton>
    </AppCard>

    <div v-if="loadError" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">کدهای تخفیف بارگذاری نشد.</p>
      <AppButton type="button" variant="secondary" data-testid="retry-coupons" @click="load">تلاش دوباره</AppButton>
    </div>

    <template v-else>
      <div v-if="loading" class="flex items-center justify-center py-8 text-(--color-text-muted)">
        <AppIcon name="spinner" :size="20" class="animate-spin" />
      </div>

      <template v-else>
        <EmptyState v-if="coupons.length === 0" icon="coupons" message="هنوز کد تخفیفی ثبت نشده است." />

        <!-- auto-fit + justify-center, not a fixed md:/xl: column count: a lone or odd
             trailing card in a fixed grid strands in the RTL start (right) column with
             visibly empty space beside it. This still lays out multi-column once there are
             enough coupons to fill a row, but centers the populated tracks when there aren't.
             max: 1fr, not a fixed px cap -- a fixed max lets each column size independently
             off its own content up to that cap, producing visibly uneven column widths when
             cards differ (the exact bug BookingsView.vue had); 1fr splits the row's leftover
             space equally across every populated column instead. -->
        <div v-else class="grid items-start justify-center gap-3 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
          <AppCard v-for="c in coupons" :key="c.id" :padded="false" class="space-y-2 p-4">
            <!--
              The code is owner-supplied and has no break opportunities («SUMMERSPECIAL2026»),
              and the longest status label («به سقف استفاده رسیده») is ~150px on its own -- the
              pair overflowed a 320px card. break-all lets the code wrap; flex-wrap keeps the
              badge whole rather than squashed.
            -->
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="tnum min-w-0 break-all text-sm font-bold text-(--color-text)">{{ c.code }}</p>
              <StatusBadge :label="couponStatus(c).label" :tone="couponStatus(c).tone" />
            </div>
            <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-(--color-text-muted)">
              <span class="tnum">{{ discountLabel(c) }}</span>
              <span class="tnum">{{ expiryLabel(c) }}</span>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="tnum text-sm text-(--color-text-muted)">استفاده: {{ usageLabel(c) }}</span>
              <AppButton
                v-if="c.isActive"
                type="button"
                variant="danger"
                class="shrink-0"
                :loading="deactivatingId === c.id"
                :disabled="deactivatingId === c.id"
                @click="deactivate(c)"
              >
                <template #icon><AppIcon name="x" :size="15" /></template>
                غیرفعال‌سازی
              </AppButton>
            </div>
          </AppCard>
        </div>
      </template>
    </template>
  </div>
</template>
