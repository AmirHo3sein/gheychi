<!-- apps/admin-panel/src/pages/BlogPostsView.vue -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '@/composables/useApi'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Pagination from '@/components/ui/Pagination.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { debounce } from '@/utils/debounce'
import { blogPostStatusLabel } from '@/utils/labels'

interface BlogCategory {
  id: number
  name: string
  slug: string
}

interface BlogPostRow {
  id: string
  title: string
  slug: string
  status: 'draft' | 'published'
  categoryName: string | null
  publishedAt: string | null
  createdAt: string
}

interface BlogPostListResponse {
  items: BlogPostRow[]
  total: number
  page: number
  pageSize: number
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'همه وضعیت‌ها' },
  { value: 'draft', label: 'پیش‌نویس' },
  { value: 'published', label: 'منتشرشده' },
]

const router = useRouter()
const { apiFetch } = useApi()

// ---- posts list ----
const posts = ref<BlogPostRow[]>([])
const loading = ref(true)
// Distinct from "genuinely no results" -- SalonsView.vue's loadError pattern -- a fetch
// failure must not be silently repainted as an empty list.
const loadError = ref(false)
const page = ref(1)
const total = ref(0)
const pageSize = 20

const statusFilter = ref<'all' | 'draft' | 'published'>('all')
const categoryFilter = ref<number | ''>('')
const titleFilter = ref('')

async function load() {
  loading.value = true
  loadError.value = false
  const params = new URLSearchParams({ status: statusFilter.value, page: String(page.value), pageSize: String(pageSize) })
  if (categoryFilter.value !== '') params.set('categoryId', String(categoryFilter.value))
  if (titleFilter.value) params.set('title', titleFilter.value)

  const { data, error } = await apiFetch<BlogPostListResponse>(`/admin/blog/posts?${params.toString()}`, { silent: true })
  if (error) {
    loadError.value = true
    posts.value = []
    total.value = 0
  } else {
    posts.value = data?.items ?? []
    total.value = data?.total ?? 0
  }
  loading.value = false
}

// Single-fetch idiom: past page 1, only reset the page and let watch(page) issue the
// request -- resetting AND calling load() here would double-fetch.
function loadFromFilterChange() {
  if (page.value !== 1) {
    page.value = 1
  } else {
    load()
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const parsed = new Date(iso)
  if (isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }).format(parsed)
}

function openPost(post: BlogPostRow) {
  router.push(`/blog/${post.id}`)
}

function goToCreate() {
  router.push('/blog/new')
}

function clearFilters() {
  statusFilter.value = 'all'
  categoryFilter.value = ''
  titleFilter.value = ''
}

const hasActiveFilters = computed(
  () => statusFilter.value !== 'all' || categoryFilter.value !== '' || !!titleFilter.value,
)

// ---- categories side card (CategoriesView pattern, retargeted at /admin/blog/categories) ----
const categories = ref<BlogCategory[]>([])
const newName = ref('')
const editingId = ref<number | null>(null)
const editName = ref('')
const submitting = ref(false)
const confirmingId = ref<number | null>(null)

const categoryOptions = computed(() => [
  { value: '', label: 'همه دسته‌بندی‌ها' },
  ...categories.value.map((c) => ({ value: c.id, label: c.name })),
])

async function loadCategories() {
  const { data } = await apiFetch<BlogCategory[]>('/blog/categories', { silent: true })
  categories.value = data ?? []
}

async function addCategory() {
  if (submitting.value) return
  submitting.value = true
  // Deliberately NOT silent: a duplicate name/slug comes back 409 with a Farsi message,
  // surfaced through the standard toast path.
  const { data } = await apiFetch<BlogCategory>('/admin/blog/categories', {
    method: 'POST',
    body: { name: newName.value },
  })
  submitting.value = false
  if (data) {
    newName.value = ''
    await loadCategories() // the slug is server-generated -- reload rather than patch locally
  }
}

function startEdit(category: BlogCategory) {
  editingId.value = category.id
  editName.value = category.name
  confirmingId.value = null
}

async function saveEdit() {
  if (submitting.value) return
  const id = editingId.value
  if (id === null) return
  submitting.value = true
  // NOT silent: a rename can 409 on a duplicate name -- toast carries the Farsi message.
  const { error } = await apiFetch<BlogCategory>(`/admin/blog/categories/${id}`, {
    method: 'PATCH',
    body: { name: editName.value },
  })
  submitting.value = false
  editingId.value = null // collapse whether it worked or not -- no doomed retry form
  if (!error) {
    await loadCategories()
    await load() // table rows display categoryName -- a rename must show up there too
  }
}

function askDelete(category: BlogCategory) {
  confirmingId.value = category.id
  editingId.value = null
}

function cancelDelete() {
  confirmingId.value = null
}

async function confirmDelete() {
  if (submitting.value) return
  const id = confirmingId.value
  if (id === null) return
  submitting.value = true
  // NOT silent: an in-use category answers 409 «این دسته‌بندی دارای مطلب است و قابل حذف نیست»,
  // surfaced through the standard toast path.
  const { error } = await apiFetch(`/admin/blog/categories/${id}`, { method: 'DELETE' })
  submitting.value = false
  confirmingId.value = null // collapse the confirm strip whatever happened
  if (!error) {
    if (categoryFilter.value === id) {
      // The active filter pointed at the deleted category -- reset it; the filter
      // watcher reloads the (now unfiltered) posts list.
      categoryFilter.value = ''
    }
    await loadCategories()
  }
}

onMounted(() => {
  load()
  loadCategories()
})
watch([statusFilter, categoryFilter], loadFromFilterChange)
// titleFilter is free-text (fires on every keystroke) -- debounced so it doesn't hammer
// the API mid-word, same as SalonsView.vue's nameFilter.
watch(titleFilter, debounce(loadFromFilterChange, 350))
watch(page, load)
</script>

<template>
  <div class="flex flex-col gap-5 p-8 xl:flex-row xl:items-start">
    <div class="min-w-0 flex-1 space-y-5">
      <AppCard :padded="false" class="p-4">
        <div class="flex flex-wrap items-end gap-3">
          <AppInput v-model="titleFilter" icon="search" label="جست‌وجو" placeholder="عنوان مطلب" class="w-52" />
          <div data-testid="status-filter">
            <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">وضعیت</label>
            <AppSelect v-model="statusFilter" :options="STATUS_OPTIONS" width="11rem" />
          </div>
          <div data-testid="category-filter">
            <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">دسته‌بندی</label>
            <AppSelect v-model="categoryFilter" :options="categoryOptions" width="12rem" :searchable="true" />
          </div>
          <AppButton
            v-if="hasActiveFilters"
            type="button"
            variant="ghost"
            class="mb-0.5"
            @click="clearFilters"
          >
            <template #icon><AppIcon name="reset" :size="15" /></template>
            پاک کردن فیلترها
          </AppButton>
          <AppButton data-testid="new-post" variant="primary" class="ms-auto" @click="goToCreate">
            <template #icon><AppIcon name="plus" :size="16" /></template>
            مطلب جدید
          </AppButton>
        </div>
      </AppCard>

      <AppCard
        v-if="loadError"
        :padded="false"
        data-testid="load-error"
        class="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center"
      >
        <div class="flex h-12 w-12 items-center justify-center rounded-full bg-(--tone-danger-bg) text-(--tone-danger-text)">
          <AppIcon name="warning" :size="22" />
        </div>
        <p class="text-sm text-(--color-text-muted)">خطا در دریافت فهرست مطالب.</p>
        <AppButton type="button" variant="secondary" data-testid="retry-load" @click="load">تلاش دوباره</AppButton>
      </AppCard>

      <EmptyState v-else-if="!loading && posts.length === 0" icon="newspaper" message="مطلبی با این فیلترها یافت نشد." />

      <AppCard v-else :padded="false" class="overflow-hidden">
        <div class="relative">
          <div
            v-if="loading"
            data-testid="table-loading"
            class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-(--color-surface-card)/70"
          >
            <AppIcon name="spinner" :size="22" class="animate-spin text-(--color-text-muted)" />
          </div>
          <!-- The table gets its OWN horizontal scroller (CouponsView.vue's idiom). Without it a
               table narrower than its min-content width doesn't shrink -- it overflows the card,
               and AppCard's overflow-hidden (there for the rounded corners) then CLIPS the
               trailing columns. Squeezed hardest on this page, since the categories side card
               takes a fixed 20rem out of the row from xl up. Desktop is untouched: no scrollbar
               exists while the table fits, which is the ≥1280px case this app optimizes for. -->
          <div class="overflow-x-auto">
            <table class="w-full text-right text-sm transition-opacity" :class="{ 'opacity-50': loading }">
              <thead>
                <tr class="border-b border-(--color-border) bg-(--color-border-soft) text-xs text-(--color-text-muted)">
                  <th class="px-5 py-3 font-semibold">عنوان</th>
                  <th class="px-5 py-3 font-semibold">دسته‌بندی</th>
                  <th class="px-5 py-3 font-semibold">وضعیت</th>
                  <th class="px-5 py-3 font-semibold">تاریخ انتشار</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="post in posts"
                  :key="post.id"
                  data-testid="post-row"
                  class="cursor-pointer border-b border-(--color-border-soft) transition-colors last:border-0 hover:bg-(--color-border-soft)"
                  @click="openPost(post)"
                >
                  <td class="px-5 py-3.5 font-semibold text-(--color-text)">
                    <RouterLink :to="`/blog/${post.id}`" class="hover:text-(--color-accent-text)">{{ post.title }}</RouterLink>
                  </td>
                  <td class="px-5 py-3.5 text-(--color-text-muted)">{{ post.categoryName ?? '—' }}</td>
                  <td class="px-5 py-3.5">
                    <StatusBadge :label="blogPostStatusLabel(post.status).label" :tone="blogPostStatusLabel(post.status).tone" />
                  </td>
                  <td class="tnum px-5 py-3.5 text-(--color-text-muted)">{{ formatDate(post.publishedAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="(p) => (page = p)" />
      </AppCard>
    </div>

    <AppCard class="w-full shrink-0 xl:w-80">
      <p class="mb-3 flex items-center gap-2 text-sm font-semibold text-(--color-text)">
        <AppIcon name="categories" :size="16" class="text-(--color-accent)" />
        دسته‌بندی‌های بلاگ
      </p>

      <form class="mb-4 flex gap-2" @submit.prevent="addCategory">
        <!-- maxlength 60 = CreateBlogCategoryDto's @Length cap (blog_categories.name varchar(60)) -->
        <div class="min-w-0 flex-1">
          <AppInput
            v-model="newName"
            data-testid="new-category-name"
            placeholder="نام دسته‌بندی"
            :maxlength="60"
          />
        </div>
        <AppButton
          data-testid="add-category"
          type="submit"
          variant="primary"
          aria-label="افزودن دسته‌بندی"
          :disabled="submitting || !newName.trim()"
        >
          <template #icon><AppIcon name="plus" :size="16" /></template>
        </AppButton>
      </form>

      <div class="space-y-2">
        <div
          v-for="category in categories"
          :key="category.id"
          class="flex items-center gap-2 rounded-2xl border border-(--color-border-soft) p-2.5"
        >
          <template v-if="confirmingId === category.id">
            <span class="min-w-0 flex-1 truncate text-sm font-semibold text-(--tone-danger-text)">
              «{{ category.name }}» حذف شود؟
            </span>
            <AppButton data-testid="confirm-delete-category" variant="danger" :disabled="submitting" @click="confirmDelete">
              حذف
            </AppButton>
            <AppButton data-testid="cancel-delete-category" variant="ghost" :disabled="submitting" @click="cancelDelete">
              انصراف
            </AppButton>
          </template>

          <template v-else>
            <div v-if="editingId === category.id" class="min-w-0 flex-1">
              <AppInput v-model="editName" data-testid="edit-category-name" aria-label="نام دسته‌بندی" :maxlength="60" />
            </div>
            <span v-else class="min-w-0 flex-1 truncate text-sm font-semibold text-(--color-text)">{{ category.name }}</span>
            <AppButton
              v-if="editingId === category.id"
              data-testid="save-category"
              variant="primary"
              :disabled="submitting"
              @click="saveEdit"
            >
              ذخیره
            </AppButton>
            <template v-else>
              <AppButton
                data-testid="edit-category"
                variant="secondary"
                :disabled="submitting"
                title="ویرایش"
                @click="startEdit(category)"
              >
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
        </div>
        <p v-if="categories.length === 0" class="py-4 text-center text-xs text-(--color-text-muted)">
          هنوز دسته‌بندی‌ای ساخته نشده است.
        </p>
      </div>
    </AppCard>
  </div>
</template>
