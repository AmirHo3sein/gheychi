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
const page = ref(1)
const total = ref(0)
const pageSize = 20

const statusFilter = ref<'all' | 'pending' | 'approved' | 'rejected' | 'suspended'>('all')
const cityFilter = ref('')
const nameFilter = ref('')
const genderFilter = ref<'' | 'women' | 'men'>('')

async function load() {
  loading.value = true
  const params = new URLSearchParams({ status: statusFilter.value, page: String(page.value), pageSize: String(pageSize) })
  if (cityFilter.value) params.set('city', cityFilter.value)
  if (nameFilter.value) params.set('name', nameFilter.value)
  if (genderFilter.value) params.set('genderTarget', genderFilter.value)

  const { data } = await apiFetch<SalonListResponse>(`/admin/salons?${params.toString()}`, { silent: true })
  salons.value = data?.items ?? []
  total.value = data?.total ?? 0
  loading.value = false
}

function loadFromFilterChange() {
  page.value = 1 // any filter change invalidates the current page position
  load()
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso))
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
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">جست‌وجو</label>
          <AppInput v-model="nameFilter" icon="search" placeholder="نام آرایشگاه" class="w-52" />
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">شهر</label>
          <AppSelect v-model="cityFilter" :options="CITY_OPTIONS" width="10rem" searchable />
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">مخاطب</label>
          <AppSelect v-model="genderFilter" :options="GENDER_OPTIONS" width="11rem" />
        </div>
        <div data-testid="status-filter">
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">وضعیت</label>
          <AppSelect v-model="statusFilter" :options="STATUS_OPTIONS" width="11rem" />
        </div>
        <AppButton
          v-if="hasActiveFilters"
          type="button"
          variant="ghost"
          class="mb-2"
          @click="clearFilters"
        >
          <template #icon><AppIcon name="reset" :size="15" /></template>
          پاک کردن فیلترها
        </AppButton>
      </div>
    </AppCard>

    <EmptyState v-if="!loading && salons.length === 0" icon="salons" message="آرایشگاهی با این فیلترها یافت نشد." />

    <AppCard v-else :padded="false" class="overflow-hidden">
      <table class="w-full text-right text-sm">
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
              <RouterLink :to="`/salons/${salon.id}`" class="font-semibold text-(--color-text) hover:text-(--color-accent)">
                {{ salon.name }}
              </RouterLink>
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
      <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="(p) => (page = p)" />
    </AppCard>
  </div>
</template>
