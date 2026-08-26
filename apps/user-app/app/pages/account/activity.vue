<script setup lang="ts">
import type { IconName } from '~/components/ui/BaseIcon.vue'
import { formatToman } from '../../utils/format-toman'

type ActivityType = 'booking' | 'wallet_transaction' | 'review' | 'referral_reward'

interface BookingDetail {
  status: 'pending_payment' | 'confirmed' | 'completed' | 'cancelled_by_user' | 'cancelled_by_salon' | 'expired' | 'no_show'
  source: 'online' | 'manual'
  salonName: string
  serviceName: string
  workerName: string | null
  startsAt: string
  priceSnapshot: number
}
interface WalletTransactionDetail {
  type: 'referral_reward' | 'referral_reversal' | 'admin_adjustment' | 'booking_spend' | 'booking_spend_reversal'
  amount: number
  balanceAfter: number
  reason: string | null
}
interface ReviewDetail {
  rating: number
  comment: string | null
  status: 'published' | 'rejected' | 'withdrawn'
  salonName: string
  bookingId: string
}
interface ReferralRewardDetail {
  beneficiaryRole: 'referrer' | 'referred'
  rewardKind: 'wallet_credit' | 'cashback' | 'loyalty_points' | 'percent_discount' | 'fixed_discount'
  rewardValue: number
  status: 'granted' | 'reversed'
}

interface ActivityItem {
  type: ActivityType
  id: string
  occurredAt: string
  detail: BookingDetail | WalletTransactionDetail | ReviewDetail | ReferralRewardDetail
}
interface ActivityPage {
  items: ActivityItem[]
  nextCursor: string | null
  hasMore: boolean
}

const { apiFetch } = useApi()

// Same per-file local const convention as bookings/index.vue's own STATUS_META, rather
// than a shared module -- these labels only exist here.
const BOOKING_STATUS_LABELS: Record<BookingDetail['status'], string> = {
  pending_payment: 'در انتظار پرداخت',
  confirmed: 'تایید شده',
  completed: 'انجام شده',
  cancelled_by_user: 'لغو شده توسط شما',
  cancelled_by_salon: 'لغو شده توسط سالن',
  expired: 'منقضی شده',
  no_show: 'عدم مراجعه',
}
const WALLET_TYPE_LABELS: Record<WalletTransactionDetail['type'], string> = {
  admin_adjustment: 'اصلاح توسط پشتیبانی',
  referral_reward: 'پاداش معرفی',
  referral_reversal: 'برگشت پاداش معرفی',
  booking_spend: 'استفاده در رزرو',
  booking_spend_reversal: 'برگشت وجه رزرو',
}
const REWARD_KIND_LABELS: Record<ReferralRewardDetail['rewardKind'], string> = {
  wallet_credit: 'اعتبار کیف پول',
  cashback: 'کش‌بک',
  loyalty_points: 'امتیاز وفاداری',
  percent_discount: 'تخفیف درصدی',
  fixed_discount: 'تخفیف مبلغ ثابت',
}
const REVIEW_STATUS_LABELS: Record<ReviewDetail['status'], string> = {
  published: 'منتشر شده',
  rejected: 'رد شده',
  withdrawn: 'حذف شده',
}
const TYPE_META: Record<ActivityType, { icon: IconName; iconClass: string }> = {
  booking: { icon: 'calendar', iconClass: 'bg-(--color-accent-soft) text-(--color-text)' },
  wallet_transaction: { icon: 'wallet', iconClass: 'bg-(--color-success)/10 text-(--color-success)' },
  review: { icon: 'star', iconClass: 'bg-(--color-accent-soft) text-(--color-text)' },
  referral_reward: { icon: 'gift', iconClass: 'bg-(--color-success)/10 text-(--color-success)' },
}

const items = ref<ActivityItem[]>([])
const nextCursor = ref<string | null>(null)
const hasMore = ref(false)
const loading = ref(true)
const loadingMore = ref(false)
const loadError = ref(false)

async function load() {
  loading.value = true
  loadError.value = false
  const { data, error } = await apiFetch<ActivityPage>('/activity/mine', { silent: true })
  if (error || !data) {
    loadError.value = true
    loading.value = false
    return
  }
  items.value = data.items
  nextCursor.value = data.nextCursor
  hasMore.value = data.hasMore
  loading.value = false
}

async function loadMore() {
  if (!nextCursor.value || loadingMore.value) return
  loadingMore.value = true
  const { data } = await apiFetch<ActivityPage>('/activity/mine', {
    query: { cursor: nextCursor.value },
    silent: true,
  })
  if (data) {
    items.value = [...items.value, ...data.items]
    nextCursor.value = data.nextCursor
    hasMore.value = data.hasMore
  }
  loadingMore.value = false
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fa-IR')
}

function bookingTitle(detail: BookingDetail): string {
  return `${detail.salonName} — ${detail.serviceName}`
}

function walletAmountLabel(detail: WalletTransactionDetail): string {
  const sign = detail.amount > 0 ? '+' : ''
  return `${sign}${formatToman(detail.amount)} تومان`
}

function rewardValueLabel(detail: ReferralRewardDetail): string {
  if (detail.rewardKind === 'percent_discount') return `٪${detail.rewardValue.toLocaleString('fa-IR')}`
  if (detail.rewardKind === 'fixed_discount') return `${formatToman(detail.rewardValue)} تومان`
  return `${formatToman(detail.rewardValue)} تومان`
}

useSeoMeta({ title: 'تاریخچه فعالیت — قیچی' })

onMounted(load)
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
      <h1 class="text-lg font-bold">تاریخچه فعالیت</h1>
    </div>

    <div v-if="loading" data-testid="activity-loading" class="flex items-center justify-center gap-2 py-12 text-sm text-(--color-text-muted)">
      <BaseIcon name="spinner" :size="18" class="animate-spin" />
      در حال بارگذاری…
    </div>

    <BaseCard v-else-if="loadError" data-testid="activity-load-error" role="alert" class="space-y-3 text-center">
      <p class="text-sm text-(--color-text-muted)">بارگذاری تاریخچه فعالیت با خطا مواجه شد.</p>
      <BaseButton variant="secondary" data-testid="activity-retry-button" @click="load">تلاش مجدد</BaseButton>
    </BaseCard>

    <p v-else-if="!items.length" data-testid="activity-empty-state" class="py-6 text-center text-sm text-(--color-text-muted)">
      هنوز فعالیتی ثبت نشده است
    </p>

    <div v-else class="space-y-2">
      <BaseCard v-for="item in items" :key="`${item.type}-${item.id}`" data-testid="activity-item" class="flex items-start gap-3">
        <span
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          :class="TYPE_META[item.type].iconClass"
        >
          <BaseIcon :name="TYPE_META[item.type].icon" :size="16" />
        </span>

        <div class="min-w-0 flex-1 space-y-0.5 text-sm">
          <template v-if="item.type === 'booking'">
            <NuxtLink :to="`/bookings/${item.id}`" class="block break-words font-medium text-(--color-text) hover:underline">
              {{ bookingTitle(item.detail as BookingDetail) }}
            </NuxtLink>
            <p class="text-xs text-(--color-text-muted)">
              {{ BOOKING_STATUS_LABELS[(item.detail as BookingDetail).status] }}
              <span v-if="(item.detail as BookingDetail).source === 'manual'"> · ثبت دستی</span>
            </p>
          </template>

          <template v-else-if="item.type === 'wallet_transaction'">
            <p class="break-words font-medium text-(--color-text)">
              {{ WALLET_TYPE_LABELS[(item.detail as WalletTransactionDetail).type] }}
            </p>
            <p
              data-testid="activity-wallet-amount"
              class="text-xs font-semibold"
              :class="(item.detail as WalletTransactionDetail).amount > 0 ? 'text-(--color-success)' : 'text-(--color-danger)'"
            >
              <span dir="ltr" class="tnum">{{ walletAmountLabel(item.detail as WalletTransactionDetail) }}</span>
            </p>
            <p v-if="(item.detail as WalletTransactionDetail).reason" class="text-xs text-(--color-text-muted)">
              {{ (item.detail as WalletTransactionDetail).reason }}
            </p>
          </template>

          <template v-else-if="item.type === 'review'">
            <p class="break-words font-medium text-(--color-text)">نظر شما برای {{ (item.detail as ReviewDetail).salonName }}</p>
            <div class="flex items-center gap-0.5" :aria-label="`${(item.detail as ReviewDetail).rating.toLocaleString('fa-IR')} از ۵ ستاره`">
              <BaseIcon
                v-for="n in 5"
                :key="n"
                name="star"
                :size="12"
                :class="n <= (item.detail as ReviewDetail).rating ? 'text-(--color-accent-text)' : 'text-(--color-border)'"
                aria-hidden="true"
              />
            </div>
            <p v-if="(item.detail as ReviewDetail).comment" class="break-words text-(--color-text)">
              {{ (item.detail as ReviewDetail).comment }}
            </p>
            <p v-if="(item.detail as ReviewDetail).status !== 'published'" class="text-xs text-(--color-text-muted)">
              {{ REVIEW_STATUS_LABELS[(item.detail as ReviewDetail).status] }}
            </p>
          </template>

          <template v-else-if="item.type === 'referral_reward'">
            <NuxtLink to="/account/referral" class="block break-words font-medium text-(--color-text) hover:underline">
              {{ REWARD_KIND_LABELS[(item.detail as ReferralRewardDetail).rewardKind] }}
            </NuxtLink>
            <p
              class="text-xs font-semibold"
              :class="(item.detail as ReferralRewardDetail).status === 'granted' ? 'text-(--color-success)' : 'text-(--color-danger)'"
            >
              <span dir="ltr" class="tnum">{{ rewardValueLabel(item.detail as ReferralRewardDetail) }}</span>
            </p>
          </template>

          <p class="text-xs text-(--color-text-muted)">{{ formatDate(item.occurredAt) }}</p>
        </div>
      </BaseCard>

      <div v-if="hasMore" class="pt-2 text-center">
        <BaseButton
          variant="secondary"
          data-testid="activity-load-more"
          :loading="loadingMore"
          @click="loadMore"
        >
          بارگذاری بیشتر
        </BaseButton>
      </div>
    </div>
  </div>
</template>
