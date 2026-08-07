<!-- apps/admin-panel/src/pages/WalletView.vue -->
<!-- Wallet Ledger admin screen (design spec §8: "Wallet Ledger (/wallet) -- search by
     user (phone), paginated transaction list, plus an Adjust Balance action"). Filter/
     paginate UX mirrors AuditLogView.vue and UsersView.vue exactly (debounced free-text
     search, AppSelect dropdown, JalaliDatePicker range, Pagination, clear-filters button).

     User targeting matches UsersView.vue's own identifier field: phone (free-text, ILIKE
     via GET /admin/users?phone=), resolved locally to a userId before it's sent as the
     `userId` filter GET /admin/wallet/transactions actually accepts. Leaving no user
     selected browses the global ledger across every user (userId is an optional filter
     server-side), same as AuditLogView's optional actorId. -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import { usePhoneUserSearch } from '@/composables/usePhoneUserSearch'
import AdjustBalanceCard from '@/components/wallet/AdjustBalanceCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'
import Pagination from '@/components/ui/Pagination.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { currencyLabel, walletTransactionTypeLabel } from '@/utils/labels'

const TYPE_OPTIONS = [
  { value: '', label: 'همه انواع' },
  { value: 'admin_adjustment', label: 'تعدیل دستی' },
  { value: 'referral_reward', label: 'پاداش معرفی' },
  { value: 'referral_reversal', label: 'برگشت پاداش معرفی' },
  { value: 'booking_spend', label: 'استفاده در رزرو' },
  { value: 'booking_spend_reversal', label: 'برگشت وجه رزرو' },
]

type WalletTransactionType =
  | 'referral_reward'
  | 'referral_reversal'
  | 'admin_adjustment'
  | 'booking_spend'
  | 'booking_spend_reversal'

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
// A fetch failure must not be silently repainted as an empty state -- see
// SalonsView.vue's identical loadError pattern.
const loadError = ref(false)
const page = ref(1)
const total = ref(0)
const pageSize = 20

const { root: phoneSearchRoot, phoneQuery, matches, selectedUser, noResults, selectUser, clearUser: clearUserFilter } =
  usePhoneUserSearch()
const typeFilter = ref<'' | WalletTransactionType>('')
const fromDate = ref('')
const toDate = ref('')

async function load() {
  loading.value = true
  loadError.value = false
  const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) })
  if (selectedUser.value) params.set('userId', selectedUser.value.id)
  if (typeFilter.value) params.set('type', typeFilter.value)
  // Both bounds anchored in LOCAL time -- see UsersView.vue/AuditLogView.vue for why
  // `new Date('YYYY-MM-DD')` alone (parsed as UTC midnight) would silently drop early
  // local-time rows on the from-day (UTC+3:30).
  if (fromDate.value) params.set('from', new Date(`${fromDate.value}T00:00:00.000`).toISOString())
  if (toDate.value) params.set('to', new Date(`${toDate.value}T23:59:59.999`).toISOString())

  const { data, error } = await apiFetch<WalletTransactionListResponse>(`/admin/wallet/transactions?${params.toString()}`, {
    silent: true,
  })
  if (error) {
    loadError.value = true
    transactions.value = []
    total.value = 0
  } else {
    transactions.value = data?.items ?? []
    total.value = data?.total ?? 0
  }
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
  // Refresh whenever the ledger isn't currently filtered to a DIFFERENT user than the one
  // just adjusted -- covers both "narrowed to exactly that user" and the page's default
  // unfiltered/global-ledger state, so the new row is visible immediately instead of
  // looking stale (with only the toast as feedback) until the next filter change.
  if (!selectedUser.value || selectedUser.value.id === result.userId) load()
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
watch(selectedUser, loadFromFilterChange)
watch([typeFilter, fromDate, toDate], loadFromFilterChange)
watch(page, load)
</script>

<template>
  <div class="space-y-5 p-8">
    <AdjustBalanceCard @adjusted="onAdjusted" />

    <AppCard :padded="false" class="p-4">
      <div class="flex flex-wrap items-end gap-3">
        <div ref="phoneSearchRoot" class="relative">
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">شماره موبایل کاربر</label>
          <AppInput
            v-if="!selectedUser"
            v-model="phoneQuery"
            icon="phone"
            data-testid="wallet-phone-filter"
            placeholder="جست‌وجو…"
            class="w-44"
          />
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
              aria-label="پاک کردن کاربر"
              @click="clearUserFilter"
            >
              <AppIcon name="x" :size="14" />
            </button>
          </div>

          <div
            v-if="matches.length > 0 || noResults"
            data-testid="wallet-user-matches"
            class="absolute start-0 top-full z-10 mt-1 w-44 overflow-hidden rounded-xl border border-(--color-border) bg-(--color-surface-card) shadow-(--shadow-md)"
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
            <p v-if="noResults" class="px-3 py-2 text-sm text-(--color-text-muted)">کاربری یافت نشد</p>
          </div>
        </div>

        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">نوع تراکنش</label>
          <AppSelect v-model="typeFilter" :options="TYPE_OPTIONS" width="12rem" />
        </div>

        <div class="min-w-0">
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">بازه زمانی</label>
          <!-- See UsersView.vue: the from/to pair is a nested flex row that would otherwise stay
               one unbreakable ~19rem block, the widest item in this bar. Wrapping only ever
               engages below that width, so the desk-sized rendering is unchanged. -->
          <div class="flex flex-wrap items-center gap-1.5">
            <JalaliDatePicker v-model="fromDate" placeholder="از تاریخ" class="w-40" />
            <span class="text-(--color-text-muted)">تا</span>
            <JalaliDatePicker v-model="toDate" placeholder="تا تاریخ" class="w-40" />
          </div>
        </div>

        <AppButton
          v-if="hasActiveFilters"
          type="button"
          variant="ghost"
          class="mb-2"
          @click="clearFilters"
        >
          <template #icon><AppIcon name="reset" :size="15" /></template>
          پاک کردن فیلترها
        </AppButton>
      </div>
    </AppCard>

    <AppCard
      v-if="loadError"
      :padded="false"
      data-testid="load-error"
      class="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center"
    >
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-(--tone-danger-bg) text-(--tone-danger-text)">
        <AppIcon name="warning" :size="22" />
      </div>
      <p class="text-sm text-(--color-text-muted)">خطا در دریافت تراکنش‌های کیف پول.</p>
      <AppButton type="button" variant="secondary" data-testid="retry-load" @click="load">تلاش دوباره</AppButton>
    </AppCard>

    <EmptyState v-else-if="!loading && transactions.length === 0" icon="wallet" message="تراکنشی با این فیلترها یافت نشد." />

    <AppCard v-else :padded="false" class="overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-right text-sm">
          <thead>
            <tr class="border-b border-(--color-border) bg-(--color-border-soft) text-xs text-(--color-text-muted)">
              <th scope="col" class="px-5 py-3 font-semibold">تاریخ</th>
              <th scope="col" class="px-5 py-3 font-semibold">کاربر</th>
              <th scope="col" class="px-5 py-3 font-semibold">واحد</th>
              <th scope="col" class="px-5 py-3 font-semibold">مبلغ</th>
              <th scope="col" class="px-5 py-3 font-semibold">نوع</th>
              <th scope="col" class="px-5 py-3 font-semibold">دلیل</th>
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
