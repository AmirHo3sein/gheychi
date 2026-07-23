<script setup lang="ts">
interface WalletBalance {
  currency: string
  balance: number
}

interface WalletTransactionItem {
  id: string
  currency: string
  amount: number
  balanceAfter: number
  type: 'referral_reward' | 'referral_reversal' | 'admin_adjustment'
  reason: string | null
  createdAt: string
}

interface WalletTransactionsResponse {
  items: WalletTransactionItem[]
  total: number
  page: number
  pageSize: number
}

const route = useRoute()
const router = useRouter()
const { apiFetch } = useApi()

const PAGE_SIZE = 20

const CURRENCY_LABELS: Record<string, string> = {
  toman: 'تومان',
  points: 'امتیاز',
}

const TYPE_LABELS: Record<WalletTransactionItem['type'], string> = {
  admin_adjustment: 'اصلاح توسط پشتیبانی',
  referral_reward: 'پاداش معرفی',
  referral_reversal: 'برگشت پاداش معرفی',
}

const page = computed(() => {
  const n = Number(route.query.page)
  return Number.isInteger(n) && n > 0 ? n : 1
})

// wallet_balances rows are only ever created the first time a currency is actually
// credited/debited (see apps/api WalletService.lockOrCreateBalance's upsert-then-lock) --
// GET /wallet/mine never returns a placeholder row for a currency the caller has never
// touched. So there's no separate "zero balance and zero history" row to filter out on
// this side: every row this endpoint returns already has at least one transaction
// behind it, which is exactly the "skip the confusing empty balance" behavior asked for.
const { data: balances } = await useAsyncData('wallet-balances', async () => {
  const { data } = await apiFetch<{ balances: WalletBalance[] }>('/wallet/mine', { silent: true })
  return data?.balances ?? []
})

// Filter/page state lives in the route query (same idiom as blog/index.vue) so a page
// turn is one router.push and useAsyncData refetches exactly once.
const { data: transactions } = await useAsyncData(
  'wallet-transactions',
  async () => {
    const { data } = await apiFetch<WalletTransactionsResponse>('/wallet/mine/transactions', {
      query: { page: page.value, pageSize: PAGE_SIZE },
      silent: true,
    })
    return data
  },
  { watch: [page] },
)

const totalPages = computed(() =>
  transactions.value ? Math.max(1, Math.ceil(transactions.value.total / transactions.value.pageSize)) : 1,
)

function goToPage(target: number) {
  if (target < 1 || target > totalPages.value || target === page.value) return
  router.push({ query: target > 1 ? { page: target } : {} })
}

function currencyLabel(currency: string): string {
  return CURRENCY_LABELS[currency] ?? currency
}

function typeLabel(type: WalletTransactionItem['type']): string {
  return TYPE_LABELS[type] ?? type
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fa-IR')
}

function formatAmount(amount: number): string {
  return `${amount > 0 ? '+' : ''}${amount.toLocaleString('fa-IR')}`
}

useSeoMeta({ title: 'کیف پول — آرایشگاه' })
</script>

<template>
  <div class="p-4 space-y-6">
    <div class="flex items-center gap-2">
      <NuxtLink
        to="/profile"
        aria-label="بازگشت"
        class="flex h-8 w-8 items-center justify-center rounded-lg text-(--color-text-muted) transition-colors hover:bg-(--color-surface-subtle)"
      >
        <BaseIcon name="chevron-forward" :size="20" />
      </NuxtLink>
      <h1 class="text-lg font-bold">کیف پول</h1>
    </div>

    <section v-if="balances?.length" data-testid="wallet-balances" class="grid gap-3 sm:grid-cols-2">
      <BaseCard v-for="b in balances" :key="b.currency" data-testid="wallet-balance">
        <p class="text-sm text-(--color-text-muted)">موجودی {{ currencyLabel(b.currency) }}</p>
        <p class="mt-1 text-2xl font-bold">
          {{ b.balance.toLocaleString('fa-IR') }}
          <span class="text-sm font-normal text-(--color-text-muted)">{{ currencyLabel(b.currency) }}</span>
        </p>
      </BaseCard>
    </section>

    <section class="space-y-3">
      <h2 class="font-bold">تاریخچه تراکنش‌ها</h2>

      <p
        v-if="!transactions?.items?.length"
        data-testid="empty-state"
        class="py-6 text-center text-sm text-(--color-text-muted)"
      >
        هنوز تراکنشی در کیف پول شما ثبت نشده است
      </p>

      <div v-else class="space-y-2">
        <BaseCard v-for="tx in transactions.items" :key="tx.id" data-testid="wallet-transaction">
          <div class="flex items-center justify-between gap-2">
            <div class="space-y-0.5 text-sm">
              <p class="font-medium">{{ typeLabel(tx.type) }}</p>
              <p class="text-xs text-(--color-text-muted)">{{ formatDate(tx.createdAt) }}</p>
              <p v-if="tx.reason" class="text-xs text-(--color-text-muted)">{{ tx.reason }}</p>
            </div>
            <p
              data-testid="wallet-transaction-amount"
              class="whitespace-nowrap text-sm font-bold"
              :class="tx.amount > 0 ? 'text-(--color-success)' : 'text-(--color-danger)'"
            >
              {{ formatAmount(tx.amount) }} {{ currencyLabel(tx.currency) }}
            </p>
          </div>
        </BaseCard>
      </div>

      <nav v-if="totalPages > 1" class="flex items-center justify-center gap-3 pt-2 text-sm" aria-label="صفحه‌بندی">
        <button
          type="button"
          data-testid="prev-page"
          class="rounded-full bg-(--color-surface-card) px-3 py-1 disabled:opacity-40"
          :disabled="page <= 1"
          @click="goToPage(page - 1)"
        >
          قبلی
        </button>
        <span class="text-xs">صفحه {{ page.toLocaleString('fa-IR') }} از {{ totalPages.toLocaleString('fa-IR') }}</span>
        <button
          type="button"
          data-testid="next-page"
          class="rounded-full bg-(--color-surface-card) px-3 py-1 disabled:opacity-40"
          :disabled="page >= totalPages"
          @click="goToPage(page + 1)"
        >
          بعدی
        </button>
      </nav>
    </section>
  </div>
</template>
