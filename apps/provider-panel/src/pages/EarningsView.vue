<!-- apps/provider-panel/src/pages/EarningsView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
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
    <h1 class="text-lg font-bold">درآمد</h1>
    <div v-if="earnings" class="space-y-3">
      <div class="rounded-lg border p-4">
        <p class="text-sm text-gray-500">مجموع دریافتی</p>
        <p class="text-xl font-bold">{{ toman(earnings.totalCollected) }}</p>
      </div>
      <div class="rounded-lg border p-4">
        <p class="text-sm text-gray-500">کارمزد پلتفرم ({{ earnings.commissionPercent }}٪)</p>
        <p class="text-xl font-bold">{{ toman(earnings.commissionAmount) }}</p>
      </div>
      <div class="rounded-lg border p-4">
        <p class="text-sm text-gray-500">مبلغ قابل پرداخت</p>
        <p class="text-xl font-bold">{{ toman(earnings.netPayout) }}</p>
      </div>
    </div>
  </div>
</template>
