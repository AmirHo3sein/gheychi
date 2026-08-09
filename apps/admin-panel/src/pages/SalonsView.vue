<!-- apps/admin-panel/src/pages/SalonsView.vue -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Pagination from '@/components/ui/Pagination.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { CITIES } from '@/utils/cities'
import { debounce } from '@/utils/debounce'
import { genderTargetLabel, salonStatusLabel } from '@/utils/labels'

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
const CITY_OPTIONS = [{ value: '', label: 'همه شهرها' }, ...CITIES.map((c) => ({ value: c, label: c }))]

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
const page = ref(1)
const total = ref(0)
const pageSize = 20

const statusFilter = ref<'all' | 'pending' | 'approved' | 'rejected' | 'suspended'>('all')
const cityFilter = ref('')
const nameFilter = ref('')
const genderFilter = ref<'' | 'women' | 'men'>('')

async function load() {
  loading.value = true
  loadError.value = false
  const params = new URLSearchParams({ status: statusFilter.value, page: String(page.value), pageSize: String(pageSize) })
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
  if (page.value !== 1) {
    page.value = 1
  } else {
    load()
  }
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso))
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

onMounted(load)
// nameFilter is free-text (fires on every keystroke) -- debounced so it doesn't hammer the
// API mid-word. The dropdown filters are discrete clicks, so they still trigger immediately.
watch(nameFilter, debounce(loadFromFilterChange, 350))
watch([statusFilter, cityFilter, genderFilter], loadFromFilterChange)
watch(page, load)
</script>

<template>
  <div class="space-y-5 p-8">
    <AppCard :padded="false" class="p-4">
      <div class="flex flex-wrap items-end gap-3">
        <AppInput v-model="nameFilter" icon="search" label="جست‌وجو" placeholder="نام آرایشگاه" class="w-52" />
        <AppSelect v-model="cityFilter" :options="CITY_OPTIONS" label="شهر" width="10rem" searchable />
        <AppSelect v-model="genderFilter" :options="GENDER_OPTIONS" label="مخاطب" width="11rem" />
        <div data-testid="status-filter">
          <AppSelect v-model="statusFilter" :options="STATUS_OPTIONS" label="وضعیت" width="11rem" />
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
      <p class="text-sm text-(--color-text-muted)">خطا در دریافت فهرست آرایشگاه‌ها.</p>
      <AppButton type="button" variant="secondary" data-testid="retry-load" @click="load">تلاش دوباره</AppButton>
    </AppCard>

    <EmptyState v-else-if="!loading && salons.length === 0" icon="salons" message="آرایشگاهی با این فیلترها یافت نشد." />

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
        <div class="overflow-x-auto">
          <table class="w-full text-right text-sm transition-opacity" :class="{ 'opacity-50': loading }">
            <thead>
              <tr class="border-b border-(--color-border) bg-(--color-border-soft) text-xs text-(--color-text-muted)">
                <th class="px-5 py-3 font-semibold">نام</th>
                <th class="px-5 py-3 font-semibold">شهر</th>
                <th class="px-5 py-3 font-semibold">مخاطب</th>
                <th class="px-5 py-3 font-semibold">وضعیت</th>
                <th class="px-5 py-3 font-semibold">تاریخ ثبت</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="salon in salons"
                :key="salon.id"
                class="border-b border-(--color-border-soft) transition-colors last:border-0 hover:bg-(--color-border-soft)"
              >
                <td class="px-5 py-3.5">
                  <div class="flex items-center gap-2">
                    <RouterLink :to="`/salons/${salon.id}`" class="font-semibold text-(--color-text) hover:text-(--color-accent-text)">
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
                <td class="px-5 py-3.5 text-(--color-text-muted)">{{ salon.city }}</td>
                <td class="px-5 py-3.5 text-(--color-text-muted)">{{ genderTargetLabel(salon.genderTarget) }}</td>
                <td class="px-5 py-3.5">
                  <StatusBadge :label="salonStatusLabel(salon.status).label" :tone="salonStatusLabel(salon.status).tone" />
                </td>
                <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ formatDate(salon.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="(p) => (page = p)" />
    </AppCard>
  </div>
</template>
