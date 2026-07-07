<!-- apps/provider-panel/src/components/onboarding/FirstServiceStep.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useApi } from '@/composables/useApi'

const model = defineModel<{ categoryId: number | null; name: string; price: number; durationMin: number }>({
  required: true,
})

const { apiFetch } = useApi()
const categories = ref<{ id: number; name: string }[]>([])

onMounted(async () => {
  const { data } = await apiFetch<{ id: number; name: string }[]>('/categories', { silent: true })
  categories.value = data ?? []
})
</script>

<template>
  <div class="space-y-3">
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
