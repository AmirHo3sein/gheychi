<!-- apps/provider-panel/src/pages/EarningsView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useApi } from '@/composables/useApi'

interface Earnings {
  totalCollected: number
  commissionPercent: number
  commissionAmount: number
  netPayout: number
}

const { apiFetch } = useApi()
const earnings = ref<Earnings | null>(null)

onMounted(async () => {
  const { data } = await apiFetch<Earnings>('/salons/mine/earnings', { silent: true })
  earnings.value = data
})

function toman(amount: number): string {
  return `${amount.toLocaleString('fa-IR')} تومان`
}
</script>

<template>
  <div class="space-y-4 p-4">
    <h1 class="text-lg font-bold text-(--color-text)">درآمد</h1>

    <div v-if="earnings" class="space-y-3">
      <AppCard class="bg-(--color-accent) text-white">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20">
            <AppIcon name="earnings" :size="18" />
          </div>
          <div>
            <p class="text-xs opacity-90">مجموع دریافتی</p>
            <p class="tnum text-xl font-bold">{{ toman(earnings.totalCollected) }}</p>
          </div>
        </div>
      </AppCard>

      <AppCard>
        <div class="flex items-center justify-between">
          <p class="text-sm text-(--color-text-muted)">کارمزد پلتفرم ({{ earnings.commissionPercent }}٪)</p>
          <p class="tnum text-lg font-bold text-(--tone-danger-text)">−{{ toman(earnings.commissionAmount) }}</p>
        </div>
      </AppCard>

      <AppCard class="border-(--color-accent)">
        <div class="flex items-center justify-between">
          <p class="text-sm font-semibold text-(--color-text)">مبلغ قابل پرداخت</p>
          <p class="tnum text-xl font-bold text-(--tone-success-text)">{{ toman(earnings.netPayout) }}</p>
        </div>
      </AppCard>
    </div>
  </div>
</template>
