<!-- apps/admin-panel/src/pages/CategoriesView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useApi } from '@/composables/useApi'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon, { type IconName } from '@/components/ui/AppIcon.vue'

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

const KNOWN_ICONS: IconName[] = ['scissors', 'palette', 'droplet', 'nail', 'sparkles', 'brush', 'eye', 'razor', 'pencil']

// The icon field is a free-text key set by whoever created the category (no upload/picker
// exists per this app's design). Known keys map to a real glyph; anything else falls back
// to a generic tag icon instead of rendering raw, possibly-English text in the UI.
function iconFor(icon: string): IconName {
  return (KNOWN_ICONS as string[]).includes(icon) ? (icon as IconName) : 'tag'
}

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
  <div class="mx-auto max-w-3xl space-y-5 p-8">
    <AppCard>
      <p class="mb-3 flex items-center gap-2 text-sm font-semibold text-(--color-text)">
        <AppIcon name="plus" :size="16" class="text-(--color-accent)" />
        افزودن دسته‌بندی جدید
      </p>
      <form class="flex gap-2.5" @submit.prevent="add">
        <input
          v-model="newIcon"
          placeholder="کلید آیکون"
          maxlength="20"
          class="w-28 rounded-xl border border-(--color-border) p-2.5 text-sm"
        />
        <input
          v-model="newName"
          placeholder="نام دسته‌بندی"
          maxlength="60"
          class="flex-1 rounded-xl border border-(--color-border) p-2.5 text-sm"
        />
        <button
          type="submit"
          :disabled="submitting || !newName.trim()"
          class="inline-flex shrink-0 items-center gap-2 rounded-xl bg-(--color-accent) px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <AppIcon name="plus" :size="16" />
          افزودن
        </button>
      </form>
    </AppCard>

    <div>
      <p class="mb-3 text-sm font-bold text-(--color-muted)">{{ categories.length }} دسته‌بندی</p>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <AppCard
          v-for="category in categories"
          :key="category.id"
          :padded="false"
          class="flex items-center gap-3 p-3.5 transition-shadow hover:shadow-(--shadow-pop)"
        >
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--color-border-soft) text-(--color-accent)">
            <AppIcon :name="iconFor(category.icon)" :size="19" />
          </div>
          <input
            v-if="editingId === category.id"
            v-model="editName"
            maxlength="60"
            class="min-w-0 flex-1 rounded-lg border border-(--color-border) p-1.5 text-sm"
          />
          <span v-else class="min-w-0 flex-1 truncate text-sm font-semibold text-(--color-text)">{{ category.name }}</span>
          <button
            v-if="editingId === category.id"
            type="button"
            :disabled="submitting"
            class="shrink-0 text-sm font-semibold text-(--color-accent) disabled:opacity-40"
            @click="saveEdit"
          >
            ذخیره
          </button>
          <button
            v-else
            type="button"
            :disabled="submitting"
            class="shrink-0 rounded-lg p-1.5 text-(--color-muted) transition-colors hover:bg-(--color-border-soft) hover:text-(--color-accent) disabled:opacity-40"
            title="ویرایش"
            @click="startEdit(category)"
          >
            <AppIcon name="pencil" :size="15" />
          </button>
        </AppCard>
      </div>
    </div>
  </div>
</template>
