<!-- apps/admin-panel/src/pages/UsersView.vue -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import SuspendUserButton from '@/components/users/SuspendUserButton.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'
import Pagination from '@/components/ui/Pagination.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { useSessionStore } from '@/stores/session'
import { debounce } from '@/utils/debounce'
import { userRoleLabel, userStatusLabel } from '@/utils/labels'

const ROLE_OPTIONS = [
  { value: '', label: 'همه نقش‌ها' },
  { value: 'customer', label: 'مشتری' },
  { value: 'provider', label: 'آرایشگاه‌دار' },
  { value: 'admin', label: 'مدیر' },
]

interface UserRow {
  id: string
  phone: string
  name: string | null
  role: 'customer' | 'provider' | 'admin'
  status: 'active' | 'suspended'
  createdAt: string
}

interface UserListResponse {
  items: UserRow[]
  total: number
  page: number
  pageSize: number
}

const { apiFetch } = useApi()
const session = useSessionStore()
// AdminUsersService.setStatus rejects a self-targeted change outright (400), so the acting
// admin's own row must not offer the control at all -- otherwise the only way to learn that
// is to click it and read an error. Also removes the "did I just lock myself out?" moment.
const isSelf = (userId: string) => userId === session.user?.id
const users = ref<UserRow[]>([])
const loading = ref(true)
// A fetch failure must not be silently repainted as an empty state -- see
// SalonsView.vue's identical loadError pattern.
const loadError = ref(false)
const page = ref(1)
const total = ref(0)
const pageSize = 20

const phoneFilter = ref('')
const nameFilter = ref('')
const roleFilter = ref<'' | 'customer' | 'provider' | 'admin'>('')
const joinedFrom = ref('')
const joinedTo = ref('')

// Guards against out-of-order responses: two watchers (debounced text filters, immediate
// role/date filters) can both call load() in quick succession, and a slower earlier request
// could resolve after a faster later one. Only the response matching the latest request id
// is committed; anything stale is dropped silently.
const requestId = ref(0)

async function load() {
  loading.value = true
  loadError.value = false
  const currentRequestId = ++requestId.value
  const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) })
  if (phoneFilter.value) params.set('phone', phoneFilter.value)
  if (nameFilter.value) params.set('name', nameFilter.value)
  if (roleFilter.value) params.set('role', roleFilter.value)
  // Both bounds are anchored in LOCAL time -- `new Date('YYYY-MM-DD')` alone would parse
  // as UTC midnight and silently exclude 00:00-03:29 local rows on the from-day (UTC+3:30).
  if (joinedFrom.value) params.set('joinedFrom', new Date(`${joinedFrom.value}T00:00:00.000`).toISOString())
  if (joinedTo.value) params.set('joinedTo', new Date(`${joinedTo.value}T23:59:59.999`).toISOString())

  const { data, error } = await apiFetch<UserListResponse>(`/admin/users?${params.toString()}`, { silent: true })
  if (currentRequestId !== requestId.value) return
  if (error) {
    loadError.value = true
    users.value = []
    total.value = 0
  } else {
    users.value = data?.items ?? []
    total.value = data?.total ?? 0
  }
  loading.value = false
}

function loadFromFilterChange() {
  // Any filter change invalidates the current page position. When we're past page 1, just
  // reset it -- the page watcher below triggers the (single) reload; calling load() here too
  // would fire a redundant concurrent second request.
  if (page.value !== 1) {
    page.value = 1
  } else {
    load()
  }
}

function onUpdated(userId: string, status: string) {
  const user = users.value.find((u) => u.id === userId)
  if (user) user.status = status as UserRow['status']
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso))
}

function clearFilters() {
  phoneFilter.value = ''
  nameFilter.value = ''
  roleFilter.value = ''
  joinedFrom.value = ''
  joinedTo.value = ''
}

const hasActiveFilters = computed(
  () => !!phoneFilter.value || !!nameFilter.value || !!roleFilter.value || !!joinedFrom.value || !!joinedTo.value,
)

onMounted(load)
watch([phoneFilter, nameFilter], debounce(loadFromFilterChange, 350))
watch([roleFilter, joinedFrom, joinedTo], loadFromFilterChange)
watch(page, load)
</script>

<template>
  <div class="space-y-5 p-8">
    <AppCard :padded="false" class="p-4">
      <div class="flex flex-wrap items-end gap-3">
        <div class="w-48">
          <AppInput v-model="phoneFilter" icon="phone" label="شماره موبایل" placeholder="جست‌وجو…" />
        </div>
        <div class="w-40">
          <AppInput v-model="nameFilter" label="نام" placeholder="همه" />
        </div>
        <AppSelect v-model="roleFilter" :options="ROLE_OPTIONS" label="نقش" width="10rem" />
        <div class="min-w-0">
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">بازه عضویت</label>
          <!-- The outer filter row wraps, but this from/to pair is a nested flex row of its own
               and would otherwise stay one unbreakable ~19rem block -- the single widest item in
               the bar, and the first thing to push past the card on a narrow window. flex-wrap
               lets the second picker drop below the first instead; both fit on one line from
               ~19rem of filter-bar width up, so nothing changes on a desk-sized screen. -->
          <div class="flex flex-wrap items-center gap-1.5">
            <JalaliDatePicker v-model="joinedFrom" placeholder="از تاریخ" aria-label="از تاریخ عضویت" class="w-40" />
            <span class="text-(--color-text-muted)">تا</span>
            <JalaliDatePicker v-model="joinedTo" placeholder="تا تاریخ" aria-label="تا تاریخ عضویت" class="w-40" />
          </div>
        </div>
        <AppButton v-if="hasActiveFilters" type="button" variant="ghost" class="mb-2" @click="clearFilters">
          <template #icon>
            <AppIcon name="reset" :size="15" />
          </template>
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
      <p class="text-sm text-(--color-text-muted)">خطا در دریافت فهرست کاربران.</p>
      <AppButton type="button" variant="secondary" data-testid="retry-load" @click="load">تلاش دوباره</AppButton>
    </AppCard>

    <EmptyState v-else-if="!loading && users.length === 0" icon="users" message="کاربری با این فیلترها یافت نشد." />

    <AppCard v-else :padded="false" class="overflow-hidden">
      <div class="relative">
        <div
          v-if="loading"
          data-testid="table-loading"
          class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-(--color-surface-card)/70"
        >
          <AppIcon name="spinner" :size="22" class="animate-spin text-(--color-text-muted)" />
        </div>
        <!-- The table gets its OWN horizontal scroller (CouponsView.vue's idiom). Without it a
             table narrower than its min-content width doesn't shrink -- it overflows the card,
             and AppCard's overflow-hidden (there for the rounded corners) then CLIPS the
             trailing columns. Here that trailing column is the suspend/reactivate control, so
             the clipping made a real action unreachable. Desktop is untouched: no scrollbar
             exists while the table fits, which is the ≥1280px case this app optimizes for. -->
        <div class="overflow-x-auto">
          <table class="w-full text-right text-sm transition-opacity" :class="{ 'opacity-50': loading }">
            <thead>
              <tr class="border-b border-(--color-border) bg-(--color-border-soft) text-xs text-(--color-text-muted)">
                <th class="px-5 py-3 font-semibold">نام</th>
                <th class="px-5 py-3 font-semibold">موبایل</th>
                <th class="px-5 py-3 font-semibold">نقش</th>
                <th class="px-5 py-3 font-semibold">تاریخ عضویت</th>
                <th class="px-5 py-3 font-semibold">وضعیت</th>
                <th class="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="user in users"
                :key="user.id"
                class="border-b border-(--color-border-soft) transition-colors last:border-0 hover:bg-(--color-border-soft)"
              >
                <td class="px-5 py-3.5 font-semibold text-(--color-text)">{{ user.name ?? '—' }}</td>
                <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ user.phone }}</td>
                <td class="px-5 py-3.5 text-(--color-text-muted)">{{ userRoleLabel(user.role) }}</td>
                <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ formatDate(user.createdAt) }}</td>
                <td class="px-5 py-3.5">
                  <StatusBadge :label="userStatusLabel(user.status).label" :tone="userStatusLabel(user.status).tone" />
                </td>
                <td class="px-5 py-3.5">
                  <span v-if="isSelf(user.id)" data-testid="self-row-hint" class="text-xs text-(--color-text-muted)">
                    حساب شما
                  </span>
                  <SuspendUserButton
                    v-else
                    :user-id="user.id"
                    :status="user.status"
                    :role="user.role"
                    @updated="(u) => onUpdated(u.id, u.status)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="(p) => (page = p)" />
    </AppCard>
  </div>
</template>
