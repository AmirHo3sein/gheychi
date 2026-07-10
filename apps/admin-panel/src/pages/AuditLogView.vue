<!-- apps/admin-panel/src/pages/AuditLogView.vue -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'
import Pagination from '@/components/ui/Pagination.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { debounce } from '@/utils/debounce'
import { auditActionLabel } from '@/utils/labels'

// The nine audited admin mutations -- keep in sync with the backend's @AuditAction() names.
const AUDIT_ACTIONS = [
  'salon.status.set',
  'salon.featured.set',
  'user.status.set',
  'review.moderate',
  'category.create',
  'category.update',
  'category.delete',
  'config.update',
  'report.resolve',
]

const ACTION_OPTIONS = [
  { value: '', label: 'همه اقدامات' },
  ...AUDIT_ACTIONS.map((action) => ({ value: action, label: auditActionLabel(action).label })),
]

const TARGET_TYPE_FA: Record<string, string> = {
  salon: 'آرایشگاه',
  user: 'کاربر',
  review: 'نظر',
  category: 'دسته‌بندی',
  config: 'تنظیمات',
  report: 'گزارش',
}

interface AuditRow {
  id: string
  actorId: string
  actorPhone: string
  actorName: string | null
  action: string
  targetType: string
  targetId: string | null
  success: boolean
  createdAt: string
}

interface AuditListResponse {
  items: AuditRow[]
  total: number
  page: number
  pageSize: number
}

const { apiFetch } = useApi()
const rows = ref<AuditRow[]>([])
const loading = ref(true)
const page = ref(1)
const total = ref(0)
const pageSize = 20

const actionFilter = ref('')
const actorFilter = ref('')
const fromDate = ref('')
const toDate = ref('')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function load() {
  loading.value = true
  const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) })
  if (actionFilter.value) params.set('action', actionFilter.value)
  // The backend DTO validates actorId with @IsUUID() (400 otherwise), so only send it
  // once the input is a complete UUID; partial input just doesn't filter yet.
  if (UUID_RE.test(actorFilter.value.trim())) params.set('actorId', actorFilter.value.trim())
  if (fromDate.value) params.set('from', new Date(fromDate.value).toISOString())
  if (toDate.value) params.set('to', new Date(`${toDate.value}T23:59:59.999`).toISOString())

  const { data } = await apiFetch<AuditListResponse>(`/admin/audit-log?${params.toString()}`, { silent: true })
  rows.value = data?.items ?? []
  total.value = data?.total ?? 0
  loading.value = false
}

function loadFromFilterChange() {
  page.value = 1 // any filter change invalidates the current page position
  load()
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

function targetLabel(row: AuditRow): string {
  return TARGET_TYPE_FA[row.targetType] ?? row.targetType
}

function clearFilters() {
  actionFilter.value = ''
  actorFilter.value = ''
  fromDate.value = ''
  toDate.value = ''
}

const hasActiveFilters = computed(
  () => !!actionFilter.value || !!actorFilter.value || !!fromDate.value || !!toDate.value,
)

onMounted(load)
// actorFilter is free-text (fires per keystroke) -- debounced like SalonsView's name filter.
watch(actorFilter, debounce(loadFromFilterChange, 350))
watch([actionFilter, fromDate, toDate], loadFromFilterChange)
watch(page, load)
</script>

<template>
  <div class="space-y-5 p-8">
    <AppCard :padded="false" class="p-4">
      <div class="flex flex-wrap items-end gap-3">
        <div data-testid="action-filter">
          <label class="mb-1.5 block text-xs font-semibold text-(--color-muted)">اقدام</label>
          <AppSelect v-model="actionFilter" :options="ACTION_OPTIONS" width="13rem" />
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-muted)">شناسه مدیر (UUID)</label>
          <div class="relative">
            <AppIcon name="search" :size="16" class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-(--color-muted)" />
            <input
              v-model="actorFilter"
              placeholder="شناسه کامل را وارد کنید"
              class="w-52 rounded-xl border border-(--color-border) py-2 ps-9 pe-3 text-sm"
              dir="ltr"
            />
          </div>
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-muted)">بازه زمانی</label>
          <div class="flex items-center gap-1.5">
            <JalaliDatePicker v-model="fromDate" placeholder="از تاریخ" class="w-32" />
            <span class="text-(--color-muted)">تا</span>
            <JalaliDatePicker v-model="toDate" placeholder="تا تاریخ" class="w-32" />
          </div>
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

    <EmptyState v-if="!loading && rows.length === 0" icon="history" message="اقدامی با این فیلترها ثبت نشده است." />

    <AppCard v-else :padded="false" class="overflow-hidden">
      <table class="w-full text-right text-sm">
        <thead>
          <tr class="border-b border-(--color-border) bg-(--color-border-soft) text-xs text-(--color-muted)">
            <th class="px-5 py-3 font-semibold">زمان</th>
            <th class="px-5 py-3 font-semibold">مدیر</th>
            <th class="px-5 py-3 font-semibold">اقدام</th>
            <th class="px-5 py-3 font-semibold">هدف</th>
            <th class="px-5 py-3 font-semibold">نتیجه</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.id"
            class="border-b border-(--color-border-soft) transition-colors last:border-0 hover:bg-(--color-border-soft)"
          >
            <td class="tnum px-5 py-3.5 text-(--color-muted)">{{ formatDateTime(row.createdAt) }}</td>
            <td class="px-5 py-3.5">
              <p class="font-semibold text-(--color-text)">{{ row.actorName ?? '—' }}</p>
              <p class="tnum text-xs text-(--color-muted)">{{ row.actorPhone }}</p>
            </td>
            <td class="px-5 py-3.5">
              <StatusBadge :label="auditActionLabel(row.action).label" :tone="auditActionLabel(row.action).tone" />
            </td>
            <td class="px-5 py-3.5">
              <RouterLink
                v-if="row.targetType === 'salon' && row.targetId"
                :to="`/salons/${row.targetId}`"
                class="font-semibold text-(--color-text) hover:text-(--color-accent)"
              >
                {{ targetLabel(row) }}
              </RouterLink>
              <span v-else class="text-(--color-muted)">{{ targetLabel(row) }}</span>
              <p v-if="row.targetId" dir="ltr" class="tnum text-right text-xs text-(--color-muted)">
                {{ row.targetId.slice(0, 8) }}…
              </p>
            </td>
            <td class="px-5 py-3.5">
              <StatusBadge
                data-testid="success-badge"
                :label="row.success ? 'موفق' : 'ناموفق'"
                :tone="row.success ? 'success' : 'danger'"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="(p) => (page = p)" />
    </AppCard>
  </div>
</template>
