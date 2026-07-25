<!-- apps/provider-panel/src/pages/CouponsView.vue -->
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { useApi } from '@/composables/useApi'
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
  if (newCoupon.expiresAt) body.expiresAt = new Date(newCoupon.expiresAt).toISOString()
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
  <div class="space-y-4 p-4">
    <h1 class="text-lg font-bold text-(--color-text)">کدهای تخفیف</h1>

    <AppCard class="space-y-3">
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
      <AppInput v-model="newCoupon.expiresAt" label="تاریخ انقضا (اختیاری)" type="date" class="tnum" />
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

        <AppCard v-for="c in coupons" :key="c.id" :padded="false" class="space-y-2 p-4">
          <div class="flex items-center justify-between">
            <p class="tnum text-sm font-bold text-(--color-text)">{{ c.code }}</p>
            <StatusBadge :label="couponStatus(c).label" :tone="couponStatus(c).tone" />
          </div>
          <div class="flex items-center justify-between text-sm text-(--color-text-muted)">
            <span class="tnum">{{ discountLabel(c) }}</span>
            <span class="tnum">{{ expiryLabel(c) }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="tnum text-sm text-(--color-text-muted)">استفاده: {{ usageLabel(c) }}</span>
            <AppButton
              v-if="c.isActive"
              type="button"
              variant="danger"
              :loading="deactivatingId === c.id"
              :disabled="deactivatingId === c.id"
              @click="deactivate(c)"
            >
              <template #icon><AppIcon name="x" :size="15" /></template>
              غیرفعال‌سازی
            </AppButton>
          </div>
        </AppCard>
      </template>
    </template>
  </div>
</template>
