<!-- apps/provider-panel/src/pages/EarningsView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useApi } from '@/composables/useApi'

interface Earnings {
  totalCollected: number
  commissionPercent: number
  commissionAmount: number
  netPayout: number
}

const { apiFetch } = useApi()
const earnings = ref<Earnings | null>(null)
const loading = ref(true)
const loadError = ref(false)

async function load() {
  loading.value = true
  loadError.value = false

  const { data, error } = await apiFetch<Earnings>('/salons/mine/earnings', { silent: true })
  if (error) {
    loadError.value = true
    loading.value = false
    return
  }

  earnings.value = data
  loading.value = false
}

onMounted(load)

function toman(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return '—'
  return `${amount.toLocaleString('fa-IR')} تومان`
}
</script>

<template>
  <div class="space-y-4 p-4">
    <h1 class="text-lg font-bold text-(--color-text)">درآمد</h1>

    <div v-if="loading" class="flex items-center justify-center py-14 text-(--color-text-muted)">
      <AppIcon name="spinner" :size="20" class="animate-spin" />
    </div>

    <div v-else-if="loadError" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">اطلاعات درآمد بارگذاری نشد.</p>
      <AppButton variant="secondary" data-testid="retry-earnings" @click="load">
        تلاش دوباره
      </AppButton>
    </div>

    <EmptyState v-else-if="!earnings" icon="earnings" message="اطلاعات درآمدی برای نمایش وجود ندارد." />

    <div v-else class="space-y-3 md:grid md:grid-cols-3 md:gap-4 md:space-y-0">
      <AppCard class="bg-(--color-surface-subtle)">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-(--color-surface-card) text-(--color-text-muted)">
            <AppIcon name="earnings" :size="18" />
          </div>
          <div>
            <p class="text-xs text-(--color-text-muted)">مجموع دریافتی</p>
            <p class="tnum text-xl font-bold text-(--color-text)">{{ toman(earnings.totalCollected) }}</p>
          </div>
        </div>
      </AppCard>

      <AppCard>
        <div class="flex items-center justify-between md:flex-col md:items-start md:gap-1">
          <p class="text-sm text-(--color-text-muted)">کارمزد پلتفرم ({{ earnings.commissionPercent }}٪)</p>
          <p class="tnum text-lg font-bold text-(--color-text-muted)">−{{ toman(earnings.commissionAmount) }}</p>
        </div>
      </AppCard>

      <AppCard>
        <div class="flex items-center justify-between md:flex-col md:items-start md:gap-1">
          <p class="text-sm font-semibold text-(--color-text)">مبلغ قابل پرداخت</p>
          <p class="tnum text-xl font-bold text-(--tone-success-text)">{{ toman(earnings.netPayout) }}</p>
        </div>
      </AppCard>
    </div>
  </div>
</template>
