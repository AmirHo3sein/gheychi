<!-- apps/admin-panel/src/pages/CouponsView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useApi } from '@/composables/useApi'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'

// Platform-wide coupons only (GET/POST/PATCH/DELETE /admin/coupons) -- salonId is always null
// for rows returned here, so there's deliberately no salon column, unlike the salon-scoped
// coupon endpoints a provider would use for their own coupons.
//
// discountPercent is typed nullable even though this screen's own create/edit form only ever
// writes a percent value (CreateCouponDto/UpdateCouponDto have no fixed-amount field -- an
// admin can't create a fixed_discount coupon here) and referral-issued coupons (which CAN be
// fixed_discount, Slice 6) are excluded from this endpoint entirely (CouponsService.listPlatformWide
// filters out issuedToUserId IS NOT NULL rows -- see coupons.service.ts). Kept nullable anyway,
// defense-in-depth: coupons.discount_percent is no longer NOT NULL at the schema level
// platform-wide (coupons_discount_shape_chk allows discount_fixed_amount instead), so a future
// endpoint change or bug that lets a fixed-kind row leak through here shouldn't render "٪null".
interface Coupon {
  id: string
  code: string
  discountPercent: number | null
  expiresAt: string | null
  maxRedemptions: number | null
  isActive: boolean
  createdAt: string
  redeemedCount: number
}

const { apiFetch } = useApi()
const coupons = ref<Coupon[]>([])
const loading = ref(true)

const newCode = ref('')
const newDiscountPercent = ref<number | null>(null)
const newExpiresAt = ref('')
const newMaxRedemptions = ref<number | null>(null)

const editingId = ref<string | null>(null)
const editDiscountPercent = ref<number | null>(null)
const editExpiresAt = ref('')
const editMaxRedemptions = ref<number | null>(null)

const submitting = ref(false)
const confirmingId = ref<string | null>(null)

async function load() {
  loading.value = true
  const { data } = await apiFetch<Coupon[]>('/admin/coupons', { silent: true })
  coupons.value = data ?? []
  loading.value = false
}

function formatDate(iso: string | null): string {
  if (!iso) return 'بدون انقضا'
  return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso))
}

// Defense-in-depth (see the Coupon interface comment above) -- this screen should never
// actually receive a null discountPercent, but rendering "٪" alone (or "٪null") if one ever
// slipped through would be worse than a clear placeholder.
function formatDiscountPercent(percent: number | null): string {
  return percent === null ? '—' : `${percent}٪`
}

async function add() {
  if (!newCode.value.trim() || !newDiscountPercent.value) return
  submitting.value = true
  // Deliberately NOT silent: a duplicate code (any scope) comes back as a 409, which useApi
  // surfaces through the standard toast path -- mirrors CategoriesView.vue's create().
  const { data } = await apiFetch<Coupon>('/admin/coupons', {
    method: 'POST',
    body: {
      code: newCode.value.trim(),
      discountPercent: newDiscountPercent.value,
      expiresAt: newExpiresAt.value ? new Date(`${newExpiresAt.value}T23:59:59.999`).toISOString() : undefined,
      maxRedemptions: newMaxRedemptions.value || undefined,
    },
  })
  submitting.value = false
  if (data) {
    coupons.value.push(data)
    newCode.value = ''
    newDiscountPercent.value = null
    newExpiresAt.value = ''
    newMaxRedemptions.value = null
  }
}

function startEdit(coupon: Coupon) {
  editingId.value = coupon.id
  editDiscountPercent.value = coupon.discountPercent
  editExpiresAt.value = coupon.expiresAt ? coupon.expiresAt.slice(0, 10) : ''
  editMaxRedemptions.value = coupon.maxRedemptions
  confirmingId.value = null
}

async function saveEdit() {
  submitting.value = true
  const { data } = await apiFetch<Coupon>(`/admin/coupons/${editingId.value}`, {
    method: 'PATCH',
    body: {
      discountPercent: editDiscountPercent.value,
      // Explicit null clears the field server-side; matches UpdateCouponDto's
      // undefined-leaves-unchanged / null-clears contract.
      expiresAt: editExpiresAt.value ? new Date(`${editExpiresAt.value}T23:59:59.999`).toISOString() : null,
      maxRedemptions: editMaxRedemptions.value || null,
    },
  })
  submitting.value = false
  if (data) {
    const coupon = coupons.value.find((c) => c.id === data.id)
    if (coupon) {
      coupon.discountPercent = data.discountPercent
      coupon.expiresAt = data.expiresAt
      coupon.maxRedemptions = data.maxRedemptions
    }
    editingId.value = null
  }
}

async function toggleActive(coupon: Coupon) {
  if (submitting.value) return
  submitting.value = true
  const { data } = await apiFetch<Coupon>(`/admin/coupons/${coupon.id}`, {
    method: 'PATCH',
    body: { isActive: !coupon.isActive },
  })
  submitting.value = false
  if (data) coupon.isActive = data.isActive
}

function askDelete(coupon: Coupon) {
  confirmingId.value = coupon.id
  editingId.value = null
}

async function confirmDelete() {
  if (submitting.value) return
  const id = confirmingId.value
  if (id === null) return
  submitting.value = true
  const { error } = await apiFetch(`/admin/coupons/${id}`, { method: 'DELETE' })
  submitting.value = false
  confirmingId.value = null
  // Unlike CategoriesView's delete, this endpoint soft-deactivates rather than removing the
  // row (same contract as the salon-scoped coupon endpoints) -- reflect that locally as
  // isActive=false instead of splicing the row out, so the list doesn't disagree with what
  // the next GET /admin/coupons would return.
  if (!error) {
    const coupon = coupons.value.find((c) => c.id === id)
    if (coupon) coupon.isActive = false
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-5 p-8">
    <AppCard>
      <p class="mb-3 flex items-center gap-2 text-sm font-semibold text-(--color-text)">
        <AppIcon name="plus" :size="16" class="text-(--color-accent)" />
        افزودن کد تخفیف جدید
      </p>
      <form class="flex flex-wrap items-end gap-2.5" @submit.prevent="add">
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">کد</label>
          <input
            v-model="newCode"
            placeholder="مثلا SUMMER25"
            maxlength="30"
            class="w-36 rounded-xl border border-(--color-border) p-2.5 text-sm uppercase"
          />
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">درصد تخفیف</label>
          <input
            v-model.number="newDiscountPercent"
            type="number"
            min="1"
            max="100"
            placeholder="۱ تا ۱۰۰"
            class="tnum w-24 rounded-xl border border-(--color-border) p-2.5 text-sm"
          />
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">تاریخ انقضا (اختیاری)</label>
          <input v-model="newExpiresAt" type="date" class="tnum w-40 rounded-xl border border-(--color-border) p-2.5 text-sm" />
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">سقف تعداد استفاده (اختیاری)</label>
          <input
            v-model.number="newMaxRedemptions"
            type="number"
            min="1"
            placeholder="نامحدود"
            class="tnum w-32 rounded-xl border border-(--color-border) p-2.5 text-sm"
          />
        </div>
        <button
          type="submit"
          :disabled="submitting || !newCode.trim() || !newDiscountPercent"
          class="inline-flex shrink-0 items-center gap-2 rounded-xl bg-(--color-accent) px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <AppIcon name="plus" :size="16" />
          افزودن
        </button>
      </form>
    </AppCard>

    <EmptyState v-if="!loading && coupons.length === 0" icon="coupon" message="هنوز کد تخفیفی ثبت نشده است." />

    <AppCard v-else :padded="false" class="overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-right text-sm">
          <thead>
            <tr class="border-b border-(--color-border) bg-(--color-border-soft) text-xs text-(--color-text-muted)">
              <th class="px-5 py-3 font-semibold">کد</th>
              <th class="px-5 py-3 font-semibold">درصد تخفیف</th>
              <th class="px-5 py-3 font-semibold">تاریخ انقضا</th>
              <th class="px-5 py-3 font-semibold">سقف استفاده</th>
              <th class="px-5 py-3 font-semibold">تعداد استفاده‌شده</th>
              <th class="px-5 py-3 font-semibold">وضعیت</th>
              <th class="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="coupon in coupons"
              :key="coupon.id"
              class="border-b border-(--color-border-soft) transition-colors last:border-0 hover:bg-(--color-border-soft)"
            >
              <td class="px-5 py-3.5 font-mono font-semibold text-(--color-text)">{{ coupon.code }}</td>

              <template v-if="editingId === coupon.id">
                <td class="px-5 py-3.5">
                  <input
                    v-model.number="editDiscountPercent"
                    type="number"
                    min="1"
                    max="100"
                    class="tnum w-20 rounded-lg border border-(--color-border) p-1.5 text-sm"
                  />
                </td>
                <td class="px-5 py-3.5">
                  <input v-model="editExpiresAt" type="date" class="tnum w-36 rounded-lg border border-(--color-border) p-1.5 text-sm" />
                </td>
                <td class="px-5 py-3.5">
                  <input
                    v-model.number="editMaxRedemptions"
                    type="number"
                    min="1"
                    placeholder="نامحدود"
                    class="tnum w-24 rounded-lg border border-(--color-border) p-1.5 text-sm"
                  />
                </td>
                <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ coupon.redeemedCount }}</td>
                <td class="px-5 py-3.5">
                  <StatusBadge :label="coupon.isActive ? 'فعال' : 'غیرفعال'" :tone="coupon.isActive ? 'success' : 'neutral'" />
                </td>
                <td class="px-5 py-3.5">
                  <button
                    type="button"
                    :disabled="submitting"
                    class="shrink-0 text-sm font-semibold text-(--color-accent) disabled:opacity-40"
                    @click="saveEdit"
                  >
                    ذخیره
                  </button>
                  <button
                    type="button"
                    :disabled="submitting"
                    class="mr-3 shrink-0 text-sm font-semibold text-(--color-text-muted) disabled:opacity-40"
                    @click="editingId = null"
                  >
                    انصراف
                  </button>
                </td>
              </template>

              <template v-else-if="confirmingId === coupon.id">
                <td colspan="5" class="px-5 py-3.5 text-sm font-semibold text-(--tone-danger-text)">
                  کد «{{ coupon.code }}» غیرفعال شود؟
                </td>
                <td class="px-5 py-3.5">
                  <button
                    data-testid="confirm-delete"
                    type="button"
                    :disabled="submitting"
                    class="shrink-0 text-sm font-semibold text-(--tone-danger-text) disabled:opacity-40"
                    @click="confirmDelete"
                  >
                    حذف
                  </button>
                  <button
                    data-testid="cancel-delete"
                    type="button"
                    :disabled="submitting"
                    class="mr-3 shrink-0 text-sm font-semibold text-(--color-text-muted) disabled:opacity-40"
                    @click="confirmingId = null"
                  >
                    انصراف
                  </button>
                </td>
              </template>

              <template v-else>
                <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ formatDiscountPercent(coupon.discountPercent) }}</td>
                <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ formatDate(coupon.expiresAt) }}</td>
                <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ coupon.maxRedemptions ?? 'نامحدود' }}</td>
                <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ coupon.redeemedCount }}</td>
                <td class="px-5 py-3.5">
                  <button type="button" :disabled="submitting" class="disabled:opacity-40" title="تغییر وضعیت فعال/غیرفعال" @click="toggleActive(coupon)">
                    <StatusBadge :label="coupon.isActive ? 'فعال' : 'غیرفعال'" :tone="coupon.isActive ? 'success' : 'neutral'" />
                  </button>
                </td>
                <td class="px-5 py-3.5">
                  <button
                    type="button"
                    :disabled="submitting"
                    class="shrink-0 rounded-lg p-1.5 text-(--color-text-muted) transition-colors hover:bg-(--color-border-soft) hover:text-(--color-accent) disabled:opacity-40"
                    title="ویرایش"
                    @click="startEdit(coupon)"
                  >
                    <AppIcon name="pencil" :size="15" />
                  </button>
                  <button
                    data-testid="delete-coupon"
                    type="button"
                    :disabled="submitting"
                    class="shrink-0 rounded-lg p-1.5 text-(--color-text-muted) transition-colors hover:bg-(--tone-danger-bg) hover:text-(--tone-danger-text) disabled:opacity-40"
                    title="حذف"
                    @click="askDelete(coupon)"
                  >
                    <AppIcon name="x" :size="15" />
                  </button>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>
    </AppCard>
  </div>
</template>
