<!-- apps/provider-panel/src/pages/CouponsView.vue -->
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { useApi } from '@/composables/useApi'

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
const createError = ref('')
const newCoupon = reactive({
  code: '',
  discountPercent: null as number | null,
  expiresAt: '',
  maxRedemptions: null as number | null,
})

async function load() {
  const { data } = await apiFetch<Coupon[]>('/salons/mine/coupons', { silent: true })
  coupons.value = data ?? []
  loading.value = false
}

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

async function createCoupon() {
  createError.value = ''
  if (!newCoupon.code.trim() || !newCoupon.discountPercent) return

  const body: Record<string, unknown> = {
    code: newCoupon.code.trim(),
    discountPercent: Number(newCoupon.discountPercent),
  }
  if (newCoupon.expiresAt) body.expiresAt = new Date(newCoupon.expiresAt).toISOString()
  if (newCoupon.maxRedemptions) body.maxRedemptions = Number(newCoupon.maxRedemptions)

  // Not silent: a 409 (duplicate code) needs to surface inline, not just via the
  // generic toast -- the toast still fires too (useApi's default non-silent behavior).
  const { data, error } = await apiFetch<Coupon>('/salons/mine/coupons', { method: 'POST', body })
  if (error) {
    createError.value = error.status === 409 ? 'این کد تخفیف قبلاً استفاده شده است.' : error.message
    return
  }
  if (data) coupons.value.unshift({ ...data, redeemedCount: 0 })

  newCoupon.code = ''
  newCoupon.discountPercent = null
  newCoupon.expiresAt = ''
  newCoupon.maxRedemptions = null
}

async function deactivate(coupon: Coupon) {
  if (!window.confirm('این کد تخفیف غیرفعال شود؟')) return
  await apiFetch(`/salons/mine/coupons/${coupon.id}`, { method: 'DELETE' })
  coupon.isActive = false
}
</script>

<template>
  <div class="space-y-4 p-4">
    <h1 class="text-lg font-bold text-(--color-text)">کدهای تخفیف</h1>

    <AppCard class="space-y-3">
      <h2 class="font-bold text-(--color-text)">افزودن کد تخفیف جدید</h2>
      <div>
        <input
          v-model="newCoupon.code"
          placeholder="کد تخفیف (مثلاً SUMMER20)"
          class="uppercase w-full rounded-xl border border-(--color-border) bg-(--color-surface) p-3 text-sm"
        />
        <p class="mt-1 text-xs text-(--color-muted)">کد به‌صورت خودکار با حروف بزرگ ذخیره می‌شود.</p>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <input
          v-model.number="newCoupon.discountPercent"
          type="number"
          min="1"
          max="100"
          placeholder="٪ تخفیف"
          class="tnum w-full rounded-xl border border-(--color-border) bg-(--color-surface) p-3 text-sm"
        />
        <input
          v-model.number="newCoupon.maxRedemptions"
          type="number"
          min="1"
          placeholder="سقف استفاده (اختیاری)"
          class="tnum w-full rounded-xl border border-(--color-border) bg-(--color-surface) p-3 text-sm"
        />
      </div>
      <div>
        <label class="mb-1.5 block text-sm font-semibold text-(--color-text)">تاریخ انقضا (اختیاری)</label>
        <input
          v-model="newCoupon.expiresAt"
          type="date"
          class="tnum w-full rounded-xl border border-(--color-border) bg-(--color-surface) p-3 text-sm"
        />
      </div>
      <p v-if="createError" class="flex items-center gap-2 rounded-xl bg-(--tone-danger-bg) p-3 text-sm text-(--tone-danger-text)">
        {{ createError }}
      </p>
      <button
        type="button"
        class="w-full rounded-xl bg-(--color-accent) p-3 text-sm font-bold text-white transition-opacity hover:opacity-90"
        @click="createCoupon"
      >
        افزودن
      </button>
    </AppCard>

    <EmptyState v-if="!loading && coupons.length === 0" icon="coupons" message="هنوز کد تخفیفی ثبت نشده است." />

    <AppCard v-for="c in coupons" :key="c.id" :padded="false" class="space-y-2 p-4">
      <div class="flex items-center justify-between">
        <p class="tnum text-sm font-bold text-(--color-text)">{{ c.code }}</p>
        <StatusBadge :label="c.isActive ? 'فعال' : 'غیرفعال'" :tone="c.isActive ? 'success' : 'neutral'" />
      </div>
      <div class="flex items-center justify-between text-sm text-(--color-muted)">
        <span class="tnum">{{ discountLabel(c) }}</span>
        <span class="tnum">{{ expiryLabel(c) }}</span>
      </div>
      <div class="flex items-center justify-between">
        <span class="tnum text-sm text-(--color-muted)">استفاده: {{ usageLabel(c) }}</span>
        <button
          v-if="c.isActive"
          type="button"
          class="flex items-center gap-1.5 text-sm font-semibold text-(--tone-danger-text)"
          @click="deactivate(c)"
        >
          <AppIcon name="x" :size="15" />
          غیرفعال‌سازی
        </button>
      </div>
    </AppCard>
  </div>
</template>
