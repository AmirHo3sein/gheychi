<!-- apps/admin-panel/src/pages/FeaturedView.vue -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'
import Pagination from '@/components/ui/Pagination.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'

interface AdminSalon { id: string; name: string; city: string; isFeatured: boolean; featuredUntil: string | null }

// GET /admin/salons returns a paginated envelope ({ items, total, page, pageSize } --
// see AdminSalonsController.list()), never a bare array, so `data` here must be unwrapped
// via `.items` before it's assigned/iterated below.
interface AdminSalonsResponse { items: AdminSalon[]; total: number; page: number; pageSize: number }

// Featuring is only meaningful for an APPROVED salon: SearchService.search() filters every
// listing (featured/ad-boosted results included) to status = 'approved', so is_featured on
// any other row is a flag search can never surface -- the toggle looks like it worked and
// changes nothing anyone can see. /admin/salons defaults to status=pending when the param is
// omitted (AdminSalonsController.list()), i.e. exactly the salons that must NOT be listed
// here, so the filter is always sent explicitly.
const STATUS = 'approved'
// The endpoint's own @Max(100) cap (AdminSalonQueryDto) -- one request per 100 salons, paged
// below rather than fetched all at once, since an approved-salon list grows unbounded with
// the platform.
const PAGE_SIZE = 100

const { apiFetch } = useApi()
const salons = ref<AdminSalon[]>([])
const loading = ref(true)
// A fetch failure must not be silently repainted as an empty state -- see SalonsView.vue's
// identical loadError pattern.
const loadError = ref(false)
const savingId = ref<string | null>(null)
const page = ref(1)
const total = ref(0)

// One "تا تاریخ" date-input value per row, keyed by salon id. Preserved (not reset) across
// a reload triggered by toggle() so a value typed just before a save isn't wiped by the
// refetch that follows it -- new rows only get a key added.
const untilInputs = ref<Record<string, string>>({})

async function load() {
  loading.value = true
  loadError.value = false
  const params = new URLSearchParams({ status: STATUS, page: String(page.value), pageSize: String(PAGE_SIZE) })
  const { data, error } = await apiFetch<AdminSalonsResponse>(`/admin/salons?${params.toString()}`, { silent: true })
  if (error) {
    loadError.value = true
    salons.value = []
    total.value = 0
  } else {
    salons.value = data?.items ?? []
    total.value = data?.total ?? 0
    for (const salon of salons.value) {
      if (!(salon.id in untilInputs.value)) untilInputs.value[salon.id] = ''
    }
  }
  loading.value = false
}

async function toggle(salon: AdminSalon) {
  savingId.value = salon.id
  const featuredUntilInput = untilInputs.value[salon.id] ?? ''
  await apiFetch(`/admin/salons/${salon.id}/featured`, {
    method: 'PATCH',
    body: {
      isFeatured: !salon.isFeatured,
      // End of the chosen day, not its midnight. `new Date('2026-08-01')` parses as
      // 2026-08-01T00:00:00Z, and the boost is gated on `featured_until > now()`, so a
      // window granted "until 10 Mordad" would lapse at 03:30 that morning (Iran is
      // UTC+3:30) -- on the very date this field displays. Same idiom CouponsView's
      // expiry field uses.
      featuredUntil: featuredUntilInput
        ? new Date(`${featuredUntilInput}T23:59:59.999`).toISOString()
        : undefined,
    },
  })
  savingId.value = null
  await load()
}

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

onMounted(load)
watch(page, load)
</script>

<template>
  <div class="space-y-5 p-8">
    <!-- Says out loud why a pending salon is missing from the list: nothing but an approved
         salon can appear in search, featured or not. -->
    <p class="text-sm text-(--color-text-muted)">
      تنها سالن‌های تاییدشده در این فهرست دیده می‌شوند، چون فقط آن‌ها در نتایج جستجو نمایش داده می‌شوند.
    </p>

    <div v-if="loading && !salons.length" class="flex items-center justify-center py-16" role="status" aria-label="در حال بارگذاری">
      <AppIcon name="spinner" :size="24" class="animate-spin text-(--color-text-muted)" />
    </div>

    <AppCard
      v-else-if="loadError"
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

    <EmptyState
      v-else-if="!salons.length"
      icon="star"
      data-testid="featured-empty"
      message="سالن تاییدشده‌ای برای نمایش وجود ندارد"
    />

    <AppCard v-else :padded="false" class="overflow-hidden">
      <!-- The table gets its own horizontal scroller (CouponsView.vue's idiom) -- AppCard's
           overflow-hidden (there for the rounded corners) would otherwise clip trailing
           columns rather than let the operator reach them. -->
      <div class="relative">
        <div
          v-if="loading"
          data-testid="table-loading"
          class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-(--color-surface-card)/70"
        >
          <AppIcon name="spinner" :size="22" class="animate-spin text-(--color-text-muted)" />
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-right text-sm transition-opacity" :class="{ 'opacity-50': loading }">
            <thead>
              <tr class="border-b border-(--color-border) bg-(--color-border-soft) text-xs text-(--color-text-muted)">
                <th class="px-5 py-3 font-semibold">نام</th>
                <th class="px-5 py-3 font-semibold">شهر</th>
                <th class="px-5 py-3 font-semibold">ویژه</th>
                <th class="px-5 py-3 font-semibold">تا تاریخ</th>
                <th class="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="salon in salons"
                :key="salon.id"
                data-testid="featured-row"
                class="border-b border-(--color-border-soft) transition-colors last:border-0 hover:bg-(--color-border-soft)"
              >
                <td class="px-5 py-3.5 font-semibold text-(--color-text)">{{ salon.name }}</td>
                <td class="px-5 py-3.5 text-(--color-text-muted)">{{ salon.city }}</td>
                <td class="px-5 py-3.5">
                  <StatusBadge
                    data-testid="featured-badge"
                    :label="salon.isFeatured ? 'بله' : 'خیر'"
                    :tone="salon.isFeatured ? 'warning' : 'neutral'"
                  />
                </td>
                <td class="px-5 py-3.5">
                  <span class="sr-only">تا تاریخ ویژه بودن {{ salon.name }}</span>
                  <JalaliDatePicker
                    v-model="untilInputs[salon.id]"
                    :aria-label="`تا تاریخ ویژه بودن ${salon.name}`"
                    placeholder="بدون تاریخ"
                    data-testid="featured-until-input"
                    class="w-40"
                  />
                </td>
                <td class="px-5 py-3.5 text-end">
                  <AppButton
                    data-testid="toggle-featured-button"
                    variant="secondary"
                    :loading="savingId === salon.id"
                    @click="toggle(salon)"
                  >
                    {{ salon.isFeatured ? 'حذف از ویژه' : 'افزودن به ویژه' }}
                  </AppButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Only the endpoint's own page-size cap (100) makes a pager possible here at all --
           see PAGE_SIZE above. -->
      <div v-if="pageCount > 1" data-testid="featured-pager">
        <Pagination :page="page" :page-size="PAGE_SIZE" :total="total" @update:page="(p) => (page = p)" />
      </div>
    </AppCard>
  </div>
</template>
