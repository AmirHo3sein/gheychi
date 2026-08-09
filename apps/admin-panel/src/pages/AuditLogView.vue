<!-- apps/admin-panel/src/pages/AuditLogView.vue -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
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
import { AUDIT_ACTION_KEYS, auditActionLabel, targetTypeLabel } from '@/utils/labels'

// Options derive from labels.ts's canonical key list -- single source of truth with
// the backend's @AuditAction() names, no locally re-declared copy to drift.
const ACTION_OPTIONS = [
  { value: '', label: 'همه اقدامات' },
  ...AUDIT_ACTION_KEYS.map((action) => ({ value: action, label: auditActionLabel(action).label })),
]

// Target types with a real list page in this app -- linked rows go there (not to a
// per-record anchor, since most of these list pages don't support filtering by a raw id).
// Every other target type (story, portfolioitem, category, config, post, blogcategory,
// wallet, referral-reward-type) has no corresponding route and stays inert text.
const TARGET_LIST_ROUTE: Record<string, string> = {
  user: '/users',
  review: '/reviews',
  report: '/reports',
  coupon: '/coupons',
  referral: '/referrals',
  'worker-rating': '/worker-ratings',
}

interface AuditRow {
  id: string
  actorId: string
  actorPhone: string
  actorName: string | null
  action: string
  targetType: string
  targetId: string | null
  payload: Record<string, unknown> | null
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
// Distinct from "genuinely no results": a fetch failure must not be silently repainted as an
// empty list (the operator would read that as "nothing happened", not "the request failed").
const loadError = ref(false)
const page = ref(1)
const total = ref(0)
const pageSize = 20

const actionFilter = ref('')
const actorFilter = ref('')
const fromDate = ref('')
const toDate = ref('')

// Mirrors class-validator's @IsUUID() shape (version nibble 1-8, variant nibble 8/9/a/b),
// so anything we send is guaranteed to pass the backend DTO's validation.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Purely informational -- an inverted range isn't sent differently, the backend just
// correctly returns zero rows either way. This only disambiguates that empty result from
// "nothing happened" (see loadError above) and "invalid range" for the operator.
const dateRangeInverted = computed(
  () => !!fromDate.value && !!toDate.value && toDate.value < fromDate.value,
)

async function load() {
  loading.value = true
  loadError.value = false
  const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) })
  if (actionFilter.value) params.set('action', actionFilter.value)
  // The backend DTO validates actorId with @IsUUID() (400 otherwise), so only send it
  // once the input is a complete UUID; partial input just doesn't filter yet.
  if (UUID_RE.test(actorFilter.value.trim())) params.set('actorId', actorFilter.value.trim())
  // Both bounds are anchored in LOCAL time -- `new Date('YYYY-MM-DD')` alone would parse
  // as UTC midnight and silently exclude 00:00-03:29 local rows on the from-day (UTC+3:30).
  if (fromDate.value) params.set('from', new Date(`${fromDate.value}T00:00:00.000`).toISOString())
  if (toDate.value) params.set('to', new Date(`${toDate.value}T23:59:59.999`).toISOString())

  const { data, error } = await apiFetch<AuditListResponse>(`/admin/audit-log?${params.toString()}`, { silent: true })
  if (error) {
    loadError.value = true
    rows.value = []
    total.value = 0
  } else {
    rows.value = data?.items ?? []
    total.value = data?.total ?? 0
  }
  loading.value = false
}

function loadFromFilterChange() {
  // Any filter change invalidates the current page position. When we're past page 1,
  // just reset it -- the page watcher triggers the (single) reload; calling load() here
  // too would fire a duplicate request.
  if (page.value !== 1) {
    page.value = 1
  } else {
    load()
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

function formatPayload(payload: Record<string, unknown>): string {
  return JSON.stringify(payload, null, 2)
}

/** Salon rows link to their own record (a working per-record route exists); the other
 *  known target types link to their list page instead. Everything else is inert text. */
function targetLink(row: AuditRow): string | null {
  if (row.targetType === 'salon') return row.targetId ? `/salons/${row.targetId}` : null
  return TARGET_LIST_ROUTE[row.targetType] ?? null
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
          <AppSelect v-model="actionFilter" :options="ACTION_OPTIONS" label="اقدام" width="13rem" searchable />
        </div>
        <AppInput
          v-model="actorFilter"
          icon="search"
          label="شناسه مدیر (UUID)"
          placeholder="شناسه کامل را وارد کنید"
          dir="ltr"
          class="w-52"
        />
        <fieldset class="min-w-0 border-0 p-0">
          <legend class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">بازه زمانی</legend>
          <!-- See UsersView.vue: the from/to pair is a nested flex row that would otherwise stay
               one unbreakable ~19rem block, the widest item in this bar. Wrapping only ever
               engages below that width, so the desk-sized rendering is unchanged. -->
          <div class="flex flex-wrap items-center gap-1.5">
            <JalaliDatePicker v-model="fromDate" placeholder="از تاریخ" class="w-40" />
            <span class="text-(--color-text-muted)">تا</span>
            <JalaliDatePicker v-model="toDate" placeholder="تا تاریخ" class="w-40" />
          </div>
          <p v-if="dateRangeInverted" class="mt-1.5 text-xs text-(--color-danger)">
            تاریخ پایان باید بعد از تاریخ شروع باشد.
          </p>
        </fieldset>
        <AppButton
          v-if="hasActiveFilters"
          variant="ghost"
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
      <p class="text-sm text-(--color-text-muted)">خطا در دریافت تاریخچه اقدامات.</p>
      <AppButton type="button" variant="secondary" data-testid="retry-load" @click="load">تلاش دوباره</AppButton>
    </AppCard>

    <EmptyState v-else-if="!loading && rows.length === 0" icon="history" message="اقدامی با این فیلترها ثبت نشده است." />

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
             trailing columns. This is the widest table in the app (six columns, one of them a
             payload block), so it is the first to need the scroller. Desktop is untouched: no
             scrollbar exists while the table fits, which is the ≥1280px case this app
             optimizes for. -->
        <div class="overflow-x-auto">
          <table class="w-full text-right text-sm transition-opacity" :class="{ 'opacity-50': loading }">
            <thead>
              <tr class="border-b border-(--color-border) bg-(--color-border-soft) text-xs text-(--color-text-muted)">
                <th class="px-5 py-3 font-semibold">زمان</th>
                <th class="px-5 py-3 font-semibold">مدیر</th>
                <th class="px-5 py-3 font-semibold">اقدام</th>
                <th class="px-5 py-3 font-semibold">هدف</th>
                <th class="px-5 py-3 font-semibold">جزئیات</th>
                <th class="px-5 py-3 font-semibold">نتیجه</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in rows"
                :key="row.id"
                class="border-b border-(--color-border-soft) transition-colors last:border-0 hover:bg-(--color-border-soft)"
              >
                <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ formatDateTime(row.createdAt) }}</td>
                <td class="px-5 py-3.5">
                  <p class="font-semibold text-(--color-text)">{{ row.actorName ?? '—' }}</p>
                  <p class="tnum text-xs text-(--color-text-muted)">{{ row.actorPhone }}</p>
                </td>
                <td class="px-5 py-3.5">
                  <StatusBadge :label="auditActionLabel(row.action).label" :tone="auditActionLabel(row.action).tone" />
                </td>
                <td class="px-5 py-3.5">
                  <RouterLink
                    v-if="targetLink(row)"
                    :to="targetLink(row)!"
                    class="font-semibold text-(--color-text) hover:text-(--color-accent-text)"
                  >
                    {{ targetTypeLabel(row.targetType) }}
                  </RouterLink>
                  <span v-else class="text-(--color-text-muted)">{{ targetTypeLabel(row.targetType) }}</span>
                  <p v-if="row.targetId" dir="ltr" class="tnum text-right text-xs text-(--color-text-muted)">
                    {{ row.targetId.slice(0, 8) }}…
                  </p>
                </td>
                <td data-testid="payload-cell" class="px-5 py-3.5">
                  <!-- Text interpolation only (never v-html) -- payloads contain user-supplied text. -->
                  <details v-if="row.payload" data-testid="payload-details">
                    <summary class="cursor-pointer text-xs font-semibold text-(--color-text-muted) transition-colors hover:text-(--color-text)">
                      نمایش
                    </summary>
                    <!-- max-w-64 caps the column's contribution to the table's min-content width;
                         the pre keeps its own inner scroller so a long payload line still can't
                         widen the row. -->
                    <pre
                      dir="ltr"
                      class="mt-1.5 max-h-40 max-w-64 overflow-x-auto overflow-y-auto rounded-2xl bg-(--color-border-soft) p-2 text-left text-xs text-(--color-text-muted)"
                    >{{ formatPayload(row.payload) }}</pre>
                  </details>
                  <span v-else class="text-(--color-text-muted)">—</span>
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
        </div>
      </div>
      <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="(p) => (page = p)" />
    </AppCard>
  </div>
</template>
