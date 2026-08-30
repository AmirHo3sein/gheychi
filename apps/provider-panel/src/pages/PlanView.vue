<!-- apps/provider-panel/src/pages/PlanView.vue -->
<!-- Read-only: the owner sees their current plan and what it includes, but has no control
     here to change plan, cancel, or set any override -- all of that is admin-only
     (docs/technical-overview/30-subscription-plan-foundation.md), matching the "salon owner
     picks only booking mode, nothing commercial" decision. -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useApi } from '@/composables/useApi'
import { formatToman } from '@/utils/format-toman'

interface Plan { id: string; key: string; name: string; description: string | null; monthlyPriceToman: number }
interface Subscription { status: 'active' | 'canceled' }
interface SubscriptionResponse { subscription: Subscription; plan: Plan; resolvedEntitlements: Record<string, unknown> }

const { apiFetch } = useApi()
const data = ref<SubscriptionResponse | null>(null)
const loading = ref(true)
const loadError = ref(false)

async function load() {
  loading.value = true
  loadError.value = false
  const { data: result, error } = await apiFetch<SubscriptionResponse>('/salons/mine/subscription', { silent: true })
  if (error || !result) {
    loadError.value = true
    loading.value = false
    return
  }
  data.value = result
  loading.value = false
}
onMounted(load)

const entitlementEntries = () => Object.entries(data.value?.resolvedEntitlements ?? {})
</script>

<template>
  <div class="mx-auto w-full max-w-2xl space-y-4 p-4 lg:p-6">
    <h1 class="text-lg font-bold text-(--color-text)">پلن من</h1>

    <div v-if="loading" class="flex items-center justify-center py-14 text-(--color-text-muted)">
      <AppIcon name="spinner" :size="20" class="animate-spin" />
    </div>

    <div v-else-if="loadError" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">اطلاعات پلن بارگذاری نشد.</p>
      <AppButton variant="secondary" data-testid="retry-plan" @click="load">تلاش دوباره</AppButton>
    </div>

    <template v-else-if="data">
      <AppCard class="bg-(--color-surface-subtle)">
        <div class="flex items-center gap-3">
          <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-(--color-surface-card) text-(--color-text-muted)">
            <AppIcon name="plan" :size="20" />
          </div>
          <div class="min-w-0">
            <p class="text-xs text-(--color-text-muted)">پلن فعلی</p>
            <p class="break-words text-xl font-bold text-(--color-text)">{{ data.plan.name }}</p>
          </div>
        </div>
        <p v-if="data.plan.description" class="mt-3 text-sm leading-6 text-(--color-text)">{{ data.plan.description }}</p>
        <p class="mt-3 text-sm font-semibold text-(--color-text)">
          <span v-if="data.plan.monthlyPriceToman === 0">رایگان</span>
          <span v-else><span dir="ltr" class="tnum">{{ formatToman(data.plan.monthlyPriceToman) }}</span> تومان در ماه</span>
        </p>
        <p v-if="data.subscription.status === 'canceled'" data-testid="canceled-note" class="mt-3 text-xs text-(--tone-warning-text)">
          اشتراک قبلی این سالن توسط پلتفرم لغو شده و به‌طور موقت روی پلن پیش‌فرض قرار دارد. برای تغییر با پشتیبانی تماس بگیرید.
        </p>
      </AppCard>

      <div>
        <h2 class="mb-2 text-base font-bold text-(--color-text)">امکانات این پلن</h2>
        <AppCard v-if="entitlementEntries().length === 0" :padded="false" class="p-4">
          <p class="text-sm text-(--color-text-muted)">این پلن هنوز محدودیت یا امکان خاصی تعریف‌شده ندارد.</p>
        </AppCard>
        <AppCard v-else :padded="false" class="divide-y divide-(--color-border-soft)">
          <div v-for="[key, value] in entitlementEntries()" :key="key" class="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span class="text-(--color-text-muted)">{{ key }}</span>
            <span dir="ltr" class="tnum font-semibold text-(--color-text)">{{ JSON.stringify(value) }}</span>
          </div>
        </AppCard>
      </div>
    </template>
  </div>
</template>
