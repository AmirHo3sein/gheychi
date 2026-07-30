<script setup lang="ts">
interface MyCodeResponse {
  code: string
  isActive: boolean
  shareUrl: string
}

type ReferralStatus = 'awaiting_qualifying_event' | 'partially_granted' | 'reward_granted' | 'expired' | 'cancelled'

interface ReferralItem {
  id: string
  referredUserPhoneMasked: string
  status: ReferralStatus
  referralType: 'user' | 'salon_owner' | 'worker'
  createdAt: string
  rewardGrantedAt: string | null
}

interface ReferralsResponse {
  items: ReferralItem[]
  total: number
  page: number
  pageSize: number
}

// Mirrors the API's RewardKind union (referral-reward-type.entity.ts) verbatim.
// wallet_credit/cashback/loyalty_points are the only kinds slice 4 can actually grant
// (see CLAUDE.md) -- percent_discount/fixed_discount ship in slices 5/6, so a row with
// one of those kinds can't exist yet, but the label map covers all five defensively
// rather than assuming that stays true (same idiom as STATUS_LABELS below).
type RewardKind = 'wallet_credit' | 'cashback' | 'loyalty_points' | 'percent_discount' | 'fixed_discount'
type RewardBeneficiaryRole = 'referrer' | 'referred'
type RewardStatus = 'granted' | 'reversed'

interface RewardItem {
  id: string
  referralId: string
  beneficiaryRole: RewardBeneficiaryRole
  rewardKind: RewardKind
  rewardValue: number
  status: RewardStatus
  grantedAt: string
  walletTransactionId: string | null
  couponId: string | null
  currency: 'toman' | 'points' | null
  couponCode: string | null
  // A referral coupon inherits the referral's salon: a salon_owner/worker-type referral
  // pays out a code the API only accepts at that one salon (and only until its expiry).
  // Both are shown on the card -- otherwise the code reads as generally usable and the
  // user discovers the restriction as "کد تخفیف نامعتبر است" at checkout.
  // couponSalonId null = platform-wide, usable anywhere.
  couponSalonId: string | null
  couponSalonName: string | null
  couponSalonSlug: string | null
  couponExpiresAt: string | null
}

interface RewardsResponse {
  items: RewardItem[]
  total: number
  page: number
  pageSize: number
}

const route = useRoute()
const router = useRouter()
const { apiFetch } = useApi()

const PAGE_SIZE = 20

// Slice 4 can now actually produce 'partially_granted' (one side's reward_kind is
// grantable, the other's isn't yet -- see referral-reward.entity.ts) and
// 'reward_granted' (both sides landed). 'expired' still can't be produced until the
// sweep cron ships, but the label map covers all five DB-level statuses defensively
// rather than assuming that stays true.
const STATUS_LABELS: Record<ReferralStatus, string> = {
  awaiting_qualifying_event: 'در انتظار تکمیل رزرو',
  partially_granted: 'پاداش جزئی اعطا شد',
  reward_granted: 'پاداش اعطا شد',
  expired: 'منقضی شده',
  cancelled: 'لغو شده',
}

const STATUS_CLASSES: Record<ReferralStatus, string> = {
  awaiting_qualifying_event: 'text-(--color-text-muted)',
  partially_granted: 'text-(--color-accent-text)',
  reward_granted: 'text-(--color-success)',
  expired: 'text-(--color-text-muted)',
  cancelled: 'text-(--color-danger)',
}

const CURRENCY_LABELS: Record<string, string> = {
  toman: 'تومان',
  points: 'امتیاز',
}

const REWARD_KIND_LABELS: Record<RewardKind, string> = {
  wallet_credit: 'اعتبار کیف پول',
  cashback: 'کش‌بک',
  loyalty_points: 'امتیاز وفاداری',
  percent_discount: 'تخفیف درصدی',
  fixed_discount: 'تخفیف مبلغ ثابت',
}

const REWARD_BENEFICIARY_LABELS: Record<RewardBeneficiaryRole, string> = {
  referrer: 'به‌عنوان معرف',
  referred: 'به‌عنوان معرفی‌شده',
}

const REWARD_STATUS_LABELS: Record<RewardStatus, string> = {
  granted: 'اعطا شده',
  reversed: 'برگشت داده شده',
}

const REWARD_STATUS_CLASSES: Record<RewardStatus, string> = {
  granted: 'text-(--color-success)',
  reversed: 'text-(--color-danger)',
}

const page = computed(() => {
  const n = Number(route.query.page)
  return Number.isInteger(n) && n > 0 ? n : 1
})

const rewardsPage = computed(() => {
  const n = Number(route.query.rewardsPage)
  return Number.isInteger(n) && n > 0 ? n : 1
})

// GET /referrals/my-code lazily mints the caller's one lifetime code on first call
// (ReferralsService.getOrCreateMyCode) -- nothing extra to trigger that from here.
const { data: myCode } = await useAsyncData('referral-my-code', async () => {
  const { data } = await apiFetch<MyCodeResponse>('/referrals/my-code', { silent: true })
  return data
})

// Filter/page state lives in the route query (same idiom as account/wallet.vue) so a
// page turn is one router.push and useAsyncData refetches exactly once. The referral
// list and the rewards list below page independently (`page` vs `rewardsPage`), so
// goToPage/goToRewardsPage merge into the existing query rather than replacing it.
const { data: referrals, pending: referralsPending } = await useAsyncData(
  'referrals-mine',
  async () => {
    const { data } = await apiFetch<ReferralsResponse>('/referrals/mine', {
      query: { page: page.value, pageSize: PAGE_SIZE },
      silent: true,
    })
    return data
  },
  { watch: [page] },
)

// GET /referrals/mine/rewards -- my referral_rewards rows, either beneficiary role
// (I can appear as 'referrer' on referrals I sent, or 'referred' on the one referral
// that brought me in). currency/couponCode are denormalized in by the API itself.
const { data: rewards, pending: rewardsPending } = await useAsyncData(
  'referral-rewards-mine',
  async () => {
    const { data } = await apiFetch<RewardsResponse>('/referrals/mine/rewards', {
      query: { page: rewardsPage.value, pageSize: PAGE_SIZE },
      silent: true,
    })
    return data
  },
  { watch: [rewardsPage] },
)

const totalPages = computed(() =>
  referrals.value ? Math.max(1, Math.ceil(referrals.value.total / referrals.value.pageSize)) : 1,
)

const rewardsTotalPages = computed(() =>
  rewards.value ? Math.max(1, Math.ceil(rewards.value.total / rewards.value.pageSize)) : 1,
)

function goToPage(target: number) {
  if (target < 1 || target > totalPages.value || target === page.value) return
  router.push({ query: { ...route.query, page: target > 1 ? String(target) : undefined } })
}

function goToRewardsPage(target: number) {
  if (target < 1 || target > rewardsTotalPages.value || target === rewardsPage.value) return
  router.push({ query: { ...route.query, rewardsPage: target > 1 ? String(target) : undefined } })
}

async function copyToClipboard(text: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(text)
    useToast().push(successMessage)
  } catch {
    useToast().push('کپی کردن با خطا مواجه شد')
  }
}

function copyCode() {
  if (myCode.value) copyToClipboard(myCode.value.code, 'کد معرف کپی شد')
}

function copyShareLink() {
  if (myCode.value) copyToClipboard(myCode.value.shareUrl, 'لینک دعوت کپی شد')
}

// Mirrors CouponsService.resolveAndValidate's own boundary exactly (`expiresAt < now`
// -- the expiry instant itself is still valid), so the card never offers a code the
// API would reject as 'کد تخفیف منقضی شده است'.
function isCouponExpired(reward: RewardItem): boolean {
  return !!reward.couponExpiresAt && new Date(reward.couponExpiresAt).getTime() < Date.now()
}

function couponScopeLabel(reward: RewardItem): string {
  return reward.couponSalonName ? `فقط برای سالن ${reward.couponSalonName}` : 'قابل استفاده در همهٔ سالن‌ها'
}

function couponValidityLabel(reward: RewardItem): string | null {
  if (!reward.couponExpiresAt) return null
  return isCouponExpired(reward)
    ? 'مهلت استفاده از این کد گذشته است'
    : `معتبر تا ${formatDate(reward.couponExpiresAt)}`
}

// A coupon-kind reward's couponCode is a literal, redeemable row in the same `coupons`
// table the booking page's "کد تخفیف دارید؟" field validates via POST /coupons/validate
// -- so "using" it here is just: copy the code, then hand the user off to where the
// booking flow starts (the coupon field itself lives on the per-service booking page,
// which needs a salon+service chosen first). No new redemption path. A salon-restricted
// code goes straight to ITS salon, since the salon list would only lead the user to
// pick a salon where their own code is invalid.
async function useCoupon(reward: RewardItem) {
  if (!reward.couponCode) return
  const salonSlug = reward.couponSalonSlug
  await copyToClipboard(
    reward.couponCode,
    salonSlug ? 'کد تخفیف کپی شد؛ هنگام رزرو در همین سالن آن را وارد کن' : 'کد تخفیف کپی شد؛ هنگام رزرو آن را وارد کن',
  )
  await navigateTo(salonSlug ? `/salons/${salonSlug}` : '/')
}

function statusLabel(status: ReferralStatus): string {
  return STATUS_LABELS[status] ?? status
}

function currencyLabel(currency: string): string {
  return CURRENCY_LABELS[currency] ?? currency
}

function rewardKindLabel(kind: RewardKind): string {
  return REWARD_KIND_LABELS[kind] ?? kind
}

function rewardBeneficiaryLabel(role: RewardBeneficiaryRole): string {
  return REWARD_BENEFICIARY_LABELS[role] ?? role
}

function rewardStatusLabel(status: RewardStatus): string {
  return REWARD_STATUS_LABELS[status] ?? status
}

// percent_discount/fixed_discount rewards aren't wallet transactions -- they can't
// carry a `currency` from the API's wallet_transactions join, so they're formatted
// from rewardKind alone rather than relying on a currency that will always be null
// for them. Neither kind is actually grantable yet (slices 5/6), but this keeps the
// display honest whenever they do start appearing.
function formatRewardValue(item: RewardItem): string {
  if (item.rewardKind === 'percent_discount') return `٪${item.rewardValue.toLocaleString('fa-IR')}`
  if (item.rewardKind === 'fixed_discount') return `${item.rewardValue.toLocaleString('fa-IR')} تومان`
  const currency = item.currency ? currencyLabel(item.currency) : ''
  return `${item.rewardValue.toLocaleString('fa-IR')}${currency ? ' ' + currency : ''}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fa-IR')
}

useSeoMeta({ title: 'دعوت از دوستان — قیچی' })
</script>

<template>
  <div class="mx-auto max-w-2xl p-4 space-y-6">
    <div class="flex items-center gap-2">
      <NuxtLink
        to="/profile"
        aria-label="بازگشت"
        class="flex h-8 w-8 items-center justify-center rounded-lg text-(--color-text-muted) transition-colors hover:bg-(--color-surface-subtle)"
      >
        <BaseIcon name="chevron-forward" :size="20" />
      </NuxtLink>
      <h1 class="text-lg font-bold">دعوت از دوستان</h1>
    </div>

    <section v-if="myCode" data-testid="referral-code-card" class="space-y-3">
      <h2 class="font-bold">کد معرفی من</h2>
      <BaseCard padding="lg" class="space-y-4 text-center">
        <p data-testid="referral-code" class="text-3xl font-bold tracking-[0.3em]">{{ myCode.code }}</p>
        <p class="text-sm text-(--color-text-muted)">
          این کد را با دوستانت به اشتراک بگذار تا هنگام ثبت‌نام وارد کنند.
        </p>
        <div class="flex flex-col gap-2 sm:flex-row">
          <BaseButton variant="secondary" block @click="copyCode">
            <template #icon><BaseIcon name="check" :size="16" /></template>
            کپی کد
          </BaseButton>
          <BaseButton block @click="copyShareLink">
            <template #icon><BaseIcon name="sparkles" :size="16" /></template>
            کپی لینک دعوت
          </BaseButton>
        </div>
      </BaseCard>
    </section>

    <section class="space-y-3">
      <h2 class="font-bold">دعوت‌های من</h2>

      <p
        v-if="!referrals?.items?.length"
        data-testid="empty-state"
        class="py-6 text-center text-sm text-(--color-text-muted)"
      >
        هنوز کسی با کد معرفی تو ثبت‌نام نکرده است
      </p>

      <div v-else class="space-y-2 transition-opacity" :class="{ 'pointer-events-none opacity-60': referralsPending }">
        <BaseCard v-for="r in referrals.items" :key="r.id" data-testid="referral-item">
          <div class="flex items-center justify-between gap-2">
            <div class="space-y-0.5 text-sm">
              <p class="font-medium">{{ r.referredUserPhoneMasked }}</p>
              <p class="text-xs text-(--color-text-muted)">{{ formatDate(r.createdAt) }}</p>
            </div>
            <p data-testid="referral-status" class="whitespace-nowrap text-sm font-bold" :class="STATUS_CLASSES[r.status]">
              {{ statusLabel(r.status) }}
            </p>
          </div>
          <p v-if="r.status === 'partially_granted'" class="mt-2 text-xs text-(--color-text-muted)">
            بخشی از پاداش این دعوت اعطا شده؛ باقی‌ماندهٔ آن هنوز فعال نیست و به‌محض فعال‌سازی، به‌صورت خودکار اعطا می‌شود.
          </p>
        </BaseCard>
      </div>

      <nav v-if="totalPages > 1" class="flex items-center justify-center gap-3 pt-2 text-sm" aria-label="صفحه‌بندی دعوت‌ها">
        <button
          type="button"
          data-testid="prev-page"
          class="min-h-11 rounded-full border border-(--color-border) bg-(--color-surface-card) px-4 py-2 text-(--color-text) disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="page <= 1 || referralsPending"
          @click="goToPage(page - 1)"
        >
          قبلی
        </button>
        <span class="flex items-center gap-1.5 text-xs text-(--color-text-muted)">
          <BaseIcon v-if="referralsPending" name="spinner" :size="14" class="animate-spin" />
          صفحه {{ page.toLocaleString('fa-IR') }} از {{ totalPages.toLocaleString('fa-IR') }}
        </span>
        <button
          type="button"
          data-testid="next-page"
          class="min-h-11 rounded-full border border-(--color-border) bg-(--color-surface-card) px-4 py-2 text-(--color-text) disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="page >= totalPages || referralsPending"
          @click="goToPage(page + 1)"
        >
          بعدی
        </button>
      </nav>
    </section>

    <section class="space-y-3">
      <h2 class="font-bold">پاداش‌های من</h2>

      <p
        v-if="!rewards?.items?.length"
        data-testid="rewards-empty-state"
        class="py-6 text-center text-sm text-(--color-text-muted)"
      >
        هنوز پاداشی برای تو ثبت نشده است
      </p>

      <div v-else class="space-y-2 transition-opacity" :class="{ 'pointer-events-none opacity-60': rewardsPending }">
        <BaseCard v-for="rw in rewards.items" :key="rw.id" data-testid="reward-item">
          <div class="flex items-center justify-between gap-2">
            <div class="space-y-0.5 text-sm">
              <p data-testid="reward-kind" class="font-medium">{{ rewardKindLabel(rw.rewardKind) }}</p>
              <p class="text-xs text-(--color-text-muted)">
                {{ rewardBeneficiaryLabel(rw.beneficiaryRole) }} · {{ formatDate(rw.grantedAt) }}
              </p>
              <template v-if="rw.couponCode">
                <p class="text-xs text-(--color-text-muted)">کد تخفیف: {{ rw.couponCode }}</p>
                <p data-testid="coupon-terms" class="text-xs text-(--color-text-muted)">
                  {{ couponScopeLabel(rw) }}<template v-if="couponValidityLabel(rw)"> — {{ couponValidityLabel(rw) }}</template>
                </p>
                <button
                  v-if="!isCouponExpired(rw)"
                  type="button"
                  data-testid="use-coupon-button"
                  class="text-xs text-(--color-accent-text) hover:underline"
                  @click="useCoupon(rw)"
                >
                  استفاده از این کد
                </button>
              </template>
              <NuxtLink v-if="rw.walletTransactionId" to="/account/wallet" class="text-xs text-(--color-accent-text) hover:underline">
                مشاهده در کیف پول
              </NuxtLink>
            </div>
            <div class="space-y-0.5 text-left">
              <p data-testid="reward-value" class="whitespace-nowrap text-sm font-bold">{{ formatRewardValue(rw) }}</p>
              <p data-testid="reward-status" class="whitespace-nowrap text-xs font-bold" :class="REWARD_STATUS_CLASSES[rw.status]">
                {{ rewardStatusLabel(rw.status) }}
              </p>
            </div>
          </div>
        </BaseCard>
      </div>

      <nav v-if="rewardsTotalPages > 1" class="flex items-center justify-center gap-3 pt-2 text-sm" aria-label="صفحه‌بندی پاداش‌ها">
        <button
          type="button"
          data-testid="rewards-prev-page"
          class="min-h-11 rounded-full border border-(--color-border) bg-(--color-surface-card) px-4 py-2 text-(--color-text) disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="rewardsPage <= 1 || rewardsPending"
          @click="goToRewardsPage(rewardsPage - 1)"
        >
          قبلی
        </button>
        <span class="flex items-center gap-1.5 text-xs text-(--color-text-muted)">
          <BaseIcon v-if="rewardsPending" name="spinner" :size="14" class="animate-spin" />
          صفحه {{ rewardsPage.toLocaleString('fa-IR') }} از {{ rewardsTotalPages.toLocaleString('fa-IR') }}
        </span>
        <button
          type="button"
          data-testid="rewards-next-page"
          class="min-h-11 rounded-full border border-(--color-border) bg-(--color-surface-card) px-4 py-2 text-(--color-text) disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="rewardsPage >= rewardsTotalPages || rewardsPending"
          @click="goToRewardsPage(rewardsPage + 1)"
        >
          بعدی
        </button>
      </nav>
    </section>
  </div>
</template>
