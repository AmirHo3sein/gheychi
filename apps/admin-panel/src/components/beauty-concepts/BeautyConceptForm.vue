<!-- apps/admin-panel/src/components/beauty-concepts/BeautyConceptForm.vue -->
<!-- The create AND inline-edit form for BeautyConceptsView -- one component so the two modes
     can never drift apart field-by-field. The parent owns the API call and the submitting
     flag; this component owns only the draft, its client-side validation (mirroring
     CreateBeautyConceptDto/UpdateBeautyConceptDto's bounds so a typo surfaces inline rather
     than as the generic 400 toast), and turning the raw inputs into the request body.
     `key` is only editable in create mode: stored guides and the AI contract speak keys, so
     the backend treats it as immutable (UpdateBeautyConceptDto has no key field at all). -->
<script lang="ts">
// Plain (non-setup) block: <script setup> can't export values, and the view shares these.
export type BeautyDomain = 'hair_color' | 'hair_cut_style' | 'nails' | 'brows_lashes' | 'makeup'

export interface BeautyConcept {
  id: string
  key: string
  domain: BeautyDomain
  nameFa: string
  nameEn: string
  categoryId: number | null
  keywords: string[]
  maintenanceFa: string | null
  isActive: boolean
  sortOrder: number
  createdAt: string
}

export interface CategoryOption {
  id: number
  name: string
}

export type BeautyConceptPayload = Omit<BeautyConcept, 'id' | 'createdAt' | 'key'> & { key?: string }

export const BEAUTY_DOMAIN_LABEL: Record<BeautyDomain, string> = {
  hair_color: 'رنگ مو',
  hair_cut_style: 'کوتاهی و حالت مو',
  nails: 'ناخن',
  brows_lashes: 'ابرو و مژه',
  makeup: 'آرایش',
}
</script>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect, { type SelectOption } from '@/components/ui/AppSelect.vue'
import { toEnglishDigits } from '@/utils/digits'

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/
// AppSelect's model is string | number, so "no category" travels as '' and maps to null.
const NO_CATEGORY = ''

const props = defineProps<{
  mode: 'create' | 'edit'
  initial?: BeautyConcept
  categories: CategoryOption[]
  submitting: boolean
}>()
const emit = defineEmits<{ submit: [payload: BeautyConceptPayload]; cancel: [] }>()

const draft = reactive({
  key: props.initial?.key ?? '',
  domain: (props.initial?.domain ?? 'hair_color') as string | number,
  nameFa: props.initial?.nameFa ?? '',
  nameEn: props.initial?.nameEn ?? '',
  categoryId: (props.initial?.categoryId ?? NO_CATEGORY) as string | number,
  keywordsText: props.initial?.keywords.join('، ') ?? '',
  maintenanceFa: props.initial?.maintenanceFa ?? '',
  isActive: props.initial?.isActive ?? true,
  sortOrderText: String(props.initial?.sortOrder ?? 0),
})
const error = ref('')

const domainOptions: SelectOption[] = (Object.keys(BEAUTY_DOMAIN_LABEL) as BeautyDomain[]).map((d) => ({
  value: d,
  label: BEAUTY_DOMAIN_LABEL[d],
}))
const categoryOptions = computed<SelectOption[]>(() => [
  { value: NO_CATEGORY, label: 'بدون دسته‌بندی' },
  ...props.categories.map((c) => ({ value: c.id, label: c.name })),
])

// Accepts both the Latin and the Persian comma -- an admin typing in a Persian keyboard
// layout gets «،», and silently treating "a، b" as one keyword would be a real mis-match.
function parseKeywords(text: string): string[] {
  const parts = text.split(/[,،]/).map((k) => k.trim()).filter((k) => k !== '')
  return [...new Set(parts)]
}

function submit() {
  const nameFa = draft.nameFa.trim()
  const nameEn = draft.nameEn.trim()
  const keywords = parseKeywords(draft.keywordsText)
  const sortOrderRaw = toEnglishDigits(draft.sortOrderText.trim())
  const sortOrder = Number(sortOrderRaw)
  const key = draft.key.trim()
  const maintenance = draft.maintenanceFa.trim()

  if (props.mode === 'create' && (key.length < 2 || key.length > 60 || !KEY_PATTERN.test(key))) {
    error.value = 'کلید باید ۲ تا ۶۰ نویسه، با حرف کوچک انگلیسی شروع شود و فقط شامل حروف کوچک، عدد و _ باشد.'
    return
  }
  if (!nameFa || !nameEn) {
    error.value = 'نام فارسی و انگلیسی الزامی است.'
    return
  }
  if (nameFa.length > 80 || nameEn.length > 80) {
    error.value = 'نام حداکثر ۸۰ نویسه است.'
    return
  }
  if (keywords.length > 20 || keywords.some((k) => k.length > 60)) {
    error.value = 'حداکثر ۲۰ کلیدواژه، هر کدام حداکثر ۶۰ نویسه.'
    return
  }
  if (maintenance.length > 500) {
    error.value = 'متن نگهداری حداکثر ۵۰۰ نویسه است.'
    return
  }
  if (sortOrderRaw === '' || !Number.isInteger(sortOrder) || sortOrder < 0) {
    error.value = 'ترتیب نمایش باید عدد صحیح صفر یا بیشتر باشد.'
    return
  }
  error.value = ''

  const payload: BeautyConceptPayload = {
    domain: draft.domain as BeautyDomain,
    nameFa,
    nameEn,
    categoryId: draft.categoryId === NO_CATEGORY ? null : Number(draft.categoryId),
    keywords,
    maintenanceFa: maintenance === '' ? null : maintenance,
    isActive: draft.isActive,
    sortOrder,
  }
  if (props.mode === 'create') payload.key = key
  emit('submit', payload)
}
</script>

<template>
  <form class="space-y-3" data-testid="concept-form" @submit.prevent="submit">
    <div class="grid gap-3 sm:grid-cols-2">
      <div v-if="mode === 'create'">
        <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">کلید (انگلیسی، غیرقابل تغییر)</label>
        <AppInput v-model="draft.key" data-testid="concept-key-input" dir="ltr" placeholder="balayage" :maxlength="60" />
      </div>
      <AppSelect v-model="draft.domain" label="حوزه" :options="domainOptions" width="100%" data-testid="concept-domain-select" />
      <div>
        <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">نام فارسی</label>
        <AppInput v-model="draft.nameFa" data-testid="concept-name-fa-input" :maxlength="80" />
      </div>
      <div>
        <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">نام انگلیسی</label>
        <AppInput v-model="draft.nameEn" data-testid="concept-name-en-input" dir="ltr" :maxlength="80" />
      </div>
      <div>
        <AppSelect
          v-model="draft.categoryId"
          label="دسته‌بندی خدمات (برای پیدا کردن سالن‌ها)"
          :options="categoryOptions"
          width="100%"
          searchable
          data-testid="concept-category-select"
        />
      </div>
      <div>
        <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">ترتیب نمایش</label>
        <AppInput v-model="draft.sortOrderText" data-testid="concept-sort-input" dir="ltr" inputmode="numeric" />
      </div>
    </div>

    <div>
      <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">کلیدواژه‌ها (با ویرگول جدا کنید)</label>
      <AppInput v-model="draft.keywordsText" data-testid="concept-keywords-input" placeholder="بالیاژ، balayage" />
    </div>

    <div>
      <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">متن نگهداری (اختیاری)</label>
      <textarea
        v-model="draft.maintenanceFa"
        data-testid="concept-maintenance-input"
        rows="3"
        maxlength="500"
        class="w-full rounded-xl border border-(--color-border) bg-(--color-surface-card) p-3 text-sm text-(--color-text)"
      />
      <p class="mt-1 text-xs text-(--tone-warning-text)">هشدار — متن نگهداری باید محتاطانه باشد، بدون وعده یا برنامه قطعی.</p>
    </div>

    <label class="flex items-center gap-2 text-sm text-(--color-text)">
      <input v-model="draft.isActive" type="checkbox" data-testid="concept-active-input" class="h-4 w-4" />
      فعال (غیرفعال‌ها به هوش مصنوعی پیشنهاد نمی‌شوند)
    </label>

    <p v-if="error" data-testid="concept-form-error" class="text-xs text-(--tone-danger-text)">{{ error }}</p>

    <div class="flex flex-wrap gap-2.5">
      <AppButton type="submit" variant="primary" data-testid="concept-submit" :disabled="submitting" :loading="submitting">
        {{ mode === 'create' ? 'افزودن مفهوم' : 'ذخیره' }}
      </AppButton>
      <AppButton type="button" variant="ghost" data-testid="concept-cancel" :disabled="submitting" @click="emit('cancel')">
        انصراف
      </AppButton>
    </div>
  </form>
</template>
