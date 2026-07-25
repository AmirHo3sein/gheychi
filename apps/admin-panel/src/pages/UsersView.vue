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
const users = ref<UserRow[]>([])
const loading = ref(true)
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
  const currentRequestId = ++requestId.value
  const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) })
  if (phoneFilter.value) params.set('phone', phoneFilter.value)
  if (nameFilter.value) params.set('name', nameFilter.value)
  if (roleFilter.value) params.set('role', roleFilter.value)
  // Both bounds are anchored in LOCAL time -- `new Date('YYYY-MM-DD')` alone would parse
  // as UTC midnight and silently exclude 00:00-03:29 local rows on the from-day (UTC+3:30).
  if (joinedFrom.value) params.set('joinedFrom', new Date(`${joinedFrom.value}T00:00:00.000`).toISOString())
  if (joinedTo.value) params.set('joinedTo', new Date(`${joinedTo.value}T23:59:59.999`).toISOString())

  const { data } = await apiFetch<UserListResponse>(`/admin/users?${params.toString()}`, { silent: true })
  if (currentRequestId !== requestId.value) return
  users.value = data?.items ?? []
  total.value = data?.total ?? 0
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
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">بازه عضویت</label>
          <div class="flex items-center gap-1.5">
            <JalaliDatePicker v-model="joinedFrom" placeholder="از تاریخ" aria-label="از تاریخ عضویت" class="w-32" />
            <span class="text-(--color-text-muted)">تا</span>
            <JalaliDatePicker v-model="joinedTo" placeholder="تا تاریخ" aria-label="تا تاریخ عضویت" class="w-32" />
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

    <EmptyState v-if="!loading && users.length === 0" icon="users" message="کاربری با این فیلترها یافت نشد." />

    <AppCard v-else :padded="false" class="overflow-hidden">
      <div class="relative">
        <div
          v-if="loading"
          data-testid="table-loading"
          class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-(--color-surface-card)/70"
        >
          <AppIcon name="spinner" :size="22" class="animate-spin text-(--color-text-muted)" />
        </div>
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
                <SuspendUserButton :user-id="user.id" :status="user.status" :role="user.role" @updated="(u) => onUpdated(u.id, u.status)" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="(p) => (page = p)" />
    </AppCard>
  </div>
</template>
