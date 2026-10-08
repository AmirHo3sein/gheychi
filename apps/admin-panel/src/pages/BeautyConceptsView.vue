<!-- apps/admin-panel/src/pages/BeautyConceptsView.vue -->
<!-- The Beauty Guide's controlled vocabulary: the AI may only name concepts listed (and
     active) here, and a concept's category mapping is the ONLY way a guide ever reaches real
     salon services -- an unmapped concept is still shown to customers but never matched to
     a salon, hence the explicit «بدون نگاشت» warning. Same shape as CategoriesView.vue
     (create card on top, list below, inline edit); there is no delete -- stored guides
     reference concepts, so a concept is retired with isActive=false instead. -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useApi } from '@/composables/useApi'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect, { type SelectOption } from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import BeautyConceptForm, {
  BEAUTY_DOMAIN_LABEL,
  type BeautyConcept,
  type BeautyConceptPayload,
  type BeautyDomain,
  type CategoryOption,
} from '@/components/beauty-concepts/BeautyConceptForm.vue'

const DOMAINS = Object.keys(BEAUTY_DOMAIN_LABEL) as BeautyDomain[]

const { apiFetch } = useApi()
const concepts = ref<BeautyConcept[]>([])
const categories = ref<CategoryOption[]>([])
const loading = ref(true)
// A fetch failure must not be silently repainted as an empty state -- see
// CategoriesView.vue's identical loadError pattern.
const loadError = ref(false)
const creating = ref(false)
const editingId = ref<string | null>(null)
const submitting = ref(false)
const domainFilter = ref<string | number>('')

const domainFilterOptions: SelectOption[] = [
  { value: '', label: 'همه حوزه‌ها' },
  ...DOMAINS.map((d) => ({ value: d, label: BEAUTY_DOMAIN_LABEL[d] })),
]

const categoryNameById = computed(() => new Map(categories.value.map((c) => [c.id, c.name])))

const groups = computed(() =>
  DOMAINS.filter((d) => domainFilter.value === '' || domainFilter.value === d)
    .map((domain) => ({
      domain,
      label: BEAUTY_DOMAIN_LABEL[domain],
      concepts: concepts.value
        .filter((c) => c.domain === domain)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key)),
    }))
    .filter((g) => g.concepts.length > 0),
)

async function load() {
  loading.value = true
  loadError.value = false
  const [conceptsRes, categoriesRes] = await Promise.all([
    apiFetch<BeautyConcept[]>('/admin/beauty-concepts', { silent: true }),
    apiFetch<CategoryOption[]>('/categories', { silent: true }),
  ])
  if (conceptsRes.error || categoriesRes.error) {
    loadError.value = true
    concepts.value = []
  } else {
    concepts.value = conceptsRes.data ?? []
    categories.value = categoriesRes.data ?? []
  }
  loading.value = false
}

async function create(payload: BeautyConceptPayload) {
  submitting.value = true
  // Deliberately NOT silent: a duplicate key or an unknown category comes back as a 409 with
  // a Farsi message, which useApi surfaces through the standard toast path.
  const { data } = await apiFetch<BeautyConcept>('/admin/beauty-concepts', { method: 'POST', body: payload })
  submitting.value = false
  if (data) {
    concepts.value.push(data)
    // Unmounting the form is what resets its draft for the next create.
    creating.value = false
  }
}

async function saveEdit(id: string, payload: BeautyConceptPayload) {
  submitting.value = true
  const { data } = await apiFetch<BeautyConcept>(`/admin/beauty-concepts/${id}`, { method: 'PATCH', body: payload })
  submitting.value = false
  if (data) {
    const index = concepts.value.findIndex((c) => c.id === data.id)
    if (index !== -1) concepts.value[index] = data
    editingId.value = null
  }
}

onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-5 p-4 sm:p-6 lg:p-8">
    <AppCard>
      <div v-if="!creating" class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-(--color-text-muted)">
          هوش مصنوعی فقط مفاهیم فعال این فهرست را تشخیص می‌دهد؛ نگاشت به دسته‌بندی، مفهوم را به خدمات واقعی سالن‌ها وصل می‌کند.
        </p>
        <AppButton variant="primary" data-testid="new-concept" @click="creating = true; editingId = null">
          <template #icon><AppIcon name="plus" :size="16" /></template>
          افزودن مفهوم
        </AppButton>
      </div>
      <div v-else>
        <p class="mb-3 flex items-center gap-2 text-sm font-semibold text-(--color-text)">
          <AppIcon name="plus" :size="16" class="text-(--color-accent-text)" />
          افزودن مفهوم جدید
        </p>
        <BeautyConceptForm
          mode="create"
          :categories="categories"
          :submitting="submitting"
          @submit="create"
          @cancel="creating = false"
        />
      </div>
    </AppCard>

    <div v-if="loading" class="flex items-center justify-center py-16" role="status" aria-label="در حال بارگذاری">
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
      <p class="text-sm text-(--color-text-muted)">خطا در دریافت مفاهیم راهنمای زیبایی.</p>
      <AppButton type="button" variant="secondary" data-testid="retry-load" @click="load">تلاش دوباره</AppButton>
    </AppCard>

    <EmptyState
      v-else-if="concepts.length === 0"
      icon="sparkles"
      message="هنوز مفهومی ثبت نشده است. برای افزودن، از دکمه بالا استفاده کنید."
    />

    <template v-else>
      <AppSelect
        v-model="domainFilter"
        label="حوزه"
        :options="domainFilterOptions"
        data-testid="domain-filter"
      />

      <section v-for="group in groups" :key="group.domain" class="space-y-2.5" :data-testid="`domain-group-${group.domain}`">
        <h2 class="flex items-center gap-2 px-1 text-sm font-bold text-(--color-text)">
          {{ group.label }}
          <span class="text-xs font-normal text-(--color-text-muted)">({{ group.concepts.length.toLocaleString('fa-IR') }})</span>
        </h2>

        <AppCard v-for="concept in group.concepts" :key="concept.id" :data-testid="`concept-${concept.key}`">
          <BeautyConceptForm
            v-if="editingId === concept.id"
            mode="edit"
            :initial="concept"
            :categories="categories"
            :submitting="submitting"
            @submit="saveEdit(concept.id, $event)"
            @cancel="editingId = null"
          />
          <div v-else class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0 space-y-1.5">
              <div class="flex flex-wrap items-center gap-2">
                <p class="text-sm font-semibold text-(--color-text)">
                  {{ concept.nameFa }} (<span dir="ltr">{{ concept.nameEn }}</span>)
                </p>
                <StatusBadge :label="concept.isActive ? 'فعال' : 'غیرفعال'" :tone="concept.isActive ? 'success' : 'neutral'" />
              </div>
              <p class="font-mono text-xs text-(--color-text-muted)" dir="ltr">{{ concept.key }}</p>
              <p class="text-xs text-(--color-text-muted)">
                دسته‌بندی:
                <span v-if="concept.categoryId !== null" class="font-semibold text-(--color-text)" data-testid="concept-category">
                  {{ categoryNameById.get(concept.categoryId) ?? `#${concept.categoryId}` }}
                </span>
                <StatusBadge
                  v-else
                  label="بدون نگاشت"
                  tone="warning"
                  data-testid="concept-unmapped"
                  title="به مشتری نمایش داده می‌شود اما به هیچ سالنی وصل نمی‌شود"
                />
              </p>
              <p v-if="concept.keywords.length" class="break-words text-xs text-(--color-text-muted)" data-testid="concept-keywords">
                کلیدواژه‌ها: {{ concept.keywords.join('، ') }}
              </p>
            </div>
            <AppButton
              variant="secondary"
              :disabled="submitting"
              title="ویرایش"
              :data-testid="`edit-concept-${concept.key}`"
              @click="editingId = concept.id; creating = false"
            >
              <template #icon><AppIcon name="pencil" :size="15" /></template>
            </AppButton>
          </div>
        </AppCard>
      </section>
    </template>
  </div>
</template>
