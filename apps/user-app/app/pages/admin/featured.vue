<script setup lang="ts">
definePageMeta({ middleware: 'admin' })

interface AdminSalon { id: string; name: string; city: string; isFeatured: boolean; featuredUntil: string | null }

// GET /admin/salons returns a paginated envelope ({ items, total, page, pageSize } --
// see AdminSalonsController.list()), never a bare array, so `data` here must be
// unwrapped via `.items` before it's assigned/iterated below.
interface AdminSalonsResponse { items: AdminSalon[]; total: number; page: number; pageSize: number }

const { apiFetch } = useApi()
const salons = ref<AdminSalon[]>([])
const savingId = ref<string | null>(null)
const loading = ref(true)

// One "تا تاریخ" date-input value per row, keyed by salon id. Bound via v-model
// instead of the old document.getElementById(`until-${id}`) lookup. Preserved (not
// reset) across a reload triggered by toggle() so a value typed just before a save
// isn't wiped by the refetch that follows it -- new rows only get a key added.
const untilInputs = ref<Record<string, string>>({})

async function load() {
  loading.value = true
  const { data } = await apiFetch<AdminSalonsResponse>('/admin/salons', { silent: true })
  salons.value = data?.items ?? []
  for (const salon of salons.value) {
    if (!(salon.id in untilInputs.value)) untilInputs.value[salon.id] = ''
  }
  loading.value = false
}

onMounted(load)

async function toggle(salon: AdminSalon, featuredUntilInput: string) {
  savingId.value = salon.id
  await apiFetch(`/admin/salons/${salon.id}/featured`, {
    method: 'PATCH',
    body: {
      isFeatured: !salon.isFeatured,
      featuredUntil: featuredUntilInput ? new Date(featuredUntilInput).toISOString() : undefined,
    },
  })
  savingId.value = null
  await load()
}

useSeoMeta({ title: 'مدیریت سالن‌های ویژه — آرایشگاه' })
</script>

<template>
  <div class="p-4 space-y-4">
    <h1 class="text-lg font-bold text-(--color-text)">مدیریت سالن‌های ویژه (تبلیغ)</h1>

    <p v-if="loading" class="flex items-center justify-center gap-2 py-8 text-sm text-(--color-text-muted)">
      <BaseIcon name="spinner" :size="18" class="animate-spin" />
      در حال بارگذاری...
    </p>

    <p
      v-else-if="!salons.length"
      data-testid="featured-empty"
      class="rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-6 text-center text-sm text-(--color-text-muted)"
    >
      سالنی برای نمایش وجود ندارد
    </p>

    <BaseCard v-else padding="none" class="overflow-hidden">
      <div class="overflow-x-auto">
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
    </BaseCard>
  </div>
</template>
