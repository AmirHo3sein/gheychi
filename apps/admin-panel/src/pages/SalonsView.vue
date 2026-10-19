<!-- apps/admin-panel/src/pages/SalonsView.vue -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import { useCities } from '@/composables/useCities'
import { useQueryFilters } from '@/composables/useQueryFilters'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ScrollTable from '@/components/ui/ScrollTable.vue'
import Pagination from '@/components/ui/Pagination.vue'
import SortableTh from '@/components/ui/SortableTh.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { debounce } from '@/utils/debounce'
import { genderTargetLabel, salonStatusLabel } from '@/utils/labels'
import { STACKED_CELL, STACKED_CELL_PLAIN, STACKED_ROW, STACKED_TABLE, STACKED_TBODY, STACKED_THEAD } from '@/utils/stacked-table'
import { SORT_ORDERS, type SortOrder } from '@/utils/table-sort'

const SALON_SORTS = ['createdAt', 'name', 'city'] as const
type SalonSort = (typeof SALON_SORTS)[number]
// Phones stack the table into cards, which hides the header row -- this select is the same
// sort choice for them (`sort:order` pairs).
const MOBILE_SORT_OPTIONS = [
  { value: 'createdAt:asc', label: 'قدیمی‌ترین ثبت' },
  { value: 'createdAt:desc', label: 'جدیدترین ثبت' },
  { value: 'name:asc', label: 'نام (الف تا ی)' },
  { value: 'name:desc', label: 'نام (ی تا الف)' },
  { value: 'city:asc', label: 'شهر (الف تا ی)' },
  { value: 'city:desc', label: 'شهر (ی تا الف)' },
]

const GENDER_OPTIONS = [
  { value: '', label: 'همه مخاطب‌ها' },
  { value: 'women', label: 'بانوان' },
  { value: 'men', label: 'آقایان' },
]
const STATUS_OPTIONS = [
  { value: 'all', label: 'همه وضعیت‌ها' },
  { value: 'pending', label: 'در انتظار بررسی' },
  { value: 'approved', label: 'تایید شده' },
  { value: 'rejected', label: 'رد شده' },
  { value: 'suspended', label: 'معلق' },
]

// Live, canonical GET /cities (via useCities), not a hand-maintained static duplicate --
// see useCities.ts for the full rationale.
const { cityOptions, loading: citiesLoading, error: citiesError, load: loadCities } = useCities()
const CITY_OPTIONS = computed(() => [{ value: '', label: 'همه شهرها' }, ...cityOptions.value])

interface SalonRow {
  id: string
  name: string
  city: string
  status: 'pending' | 'approved' | 'rejected' | 'suspended'
  genderTarget: 'women' | 'men'
  isFeatured: boolean
  // The paid window's end. NULL means "featured with no end date" -- not "not featured";
  // the flag and the window are two separate facts and both gate the boost (see below).
  featuredUntil: string | null
  createdAt: string
}

interface SalonListResponse {
  items: SalonRow[]
  total: number
  page: number
  pageSize: number
}

const { apiFetch } = useApi()
const salons = ref<SalonRow[]>([])
const loading = ref(true)
// Distinct from "genuinely no results": a fetch failure must not be silently repainted as an
// empty list (the operator would read that as "no salons match", not "the request failed").
const loadError = ref(false)
const total = ref(0)
const pageSize = 20

type StatusValue = 'all' | 'pending' | 'approved' | 'rejected' | 'suspended'
// Kept in the URL (useQueryFilters) so returning from a salon's page restores the list exactly,
// and the dashboard can deep-link to /salons?status=pending.
const {
  page,
  status: statusFilter,
  city: cityFilter,
  name: nameFilter,
  gender: genderFilter,
  sort,
  order,
  changedByUrl,
} = useQueryFilters(
  { page: 1, status: 'all' as StatusValue, city: '', name: '', gender: '' as '' | 'women' | 'men', sort: 'createdAt' as SalonSort, order: 'asc' as SortOrder },
  { allowed: { status: STATUS_OPTIONS.map((o) => o.value), gender: ['women', 'men'], sort: SALON_SORTS, order: SORT_ORDERS } },
)

function onSort(value: { sort: string; order: SortOrder }) {
  sort.value = value.sort as SalonSort
  order.value = value.order
}
const mobileSort = computed({
  get: () => `${sort.value}:${order.value}`,
  set: (v: string) => {
    const [s, o] = v.split(':')
    onSort({ sort: s!, order: o as SortOrder })
  },
})

async function load() {
  loading.value = true
  loadError.value = false
  const params = new URLSearchParams({ status: statusFilter.value, page: String(page.value), pageSize: String(pageSize) })
  // Sent only when not the API's own default (the queue order: oldest first).
  if (sort.value !== 'createdAt' || order.value !== 'asc') {
    params.set('sort', sort.value)
    params.set('order', order.value)
  }
  if (cityFilter.value) params.set('city', cityFilter.value)
  if (nameFilter.value) params.set('name', nameFilter.value)
  if (genderFilter.value) params.set('genderTarget', genderFilter.value)

  const { data, error } = await apiFetch<SalonListResponse>(`/admin/salons?${params.toString()}`, { silent: true })
  if (error) {
    loadError.value = true
    salons.value = []
    total.value = 0
  } else {
    salons.value = data?.items ?? []
    total.value = data?.total ?? 0
  }
  loading.value = false
}

function loadFromFilterChange() {
  // Any filter change invalidates the current page position. When we're past page 1, just
  // reset it -- the page watcher below triggers the (single) reload; calling load() here too
  // would fire a redundant concurrent second request.
  // A navigation (back/forward) that set the filters -- and maybe `page` with them -- is not
  // an edit: keep the page the URL asked for.
  if (page.value !== 1 && !changedByUrl()) {
    page.value = 1
  } else {
    load()
  }
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso))
}

// Mirrors SearchService's public boost predicate exactly:
//   is_featured AND (featured_until IS NULL OR featured_until > now())
// Once the paid window elapses the salon silently loses both its search boost and its
// public badge while is_featured stays true, so gating on the flag alone would keep
// labelling it ویژه here -- the wrong answer for an operator auditing what is actually
// boosted right now, or answering "why has my ad stopped showing?".
function isFeaturedNow(salon: SalonRow): boolean {
  return salon.isFeatured && (salon.featuredUntil === null || new Date(salon.featuredUntil).getTime() > Date.now())
}

// An elapsed window still deserves a marker: with the badge simply gone, a salon whose ad
// just ran out is indistinguishable from one that was never featured -- which is exactly
// the question this screen gets asked.
function isFeaturedExpired(salon: SalonRow): boolean {
  return salon.isFeatured && !isFeaturedNow(salon)
}

function featuredTitle(salon: SalonRow): string {
  return salon.featuredUntil ? `نشان ویژه تا ${formatDate(salon.featuredUntil)}` : 'نشان ویژه بدون تاریخ پایان'
}

function clearFilters() {
  statusFilter.value = 'all'
  cityFilter.value = ''
  nameFilter.value = ''
  genderFilter.value = ''
}

const hasActiveFilters = computed(
  () => statusFilter.value !== 'all' || !!cityFilter.value || !!nameFilter.value || !!genderFilter.value,
)

onMounted(() => {
  load()
  loadCities()
})
// nameFilter is free-text (fires on every keystroke) -- debounced so it doesn't hammer the
// API mid-word. The dropdown filters are discrete clicks, so they still trigger immediately.
watch(nameFilter, debounce(loadFromFilterChange, 350))
watch([statusFilter, cityFilter, genderFilter, sort, order], loadFromFilterChange)
watch(page, load)
</script>

<template>
  <div class="space-y-5 p-4 sm:p-6 lg:p-8">
    <AppCard :padded="false" class="p-4">
      <div class="flex flex-wrap items-end gap-3">
        <AppInput v-model="nameFilter" icon="search" label="جست‌وجو" placeholder="نام سالن" class="w-52" />
        <div v-if="citiesError" class="flex items-end gap-2">
          <AppIcon name="warning" :size="14" class="mb-2.5 shrink-0 text-(--tone-danger-text)" />
          <AppButton type="button" variant="secondary" data-testid="retry-cities" @click="loadCities">تلاش دوباره</AppButton>
        </div>
        <AppSelect
          v-else
          v-model="cityFilter"
          :options="CITY_OPTIONS"
          label="شهر"
          width="10rem"
          searchable
          :disabled="citiesLoading"
          :placeholder="citiesLoading ? 'در حال بارگذاری…' : undefined"
        />
        <AppSelect v-model="genderFilter" :options="GENDER_OPTIONS" label="مخاطب" width="11rem" />
        <div data-testid="status-filter">
          <AppSelect v-model="statusFilter" :options="STATUS_OPTIONS" label="وضعیت" width="11rem" />
        </div>
        <div class="md:hidden" data-testid="mobile-sort">
          <AppSelect v-model="mobileSort" :options="MOBILE_SORT_OPTIONS" label="ترتیب" width="11rem" />
        </div>
        <AppButton
          v-if="hasActiveFilters"
          type="button"
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
      <p class="text-sm text-(--color-text-muted)">خطا در دریافت فهرست سالن‌ها.</p>
      <AppButton type="button" variant="secondary" data-testid="retry-load" @click="load">تلاش دوباره</AppButton>
    </AppCard>

    <EmptyState v-else-if="!loading && salons.length === 0" icon="salons" message="سالنی با این فیلترها یافت نشد." />

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
             trailing columns rather than letting the operator reach them. Desktop is untouched:
             no scrollbar exists while the table fits, which is the ≥1280px case this app
             optimizes for. -->
        <ScrollTable label="فهرست سالن‌ها">
          <table class="w-full text-start text-sm transition-opacity" :class="[STACKED_TABLE, { 'opacity-50': loading }]">
            <thead :class="STACKED_THEAD">
              <tr class="border-b border-(--color-border) bg-(--color-border-soft) text-xs text-(--color-text-muted)">
                <SortableTh label="نام" field="name" :sort="sort" :order="order" @sort="onSort" />
                <SortableTh label="شهر" field="city" :sort="sort" :order="order" @sort="onSort" />
                <th scope="col" class="px-5 py-3 font-semibold">مخاطب</th>
                <th scope="col" class="px-5 py-3 font-semibold">وضعیت</th>
                <SortableTh label="تاریخ ثبت" field="createdAt" :sort="sort" :order="order" @sort="onSort" />
              </tr>
            </thead>
            <tbody :class="STACKED_TBODY">
              <tr
                v-for="salon in salons"
                :key="salon.id"
                class="border-b border-(--color-border-soft) transition-colors last:border-0 hover:bg-(--color-border-soft)"
                :class="STACKED_ROW"
              >
                <td class="px-5 py-3.5 max-md:-order-2 max-md:col-span-2" :class="STACKED_CELL_PLAIN">
                  <div class="flex flex-wrap items-center gap-x-2">
                    <!-- min-h-10: a 40px tap target; md:-my-2.5 gives the extra height back to the
                         table row so the desktop row height is unchanged. -->
                    <RouterLink :to="`/salons/${salon.id}`" class="inline-flex min-h-10 items-center font-semibold text-(--color-text) hover:text-(--color-accent-text) md:-my-2.5">
                      {{ salon.name }}
                    </RouterLink>
                    <span
                      v-if="isFeaturedNow(salon)"
                      data-testid="featured-badge"
                      :title="featuredTitle(salon)"
                      class="inline-flex shrink-0 items-center gap-1 rounded-full bg-(--tone-warning-bg) px-2 py-0.5 text-[11px] font-semibold text-(--tone-warning-text)"
                    >
                      <AppIcon name="star" :size="11" />
                      ویژه
                    </span>
                    <span
                      v-else-if="isFeaturedExpired(salon)"
                      data-testid="featured-expired-badge"
                      :title="featuredTitle(salon)"
                      class="inline-flex shrink-0 items-center gap-1 rounded-full bg-(--color-border-soft) px-2 py-0.5 text-[11px] font-semibold text-(--color-text-muted)"
                    >
                      <AppIcon name="star" :size="11" />
                      ویژه (منقضی)
                    </span>
                  </div>
                </td>
                <td class="px-5 py-3.5 text-(--color-text-muted)" :class="STACKED_CELL" data-label="شهر">{{ salon.city }}</td>
                <td class="px-5 py-3.5 text-(--color-text-muted)" :class="STACKED_CELL" data-label="مخاطب">{{ genderTargetLabel(salon.genderTarget) }}</td>
                <!-- First after the name in the card layout: status is what an operator scans for. -->
                <td class="px-5 py-3.5 max-md:-order-1" :class="STACKED_CELL" data-label="وضعیت">
                  <StatusBadge :label="salonStatusLabel(salon.status).label" :tone="salonStatusLabel(salon.status).tone" />
                </td>
                <td class="tnum px-5 py-3.5 text-(--color-text-muted)" :class="STACKED_CELL" data-label="تاریخ ثبت">{{ formatDate(salon.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </ScrollTable>
      </div>
      <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="(p) => (page = p)" />
    </AppCard>
  </div>
</template>
