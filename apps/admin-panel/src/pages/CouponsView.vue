<!-- apps/admin-panel/src/pages/CouponsView.vue -->
<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'
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
// A fetch failure must not be silently repainted as an empty state -- see
// SalonsView.vue's identical loadError pattern.
const loadError = ref(false)

const newCode = ref('')
const newDiscountPercent = ref<number | null>(null)
const newExpiresAt = ref('')
const newMaxRedemptions = ref<number | null>(null)

const editingId = ref<string | null>(null)
const editDiscountPercent = ref<number | null>(null)
const editExpiresAt = ref('')
const editMaxRedemptions = ref<number | null>(null)
// Snapshot of the coupon's persisted values at the moment editing started -- diffed against
// the live edit* refs below to build the confirm-summary's old-to-new list (buildEditDiffs).
const editOriginal = ref<{ discountPercent: number | null; expiresAt: string | null; maxRedemptions: number | null }>({
  discountPercent: null,
  expiresAt: null,
  maxRedemptions: null,
})

const submitting = ref(false)
// Which row is showing its "confirm these term changes?" sub-step -- separate from
// confirmingToggleId (the status-toggle's own confirm) since they're independent per-row
// states, both required by the Uniform Consequence Rule: no mutating action here reads as
// more casual than another just because it's a single click.
const confirmingEditId = ref<string | null>(null)
const confirmingToggleId = ref<string | null>(null)

// Keyed by coupon id -- imperative DOM handles for row-level focus management (see the
// watchers below). Plain objects, not refs: they only back focus() calls, never read during
// render, so there's no reason to make them reactive.
const toggleCellEls: Record<string, HTMLElement | null> = {}
const actionCellEls: Record<string, HTMLElement | null> = {}
function setToggleCellEl(id: string, el: unknown) {
  toggleCellEls[id] = (el as HTMLElement | null) ?? null
}
function setActionCellEl(id: string, el: unknown) {
  actionCellEls[id] = (el as HTMLElement | null) ?? null
}

const editRowRef = ref<HTMLElement | null>(null)
const editConfirmRef = ref<HTMLElement | null>(null)

// Focus management: askToggle/startEdit (and the edit-confirm sub-step) swap v-if/v-else
// branches, unmounting whichever button was just clicked -- without this a keyboard user's
// focus would silently drop to <body>. Each watcher moves focus into the newly-shown
// sub-tree's first control, or back to the row's own action button once that sub-tree closes.
watch(editingId, async (id, oldId) => {
  await nextTick()
  if (id !== null) {
    editRowRef.value?.querySelector('input')?.focus()
  } else if (oldId !== null) {
    actionCellEls[oldId]?.querySelector('button')?.focus()
  }
})

watch(confirmingEditId, async (id) => {
  await nextTick()
  if (id !== null) {
    editConfirmRef.value?.querySelector('button')?.focus()
  } else if (editingId.value !== null) {
    editRowRef.value?.querySelector('input')?.focus()
  }
})

watch(confirmingToggleId, async (id, oldId) => {
  await nextTick()
  if (id !== null) {
    toggleCellEls[id]?.querySelector('button')?.focus()
  } else if (oldId !== null) {
    toggleCellEls[oldId]?.querySelector('button')?.focus()
  }
})

async function load() {
  loading.value = true
  loadError.value = false
  const { data, error } = await apiFetch<Coupon[]>('/admin/coupons', { silent: true })
  if (error) {
    loadError.value = true
    coupons.value = []
  } else {
    coupons.value = data ?? []
  }
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

// Normalizes newCode to uppercase as it's typed, not just visually via CSS -- otherwise the
// stored/submitted value silently keeps whatever case was typed even though the field always
// *looks* uppercase, so two operators typing "summer25" and "SUMMER25" would submit different
// strings despite seeing identical rendering.
function onCodeInput(value: string) {
  newCode.value = value.toUpperCase()
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
      // Explicit null check (not `|| undefined`) -- a falsy-or would coalesce a genuinely
      // typed 0 into "unlimited" instead of sending it through to the server's own Min(1)
      // validation (which correctly rejects 0 with a real error).
      maxRedemptions: newMaxRedemptions.value === null ? undefined : newMaxRedemptions.value,
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
  editOriginal.value = {
    discountPercent: coupon.discountPercent,
    expiresAt: coupon.expiresAt,
    maxRedemptions: coupon.maxRedemptions,
  }
  confirmingEditId.value = null
  confirmingToggleId.value = null
}

interface FieldDiff {
  key: string
  label: string
  oldText: string
  newText: string
}

// Only fields whose formatted text actually differs from the persisted snapshot -- feeds both
// askEditConfirm's "nothing changed, just close" short-circuit and the confirm-summary's
// old-to-new list.
function buildEditDiffs(): FieldDiff[] {
  const diffs: FieldDiff[] = []

  const oldDiscount = formatDiscountPercent(editOriginal.value.discountPercent)
  const newDiscount = formatDiscountPercent(editDiscountPercent.value)
  if (oldDiscount !== newDiscount) {
    diffs.push({ key: 'discountPercent', label: 'درصد تخفیف', oldText: oldDiscount, newText: newDiscount })
  }

  const newExpiresIso = editExpiresAt.value ? new Date(`${editExpiresAt.value}T23:59:59.999`).toISOString() : null
  const oldExpiry = formatDate(editOriginal.value.expiresAt)
  const newExpiry = formatDate(newExpiresIso)
  if (oldExpiry !== newExpiry) {
    diffs.push({ key: 'expiresAt', label: 'تاریخ انقضا', oldText: oldExpiry, newText: newExpiry })
  }

  const oldMax = editOriginal.value.maxRedemptions === null ? 'نامحدود' : String(editOriginal.value.maxRedemptions)
  const newMax = editMaxRedemptions.value === null ? 'نامحدود' : String(editMaxRedemptions.value)
  if (oldMax !== newMax) {
    diffs.push({ key: 'maxRedemptions', label: 'سقف تعداد استفاده', oldText: oldMax, newText: newMax })
  }

  return diffs
}

function askEditConfirm(coupon: Coupon) {
  // Nothing actually changed -- no empty confirm step, just close editing.
  if (buildEditDiffs().length === 0) {
    editingId.value = null
    return
  }
  confirmingEditId.value = coupon.id
}

async function saveEdit() {
  submitting.value = true
  const { data } = await apiFetch<Coupon>(`/admin/coupons/${editingId.value}`, {
    method: 'PATCH',
    body: {
      // Never null from this form: the edit Save button is disabled while
      // editDiscountPercent is null (see the template), so the null-PATCH path that used to
      // trip the DB's coupons_discount_shape_chk CHECK constraint is unreachable from the UI.
      discountPercent: editDiscountPercent.value,
      // Explicit null clears the field server-side; matches UpdateCouponDto's
      // undefined-leaves-unchanged / null-clears contract.
      expiresAt: editExpiresAt.value ? new Date(`${editExpiresAt.value}T23:59:59.999`).toISOString() : null,
      // Explicit ref value, not `|| null` -- editMaxRedemptions is already normalized to
      // null-or-number by its own input handler, so a falsy-or here would have silently
      // coalesced a genuinely typed 0 into "unlimited".
      maxRedemptions: editMaxRedemptions.value,
    },
  })
  submitting.value = false
  confirmingEditId.value = null
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

function askToggle(coupon: Coupon) {
  confirmingToggleId.value = coupon.id
  editingId.value = null
  confirmingEditId.value = null
}

function cancelToggle() {
  confirmingToggleId.value = null
}

async function toggleActive(coupon: Coupon) {
  if (submitting.value) return
  submitting.value = true
  const { data } = await apiFetch<Coupon>(`/admin/coupons/${coupon.id}`, {
    method: 'PATCH',
    body: { isActive: !coupon.isActive },
  })
  submitting.value = false
  confirmingToggleId.value = null
  if (data) coupon.isActive = data.isActive
}

onMounted(load)
</script>

<template>
  <div class="space-y-5 p-8">
    <AppCard>
      <p class="mb-3 flex items-center gap-2 text-sm font-semibold text-(--color-text)">
        <AppIcon name="plus" :size="16" class="text-(--color-accent-text)" />
        افزودن کد تخفیف جدید
      </p>
      <form class="flex flex-wrap items-end gap-2.5" @submit.prevent="add">
        <AppInput
          :model-value="newCode"
          label="کد"
          placeholder="مثلا SUMMER25"
          :maxlength="30"
          class="w-36"
          @update:model-value="onCodeInput"
        />
        <AppInput
          :model-value="newDiscountPercent === null ? '' : String(newDiscountPercent)"
          label="درصد تخفیف"
          type="number"
          min="1"
          max="100"
          placeholder="۱ تا ۱۰۰"
          class="tnum w-24"
          @update:model-value="(v) => (newDiscountPercent = v === '' ? null : Number(v))"
        />
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">تاریخ انقضا (اختیاری)</label>
          <JalaliDatePicker v-model="newExpiresAt" placeholder="بدون انقضا" class="w-40" />
        </div>
        <AppInput
          :model-value="newMaxRedemptions === null ? '' : String(newMaxRedemptions)"
          label="سقف تعداد استفاده (اختیاری)"
          type="number"
          min="1"
          placeholder="نامحدود"
          class="tnum w-32"
          @update:model-value="(v) => (newMaxRedemptions = v === '' ? null : Number(v))"
        />
        <AppButton type="submit" variant="primary" :disabled="submitting || !newCode.trim() || !newDiscountPercent">
          <template #icon><AppIcon name="plus" :size="16" /></template>
          افزودن
        </AppButton>
      </form>
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
      <p class="text-sm text-(--color-text-muted)">خطا در دریافت کدهای تخفیف.</p>
      <AppButton type="button" variant="secondary" data-testid="retry-load" @click="load">تلاش دوباره</AppButton>
    </AppCard>

    <EmptyState v-else-if="!loading && coupons.length === 0" icon="coupon" message="هنوز کد تخفیفی ثبت نشده است." />

    <AppCard v-else :padded="false" class="overflow-hidden">
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
                <th scope="col" class="px-5 py-3 font-semibold">کد</th>
                <th scope="col" class="px-5 py-3 font-semibold">درصد تخفیف</th>
                <th scope="col" class="px-5 py-3 font-semibold">تاریخ انقضا</th>
                <th scope="col" class="px-5 py-3 font-semibold">سقف استفاده</th>
                <th scope="col" class="px-5 py-3 font-semibold">تعداد استفاده‌شده</th>
                <th scope="col" class="px-5 py-3 font-semibold">وضعیت</th>
                <th scope="col" class="px-5 py-3"></th>
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
                  <!-- Coupon-term edits (discount/expiry/cap) get their own confirm-before-commit
                       sub-step, same spirit as ReferralSettingsView.vue's per-row confirm: a
                       diff list of only the fields that actually changed, Confirm commits via
                       saveEdit, Cancel returns to the edit inputs with typed values intact. -->
                  <template v-if="confirmingEditId === coupon.id">
                    <td ref="editConfirmRef" colspan="5" class="px-5 py-3.5 text-sm text-(--color-text)">
                      <p class="mb-1.5 font-semibold">تغییرات کد «{{ coupon.code }}» ثبت شود؟</p>
                      <ul class="tnum space-y-1 text-xs text-(--color-text-muted)">
                        <li v-for="diff in buildEditDiffs()" :key="diff.key">
                          <span class="font-semibold text-(--color-text)">{{ diff.label }}:</span>
                          {{ diff.oldText }} ← {{ diff.newText }}
                        </li>
                      </ul>
                    </td>
                    <td class="px-5 py-3.5">
                      <AppButton data-testid="confirm-edit" variant="primary" :disabled="submitting" @click="saveEdit">
                        تأیید
                      </AppButton>
                      <AppButton
                        data-testid="cancel-edit-confirm"
                        variant="ghost"
                        class="mr-3"
                        :disabled="submitting"
                        @click="confirmingEditId = null"
                      >
                        انصراف
                      </AppButton>
                    </td>
                  </template>

                  <template v-else>
                    <td ref="editRowRef" class="px-5 py-3.5">
                      <AppInput
                        :model-value="editDiscountPercent === null ? '' : String(editDiscountPercent)"
                        type="number"
                        min="1"
                        max="100"
                        class="tnum w-20"
                        @update:model-value="(v) => (editDiscountPercent = v === '' ? null : Number(v))"
                      />
                    </td>
                    <td class="px-5 py-3.5">
                      <JalaliDatePicker v-model="editExpiresAt" placeholder="بدون انقضا" class="w-40" />
                    </td>
                    <td class="px-5 py-3.5">
                      <AppInput
                        :model-value="editMaxRedemptions === null ? '' : String(editMaxRedemptions)"
                        type="number"
                        min="1"
                        placeholder="نامحدود"
                        class="tnum w-24"
                        @update:model-value="(v) => (editMaxRedemptions = v === '' ? null : Number(v))"
                      />
                    </td>
                    <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ coupon.redeemedCount }}</td>
                    <td class="px-5 py-3.5">
                      <StatusBadge :label="coupon.isActive ? 'فعال' : 'غیرفعال'" :tone="coupon.isActive ? 'success' : 'neutral'" />
                    </td>
                    <td class="px-5 py-3.5">
                      <AppButton
                        variant="primary"
                        :disabled="submitting || editDiscountPercent === null"
                        @click="askEditConfirm(coupon)"
                      >
                        ذخیره
                      </AppButton>
                      <AppButton variant="ghost" class="mr-3" :disabled="submitting" @click="editingId = null">
                        انصراف
                      </AppButton>
                    </td>
                  </template>
                </template>

                <template v-else>
                  <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ formatDiscountPercent(coupon.discountPercent) }}</td>
                  <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ formatDate(coupon.expiresAt) }}</td>
                  <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ coupon.maxRedemptions ?? 'نامحدود' }}</td>
                  <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ coupon.redeemedCount }}</td>
                  <td :ref="(el) => setToggleCellEl(coupon.id, el)" class="px-5 py-3.5">
                    <!-- Delete and deactivate used to be two separate-looking entry points for
                         the exact same mutation (both just set is_active=false -- there is no
                         real deletion endpoint here). This status-badge toggle is now the single,
                         honest control for that action; its own inline confirm strip already
                         satisfies the Uniform Consequence Rule on its own. -->
                    <div v-if="confirmingToggleId === coupon.id" class="flex flex-wrap items-center gap-2">
                      <span
                        class="text-xs font-semibold"
                        :class="coupon.isActive ? 'text-(--tone-danger-text)' : 'text-(--tone-success-text)'"
                      >
                        {{ coupon.isActive ? 'غیرفعال شود؟' : 'فعال شود؟' }}
                      </span>
                      <AppButton
                        data-testid="confirm-toggle-active"
                        :variant="coupon.isActive ? 'danger' : 'primary'"
                        :disabled="submitting"
                        @click="toggleActive(coupon)"
                      >
                        تأیید
                      </AppButton>
                      <AppButton data-testid="cancel-toggle-active" variant="ghost" :disabled="submitting" @click="cancelToggle">
                        انصراف
                      </AppButton>
                    </div>
                    <!-- Wraps a StatusBadge pill, not text/icon content -- AppButton's own padded
                         chrome is neutralized (p-0) so this stays a tight click target around the
                         badge rather than growing a visible button box around it. -->
                    <AppButton
                      v-else
                      variant="ghost"
                      class="!p-0"
                      :disabled="submitting"
                      title="تغییر وضعیت فعال/غیرفعال"
                      aria-label="تغییر وضعیت فعال/غیرفعال"
                      @click="askToggle(coupon)"
                    >
                      <StatusBadge :label="coupon.isActive ? 'فعال' : 'غیرفعال'" :tone="coupon.isActive ? 'success' : 'neutral'" />
                    </AppButton>
                  </td>
                  <td :ref="(el) => setActionCellEl(coupon.id, el)" class="px-5 py-3.5">
                    <AppButton variant="secondary" :disabled="submitting" title="ویرایش" aria-label="ویرایش" @click="startEdit(coupon)">
                      <template #icon><AppIcon name="pencil" :size="15" /></template>
                    </AppButton>
                  </td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </AppCard>
  </div>
</template>
