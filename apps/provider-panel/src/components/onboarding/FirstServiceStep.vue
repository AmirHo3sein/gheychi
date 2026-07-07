<!-- apps/provider-panel/src/components/onboarding/FirstServiceStep.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useApi } from '@/composables/useApi'

const model = defineModel<{ categoryId: number | null; name: string; price: number; durationMin: number }>({
  required: true,
})

const { apiFetch } = useApi()
const categories = ref<{ id: number; name: string }[]>([])
const loadError = ref(false)

async function loadCategories() {
  loadError.value = false
  const { data, error } = await apiFetch<{ id: number; name: string }[]>('/categories', { silent: true })
  if (error) {
    loadError.value = true
    return
  }
  categories.value = data ?? []
}

onMounted(loadCategories)
</script>

<template>
  <div v-if="loadError" class="space-y-3">
    <p class="text-sm text-red-600">دسته‌بندی‌ها بارگذاری نشد.</p>
    <button
      type="button"
      data-testid="retry-categories"
      class="rounded-lg border px-4 py-2 text-sm"
      @click="loadCategories"
    >
      تلاش دوباره
    </button>
  </div>
  <div v-else class="space-y-3">
    <select v-model.number="model.categoryId" data-testid="service-category" class="w-full rounded-lg border p-3">
      <option :value="null" disabled>دسته‌بندی خدمت</option>
      <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
    </select>
    <input v-model="model.name" data-testid="service-name" placeholder="نام خدمت" class="w-full rounded-lg border p-3" />
    <input
      v-model.number="model.price"
      data-testid="service-price"
      type="number"
      min="0"
      placeholder="قیمت (تومان)"
      class="w-full rounded-lg border p-3"
    />
    <input
      v-model.number="model.durationMin"
      data-testid="service-duration"
      type="number"
      min="5"
      max="600"
      placeholder="مدت زمان (دقیقه)"
      class="w-full rounded-lg border p-3"
    />
  </div>
</template>
