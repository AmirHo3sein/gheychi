<!-- apps/admin-panel/src/pages/CategoriesView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useApi } from '@/composables/useApi'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon, { type IconName } from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import EmptyState from '@/components/ui/EmptyState.vue'

interface Category {
  id: number
  name: string
  icon: string
}

const { apiFetch } = useApi()
const categories = ref<Category[]>([])
const loading = ref(true)
// A fetch failure must not be silently repainted as an empty state -- see
// SalonsView.vue's identical loadError pattern.
const loadError = ref(false)
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
  loading.value = true
  loadError.value = false
  const { data, error } = await apiFetch<Category[]>('/categories', { silent: true })
  if (error) {
    loadError.value = true
    categories.value = []
  } else {
    categories.value = data ?? []
  }
  loading.value = false
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

function cancelEdit() {
  editingId.value = null
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

<!-- p-8 from `sm` up (unchanged); below that 64px of gutter is a fifth of a 320px screen. -->
<template>
  <div class="mx-auto max-w-3xl space-y-5 p-4 sm:p-8">
    <AppCard>
      <p class="mb-3 flex items-center gap-2 text-sm font-semibold text-(--color-text)">
        <AppIcon name="plus" :size="16" class="text-(--color-accent-text)" />
        افزودن دسته‌بندی جدید
      </p>
      <!-- flex-wrap: the icon key field + its 44px preview tile is ~165px that cannot shrink,
           so on a narrow screen the name field and the submit button wrap onto their own
           lines rather than pushing the button out of the card. Single row from `sm` up. -->
      <form class="flex flex-wrap items-end gap-2.5" @submit.prevent="add">
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">کلید آیکون</label>
          <div class="flex items-center gap-2">
            <AppInput v-model="newIcon" placeholder="کلید آیکون" :maxlength="20" class="w-28" />
            <div
              data-testid="new-icon-preview"
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--color-border-soft) text-(--color-accent-text)"
              title="پیش‌نمایش آیکون"
            >
              <AppIcon :name="iconFor(newIcon)" :size="19" />
            </div>
          </div>
        </div>
        <div class="min-w-0 flex-1">
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">نام دسته‌بندی</label>
          <AppInput v-model="newName" placeholder="نام دسته‌بندی" :maxlength="60" />
        </div>
        <AppButton type="submit" variant="primary" :disabled="submitting || !newName.trim()">
          <template #icon><AppIcon name="plus" :size="16" /></template>
          افزودن
        </AppButton>
      </form>
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
      <p class="text-sm text-(--color-text-muted)">خطا در دریافت دسته‌بندی‌ها.</p>
      <AppButton type="button" variant="secondary" data-testid="retry-load" @click="load">تلاش دوباره</AppButton>
    </AppCard>

    <EmptyState
      v-else-if="categories.length === 0"
      icon="tag"
      message="هنوز دسته‌بندی‌ای ثبت نشده است. برای افزودن، از فرم بالا استفاده کنید."
    />

    <AppCard v-else :padded="false" class="overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-right text-sm">
          <thead>
            <tr class="border-b border-(--color-border) bg-(--color-border-soft) text-xs text-(--color-text-muted)">
              <th class="px-5 py-3 font-semibold">آیکون</th>
              <th class="px-5 py-3 font-semibold">نام دسته‌بندی</th>
              <th class="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="category in categories"
              :key="category.id"
              class="border-b border-(--color-border-soft) transition-colors last:border-0 hover:bg-(--color-border-soft)"
            >
              <td class="px-5 py-3.5">
                <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-(--color-border-soft) text-(--color-accent-text)">
                  <AppIcon :name="iconFor(category.icon)" :size="19" />
                </div>
              </td>

              <template v-if="confirmingId === category.id">
                <td colspan="2" class="px-5 py-3.5">
                  <div class="flex flex-wrap items-center gap-2.5">
                    <span class="text-sm font-semibold text-(--tone-danger-text)">«{{ category.name }}» حذف شود؟</span>
                    <AppButton data-testid="confirm-delete" variant="danger" :disabled="submitting" @click="confirmDelete">
                      حذف
                    </AppButton>
                    <AppButton data-testid="cancel-delete" variant="ghost" :disabled="submitting" @click="confirmingId = null">
                      انصراف
                    </AppButton>
                  </div>
                </td>
              </template>

              <template v-else-if="editingId === category.id">
                <td class="px-5 py-3.5">
                  <AppInput v-model="editName" data-testid="edit-name-input" :maxlength="60" @keyup.enter="saveEdit" />
                </td>
                <td class="px-5 py-3.5 text-end">
                  <div class="flex justify-end gap-2.5">
                    <AppButton data-testid="save-edit" variant="secondary" :disabled="submitting" @click="saveEdit">
                      ذخیره
                    </AppButton>
                    <AppButton data-testid="cancel-edit" variant="ghost" :disabled="submitting" @click="cancelEdit">
                      انصراف
                    </AppButton>
                  </div>
                </td>
              </template>

              <template v-else>
                <td class="px-5 py-3.5 font-semibold text-(--color-text)">{{ category.name }}</td>
                <td class="px-5 py-3.5 text-end">
                  <div class="flex justify-end gap-2.5">
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
                  </div>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>
    </AppCard>
  </div>
</template>
