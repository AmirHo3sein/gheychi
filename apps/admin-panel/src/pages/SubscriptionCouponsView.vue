<!-- apps/admin-panel/src/pages/SubscriptionCouponsView.vue -->
<!-- Phase 7 of the monetization initiative -- see
     docs/technical-overview/34-subscription-coupons-and-billing.md. A genuinely separate
     concept from the booking-side /coupons screen: these are redeemed by a SALON (once per
     coupon, admin-only) when an admin creates a billing period, not by a customer at
     checkout. Deliberately simpler than CouponsView.vue -- no edit, no fixed-amount kind,
     since there's no equivalent "provider issues their own subscription coupon" concept. -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'

interface SubscriptionCoupon {
  id: string
  code: string
  discountPercent: number
  expiresAt: string | null
  maxRedemptions: number | null
  isActive: boolean
}

const { apiFetch } = useApi()
const { push: pushToast } = useToast()
const coupons = ref<SubscriptionCoupon[]>([])
const loading = ref(true)
const loadError = ref(false)

async function load() {
  loading.value = true
  loadError.value = false
  const { data, error } = await apiFetch<SubscriptionCoupon[]>('/admin/subscription-coupons', { silent: true })
  if (error || !data) {
    loadError.value = true
    coupons.value = []
  } else {
    coupons.value = data
  }
  loading.value = false
}
onMounted(load)

function formatDate(iso: string | null): string {
  if (!iso) return 'بدون انقضا'
  return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso))
}

const newCode = ref('')
const newDiscountPercent = ref<number | null>(null)
const newExpiresAt = ref('')
const newMaxRedemptions = ref<number | null>(null)
const submitting = ref(false)

function onCodeInput(value: string) {
  newCode.value = value.toUpperCase()
}

async function create() {
  if (!newCode.value.trim() || !newDiscountPercent.value) return
  submitting.value = true
  const { data } = await apiFetch<SubscriptionCoupon>('/admin/subscription-coupons', {
    method: 'POST',
    body: {
      code: newCode.value.trim(),
      discountPercent: newDiscountPercent.value,
      expiresAt: newExpiresAt.value ? new Date(`${newExpiresAt.value}T23:59:59.999`).toISOString() : undefined,
      maxRedemptions: newMaxRedemptions.value === null ? undefined : newMaxRedemptions.value,
    },
  })
  submitting.value = false
  if (data) {
    coupons.value.unshift(data)
    newCode.value = ''
    newDiscountPercent.value = null
    newExpiresAt.value = ''
    newMaxRedemptions.value = null
    pushToast('کد تخفیف اشتراک ایجاد شد')
  }
}

const confirmingDeactivateId = ref<string | null>(null)
async function deactivate(coupon: SubscriptionCoupon) {
  submitting.value = true
  const { error } = await apiFetch(`/admin/subscription-coupons/${coupon.id}`, { method: 'DELETE' })
  submitting.value = false
  confirmingDeactivateId.value = null
  if (!error) coupon.isActive = false
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-5 p-4 sm:p-8">
    <div>
      <h1 class="text-lg font-bold text-(--color-text)">کدهای تخفیف اشتراک</h1>
      <p class="mt-1 text-sm text-(--color-text-muted)">
        این کدها روی هزینه اشتراک سالن اعمال می‌شوند، هنگام ثبت یک دوره صورتحساب برای آن سالن -- نه روی نوبت‌های مشتریان.
      </p>
    </div>

    <AppCard>
      <p class="mb-3 flex items-center gap-2 text-sm font-semibold text-(--color-text)">
        <AppIcon name="plus" :size="16" class="text-(--color-accent-text)" />
        افزودن کد تخفیف اشتراک جدید
      </p>
      <form class="flex flex-wrap items-end gap-2.5" @submit.prevent="create">
        <AppInput
          :model-value="newCode"
          label="کد"
          placeholder="مثلا PLUS20"
          :maxlength="30"
          class="w-36"
          data-testid="new-code-input"
          @update:model-value="onCodeInput"
        />
        <AppInput
          :model-value="newDiscountPercent === null ? '' : String(newDiscountPercent)"
          label="درصد تخفیف"
          type="number"
          min="1"
          max="100"
          placeholder="۱ تا ۱۰۰"
          class="tnum w-24"
          data-testid="new-discount-input"
          @update:model-value="(v) => (newDiscountPercent = v === '' ? null : Number(v))"
        />
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">تاریخ انقضا (اختیاری)</label>
          <JalaliDatePicker v-model="newExpiresAt" placeholder="بدون انقضا" class="w-40" />
        </div>
        <AppInput
          :model-value="newMaxRedemptions === null ? '' : String(newMaxRedemptions)"
          label="سقف تعداد استفاده (اختیاری)"
          type="number"
          min="1"
          placeholder="نامحدود"
          class="tnum w-32"
          data-testid="new-max-redemptions-input"
          @update:model-value="(v) => (newMaxRedemptions = v === '' ? null : Number(v))"
        />
        <AppButton type="submit" variant="primary" data-testid="submit-new-coupon" :disabled="submitting || !newCode.trim() || !newDiscountPercent">
          <template #icon><AppIcon name="plus" :size="16" /></template>
          افزودن
        </AppButton>
      </form>
    </AppCard>

    <div v-if="loading" data-testid="coupons-loading" class="flex items-center justify-center gap-2 py-16 text-sm text-(--color-text-muted)">
      <AppIcon name="spinner" :size="20" class="animate-spin" />
      در حال بارگذاری…
    </div>

    <AppCard
      v-else-if="loadError"
      :padded="false"
      data-testid="coupons-load-error"
      class="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center"
    >
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-(--tone-danger-bg) text-(--tone-danger-text)">
        <AppIcon name="warning" :size="22" />
      </div>
      <p class="text-sm text-(--color-text-muted)">بارگذاری کدهای تخفیف با خطا مواجه شد.</p>
      <AppButton type="button" variant="secondary" data-testid="coupons-retry" @click="load">تلاش مجدد</AppButton>
    </AppCard>

    <EmptyState v-else-if="coupons.length === 0" icon="coupon" message="هنوز کد تخفیف اشتراکی ثبت نشده است." />

    <div v-else class="space-y-2.5">
      <AppCard v-for="coupon in coupons" :key="coupon.id" data-testid="subscription-coupon-card" :padded="false" class="p-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div class="flex items-center gap-2">
              <span class="font-mono text-sm font-bold text-(--color-text)">{{ coupon.code }}</span>
              <StatusBadge :label="coupon.isActive ? 'فعال' : 'غیرفعال'" :tone="coupon.isActive ? 'success' : 'neutral'" />
            </div>
            <p class="tnum mt-1 text-xs text-(--color-text-muted)">
              {{ coupon.discountPercent.toLocaleString('fa-IR') }}٪ تخفیف
              · انقضا: {{ formatDate(coupon.expiresAt) }}
              · سقف استفاده: {{ coupon.maxRedemptions === null ? 'نامحدود' : coupon.maxRedemptions.toLocaleString('fa-IR') }}
            </p>
          </div>

          <div v-if="coupon.isActive" class="shrink-0">
            <template v-if="confirmingDeactivateId === coupon.id">
              <span class="ml-2 text-xs font-semibold text-(--tone-danger-text)">غیرفعال شود؟</span>
              <AppButton type="button" variant="danger" :disabled="submitting" :data-testid="`confirm-deactivate-${coupon.code}`" @click="deactivate(coupon)">
                تأیید
              </AppButton>
              <AppButton type="button" variant="ghost" :disabled="submitting" @click="confirmingDeactivateId = null">انصراف</AppButton>
            </template>
            <AppButton v-else type="button" variant="ghost" class="text-(--tone-danger-text)!" :data-testid="`deactivate-${coupon.code}`" @click="confirmingDeactivateId = coupon.id">
              غیرفعال‌سازی
            </AppButton>
          </div>
        </div>
      </AppCard>
    </div>
  </div>
</template>
