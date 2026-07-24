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
        <AppInput v-model="newCoupon.code" placeholder="کد تخفیف (مثلاً SUMMER20)" class="uppercase" />
        <p class="mt-1 text-xs text-(--color-text-muted)">کد به‌صورت خودکار با حروف بزرگ ذخیره می‌شود.</p>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <AppInput
          v-model="discountPercentInput"
          type="number"
          inputmode="numeric"
          min="1"
          max="100"
          placeholder="٪ تخفیف"
          class="tnum"
        />
        <AppInput
          v-model="maxRedemptionsInput"
          type="number"
          inputmode="numeric"
          min="1"
          placeholder="سقف استفاده (اختیاری)"
          class="tnum"
        />
      </div>
      <div>
        <label class="mb-1.5 block text-sm font-semibold text-(--color-text)">تاریخ انقضا (اختیاری)</label>
        <AppInput v-model="newCoupon.expiresAt" type="date" class="tnum" />
      </div>
      <p v-if="createError" class="flex items-center gap-2 rounded-xl bg-(--tone-danger-bg) p-3 text-sm text-(--tone-danger-text)">
        {{ createError }}
      </p>
      <AppButton type="button" variant="primary" block @click="createCoupon">افزودن</AppButton>
    </AppCard>

    <EmptyState v-if="!loading && coupons.length === 0" icon="coupons" message="هنوز کد تخفیفی ثبت نشده است." />

    <AppCard v-for="c in coupons" :key="c.id" :padded="false" class="space-y-2 p-4">
      <div class="flex items-center justify-between">
        <p class="tnum text-sm font-bold text-(--color-text)">{{ c.code }}</p>
        <StatusBadge :label="c.isActive ? 'فعال' : 'غیرفعال'" :tone="c.isActive ? 'success' : 'neutral'" />
      </div>
      <div class="flex items-center justify-between text-sm text-(--color-text-muted)">
        <span class="tnum">{{ discountLabel(c) }}</span>
        <span class="tnum">{{ expiryLabel(c) }}</span>
      </div>
      <div class="flex items-center justify-between">
        <span class="tnum text-sm text-(--color-text-muted)">استفاده: {{ usageLabel(c) }}</span>
        <AppButton v-if="c.isActive" type="button" variant="danger" @click="deactivate(c)">
          <template #icon><AppIcon name="x" :size="15" /></template>
          غیرفعال‌سازی
        </AppButton>
      </div>
    </AppCard>
  </div>
</template>
