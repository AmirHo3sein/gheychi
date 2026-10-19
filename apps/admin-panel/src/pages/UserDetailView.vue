<!-- apps/admin-panel/src/pages/UserDetailView.vue -->
<!-- One account, for support: who they are, the salon they own or work at, their own
     bookings, wallet balance, and the admin actions already taken on the account
     (GET /admin/users/:id -- every figure counted from the source tables). The only action
     here is the same suspend/reactivate control the users list has; everything else links
     to the screen that owns it (salon page, booking timeline, bookings list, audit log). -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useApi } from '@/composables/useApi'
import SuspendUserButton from '@/components/users/SuspendUserButton.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { useSessionStore } from '@/stores/session'
import { toPersianDigits } from '@/utils/digits'
import { formatToman } from '@/utils/format-toman'
import { auditActionLabel, bookingStatusLabel, salonStatusLabel, userRoleLabel, userStatusLabel } from '@/utils/labels'

interface UserDetail {
  user: { id: string; phone: string; name: string | null; gender: 'female' | 'male' | null; role: 'customer' | 'provider' | 'admin'; status: 'active' | 'suspended'; createdAt: string }
  salon: { id: string; name: string; slug: string; status: string } | null
  workerAt: Array<{ salonId: string; salonName: string; active: boolean }>
  bookings: {
    total: number
    byStatus: Record<string, number>
    recent: Array<{ id: string; startsAt: string; status: string; salonId: string; salonName: string; serviceName: string; priceSnapshot: number }>
  }
  wallet: { toman: number; points: number }
  reviewsCount: number
  activity: Array<{
    id: string
    action: string
    success: boolean
    createdAt: string
    actor: { id: string; name: string | null; phone: string | null }
    status: string | null
    amount: number | null
    currency: string | null
    reason: string | null
  }>
}

const route = useRoute()
const { apiFetch } = useApi()
const session = useSessionStore()

const detail = ref<UserDetail | null>(null)
const loading = ref(true)
const loadError = ref(false)
const notFound = ref(false)

const userId = computed(() => String(route.params.id ?? ''))
let requestSeq = 0

async function load() {
  const seq = ++requestSeq
  loading.value = true
  loadError.value = false
  notFound.value = false
  const { data, error } = await apiFetch<UserDetail>(`/admin/users/${encodeURIComponent(userId.value)}`, { silent: true })
  if (seq !== requestSeq) return
  loading.value = false
  if (error) {
    // A malformed id (400) is as "not found" as an unknown one (404) from the admin's side.
    if (error.status === 404 || error.status === 400) notFound.value = true
    else loadError.value = true
    detail.value = null
    return
  }
  detail.value = data
}

onMounted(load)
watch(userId, load)

const isSelf = computed(() => detail.value?.user.id === session.user?.id)

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso))
}
function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

const GENDER: Record<string, string> = { female: 'زن', male: 'مرد' }

/** Status counts, largest first, for the bookings summary. */
const statusCounts = computed(() =>
  Object.entries(detail.value?.bookings.byStatus ?? {})
    .map(([status, count]) => ({ status, count, ...bookingStatusLabel(status) }))
    .sort((a, b) => b.count - a.count),
)

function activitySummary(a: UserDetail['activity'][number]): string {
  if (a.action === 'user.status.set' && a.status) return `وضعیت: ${userStatusLabel(a.status).label}`
  if (a.action === 'wallet.adjust' && a.amount !== null) {
    const sign = a.amount > 0 ? 'افزایش' : 'کاهش'
    const unit = a.currency === 'points' ? 'امتیاز' : 'تومان'
    return `${sign} ${formatToman(Math.abs(a.amount))} ${unit}${a.reason ? ` — ${a.reason}` : ''}`
  }
  return ''
}

function onStatusUpdated(status: string) {
  if (detail.value) detail.value.user.status = status as UserDetail['user']['status']
  // The new audit row is the latest activity; re-read so the timeline shows it.
  void load()
}
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
    <RouterLink to="/users" class="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-(--color-text-muted) hover:text-(--color-text)">
      <AppIcon name="chevron-right" :size="16" />
      بازگشت به کاربران
    </RouterLink>

    <div v-if="loading && !detail" data-testid="user-loading" class="flex justify-center py-20">
      <AppIcon name="spinner" :size="28" class="animate-spin text-(--color-accent-text)" />
    </div>

    <EmptyState v-else-if="notFound" icon="warning" message="کاربر یافت نشد." data-testid="user-not-found" />

    <AppCard
      v-else-if="loadError"
      :padded="false"
      data-testid="user-load-error"
      class="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center"
    >
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-(--tone-danger-bg) text-(--tone-danger-text)">
        <AppIcon name="warning" :size="22" />
      </div>
      <p class="text-sm text-(--color-text-muted)">بارگذاری اطلاعات کاربر با خطا مواجه شد.</p>
      <AppButton type="button" variant="secondary" data-testid="user-load-retry" @click="load">تلاش مجدد</AppButton>
    </AppCard>

    <template v-else-if="detail">
      <!-- Identity + the one action. -->
      <AppCard>
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="flex min-w-0 flex-1 items-start gap-3">
            <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--color-border-soft) text-(--color-accent-text)">
              <AppIcon name="user" :size="22" />
            </div>
            <div class="min-w-0">
              <h1 class="text-lg font-bold break-words text-(--color-text)" data-testid="user-name">{{ detail.user.name ?? 'بدون نام' }}</h1>
              <p class="tnum mt-0.5 text-sm text-(--color-text-muted)" dir="ltr" style="text-align: end">{{ toPersianDigits(detail.user.phone) }}</p>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge :label="userStatusLabel(detail.user.status).label" :tone="userStatusLabel(detail.user.status).tone" data-testid="user-status" />
                <span class="rounded-full bg-(--color-border-soft) px-2.5 py-0.5 text-xs font-semibold text-(--color-text-muted)">{{ userRoleLabel(detail.user.role) }}</span>
              </div>
            </div>
          </div>
          <span v-if="isSelf" class="text-xs text-(--color-text-muted)" data-testid="self-hint">حساب شما</span>
          <SuspendUserButton
            v-else
            :user-id="detail.user.id"
            :status="detail.user.status"
            :role="detail.user.role"
            @updated="(u) => onStatusUpdated(u.status)"
          />
        </div>

        <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-(--color-border-soft) pt-4 text-sm sm:grid-cols-4">
          <div>
            <dt class="text-xs text-(--color-text-muted)">تاریخ عضویت</dt>
            <dd class="tnum mt-0.5 font-semibold text-(--color-text)">{{ formatDate(detail.user.createdAt) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-(--color-text-muted)">جنسیت</dt>
            <dd class="mt-0.5 font-semibold text-(--color-text)">{{ detail.user.gender ? GENDER[detail.user.gender] : 'ثبت نشده' }}</dd>
          </div>
          <div>
            <dt class="text-xs text-(--color-text-muted)">موجودی کیف پول</dt>
            <dd class="tnum mt-0.5 font-semibold text-(--color-text)" data-testid="user-wallet">{{ formatToman(detail.wallet.toman) }} تومان</dd>
          </div>
          <div>
            <dt class="text-xs text-(--color-text-muted)">نظرهای ثبت‌شده</dt>
            <dd class="tnum mt-0.5 font-semibold text-(--color-text)">{{ formatToman(detail.reviewsCount) }}</dd>
          </div>
        </dl>
      </AppCard>

      <div class="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <!-- Bookings as a customer. -->
        <AppCard :padded="false" class="overflow-hidden" data-testid="user-bookings">
          <div class="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
            <h2 class="font-bold text-(--color-text)">نوبت‌های این کاربر</h2>
            <RouterLink
              v-if="detail.bookings.total"
              :to="{ name: 'bookings', query: { userId: detail.user.id } }"
              data-testid="user-bookings-all"
              class="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-(--color-accent-text) hover:underline"
            >
              همهٔ {{ formatToman(detail.bookings.total) }} نوبت
              <AppIcon name="chevron-left" :size="14" />
            </RouterLink>
          </div>

          <p v-if="!detail.bookings.total" class="px-4 pt-2 pb-5 text-sm text-(--color-text-muted)">این کاربر هنوز نوبتی نگرفته است.</p>
          <template v-else>
            <ul class="flex flex-wrap gap-1.5 px-4 pt-3" aria-label="تعداد نوبت‌ها بر اساس وضعیت">
              <li v-for="s in statusCounts" :key="s.status">
                <StatusBadge :label="`${s.label}: ${formatToman(s.count)}`" :tone="s.tone" />
              </li>
            </ul>
            <ul class="mt-3 divide-y divide-(--color-border-soft) border-t border-(--color-border-soft)">
              <li v-for="b in detail.bookings.recent" :key="b.id">
                <RouterLink
                  :to="{ name: 'booking-timeline', params: { id: b.id } }"
                  data-testid="user-booking-row"
                  class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-(--color-border-soft)"
                >
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-semibold text-(--color-text)">{{ b.serviceName }} · {{ b.salonName }}</p>
                    <p class="tnum mt-0.5 text-xs text-(--color-text-muted)">{{ formatDateTime(b.startsAt) }} · {{ formatToman(b.priceSnapshot) }} تومان</p>
                    <!-- Phones: the badge goes under the text so the names keep the width. -->
                    <StatusBadge :label="bookingStatusLabel(b.status).label" :tone="bookingStatusLabel(b.status).tone" class="mt-1.5 sm:hidden" />
                  </div>
                  <StatusBadge :label="bookingStatusLabel(b.status).label" :tone="bookingStatusLabel(b.status).tone" class="shrink-0 max-sm:hidden" />
                  <AppIcon name="chevron-left" :size="16" class="shrink-0 text-(--color-text-muted)" />
                </RouterLink>
              </li>
            </ul>
            <p v-if="detail.bookings.total > detail.bookings.recent.length" class="border-t border-(--color-border-soft) px-4 py-2.5 text-xs text-(--color-text-muted)">
              {{ toPersianDigits(detail.bookings.recent.length) }} نوبت آخر نمایش داده شده است.
            </p>
          </template>
        </AppCard>

        <div class="space-y-5">
          <!-- Salon owned / worked at. -->
          <AppCard data-testid="user-salons">
            <h2 class="font-bold text-(--color-text)">سالن</h2>
            <p v-if="!detail.salon && !detail.workerAt.length" class="mt-2 text-sm text-(--color-text-muted)">مالک یا کارمند هیچ سالنی نیست.</p>
            <ul v-else class="mt-2 space-y-1">
              <li v-if="detail.salon">
                <RouterLink :to="`/salons/${detail.salon.id}`" data-testid="user-owned-salon" class="flex min-h-11 items-center gap-2 rounded-lg px-2 -mx-2 hover:bg-(--color-border-soft)">
                  <AppIcon name="building" :size="16" class="shrink-0 text-(--color-accent-text)" />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-semibold text-(--color-text)">{{ detail.salon.name }}</span>
                    <span class="text-xs text-(--color-text-muted)">مالک</span>
                  </span>
                  <StatusBadge :label="salonStatusLabel(detail.salon.status).label" :tone="salonStatusLabel(detail.salon.status).tone" />
                </RouterLink>
              </li>
              <li v-for="w in detail.workerAt" :key="w.salonId">
                <RouterLink :to="`/salons/${w.salonId}`" class="flex min-h-11 items-center gap-2 rounded-lg px-2 -mx-2 hover:bg-(--color-border-soft)">
                  <AppIcon name="scissors" :size="16" class="shrink-0 text-(--color-text-muted)" />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-semibold text-(--color-text)">{{ w.salonName }}</span>
                    <span class="text-xs text-(--color-text-muted)">کارمند{{ w.active ? '' : ' (غیرفعال)' }}</span>
                  </span>
                </RouterLink>
              </li>
            </ul>
          </AppCard>

          <!-- Admin actions on the account. -->
          <AppCard data-testid="user-activity">
            <h2 class="font-bold text-(--color-text)">اقدامات مدیران روی این حساب</h2>
            <p v-if="!detail.activity.length" class="mt-2 text-sm text-(--color-text-muted)">تاکنون اقدامی ثبت نشده است.</p>
            <ol v-else class="mt-3 space-y-3">
              <li v-for="a in detail.activity" :key="a.id" class="border-s-2 border-(--color-border) ps-3" data-testid="user-activity-row">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="text-sm font-semibold text-(--color-text)">{{ auditActionLabel(a.action).label }}</span>
                  <StatusBadge v-if="!a.success" label="ناموفق" tone="danger" />
                </div>
                <p v-if="activitySummary(a)" class="mt-0.5 text-xs break-words text-(--color-text)">{{ activitySummary(a) }}</p>
                <p class="tnum mt-0.5 text-xs text-(--color-text-muted)">
                  {{ a.actor.name ?? (a.actor.phone ? toPersianDigits(a.actor.phone) : 'مدیر') }} · {{ formatDateTime(a.createdAt) }}
                </p>
              </li>
            </ol>
          </AppCard>
        </div>
      </div>
    </template>
  </div>
</template>
