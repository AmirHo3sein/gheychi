<!-- apps/provider-panel/src/pages/ReferralView.vue -->
<!--
  The salon owner's own referral code, referral activity, granted rewards and wallet.

  Why this page exists at all: the backend's referral system resolves a referrer's type
  dynamically from their current role, and `salon_owner` is a first-class one with its own
  configurable reward terms (`referral_reward_types`) -- yet every endpoint behind it was
  consumed only by the customer app. The one actor with a real business reason to refer
  peers (another salon owner) had to log into a *different* app, as a customer, to find
  their own code. Nothing here is provider-specific API surface: `/referrals/*` and
  `/wallet/*` carry no role guard at all and key everything off `req.user.id`, so this is
  purely the missing view.

  One page rather than a page plus a dashboard card: the four things an owner wants here
  (code, activity, rewards, wallet) only make sense read together -- a balance with no
  ledger behind it and a code with no activity behind it each raise more questions than
  they answer -- and a dashboard tile showing a number that is usually zero would cost a
  permanent slot on the busiest screen in the panel to say nothing most days.

  PRIVACY: `GET /referrals/mine` returns `referredUserPhoneMasked` for each row. It is NOT
  rendered anywhere on this page and is deliberately absent from the local `ReferralItem`
  type below. The owner's legitimate interest here is "how many people did I bring in, and
  what did I earn" -- counts, statuses and amounts -- not who those people are. A masked
  phone is still an identifier (first four + last four digits narrows a real person to a
  handful in practice), and the salon owner has no relationship with a person who merely
  signed up under their code and may never have set foot in their salon.
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { useApi } from '@/composables/useApi'
import { useFeatureFlags } from '@/composables/useFeatureFlags'
import { useToast } from '@/composables/useToast'
import { formatToman } from '@/utils/format-toman'
import type { Tone } from '@/utils/labels'

interface MyCode {
  code: string
  isActive: boolean
  // Points at the *customer* app (the API builds it from FRONTEND_BASE_URL) -- that is
  // correct: it is the sign-up link a referred person follows, not a panel link.
  shareUrl: string
}

type ReferralStatus = 'awaiting_qualifying_event' | 'partially_granted' | 'reward_granted' | 'expired' | 'cancelled'

// `referredUserPhoneMasked` is returned by the API and deliberately omitted -- see the
// PRIVACY note at the top of this file. Nothing on this page may reintroduce it.
interface ReferralItem {
  id: string
  status: ReferralStatus
  createdAt: string
  rewardGrantedAt: string | null
}

type RewardKind = 'wallet_credit' | 'cashback' | 'loyalty_points' | 'percent_discount' | 'fixed_discount'

interface RewardItem {
  id: string
  beneficiaryRole: 'referrer' | 'referred'
  rewardKind: RewardKind
  rewardValue: number
  status: 'granted' | 'reversed'
  grantedAt: string
  couponCode: string | null
  couponSalonName: string | null
}

interface WalletBalance {
  currency: string
  balance: number
}

interface WalletTransactionItem {
  id: string
  currency: string
  amount: number
  type: 'referral_reward' | 'referral_reversal' | 'admin_adjustment' | 'booking_spend' | 'booking_spend_reversal'
  reason: string | null
  createdAt: string
}

interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

const { apiFetch } = useApi()
const { push: pushToast } = useToast()
const { flags: featureFlags } = useFeatureFlags()

// The API caps pageSize at 100. The per-status breakdown below is computed from the rows
// actually fetched, so it is exact for any owner with 100 referrals or fewer and is
// labelled honestly (see `countsArePartial`) for anyone past that -- the alternative would
// be paging through the whole history on page load to render five numbers.
const REFERRALS_PAGE_SIZE = 100
// Recent-activity lists, not a full ledger: both have their own dedicated, paginated home
// in the customer app, and this page's job is "at a glance".
const REWARDS_PAGE_SIZE = 10
const TRANSACTIONS_PAGE_SIZE = 10

const myCode = ref<MyCode | null>(null)
const referrals = ref<Page<ReferralItem> | null>(null)
const rewards = ref<Page<RewardItem> | null>(null)
const balances = ref<WalletBalance[]>([])
const transactions = ref<Page<WalletTransactionItem> | null>(null)

// Two independent load/error scopes rather than one page-wide flag. They fail for different
// reasons and mean different things to the reader: a referral-side failure hides a code, a
// wallet-side failure hides a balance -- and showing "موجودی: ۰" because a request failed
// would be a false claim about the owner's money. Each gets its own retry.
const referralLoading = ref(true)
const referralError = ref(false)
const walletLoading = ref(true)
const walletError = ref(false)

async function loadReferral() {
  referralLoading.value = true
  referralError.value = false
  // GET /referrals/my-code lazily mints the caller's one lifetime code on first call
  // (ReferralsService.getOrCreateMyCode), so simply opening this page is what gives an
  // owner a code -- there is nothing to "generate" first.
  const [codeRes, listRes, rewardsRes] = await Promise.all([
    apiFetch<MyCode>('/referrals/my-code', { silent: true }),
    apiFetch<Page<ReferralItem>>(`/referrals/mine?page=1&pageSize=${REFERRALS_PAGE_SIZE}`, { silent: true }),
    apiFetch<Page<RewardItem>>(`/referrals/mine/rewards?page=1&pageSize=${REWARDS_PAGE_SIZE}`, { silent: true }),
  ])
  referralLoading.value = false
  if (codeRes.error || listRes.error || rewardsRes.error) {
    referralError.value = true
    return
  }
  myCode.value = codeRes.data
  referrals.value = listRes.data
  rewards.value = rewardsRes.data
}

async function loadWallet() {
  walletLoading.value = true
  walletError.value = false
  const [balanceRes, txRes] = await Promise.all([
    apiFetch<{ balances: WalletBalance[] }>('/wallet/mine', { silent: true }),
    apiFetch<Page<WalletTransactionItem>>(
      `/wallet/mine/transactions?page=1&pageSize=${TRANSACTIONS_PAGE_SIZE}`,
      { silent: true },
    ),
  ])
  walletLoading.value = false
  if (balanceRes.error || txRes.error) {
    walletError.value = true
    return
  }
  balances.value = balanceRes.data?.balances ?? []
  transactions.value = txRes.data
}

onMounted(() => {
  loadReferral()
  loadWallet()
})

const STATUS_LABELS: Record<ReferralStatus, string> = {
  awaiting_qualifying_event: 'در انتظار اولین نوبت',
  partially_granted: 'پاداش جزئی',
  reward_granted: 'پاداش اعطا شد',
  expired: 'منقضی شده',
  cancelled: 'لغو شده',
}

const STATUS_TONES: Record<ReferralStatus, Tone> = {
  awaiting_qualifying_event: 'neutral',
  partially_granted: 'info',
  reward_granted: 'success',
  expired: 'neutral',
  cancelled: 'danger',
}

const REWARD_KIND_LABELS: Record<RewardKind, string> = {
  wallet_credit: 'اعتبار کیف پول',
  cashback: 'کش‌بک',
  loyalty_points: 'امتیاز وفاداری',
  percent_discount: 'تخفیف درصدی',
  fixed_discount: 'تخفیف مبلغ ثابت',
}

const BENEFICIARY_LABELS: Record<RewardItem['beneficiaryRole'], string> = {
  referrer: 'به‌عنوان معرف',
  referred: 'به‌عنوان معرفی‌شده',
}

const TRANSACTION_TYPE_LABELS: Record<WalletTransactionItem['type'], string> = {
  admin_adjustment: 'اصلاح توسط پشتیبانی',
  referral_reward: 'پاداش معرفی',
  referral_reversal: 'برگشت پاداش معرفی',
  booking_spend: 'استفاده در رزرو',
  booking_spend_reversal: 'برگشت وجه رزرو',
}

const CURRENCY_LABELS: Record<string, string> = { toman: 'تومان', points: 'امتیاز' }

// Only statuses that actually occur are rendered, in a fixed order -- a grid of five cells
// that are permanently «۰» reads as a broken feature rather than as an empty one.
const STATUS_ORDER: ReferralStatus[] = [
  'awaiting_qualifying_event',
  'partially_granted',
  'reward_granted',
  'expired',
  'cancelled',
]

const statusCounts = computed(() => {
  const items = referrals.value?.items ?? []
  return STATUS_ORDER.map((status) => ({
    status,
    label: STATUS_LABELS[status],
    tone: STATUS_TONES[status],
    count: items.filter((r) => r.status === status).length,
  })).filter((row) => row.count > 0)
})

const referralTotal = computed(() => referrals.value?.total ?? 0)
// The breakdown is computed from one fetched page; the total is authoritative. Say so
// rather than quietly presenting a partial tally as the whole picture.
const countsArePartial = computed(() => referralTotal.value > (referrals.value?.items.length ?? 0))

// `wallet_balances` rows only exist once a currency has actually been credited or debited,
// so "no rows" means "nothing has ever moved", not "the fetch came back thin" -- render a
// real zero rather than an empty section. (walletError is handled separately above, so this
// zero is never a failed request in disguise.)
const tomanBalance = computed(() => balances.value.find((b) => b.currency === 'toman')?.balance ?? 0)
const otherBalances = computed(() => balances.value.filter((b) => b.currency !== 'toman'))

function currencyLabel(currency: string): string {
  return CURRENCY_LABELS[currency] ?? currency
}

// `rewardValue` carries no unit of its own -- the unit is implied by `rewardKind`
// (toman for the wallet/cashback/fixed-discount kinds, a percent for percent_discount,
// a bare count for loyalty points). Getting this wrong would print a percentage as a
// price, so it is derived from the kind rather than from `currency` (which is null for
// every coupon-backed reward).
function formatRewardValue(reward: RewardItem): string {
  const value = reward.rewardValue
  switch (reward.rewardKind) {
    case 'percent_discount':
      return `${value.toLocaleString('fa-IR')}٪`
    case 'loyalty_points':
      return `${value.toLocaleString('fa-IR')} امتیاز`
    default:
      return `${formatToman(value)} تومان`
  }
}

function formatAmount(amount: number, currency: string): string {
  const sign = amount > 0 ? '+' : ''
  return currency === 'toman' ? `${sign}${formatToman(amount)}` : `${sign}${amount.toLocaleString('fa-IR')}`
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Tehran' })
    .format(new Date(iso))
}

async function copyText(text: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(text)
    pushToast(successMessage)
  } catch {
    // Clipboard access is refused outright in a non-secure context and on a page that
    // isn't focused, so this is a real path, not a theoretical one -- and the code stays
    // selectable on screen either way.
    pushToast('کپی ناموفق بود. کد را دستی انتخاب کنید.')
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-2xl space-y-4 p-4 lg:p-6">
    <h1 class="text-lg font-bold text-(--color-text)">معرفی و پاداش</h1>

    <!--
      Flag off. Mirrors StoriesView/CouponsView: an explanatory banner rather than a blank
      page, because what is switched off is narrower than the page. `referralsEnabled`
      only stops NEW rewards being granted (bookings.service.ts and referral-grant.job.ts
      are its only enforcement points -- the endpoints below are not gated server-side at
      all). So the two things that remain true are still shown: the history of what already
      happened, and the wallet balance, which is the owner's real money and must never
      vanish because a platform switch moved. What IS withheld is the share-code card --
      handing out a code that cannot currently earn anything is the one actively misleading
      thing this page could do while the program is off.
    -->
    <p
      v-if="!featureFlags.referralsEnabled"
      data-testid="referrals-disabled-banner"
      role="status"
      class="flex items-start gap-2 rounded-xl bg-(--tone-warning-bg) p-3 text-sm text-(--tone-warning-text)"
    >
      <AppIcon name="warning" :size="16" class="mt-0.5 shrink-0" />
      برنامه معرفی در حال حاضر توسط پلتفرم غیرفعال است و معرفی جدید پاداشی ایجاد نمی‌کند. سوابق و موجودی کیف پول شما
      دست‌نخورده باقی می‌ماند.
    </p>

    <!-- -- Referral side ------------------------------------------------------------- -->

    <div v-if="referralLoading" class="flex items-center justify-center py-10 text-(--color-text-muted)">
      <AppIcon name="spinner" :size="20" class="animate-spin" />
    </div>

    <AppCard v-else-if="referralError" class="space-y-3 text-center">
      <p class="text-sm text-(--tone-danger-text)">اطلاعات معرفی بارگذاری نشد.</p>
      <AppButton type="button" variant="secondary" data-testid="retry-referral" @click="loadReferral">
        تلاش دوباره
      </AppButton>
    </AppCard>

    <template v-else>
      <AppCard v-if="myCode && featureFlags.referralsEnabled" data-testid="referral-code-card" class="space-y-3">
        <div class="flex items-center gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-(--color-accent-soft) text-(--color-accent-text)">
            <AppIcon name="referral" :size="18" />
          </span>
          <div class="min-w-0">
            <h2 class="font-bold text-(--color-text)">کد معرفی شما</h2>
            <p class="text-xs text-(--color-text-muted)">این کد را با همکاران و مشتریان خود به اشتراک بگذارید</p>
          </div>
        </div>

        <!-- dir="ltr": the code is a Latin-alphabet token, and in an RTL paragraph its
             characters would otherwise be laid out right-to-left and read back wrong. -->
        <p
          dir="ltr"
          data-testid="referral-code"
          class="select-all rounded-xl bg-(--color-surface-subtle) p-3 text-center text-xl font-bold tracking-[0.2em] text-(--color-text)"
        >
          {{ myCode.code }}
        </p>

        <p v-if="!myCode.isActive" data-testid="code-inactive" class="text-xs text-(--tone-warning-text)">
          این کد توسط پشتیبانی غیرفعال شده است.
        </p>

        <div class="flex flex-wrap gap-2">
          <AppButton type="button" variant="secondary" data-testid="copy-code" @click="copyText(myCode.code, 'کد در کلیپ‌بورد کپی شد.')">
            <template #icon><AppIcon name="copy" :size="15" /></template>
            کپی کد
          </AppButton>
          <AppButton type="button" variant="secondary" data-testid="copy-link" @click="copyText(myCode.shareUrl, 'لینک دعوت کپی شد.')">
            <template #icon><AppIcon name="copy" :size="15" /></template>
            کپی لینک دعوت
          </AppButton>
        </div>
      </AppCard>

      <AppCard data-testid="referral-activity" class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="font-bold text-(--color-text)">معرفی‌های من</h2>
          <StatusBadge :label="`${referralTotal.toLocaleString('fa-IR')} معرفی`" tone="info" />
        </div>

        <EmptyState v-if="referralTotal === 0" icon="referral" message="هنوز کسی با کد شما ثبت‌نام نکرده است." />

        <template v-else>
          <!-- Counts and statuses only, never who -- see the PRIVACY note at the top. -->
          <div class="grid gap-2 sm:grid-cols-2">
            <div
              v-for="row in statusCounts"
              :key="row.status"
              :data-testid="`status-count-${row.status}`"
              class="flex items-center justify-between gap-2 rounded-xl bg-(--color-surface-subtle) px-3 py-2"
            >
              <StatusBadge :label="row.label" :tone="row.tone" />
              <span class="tnum text-sm font-bold text-(--color-text)">{{ row.count.toLocaleString('fa-IR') }}</span>
            </div>
          </div>
          <p v-if="countsArePartial" data-testid="counts-partial" class="text-xs text-(--color-text-muted)">
            این تفکیک بر اساس {{ REFERRALS_PAGE_SIZE.toLocaleString('fa-IR') }} معرفی اخیر شماست.
          </p>
        </template>
      </AppCard>

      <AppCard data-testid="rewards-section" class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="font-bold text-(--color-text)">پاداش‌های اعطاشده</h2>
          <StatusBadge :label="`${(rewards?.total ?? 0).toLocaleString('fa-IR')} پاداش`" tone="info" />
        </div>

        <EmptyState v-if="(rewards?.items.length ?? 0) === 0" icon="referral" message="هنوز پاداشی برای شما ثبت نشده است." />

        <div v-else class="divide-y divide-(--color-border-soft)">
          <div v-for="reward in rewards!.items" :key="reward.id" data-testid="reward-row" class="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div class="min-w-0">
              <p class="text-sm font-semibold text-(--color-text)">
                {{ REWARD_KIND_LABELS[reward.rewardKind] }}
                <span class="text-xs font-normal text-(--color-text-muted)">— {{ BENEFICIARY_LABELS[reward.beneficiaryRole] }}</span>
              </p>
              <p class="tnum text-xs text-(--color-text-muted)">{{ formatDate(reward.grantedAt) }}</p>
              <!-- A discount-kind reward is a real coupon row; its code is the only way the
                   owner can actually use it, and which salon it is valid at decides whether
                   it is usable at all. -->
              <p v-if="reward.couponCode" class="mt-0.5 text-xs text-(--color-text-muted)">
                کد تخفیف: <span dir="ltr" class="tnum font-semibold text-(--color-text)">{{ reward.couponCode }}</span>
                <span v-if="reward.couponSalonName"> — فقط در {{ reward.couponSalonName }}</span>
              </p>
            </div>
            <div class="flex shrink-0 flex-col items-end gap-1">
              <span dir="ltr" class="tnum text-sm font-bold text-(--color-text)">{{ formatRewardValue(reward) }}</span>
              <StatusBadge
                v-if="reward.status === 'reversed'"
                data-testid="reward-reversed"
                label="برگشت داده شده"
                tone="danger"
              />
            </div>
          </div>
        </div>
      </AppCard>
    </template>

    <!-- -- Wallet side --------------------------------------------------------------- -->

    <div v-if="walletLoading" class="flex items-center justify-center py-10 text-(--color-text-muted)">
      <AppIcon name="spinner" :size="20" class="animate-spin" />
    </div>

    <AppCard v-else-if="walletError" class="space-y-3 text-center">
      <p class="text-sm text-(--tone-danger-text)">اطلاعات کیف پول بارگذاری نشد.</p>
      <AppButton type="button" variant="secondary" data-testid="retry-wallet" @click="loadWallet">تلاش دوباره</AppButton>
    </AppCard>

    <template v-else>
      <AppCard data-testid="wallet-card" class="space-y-3 bg-(--color-surface-subtle)">
        <div class="flex items-center gap-3">
          <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-(--color-surface-card) text-(--color-text-muted)">
            <AppIcon name="earnings" :size="20" />
          </span>
          <div class="min-w-0">
            <p class="text-xs text-(--color-text-muted)">موجودی کیف پول</p>
            <p data-testid="wallet-balance" class="text-xl font-bold text-(--color-text)">
              <span dir="ltr" class="tnum">{{ formatToman(tomanBalance) }}</span> تومان
            </p>
          </div>
        </div>
        <p v-for="b in otherBalances" :key="b.currency" data-testid="other-balance" class="text-sm text-(--color-text)">
          {{ currencyLabel(b.currency) }}: <span dir="ltr" class="tnum font-bold">{{ b.balance.toLocaleString('fa-IR') }}</span>
        </p>
        <!-- Set expectations rather than leave an owner waiting for a payout that isn't
             built: the wallet is accrue-only today (there is no spend-at-checkout path and
             no payout infrastructure anywhere in this platform). -->
        <p class="text-xs text-(--color-text-muted)">
          موجودی کیف پول از پاداش‌های معرفی جمع می‌شود. برای استفاده از آن با پشتیبانی تماس بگیرید.
        </p>
      </AppCard>

      <AppCard data-testid="wallet-transactions" class="space-y-3">
        <h2 class="font-bold text-(--color-text)">آخرین تراکنش‌های کیف پول</h2>

        <EmptyState v-if="(transactions?.items.length ?? 0) === 0" icon="earnings" message="هنوز تراکنشی ثبت نشده است." />

        <div v-else class="divide-y divide-(--color-border-soft)">
          <div v-for="tx in transactions!.items" :key="tx.id" data-testid="transaction-row" class="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div class="min-w-0">
              <p class="text-sm font-semibold text-(--color-text)">{{ TRANSACTION_TYPE_LABELS[tx.type] ?? tx.type }}</p>
              <p v-if="tx.reason" class="break-words text-xs text-(--color-text-muted)">{{ tx.reason }}</p>
              <p class="tnum text-xs text-(--color-text-muted)">{{ formatDate(tx.createdAt) }}</p>
            </div>
            <span
              dir="ltr"
              class="tnum shrink-0 text-sm font-bold"
              :class="tx.amount >= 0 ? 'text-(--tone-success-text)' : 'text-(--tone-danger-text)'"
            >
              {{ formatAmount(tx.amount, tx.currency) }} {{ currencyLabel(tx.currency) }}
            </span>
          </div>
        </div>
      </AppCard>
    </template>
  </div>
</template>
