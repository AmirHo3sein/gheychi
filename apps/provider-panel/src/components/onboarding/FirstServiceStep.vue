<!-- apps/provider-panel/src/components/onboarding/FirstServiceStep.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useApi } from '@/composables/useApi'
import AppInput from '../ui/AppInput.vue'
import AppButton from '../ui/AppButton.vue'
import AppIcon from '../ui/AppIcon.vue'

const model = defineModel<{ categoryId: number | null; name: string; price: number; durationMin: number }>({
  required: true,
})

const { apiFetch } = useApi()
const categories = ref<{ id: number; name: string }[]>([])
const loading = ref(true)
const loadError = ref(false)

async function loadCategories() {
  loading.value = true
  loadError.value = false
  const { data, error } = await apiFetch<{ id: number; name: string }[]>('/categories', { silent: true })
  if (error) {
    loadError.value = true
    loading.value = false
    return
  }
  categories.value = data ?? []
  loading.value = false
}

onMounted(loadCategories)
</script>

<template>
  <div v-if="loadError" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
    <p class="text-sm text-(--tone-danger-text)">دسته‌بندی‌ها بارگذاری نشد.</p>
    <AppButton
      variant="secondary"
      data-testid="retry-categories"
      @click="loadCategories"
    >
      تلاش دوباره
    </AppButton>
  </div>
  <div v-else-if="loading" class="flex items-center justify-center py-8 text-(--color-text-muted)">
    <AppIcon name="spinner" :size="20" class="animate-spin" />
  </div>
  <div
    v-else-if="categories.length === 0"
    data-testid="no-categories"
    class="space-y-1 rounded-xl border border-dashed border-(--color-border) p-4 text-center"
  >
    <p class="text-sm font-medium text-(--color-text)">هنوز هیچ دسته‌بندی خدمتی در پلتفرم تعریف نشده است.</p>
    <p class="text-xs text-(--color-text-muted)">برای افزودن اولین خدمت، ابتدا باید مدیریت پلتفرم دسته‌بندی تعریف کند. بعداً دوباره سر بزنید.</p>
  </div>
  <div v-else class="space-y-4">
    <div>
      <label class="mb-1.5 block text-sm font-semibold text-(--color-text)">دسته‌بندی خدمت</label>
      <select
        v-model.number="model.categoryId"
        data-testid="service-category"
        class="native-select w-full rounded-xl border border-(--color-border) bg-(--color-surface-card) p-3 text-sm"
      >
        <option :value="null" disabled>انتخاب کنید</option>
        <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
    </div>
    <AppInput
      v-model="model.name"
      label="نام خدمت"
      data-testid="service-name"
      placeholder="مثلاً کوتاهی مو زنانه"
    />
    <div class="grid grid-cols-2 gap-3">
      <AppInput
        :model-value="String(model.price)"
        label="قیمت (تومان)"
        data-testid="service-price"
        type="number"
        min="0"
        class="tnum"
        @update:model-value="model.price = Number($event)"
      />
      <AppInput
        :model-value="String(model.durationMin)"
        label="مدت زمان (دقیقه)"
        data-testid="service-duration"
        type="number"
        min="5"
        max="600"
        class="tnum"
        @update:model-value="model.durationMin = Number($event)"
      />
    </div>
  </div>
</template>
