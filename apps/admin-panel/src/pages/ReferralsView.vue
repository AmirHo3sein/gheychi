<!-- apps/admin-panel/src/pages/ReferralsView.vue -->
<!-- Referrals tracking/fraud-review screen (design spec §4/§8: GET /admin/referrals,
     filterable by status/referralType/referrerPhone, paginated; row detail shows the full
     snapshot; a Cancel action only when status='awaiting_qualifying_event'). Filter/paginate
     UX mirrors WalletView.vue exactly (debounced free-text filter, AppSelect dropdowns,
     Pagination, clear-filters button) per the task brief, since it's the more recent,
     closer analogue to this screen than AuditLogView.vue.

     referrerPhone is an EXACT match server-side (ReferralsService.listForAdmin: `referrer.phone
     = :referrerPhone`, no ILIKE) -- unlike WalletView's phone lookup, there's no user-search-
     and-pick flow here, just a plain debounced text filter sent as-is.

     Slice 5: GET /admin/referrals now projects each side's reward terms
     (kind/value/max, snapshotted onto the `referrals` row at redemption time, R5), and
     GET /admin/referrals/:id/rewards exposes the per-side `referral_rewards` detail
     (status, wallet transaction id, or coupon code + isActive). The row detail panel
     renders reward terms immediately (already on the row) and fetches the per-side
     grant/reversal detail lazily on first expand, cached thereafter. -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import CancelReferralAction from '@/components/referrals/CancelReferralAction.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Pagination from '@/components/ui/Pagination.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { debounce } from '@/utils/debounce'
import { qualifyingEventLabel, referralStatusLabel, referralTypeLabel, rewardKindLabel, rewardKindUnit } from '@/utils/labels'

const STATUS_OPTIONS = [
  { value: '', label: 'همه وضعیت‌ها' },
  { value: 'awaiting_qualifying_event', label: 'در انتظار رویداد' },
  { value: 'partially_granted', label: 'اعطای جزئی پاداش' },
  { value: 'reward_granted', label: 'پاداش اعطا شد' },
  { value: 'expired', label: 'منقضی شده' },
  { value: 'cancelled', label: 'لغو شده' },
]

const TYPE_OPTIONS = [
  { value: '', label: 'همه انواع' },
  { value: 'user', label: 'کاربر عادی' },
  { value: 'salon_owner', label: 'صاحب سالن' },
  { value: 'worker', label: 'کارمند' },
]

type ReferralStatus = 'awaiting_qualifying_event' | 'partially_granted' | 'reward_granted' | 'expired' | 'cancelled'
type ReferralType = 'user' | 'salon_owner' | 'worker'
type RewardKind = 'wallet_credit' | 'percent_discount' | 'fixed_discount' | 'cashback' | 'loyalty_points'
type BeneficiaryRole = 'referrer' | 'referred'
type RewardStatus = 'granted' | 'reversed'

interface ReferralRow {
  id: string
  referralType: ReferralType
  status: ReferralStatus
  referrerUserId: string
  referrerPhone: string | null
  referredUserId: string
  referredUserPhoneMasked: string
  salonId: string | null
  qualifyingEvent: string
  expiresAt: string | null
  rewardGrantedAt: string | null
  cancelledReason: string | null
  createdAt: string
  referrerRewardKind: RewardKind
  referrerRewardValue: number
  referrerRewardMax: number | null
  referredRewardKind: RewardKind
  referredRewardValue: number
  referredRewardMax: number | null
}

interface ReferralListResponse {
  items: ReferralRow[]
  total: number
  page: number
  pageSize: number
}

// GET /admin/referrals/:id/rewards -- the per-side referral_rewards detail, fetched
// lazily (see loadRewards below), not bundled into the list response.
interface ReferralRewardRow {
  id: string
  beneficiaryRole: BeneficiaryRole
  beneficiaryUserId: string
  rewardKind: RewardKind
  rewardValue: number
  status: RewardStatus
  grantedAt: string
  reversedAt: string | null
  reversalReason: string | null
  reversalShortfallAmount: number | null
  walletTransactionId: string | null
  couponId: string | null
  couponCode: string | null
  couponIsActive: boolean | null
}

const { apiFetch } = useApi()
const referrals = ref<ReferralRow[]>([])
const loading = ref(true)
const page = ref(1)
const total = ref(0)
const pageSize = 20

const statusFilter = ref<'' | ReferralStatus>('')
const typeFilter = ref<'' | ReferralType>('')
const referrerPhoneFilter = ref('')

// Keyed by referral id. Present (even mid-fetch, as `{ loading: true, items: [] }`) once
// a row's details have been expanded at least once -- doubles as the "already
// fetched, don't refetch" cache.
const rewardsByReferral = ref<Record<string, { loading: boolean; items: ReferralRewardRow[] }>>({})

async function load() {
  loading.value = true
  const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) })
  if (statusFilter.value) params.set('status', statusFilter.value)
  if (typeFilter.value) params.set('referralType', typeFilter.value)
  if (referrerPhoneFilter.value.trim()) params.set('referrerPhone', referrerPhoneFilter.value.trim())

  const { data } = await apiFetch<ReferralListResponse>(`/admin/referrals?${params.toString()}`, { silent: true })
  referrals.value = data?.items ?? []
  total.value = data?.total ?? 0
  loading.value = false
}

async function loadRewards(referralId: string) {
  if (rewardsByReferral.value[referralId]) return
  rewardsByReferral.value[referralId] = { loading: true, items: [] }
  const { data } = await apiFetch<ReferralRewardRow[]>(`/admin/referrals/${referralId}/rewards`, { silent: true })
  rewardsByReferral.value[referralId] = { loading: false, items: data ?? [] }
}

function rewardForRole(referralId: string, role: BeneficiaryRole): ReferralRewardRow | undefined {
  return rewardsByReferral.value[referralId]?.items.find((r) => r.beneficiaryRole === role)
}

function loadFromFilterChange() {
  if (page.value !== 1) {
    page.value = 1
  } else {
    load()
  }
}

function onCancelled(id: string, result: { status: string; cancelledReason: string | null }) {
  const row = referrals.value.find((r) => r.id === id)
  if (row) {
    row.status = result.status as ReferralStatus
    row.cancelledReason = result.cancelledReason
  }
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

function formatRewardTerms(kind: RewardKind, value: number, max: number | null): string {
  const unit = rewardKindUnit(kind)
  const base = `${rewardKindLabel(kind)} — ${value.toLocaleString('fa-IR')} ${unit}`
  return max === null ? base : `${base} (تا سقف ${max.toLocaleString('fa-IR')} ${unit})`
}

// The per-side grant detail's coupon-kind value: the ACTUAL resolved discount (post-cap,
// rounded -- referral_rewards.reward_value, see referrals.service.ts's tryGrantReward),
// which can differ from the configured referrer/referredRewardValue terms shown above when
// a max cap applied. Since Slice 6 this can be either a percent (percent_discount) or a
// toman amount (fixed_discount) -- rewardKindUnit already distinguishes them ('٪' vs
// 'تومان'), so this stays a single generic formatter rather than a kind-specific branch.
function formatResolvedRewardValue(kind: RewardKind, value: number): string {
  const unit = rewardKindUnit(kind)
  return unit === '٪' ? `٪${value.toLocaleString('fa-IR')}` : `${value.toLocaleString('fa-IR')} ${unit}`
}

function clearFilters() {
  statusFilter.value = ''
  typeFilter.value = ''
  referrerPhoneFilter.value = ''
}

const hasActiveFilters = computed(() => !!statusFilter.value || !!typeFilter.value || !!referrerPhoneFilter.value)

onMounted(load)
watch(referrerPhoneFilter, debounce(loadFromFilterChange, 350))
watch([statusFilter, typeFilter], loadFromFilterChange)
watch(page, load)
</script>

<template>
  <div class="space-y-5 p-8">
    <AppCard :padded="false" class="p-4">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-muted)">شماره موبایل معرف</label>
          <div class="relative">
            <AppIcon name="phone" :size="15" class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-(--color-muted)" />
            <input
              v-model="referrerPhoneFilter"
              data-testid="referrer-phone-filter"
              placeholder="جست‌وجو…"
              class="w-44 rounded-xl border border-(--color-border) py-2 ps-9 pe-3 text-sm"
            />
          </div>
        </div>

        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-muted)">وضعیت</label>
          <AppSelect v-model="statusFilter" :options="STATUS_OPTIONS" width="12rem" />
        </div>

        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-muted)">نوع معرفی</label>
          <AppSelect v-model="typeFilter" :options="TYPE_OPTIONS" width="10rem" />
        </div>

        <button
          v-if="hasActiveFilters"
          type="button"
          class="mb-2 flex items-center gap-1.5 text-sm font-semibold text-(--color-muted) transition-colors hover:text-(--tone-danger-text)"
          @click="clearFilters"
        >
          <AppIcon name="reset" :size="15" />
          پاک کردن فیلترها
        </button>
      </div>
    </AppCard>

    <EmptyState v-if="!loading && referrals.length === 0" icon="user-plus" message="معرفی‌ای با این فیلترها یافت نشد." />

    <AppCard v-else :padded="false" class="overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-right text-sm">
          <thead>
            <tr class="border-b border-(--color-border) bg-(--color-border-soft) text-xs text-(--color-muted)">
              <th class="px-5 py-3 font-semibold">تاریخ ثبت</th>
              <th class="px-5 py-3 font-semibold">معرف</th>
              <th class="px-5 py-3 font-semibold">معرفی‌شده</th>
              <th class="px-5 py-3 font-semibold">نوع</th>
              <th class="px-5 py-3 font-semibold">وضعیت</th>
              <th class="px-5 py-3 font-semibold">جزئیات</th>
              <th class="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="referral in referrals"
              :key="referral.id"
              data-testid="referral-row"
              class="border-b border-(--color-border-soft) transition-colors last:border-0 hover:bg-(--color-border-soft)"
            >
              <td class="tnum px-5 py-3.5 text-(--color-muted)">{{ formatDateTime(referral.createdAt) }}</td>
              <td class="tnum px-5 py-3.5 text-(--color-text)">{{ referral.referrerPhone ?? '—' }}</td>
              <td class="tnum px-5 py-3.5 text-(--color-text)">{{ referral.referredUserPhoneMasked }}</td>
              <td class="px-5 py-3.5 text-(--color-muted)">{{ referralTypeLabel(referral.referralType) }}</td>
              <td class="px-5 py-3.5">
                <StatusBadge :label="referralStatusLabel(referral.status).label" :tone="referralStatusLabel(referral.status).tone" />
              </td>
              <td class="px-5 py-3.5">
                <details data-testid="referral-details">
                  <summary
                    class="cursor-pointer text-xs font-semibold text-(--color-muted) transition-colors hover:text-(--color-text)"
                    @click="loadRewards(referral.id)"
                  >
                    نمایش
                  </summary>
                  <div class="tnum mt-1.5 max-w-96 space-y-3 rounded-lg bg-(--color-border-soft) p-2.5 text-xs text-(--color-text)">
                    <ul class="space-y-1">
                      <li><span class="text-(--color-muted)">شناسه:</span> {{ referral.id.slice(0, 8) }}…</li>
                      <li><span class="text-(--color-muted)">رویداد شرط:</span> {{ qualifyingEventLabel(referral.qualifyingEvent) }}</li>
                      <li>
                        <span class="text-(--color-muted)">انقضا:</span>
                        {{ referral.expiresAt ? formatDateTime(referral.expiresAt) : 'ندارد' }}
                      </li>
                      <li>
                        <span class="text-(--color-muted)">پاداش اعطا شد:</span>
                        {{ referral.rewardGrantedAt ? formatDateTime(referral.rewardGrantedAt) : '—' }}
                      </li>
                      <li v-if="referral.salonId"><span class="text-(--color-muted)">سالن:</span> {{ referral.salonId.slice(0, 8) }}…</li>
                      <li v-if="referral.cancelledReason" class="whitespace-pre-wrap">
                        <span class="text-(--color-muted)">دلیل لغو:</span> {{ referral.cancelledReason }}
                      </li>
                    </ul>

                    <!-- Reward terms are snapshotted onto the referral row at redemption time (R5)
                         and are always available immediately, no separate fetch needed. -->
                    <div class="space-y-2 border-t border-(--color-border) pt-2">
                      <div v-for="role in (['referrer', 'referred'] as const)" :key="role" data-testid="reward-terms">
                        <p class="font-semibold text-(--color-muted)">{{ role === 'referrer' ? 'پاداش معرف' : 'پاداش معرفی‌شده' }}</p>
                        <p>
                          {{
                            formatRewardTerms(
                              role === 'referrer' ? referral.referrerRewardKind : referral.referredRewardKind,
                              role === 'referrer' ? referral.referrerRewardValue : referral.referredRewardValue,
                              role === 'referrer' ? referral.referrerRewardMax : referral.referredRewardMax,
                            )
                          }}
                        </p>

                        <!-- Per-side referral_rewards detail (GET /admin/referrals/:id/rewards),
                             fetched lazily on first expand of this row (see @click above). -->
                        <p v-if="rewardsByReferral[referral.id]?.loading" class="text-(--color-muted)">در حال بارگذاری…</p>
                        <template v-else-if="rewardsByReferral[referral.id]">
                          <div v-if="rewardForRole(referral.id, role)" :data-testid="`reward-status-${role}`" class="mt-1 space-y-1">
                            <p class="flex items-center gap-1.5">
                              <StatusBadge
                                :label="rewardForRole(referral.id, role)!.status === 'granted' ? 'اعطا شد' : 'برگشت خورد'"
                                :tone="rewardForRole(referral.id, role)!.status === 'granted' ? 'success' : 'danger'"
                              />
                              <span class="text-(--color-muted)">
                                {{ formatDateTime(rewardForRole(referral.id, role)!.status === 'granted' ? rewardForRole(referral.id, role)!.grantedAt : (rewardForRole(referral.id, role)!.reversedAt ?? rewardForRole(referral.id, role)!.grantedAt)) }}
                              </span>
                            </p>
                            <p v-if="rewardForRole(referral.id, role)!.couponId">
                              <span class="text-(--color-muted)">کد تخفیف:</span>
                              <span class="font-mono font-semibold">{{ rewardForRole(referral.id, role)!.couponCode }}</span>
                              <span class="text-(--color-muted)">
                                ({{ formatResolvedRewardValue(rewardForRole(referral.id, role)!.rewardKind, rewardForRole(referral.id, role)!.rewardValue) }})
                              </span>
                              <StatusBadge
                                class="mr-1"
                                :label="rewardForRole(referral.id, role)!.couponIsActive ? 'فعال' : 'غیرفعال'"
                                :tone="rewardForRole(referral.id, role)!.couponIsActive ? 'success' : 'neutral'"
                              />
                            </p>
                            <p v-if="rewardForRole(referral.id, role)!.reversalReason" class="whitespace-pre-wrap text-(--tone-warning-text)">
                              {{ rewardForRole(referral.id, role)!.reversalReason }}
                            </p>
                            <p v-if="rewardForRole(referral.id, role)!.reversalShortfallAmount !== null" class="text-(--tone-danger-text)">
                              کسری بازگشت: {{ rewardForRole(referral.id, role)!.reversalShortfallAmount!.toLocaleString('fa-IR') }} تومان
                            </p>
                          </div>
                          <p v-else class="mt-1 text-(--color-muted)">هنوز اعطا نشده</p>
                        </template>
                      </div>
                    </div>
                  </div>
                </details>
              </td>
              <td class="px-5 py-3.5">
                <CancelReferralAction
                  v-if="referral.status === 'awaiting_qualifying_event'"
                  :referral-id="referral.id"
                  @cancelled="(r) => onCancelled(referral.id, r)"
                  @refresh="load"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="(p) => (page = p)" />
    </AppCard>
  </div>
</template>
