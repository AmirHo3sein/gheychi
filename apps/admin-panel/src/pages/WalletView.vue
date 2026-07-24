<!-- apps/admin-panel/src/pages/WalletView.vue -->
<!-- Wallet Ledger admin screen (design spec §8: "Wallet Ledger (/wallet) -- search by
     user (phone), paginated transaction list, plus an Adjust Balance action"). Filter/
     paginate UX mirrors AuditLogView.vue and UsersView.vue exactly (debounced free-text
     search, AppSelect dropdown, JalaliDatePicker range, Pagination, clear-filters button).

     Slice 2 note: nothing in this slice produces referral_reward/referral_reversal rows
     yet (referrals don't exist until slices 3-5) -- the type filter still lists all three
     CHECK-constraint values today so the UI doesn't need to change again once they start
     appearing.

     User targeting matches UsersView.vue's own identifier field: phone (free-text, ILIKE
     via GET /admin/users?phone=), resolved locally to a userId before it's sent as the
     `userId` filter GET /admin/wallet/transactions actually accepts. Leaving no user
     selected browses the global ledger across every user (userId is an optional filter
     server-side), same as AuditLogView's optional actorId. -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import AdjustBalanceCard from '@/components/wallet/AdjustBalanceCard.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'
import Pagination from '@/components/ui/Pagination.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { debounce } from '@/utils/debounce'
import { currencyLabel, walletTransactionTypeLabel } from '@/utils/labels'

const TYPE_OPTIONS = [
  { value: '', label: 'همه انواع' },
  { value: 'admin_adjustment', label: 'تعدیل دستی' },
  { value: 'referral_reward', label: 'پاداش معرفی' },
  { value: 'referral_reversal', label: 'برگشت پاداش معرفی' },
]

type WalletTransactionType = 'referral_reward' | 'referral_reversal' | 'admin_adjustment'

interface MatchedUser {
  id: string
  phone: string
  name: string | null
}

interface WalletTransactionRow {
  id: string
  userId: string
  userPhone: string
  userName: string | null
  currency: 'toman' | 'points'
  amount: number
  balanceAfter: number
  type: WalletTransactionType
  reason: string | null
  createdAt: string
}

interface WalletTransactionListResponse {
  items: WalletTransactionRow[]
  total: number
  page: number
  pageSize: number
}

const { apiFetch } = useApi()
const transactions = ref<WalletTransactionRow[]>([])
const loading = ref(true)
const page = ref(1)
const total = ref(0)
const pageSize = 20

const phoneQuery = ref('')
const matches = ref<MatchedUser[]>([])
const selectedUser = ref<MatchedUser | null>(null)
const typeFilter = ref<'' | WalletTransactionType>('')
const fromDate = ref('')
const toDate = ref('')

// Guards against a slower earlier user-search response landing after a faster later one.
let searchToken = 0

async function searchUsers() {
  const query = phoneQuery.value.trim()
  if (selectedUser.value) return
  matches.value = []
  if (!query) return
  const token = ++searchToken
  const { data } = await apiFetch<MatchedUser[]>(`/admin/users?phone=${encodeURIComponent(query)}`, { silent: true })
  if (token === searchToken) matches.value = data ?? []
}

function selectUser(user: MatchedUser) {
  selectedUser.value = user
  matches.value = []
  phoneQuery.value = user.phone
}

function clearUserFilter() {
  selectedUser.value = null
  phoneQuery.value = ''
  matches.value = []
}

async function load() {
  loading.value = true
  const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) })
  if (selectedUser.value) params.set('userId', selectedUser.value.id)
  if (typeFilter.value) params.set('type', typeFilter.value)
  // Both bounds anchored in LOCAL time -- see UsersView.vue/AuditLogView.vue for why
  // `new Date('YYYY-MM-DD')` alone (parsed as UTC midnight) would silently drop early
  // local-time rows on the from-day (UTC+3:30).
  if (fromDate.value) params.set('from', new Date(`${fromDate.value}T00:00:00.000`).toISOString())
  if (toDate.value) params.set('to', new Date(`${toDate.value}T23:59:59.999`).toISOString())

  const { data } = await apiFetch<WalletTransactionListResponse>(`/admin/wallet/transactions?${params.toString()}`, {
    silent: true,
  })
  transactions.value = data?.items ?? []
  total.value = data?.total ?? 0
  loading.value = false
}

function loadFromFilterChange() {
  if (page.value !== 1) {
    page.value = 1
  } else {
    load()
  }
}

function onAdjusted(result: { userId: string; balanceAfter: number }) {
  // If the ledger currently narrows to the exact user who was just adjusted, refresh so
  // the new row is visible immediately instead of looking stale until the next filter change.
  if (selectedUser.value?.id === result.userId) load()
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

function formatAmount(amount: number): string {
  return `${amount > 0 ? '+' : ''}${amount.toLocaleString('fa-IR')}`
}

function clearFilters() {
  clearUserFilter()
  typeFilter.value = ''
  fromDate.value = ''
  toDate.value = ''
}

const hasActiveFilters = computed(
  () => !!selectedUser.value || !!typeFilter.value || !!fromDate.value || !!toDate.value,
)

onMounted(load)
watch(phoneQuery, debounce(searchUsers, 350))
watch(selectedUser, loadFromFilterChange)
watch([typeFilter, fromDate, toDate], loadFromFilterChange)
watch(page, load)
</script>

<template>
  <div class="space-y-5 p-8">
    <AdjustBalanceCard @adjusted="onAdjusted" />

    <AppCard :padded="false" class="p-4">
      <div class="flex flex-wrap items-end gap-3">
        <div class="relative">
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">شماره موبایل کاربر</label>
          <div v-if="!selectedUser" class="relative">
            <AppIcon name="phone" :size="15" class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-(--color-text-muted)" />
            <input
              v-model="phoneQuery"
              data-testid="wallet-phone-filter"
              placeholder="جست‌وجو…"
              class="w-44 rounded-xl border border-(--color-border) py-2 ps-9 pe-3 text-sm"
            />
          </div>
          <div
            v-else
            data-testid="wallet-selected-user"
            class="flex w-44 items-center justify-between gap-2 rounded-xl border border-(--color-border) bg-(--color-border-soft) px-3 py-2 text-sm"
          >
            <span class="min-w-0 truncate">
              <span class="font-semibold text-(--color-text)">{{ selectedUser.name ?? selectedUser.phone }}</span>
            </span>
            <button
              type="button"
              data-testid="wallet-clear-user"
              class="shrink-0 text-(--color-text-muted) hover:text-(--tone-danger-text)"
              title="پاک کردن کاربر"
              @click="clearUserFilter"
            >
              <AppIcon name="x" :size="14" />
            </button>
          </div>

          <div
            v-if="matches.length > 0"
            data-testid="wallet-user-matches"
            class="absolute right-0 top-full z-10 mt-1 w-64 overflow-hidden rounded-xl border border-(--color-border) bg-(--color-surface-card) shadow-(--shadow-md)"
          >
            <button
              v-for="user in matches"
              :key="user.id"
              type="button"
              class="block w-full px-3 py-2 text-right text-sm transition-colors hover:bg-(--color-border-soft)"
              @click="selectUser(user)"
            >
              <span class="font-semibold text-(--color-text)">{{ user.name ?? 'بدون نام' }}</span>
              <span class="tnum mr-1 text-xs text-(--color-text-muted)">{{ user.phone }}</span>
            </button>
          </div>
        </div>

        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">نوع تراکنش</label>
          <AppSelect v-model="typeFilter" :options="TYPE_OPTIONS" width="12rem" />
        </div>

        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">بازه زمانی</label>
          <div class="flex items-center gap-1.5">
            <JalaliDatePicker v-model="fromDate" placeholder="از تاریخ" class="w-32" />
            <span class="text-(--color-text-muted)">تا</span>
            <JalaliDatePicker v-model="toDate" placeholder="تا تاریخ" class="w-32" />
          </div>
        </div>

        <button
          v-if="hasActiveFilters"
          type="button"
          class="mb-2 flex items-center gap-1.5 text-sm font-semibold text-(--color-text-muted) transition-colors hover:text-(--tone-danger-text)"
          @click="clearFilters"
        >
          <AppIcon name="reset" :size="15" />
          پاک کردن فیلترها
        </button>
      </div>
    </AppCard>

    <EmptyState v-if="!loading && transactions.length === 0" icon="wallet" message="تراکنشی با این فیلترها یافت نشد." />

    <AppCard v-else :padded="false" class="overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-right text-sm">
          <thead>
            <tr class="border-b border-(--color-border) bg-(--color-border-soft) text-xs text-(--color-text-muted)">
              <th class="px-5 py-3 font-semibold">تاریخ</th>
              <th class="px-5 py-3 font-semibold">کاربر</th>
              <th class="px-5 py-3 font-semibold">واحد</th>
              <th class="px-5 py-3 font-semibold">مبلغ</th>
              <th class="px-5 py-3 font-semibold">نوع</th>
              <th class="px-5 py-3 font-semibold">دلیل</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="tx in transactions"
              :key="tx.id"
              class="border-b border-(--color-border-soft) transition-colors last:border-0 hover:bg-(--color-border-soft)"
            >
              <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ formatDateTime(tx.createdAt) }}</td>
              <td class="px-5 py-3.5">
                <p class="font-semibold text-(--color-text)">{{ tx.userName ?? '—' }}</p>
                <p class="tnum text-xs text-(--color-text-muted)">{{ tx.userPhone }}</p>
              </td>
              <td class="px-5 py-3.5 text-(--color-text-muted)">{{ currencyLabel(tx.currency) }}</td>
              <td
                class="tnum px-5 py-3.5 font-semibold"
                :class="tx.amount >= 0 ? 'text-(--tone-success-text)' : 'text-(--tone-danger-text)'"
              >
                {{ formatAmount(tx.amount) }}
              </td>
              <td class="px-5 py-3.5">
                <StatusBadge :label="walletTransactionTypeLabel(tx.type).label" :tone="walletTransactionTypeLabel(tx.type).tone" />
              </td>
              <td class="max-w-64 truncate px-5 py-3.5 text-(--color-text-muted)" :title="tx.reason ?? undefined">
                {{ tx.reason ?? '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="(p) => (page = p)" />
    </AppCard>
  </div>
</template>
