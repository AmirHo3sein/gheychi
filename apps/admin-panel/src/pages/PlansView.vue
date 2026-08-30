<!-- apps/admin-panel/src/pages/PlansView.vue -->
<!-- Admin CRUD for subscription plans (Phase 2/3 of the monetization initiative -- see
     docs/technical-overview/30-subscription-plan-foundation.md). FREE/PLUS/PREMIUM are
     launch examples, not hardcoded here: every plan (name/price/entitlements) is created
     and edited from this screen. `entitlements` is edited as raw JSON -- no phase before
     this one gives any specific key real meaning, so a fixed-field form would invent
     structure nothing reads yet; a JSON editor stays honest about that and needs no changes
     as later phases add real keys. -->
<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppMoneyInput from '@/components/ui/AppMoneyInput.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { formatToman } from '@/utils/format-toman'

interface Plan {
  id: string
  key: string
  name: string
  description: string | null
  monthlyPriceToman: number
  isActive: boolean
  isDefault: boolean
  sortOrder: number
  entitlements: Record<string, unknown>
}

const { apiFetch } = useApi()
const { push: pushToast } = useToast()
const plans = ref<Plan[]>([])
const loading = ref(true)
const loadError = ref(false)

async function load() {
  loading.value = true
  loadError.value = false
  const { data, error } = await apiFetch<Plan[]>('/admin/plans', { silent: true })
  if (error || !data) {
    loadError.value = true
    plans.value = []
  } else {
    plans.value = data
  }
  loading.value = false
}
onMounted(load)

function formatEntitlements(entitlements: Record<string, unknown>): string {
  const keys = Object.keys(entitlements)
  if (keys.length === 0) return 'بدون محدودیت تعریف‌شده'
  return keys.map((k) => `${k}: ${JSON.stringify(entitlements[k])}`).join('، ')
}

// --- Create ---------------------------------------------------------------
const creating = ref(false)
const newKey = ref('')
const newName = ref('')
const newDescription = ref('')
const newPrice = ref('')
const newEntitlementsText = ref('{}')
const newEntitlementsError = ref('')
const submitting = ref(false)

function resetCreateForm() {
  newKey.value = ''
  newName.value = ''
  newDescription.value = ''
  newPrice.value = ''
  newEntitlementsText.value = '{}'
  newEntitlementsError.value = ''
}

function parseEntitlements(text: string): { value?: Record<string, unknown>; error?: string } {
  const trimmed = text.trim()
  if (trimmed === '') return { value: {} }
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'باید یک شیء JSON معتبر باشد (مثلا {"smsMonthlyQuota": 100})' }
    }
    return { value: parsed as Record<string, unknown> }
  } catch {
    return { error: 'JSON وارد‌شده معتبر نیست' }
  }
}

async function create() {
  if (!newKey.value.trim() || !newName.value.trim()) return
  const parsed = parseEntitlements(newEntitlementsText.value)
  if (parsed.error) {
    newEntitlementsError.value = parsed.error
    return
  }
  newEntitlementsError.value = ''
  submitting.value = true
  const { data } = await apiFetch<Plan>('/admin/plans', {
    method: 'POST',
    body: {
      key: newKey.value.trim(),
      name: newName.value.trim(),
      description: newDescription.value.trim() || undefined,
      monthlyPriceToman: newPrice.value === '' ? undefined : Number(newPrice.value),
      entitlements: parsed.value,
    },
  })
  submitting.value = false
  if (data) {
    plans.value.push(data)
    resetCreateForm()
    creating.value = false
    pushToast('پلن جدید ایجاد شد')
  }
}

// --- Edit -------------------------------------------------------------------
const editingId = ref<string | null>(null)
const editName = ref('')
const editDescription = ref('')
const editPrice = ref('')
const editEntitlementsText = ref('{}')
const editEntitlementsError = ref('')
// A ref bound inside v-for resolves to an array (one entry per rendered occurrence of the
// key, even though only one card is ever actually in edit mode at a time) -- not a single
// element, unlike a ref declared outside any v-for.
const editRowRef = ref<HTMLElement | HTMLElement[] | null>(null)

function startEdit(plan: Plan) {
  editingId.value = plan.id
  editName.value = plan.name
  editDescription.value = plan.description ?? ''
  editPrice.value = String(plan.monthlyPriceToman)
  editEntitlementsText.value = JSON.stringify(plan.entitlements, null, 2)
  editEntitlementsError.value = ''
}

watch(editingId, async (id) => {
  await nextTick()
  if (id === null) return
  const el = Array.isArray(editRowRef.value) ? editRowRef.value[0] : editRowRef.value
  el?.querySelector<HTMLElement>('input, textarea')?.focus()
})

async function saveEdit(plan: Plan) {
  const parsed = parseEntitlements(editEntitlementsText.value)
  if (parsed.error) {
    editEntitlementsError.value = parsed.error
    return
  }
  editEntitlementsError.value = ''
  submitting.value = true
  const { data } = await apiFetch<Plan>(`/admin/plans/${plan.id}`, {
    method: 'PATCH',
    body: {
      name: editName.value.trim(),
      description: editDescription.value.trim() || null,
      monthlyPriceToman: Number(editPrice.value),
      entitlements: parsed.value,
    },
  })
  submitting.value = false
  if (data) {
    Object.assign(plan, data)
    editingId.value = null
    pushToast('پلن به‌روزرسانی شد')
  }
}

// --- Active toggle / set-default / delete -----------------------------------
const confirmingToggleId = ref<string | null>(null)
const confirmingDefaultId = ref<string | null>(null)
const confirmingDeleteId = ref<string | null>(null)

async function toggleActive(plan: Plan) {
  submitting.value = true
  const { data } = await apiFetch<Plan>(`/admin/plans/${plan.id}`, { method: 'PATCH', body: { isActive: !plan.isActive } })
  submitting.value = false
  confirmingToggleId.value = null
  if (data) Object.assign(plan, data)
}

async function setDefault(plan: Plan) {
  submitting.value = true
  const { data } = await apiFetch<Plan>(`/admin/plans/${plan.id}`, { method: 'PATCH', body: { isDefault: true } })
  submitting.value = false
  confirmingDefaultId.value = null
  if (data) {
    // The server unsets every other plan's flag atomically -- mirror that locally rather
    // than a full reload.
    plans.value.forEach((p) => (p.isDefault = p.id === plan.id))
    pushToast(`«${plan.name}» پلن پیش‌فرض شد`)
  }
}

async function remove(plan: Plan) {
  submitting.value = true
  const { error } = await apiFetch(`/admin/plans/${plan.id}`, { method: 'DELETE' })
  submitting.value = false
  confirmingDeleteId.value = null
  // A 409 (default plan, or a salon still subscribed to it) is surfaced by useApi's own
  // toast path -- nothing special to do here beyond not removing the row.
  if (!error) plans.value = plans.value.filter((p) => p.id !== plan.id)
}
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-5 p-4 sm:p-8">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-lg font-bold text-(--color-text)">پلن‌های اشتراک</h1>
        <p class="mt-1 text-sm text-(--color-text-muted)">
          نام، قیمت و امکانات هر پلن از همین‌جا قابل تعریف است. اعمال محدودیت‌ها روی سالن‌ها در فازهای بعدی پیاده‌سازی می‌شود.
        </p>
      </div>
      <AppButton v-if="!creating" type="button" variant="primary" data-testid="new-plan-button" @click="creating = true">
        <template #icon><AppIcon name="plus" :size="16" /></template>
        پلن جدید
      </AppButton>
    </div>

    <AppCard v-if="creating" data-testid="create-plan-form">
      <form class="space-y-3" @submit.prevent="create">
        <div class="grid gap-3 sm:grid-cols-2">
          <AppInput v-model="newKey" label="شناسه داخلی (key)" placeholder="مثلا plus" data-testid="new-key-input" />
          <AppInput v-model="newName" label="نام نمایشی" placeholder="مثلا پلاس" data-testid="new-name-input" />
        </div>
        <AppInput v-model="newDescription" label="توضیح (اختیاری)" data-testid="new-description-input" />
        <AppMoneyInput v-model="newPrice" label="قیمت ماهانه (تومان)" data-testid="new-price-input" />
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">امکانات (JSON)</label>
          <textarea
            v-model="newEntitlementsText"
            data-testid="new-entitlements-input"
            rows="3"
            dir="ltr"
            class="w-full rounded-xl border border-(--color-text-muted) p-3 font-mono text-xs"
          />
          <p v-if="newEntitlementsError" data-testid="new-entitlements-error" class="mt-1 text-xs text-(--tone-danger-text)">
            {{ newEntitlementsError }}
          </p>
        </div>
        <div class="flex gap-2.5">
          <AppButton type="submit" variant="primary" data-testid="submit-new-plan" :disabled="submitting || !newKey.trim() || !newName.trim()">
            ایجاد پلن
          </AppButton>
          <AppButton type="button" variant="ghost" :disabled="submitting" @click="creating = false; resetCreateForm()">
            انصراف
          </AppButton>
        </div>
      </form>
    </AppCard>

    <div v-if="loading" data-testid="plans-loading" class="flex items-center justify-center gap-2 py-16 text-sm text-(--color-text-muted)">
      <AppIcon name="spinner" :size="20" class="animate-spin" />
      در حال بارگذاری پلن‌ها…
    </div>

    <AppCard
      v-else-if="loadError"
      :padded="false"
      data-testid="plans-load-error"
      class="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center"
    >
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-(--tone-danger-bg) text-(--tone-danger-text)">
        <AppIcon name="warning" :size="22" />
      </div>
      <p class="text-sm text-(--color-text-muted)">بارگذاری پلن‌ها با خطا مواجه شد.</p>
      <AppButton type="button" variant="secondary" data-testid="plans-retry" @click="load">تلاش مجدد</AppButton>
    </AppCard>

    <EmptyState v-else-if="plans.length === 0" icon="plan" message="هنوز پلنی تعریف نشده است." />

    <div v-else class="space-y-3">
      <AppCard v-for="plan in plans" :key="plan.id" data-testid="plan-card">
        <template v-if="editingId === plan.id">
          <div ref="editRowRef" class="space-y-3">
            <div class="grid gap-3 sm:grid-cols-2">
              <AppInput v-model="editName" label="نام نمایشی" :data-testid="`edit-name-${plan.key}`" />
              <AppMoneyInput v-model="editPrice" label="قیمت ماهانه (تومان)" :data-testid="`edit-price-${plan.key}`" />
            </div>
            <AppInput v-model="editDescription" label="توضیح (اختیاری)" />
            <div>
              <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">امکانات (JSON)</label>
              <textarea
                v-model="editEntitlementsText"
                :data-testid="`edit-entitlements-${plan.key}`"
                rows="4"
                dir="ltr"
                class="w-full rounded-xl border border-(--color-text-muted) p-3 font-mono text-xs"
              />
              <p v-if="editEntitlementsError" class="mt-1 text-xs text-(--tone-danger-text)">{{ editEntitlementsError }}</p>
            </div>
            <div class="flex gap-2.5">
              <AppButton type="button" variant="primary" :disabled="submitting" :data-testid="`save-edit-${plan.key}`" @click="saveEdit(plan)">
                ذخیره
              </AppButton>
              <AppButton type="button" variant="ghost" :disabled="submitting" @click="editingId = null">انصراف</AppButton>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="break-words text-base font-bold text-(--color-text)">{{ plan.name }}</h3>
                <StatusBadge v-if="plan.isDefault" data-testid="default-badge" label="پیش‌فرض" tone="info" />
                <StatusBadge :label="plan.isActive ? 'فعال' : 'غیرفعال'" :tone="plan.isActive ? 'success' : 'neutral'" />
              </div>
              <p class="mt-0.5 font-mono text-xs text-(--color-text-muted)" dir="ltr">{{ plan.key }}</p>
              <p v-if="plan.description" class="mt-1.5 text-sm text-(--color-text)">{{ plan.description }}</p>
            </div>
            <p class="shrink-0 text-sm font-bold text-(--color-text)">
              <span dir="ltr" class="tnum">{{ plan.monthlyPriceToman === 0 ? 'رایگان' : formatToman(plan.monthlyPriceToman) }}</span>
              <span v-if="plan.monthlyPriceToman > 0"> تومان/ماه</span>
            </p>
          </div>

          <p class="mt-3 break-words text-xs text-(--color-text-muted)">{{ formatEntitlements(plan.entitlements) }}</p>

          <div class="mt-4 flex flex-wrap items-center gap-2 border-t border-(--color-border-soft) pt-3.5">
            <AppButton type="button" variant="secondary" :data-testid="`edit-plan-${plan.key}`" @click="startEdit(plan)">
              <template #icon><AppIcon name="pencil" :size="15" /></template>
              ویرایش
            </AppButton>

            <template v-if="confirmingToggleId === plan.id">
              <span class="text-xs font-semibold" :class="plan.isActive ? 'text-(--tone-danger-text)' : 'text-(--tone-success-text)'">
                {{ plan.isActive ? 'غیرفعال شود؟' : 'فعال شود؟' }}
              </span>
              <AppButton type="button" :variant="plan.isActive ? 'danger' : 'primary'" :disabled="submitting" :data-testid="`confirm-toggle-active-${plan.key}`" @click="toggleActive(plan)">تأیید</AppButton>
              <AppButton type="button" variant="ghost" :disabled="submitting" @click="confirmingToggleId = null">انصراف</AppButton>
            </template>
            <AppButton v-else type="button" variant="ghost" :data-testid="`toggle-active-${plan.key}`" @click="confirmingToggleId = plan.id">
              {{ plan.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی' }}
            </AppButton>

            <template v-if="!plan.isDefault">
              <template v-if="confirmingDefaultId === plan.id">
                <span class="text-xs font-semibold text-(--tone-warning-text)">پیش‌فرض شود؟ (پلن سالن‌های جدید)</span>
                <AppButton type="button" variant="primary" :disabled="submitting" :data-testid="`confirm-set-default-${plan.key}`" @click="setDefault(plan)">تأیید</AppButton>
                <AppButton type="button" variant="ghost" :disabled="submitting" @click="confirmingDefaultId = null">انصراف</AppButton>
              </template>
              <AppButton v-else type="button" variant="ghost" :data-testid="`set-default-${plan.key}`" @click="confirmingDefaultId = plan.id">
                تنظیم به‌عنوان پیش‌فرض
              </AppButton>
            </template>

            <template v-if="confirmingDeleteId === plan.id">
              <span class="text-xs font-semibold text-(--tone-danger-text)">حذف شود؟</span>
              <AppButton type="button" variant="danger" :disabled="submitting" :data-testid="`confirm-delete-${plan.key}`" @click="remove(plan)">تأیید</AppButton>
              <AppButton type="button" variant="ghost" :disabled="submitting" @click="confirmingDeleteId = null">انصراف</AppButton>
            </template>
            <AppButton
              v-else
              type="button"
              variant="ghost"
              class="text-(--tone-danger-text)!"
              :disabled="plan.isDefault"
              :title="plan.isDefault ? 'پلن پیش‌فرض قابل حذف نیست' : 'حذف'"
              :data-testid="`delete-plan-${plan.key}`"
              @click="confirmingDeleteId = plan.id"
            >
              <template #icon><AppIcon name="x" :size="15" /></template>
              حذف
            </AppButton>
          </div>
        </template>
      </AppCard>
    </div>
  </div>
</template>
