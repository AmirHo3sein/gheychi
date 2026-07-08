<!-- apps/admin-panel/src/pages/CategoriesView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useApi } from '@/composables/useApi'

interface Category {
  id: number
  name: string
  icon: string
}

const { apiFetch } = useApi()
const categories = ref<Category[]>([])
const newName = ref('')
const newIcon = ref('')
const editingId = ref<number | null>(null)
const editName = ref('')
const submitting = ref(false)

async function load() {
  const { data } = await apiFetch<Category[]>('/categories', { silent: true })
  categories.value = data ?? []
}

async function add() {
  submitting.value = true
  const { data } = await apiFetch<Category>('/admin/categories', {
    method: 'POST',
    body: { name: newName.value, icon: newIcon.value },
  })
  submitting.value = false
  if (data) {
    categories.value.push(data)
    newName.value = ''
    newIcon.value = ''
  }
}

function startEdit(category: Category) {
  editingId.value = category.id
  editName.value = category.name
}

async function saveEdit() {
  submitting.value = true
  const { data } = await apiFetch<Category>(`/admin/categories/${editingId.value}`, {
    method: 'PATCH',
    body: { name: editName.value },
  })
  submitting.value = false
  if (data) {
    const category = categories.value.find((c) => c.id === data.id)
    if (category) category.name = data.name
    editingId.value = null
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-4 p-6">
    <h1 class="text-lg font-bold">دسته‌بندی‌ها</h1>

    <ul class="space-y-2">
      <li v-for="category in categories" :key="category.id" class="flex items-center gap-3 rounded-lg border p-2">
        <span>{{ category.icon }}</span>
        <input v-if="editingId === category.id" v-model="editName" maxlength="60" class="flex-1 rounded border p-1 text-sm" />
        <span v-else class="flex-1">{{ category.name }}</span>
        <button
          v-if="editingId === category.id"
          type="button"
          :disabled="submitting"
          class="text-sm text-(--color-accent)"
          @click="saveEdit"
        >
          ذخیره
        </button>
        <button
          v-else
          type="button"
          :disabled="submitting"
          class="text-sm text-(--color-accent)"
          @click="startEdit(category)"
        >
          ویرایش
        </button>
      </li>
    </ul>

    <form class="flex gap-2" @submit.prevent="add">
      <input v-model="newIcon" placeholder="آیکون" maxlength="20" class="w-20 rounded-lg border p-2 text-sm" />
      <input v-model="newName" placeholder="نام دسته‌بندی جدید" maxlength="60" class="flex-1 rounded-lg border p-2 text-sm" />
      <button type="submit" :disabled="submitting" class="rounded-lg bg-(--color-accent) px-4 py-2 text-sm text-white">
        افزودن
      </button>
    </form>
  </div>
</template>
