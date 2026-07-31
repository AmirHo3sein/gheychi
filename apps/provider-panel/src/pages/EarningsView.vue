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
  <!-- The one screen PRODUCT.md names for a desktop review session: the three figures go
       side by side from sm (a 430px phone in landscape already has room), and the container
       stops them stretching to an unreadable 1888px on a 1920px monitor. -->
  <div class="mx-auto w-full max-w-5xl space-y-4 p-4 lg:p-6">
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

    <div v-else class="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
      <!-- The headline figure spans both columns at sm/md (where three across would squeeze
           a long toman number into two wrapped lines) and joins the row at lg. -->
      <AppCard class="bg-(--color-surface-subtle) sm:col-span-2 lg:col-span-1">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-(--color-surface-card) text-(--color-text-muted)">
            <AppIcon name="earnings" :size="18" />
          </div>
          <!-- min-w-0 + break-words: a large toman figure is a long unbreakable digit run,
               and it must wrap inside the card rather than widen it. -->
          <div class="min-w-0">
            <p class="text-xs text-(--color-text-muted)">مجموع دریافتی</p>
            <p class="tnum break-words text-xl font-bold text-(--color-text)">{{ toman(earnings.totalCollected) }}</p>
          </div>
        </div>
      </AppCard>

      <AppCard>
        <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 sm:flex-col sm:items-start">
          <p class="text-sm text-(--color-text-muted)">کارمزد پلتفرم ({{ earnings.commissionPercent }}٪)</p>
          <p class="tnum break-words text-lg font-bold text-(--color-text-muted)">−{{ toman(earnings.commissionAmount) }}</p>
        </div>
      </AppCard>

      <AppCard>
        <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 sm:flex-col sm:items-start">
          <p class="text-sm font-semibold text-(--color-text)">مبلغ قابل پرداخت</p>
          <p class="tnum break-words text-xl font-bold text-(--tone-success-text)">{{ toman(earnings.netPayout) }}</p>
        </div>
      </AppCard>
    </div>
  </div>
</template>
