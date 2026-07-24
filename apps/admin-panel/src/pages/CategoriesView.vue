<!-- apps/admin-panel/src/pages/CategoriesView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useApi } from '@/composables/useApi'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon, { type IconName } from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'

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
const confirmingId = ref<number | null>(null)

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
  confirmingId.value = null
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

function askDelete(category: Category) {
  confirmingId.value = category.id
  editingId.value = null
}

async function confirmDelete() {
  if (submitting.value) return
  const id = confirmingId.value
  if (id === null) return
  submitting.value = true
  // Deliberately NOT silent: a category still referenced by salon services comes back as a
  // 409 with a Farsi message, which useApi surfaces through the standard toast path.
  const { error } = await apiFetch(`/admin/categories/${id}`, { method: 'DELETE' })
  submitting.value = false
  confirmingId.value = null
  // On any error the row stays as-is (a 404 from a concurrent delete leaves it stale until
  // the next page load) — accepted staleness for an admin tool, same reactive philosophy as
  // the rest of the moderation surfaces.
  if (!error) categories.value = categories.value.filter((c) => c.id !== id)
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
        <AppInput v-model="newIcon" placeholder="کلید آیکون" :maxlength="20" class="w-28" />
        <div class="min-w-0 flex-1">
          <AppInput v-model="newName" placeholder="نام دسته‌بندی" :maxlength="60" />
        </div>
        <AppButton type="submit" variant="primary" :disabled="submitting || !newName.trim()">
          <template #icon><AppIcon name="plus" :size="16" /></template>
          افزودن
        </AppButton>
      </form>
    </AppCard>

    <div>
      <p class="mb-3 text-sm font-bold text-(--color-text-muted)">{{ categories.length }} دسته‌بندی</p>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <AppCard
          v-for="category in categories"
          :key="category.id"
          :padded="false"
          class="flex items-center gap-3 p-3.5 transition-shadow hover:shadow-(--shadow-lg)"
        >
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--color-border-soft) text-(--color-accent)">
            <AppIcon :name="iconFor(category.icon)" :size="19" />
          </div>

          <template v-if="confirmingId === category.id">
            <span class="min-w-0 flex-1 truncate text-sm font-semibold text-(--tone-danger-text)">
              «{{ category.name }}» حذف شود؟
            </span>
            <AppButton data-testid="confirm-delete" variant="danger" :disabled="submitting" @click="confirmDelete">
              حذف
            </AppButton>
            <AppButton data-testid="cancel-delete" variant="ghost" :disabled="submitting" @click="confirmingId = null">
              انصراف
            </AppButton>
          </template>

          <template v-else>
            <div v-if="editingId === category.id" class="min-w-0 flex-1">
              <AppInput v-model="editName" :maxlength="60" />
            </div>
            <span v-else class="min-w-0 flex-1 truncate text-sm font-semibold text-(--color-text)">{{ category.name }}</span>
            <AppButton v-if="editingId === category.id" variant="primary" :disabled="submitting" @click="saveEdit">
              ذخیره
            </AppButton>
            <template v-else>
              <AppButton variant="secondary" :disabled="submitting" title="ویرایش" @click="startEdit(category)">
                <template #icon><AppIcon name="pencil" :size="15" /></template>
              </AppButton>
              <AppButton
                data-testid="delete-category"
                variant="danger"
                :disabled="submitting"
                title="حذف"
                @click="askDelete(category)"
              >
                <template #icon><AppIcon name="x" :size="15" /></template>
              </AppButton>
            </template>
          </template>
        </AppCard>
      </div>
    </div>
  </div>
</template>
