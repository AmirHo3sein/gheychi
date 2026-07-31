<script setup lang="ts">
definePageMeta({ middleware: 'admin' })

interface AdminSalon { id: string; name: string; city: string; isFeatured: boolean; featuredUntil: string | null }

// GET /admin/salons returns a paginated envelope ({ items, total, page, pageSize } --
// see AdminSalonsController.list()), never a bare array, so `data` here must be
// unwrapped via `.items` before it's assigned/iterated below.
interface AdminSalonsResponse { items: AdminSalon[]; total: number; page: number; pageSize: number }

// Featuring is only meaningful for an APPROVED salon: SearchService.search() filters
// every listing (featured/ad-boosted results included) to status = 'approved', so
// is_featured on any other row is a flag search can never surface -- the toggle looks
// like it worked and changes nothing anyone can see. /admin/salons defaults to
// status=pending when the param is omitted (AdminSalonsController.list()), i.e. exactly
// the salons that must NOT be listed here, so the filter is always sent explicitly.
const STATUS = 'approved'
// The endpoint's own @Max(100) cap (AdminSalonQueryDto) -- one request per 100 salons,
// paged below rather than fetched all at once, since an approved-salon list grows
// unbounded with the platform.
const PAGE_SIZE = 100

const { apiFetch } = useApi()
const salons = ref<AdminSalon[]>([])
const savingId = ref<string | null>(null)
const loading = ref(true)
const page = ref(1)
const total = ref(0)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

// One "تا تاریخ" date-input value per row, keyed by salon id. Bound via v-model
// instead of the old document.getElementById(`until-${id}`) lookup. Preserved (not
// reset) across a reload triggered by toggle() so a value typed just before a save
// isn't wiped by the refetch that follows it -- new rows only get a key added.
const untilInputs = ref<Record<string, string>>({})

async function load() {
  loading.value = true
  const params = new URLSearchParams({ status: STATUS, page: String(page.value), pageSize: String(PAGE_SIZE) })
  const { data } = await apiFetch<AdminSalonsResponse>(`/admin/salons?${params.toString()}`, { silent: true })
  salons.value = data?.items ?? []
  total.value = data?.total ?? 0
  for (const salon of salons.value) {
    if (!(salon.id in untilInputs.value)) untilInputs.value[salon.id] = ''
  }
  loading.value = false
}

onMounted(load)
watch(page, load)

async function toggle(salon: AdminSalon, featuredUntilInput: string) {
  savingId.value = salon.id
  await apiFetch(`/admin/salons/${salon.id}/featured`, {
    method: 'PATCH',
    body: {
      isFeatured: !salon.isFeatured,
      // End of the chosen day, not its midnight. `new Date('2026-08-01')` parses as
      // 2026-08-01T00:00:00Z, and the boost is gated on `featured_until > now()`, so a
      // window granted "until 10 Mordad" would lapse at 03:30 that morning (Iran is
      // UTC+3:30) -- on the very date this field displays. Same idiom the coupon-expiry
      // fields in both panels use.
      featuredUntil: featuredUntilInput
        ? new Date(`${featuredUntilInput}T23:59:59.999`).toISOString()
        : undefined,
    },
  })
  savingId.value = null
  await load()
}

useSeoMeta({ title: 'مدیریت سالن‌های ویژه — قیچی' })
</script>

<template>
  <div class="p-4 space-y-4">
    <div class="space-y-1">
      <h1 class="text-lg font-bold text-(--color-text)">مدیریت سالن‌های ویژه (تبلیغ)</h1>
      <!-- Says out loud why a pending salon is missing from the list: nothing but an
           approved salon can appear in search, featured or not. -->
      <p class="text-sm text-(--color-text-muted)">
        تنها سالن‌های تاییدشده در این فهرست دیده می‌شوند، چون فقط آن‌ها در نتایج جستجو نمایش داده می‌شوند.
      </p>
    </div>

    <!-- Only the very first load blanks the screen. A page-change reload keeps the
         (stale) rows and the pager mounted, dimmed -- unmounting the just-clicked
         next/prev button would drop keyboard focus to <body> mid-navigation. -->
    <p v-if="loading && !salons.length" class="flex items-center justify-center gap-2 py-8 text-sm text-(--color-text-muted)">
      <BaseIcon name="spinner" :size="18" class="animate-spin" />
      در حال بارگذاری...
    </p>

    <p
      v-else-if="!salons.length"
      data-testid="featured-empty"
      class="rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-6 text-center text-sm text-(--color-text-muted)"
    >
      سالن تاییدشده‌ای برای نمایش وجود ندارد
    </p>

    <BaseCard v-else padding="none" class="overflow-hidden">
      <div class="overflow-x-auto transition-opacity" :class="loading && 'opacity-50'" :aria-busy="loading">
        <table class="w-full min-w-[640px] text-sm">
          <thead>
            <tr class="border-b border-(--color-border)">
              <th class="p-3 text-start font-medium text-(--color-text-muted)">نام</th>
              <th class="p-3 text-start font-medium text-(--color-text-muted)">شهر</th>
              <th class="p-3 text-start font-medium text-(--color-text-muted)">ویژه</th>
              <th class="p-3 text-start font-medium text-(--color-text-muted)">تا تاریخ</th>
              <th class="p-3 text-start font-medium text-(--color-text-muted)"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="salon in salons" :key="salon.id" data-testid="featured-row" class="border-b border-(--color-border) last:border-0">
              <td class="p-3 text-(--color-text)">{{ salon.name }}</td>
              <td class="p-3 text-(--color-text-muted)">{{ salon.city }}</td>
              <td class="p-3">
                <span
                  data-testid="featured-badge"
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold"
                  :class="salon.isFeatured ? 'bg-(--color-accent-soft) text-(--color-text)' : 'bg-(--color-surface-subtle) text-(--color-text-muted)'"
                >
                  {{ salon.isFeatured ? 'بله' : 'خیر' }}
                </span>
              </td>
              <td class="p-3">
                <label :for="`until-${salon.id}`" class="sr-only">تا تاریخ ویژه بودن {{ salon.name }}</label>
                <input
                  :id="`until-${salon.id}`"
                  v-model="untilInputs[salon.id]"
                  type="date"
                  data-testid="featured-until-input"
                  class="w-full rounded-xl border border-(--color-border) bg-(--color-surface-card) px-3 py-2 text-sm text-(--color-text) transition-colors focus:outline-none focus:border-(--color-accent) focus:ring-2 focus:ring-(--color-accent)/30"
                />
              </td>
              <td class="p-3">
                <BaseButton
                  data-testid="toggle-featured-button"
                  :loading="savingId === salon.id"
                  @click="toggle(salon, untilInputs[salon.id] ?? '')"
                >
                  {{ salon.isFeatured ? 'حذف از ویژه' : 'افزودن به ویژه' }}
                </BaseButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        v-if="pageCount > 1"
        data-testid="featured-pager"
        class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-(--color-border) p-3"
      >
        <!-- shrink-0 + flex-wrap: at 320px the two button labels and the count line want
             ~368px of a 264px row. Left to shrink, "صفحه قبل"/"صفحه بعد" each break across
             two lines; wrapping moves the count onto its own row and keeps both intact. -->
        <BaseButton variant="secondary" class="shrink-0" data-testid="featured-prev" :disabled="loading || page <= 1" @click="page--">
          صفحه قبل
        </BaseButton>
        <p class="text-xs text-(--color-text-muted)">
          صفحه {{ page }} از {{ pageCount }} — {{ total }} سالن تاییدشده
        </p>
        <BaseButton variant="secondary" class="shrink-0" data-testid="featured-next" :disabled="loading || page >= pageCount" @click="page++">
          صفحه بعد
        </BaseButton>
      </div>
    </BaseCard>
  </div>
</template>
