<!-- apps/admin-panel/src/pages/BlogEditorView.vue -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { blogPostStatusLabel } from '@/utils/labels'
import { renderMarkdown } from '@/utils/markdown'
import { previewSlug } from '@/utils/slug-preview'

interface AdminBlogPost {
  id: string
  title: string
  slug: string
  excerpt: string | null
  bodyMarkdown: string
  coverImageUrl: string | null
  categoryId: number | null
  authorName: string | null
  metaDescription: string | null
  ogTitle: string | null
  status: 'draft' | 'published'
  publishedAt: string | null
}

interface BlogCategory {
  id: number
  name: string
  slug: string
}

const route = useRoute()
const router = useRouter()
const { apiFetch } = useApi()

const isCreate = computed(() => !route.params.id)
const postId = computed(() => route.params.id as string | undefined)

const post = ref<AdminBlogPost | null>(null)
const notFound = ref(false)

const title = ref('')
const slug = ref('')
const slugDirty = ref(false)
const slugError = ref('')
const categoryId = ref<string | number>('')
const authorName = ref('')
const excerpt = ref('')
const metaDescription = ref('')
const ogTitle = ref('')
const bodyMarkdown = ref('')
const seoOpen = ref(false)

const submitting = ref(false)
const confirmingDelete = ref(false)

const categories = ref<BlogCategory[]>([])
const categoryOptions = computed(() => [
  { value: '', label: 'بدون دسته‌بندی' },
  ...categories.value.map((c) => ({ value: c.id, label: c.name })),
])

// Bound below with v-html -- safe because renderMarkdown runs markdown-it with html:false,
// so raw HTML in the markdown source never parses (pinned by markdown.spec.ts).
const previewHtml = computed(() => renderMarkdown(bodyMarkdown.value))

// In create mode the slug field previews the title until the admin edits it manually; the
// backend's makeSlug produces the authoritative slug (with a uniqueness suffix) on create.
watch(title, (t) => {
  if (isCreate.value && !slugDirty.value) slug.value = previewSlug(t)
})

function onSlugInput() {
  slugDirty.value = true
  slugError.value = ''
}

function toggleSeo() {
  seoOpen.value = !seoOpen.value
}

function applyPost(p: AdminBlogPost) {
  post.value = p
  title.value = p.title
  slug.value = p.slug
  slugDirty.value = false
  slugError.value = ''
  categoryId.value = p.categoryId ?? ''
  authorName.value = p.authorName ?? ''
  excerpt.value = p.excerpt ?? ''
  metaDescription.value = p.metaDescription ?? ''
  ogTitle.value = p.ogTitle ?? ''
  bodyMarkdown.value = p.bodyMarkdown
}

async function load() {
  if (isCreate.value || !postId.value) return
  const { data, error } = await apiFetch<AdminBlogPost>(`/admin/blog/posts/${postId.value}`, { silent: true })
  if (data) {
    applyPost(data)
    notFound.value = false
    return
  }
  // Only a confirmed 404 flips to not-found -- a transient failure right after a
  // successful action must not wipe known-good editor state (same rationale as
  // SalonDetailView.load()).
  if (error?.status === 404) notFound.value = true
}

onMounted(async () => {
  await load()
  const { data } = await apiFetch<BlogCategory[]>('/blog/categories', { silent: true })
  categories.value = data ?? []
})

function basePayload() {
  return {
    title: title.value.trim(),
    bodyMarkdown: bodyMarkdown.value,
    excerpt: excerpt.value.trim() || null,
    categoryId: categoryId.value === '' ? null : Number(categoryId.value),
    authorName: authorName.value.trim() || null,
    metaDescription: metaDescription.value.trim() || null,
    ogTitle: ogTitle.value.trim() || null,
  }
}

async function save() {
  if (submitting.value) return
  if (!title.value.trim() || !bodyMarkdown.value.trim()) {
    useToast().push('عنوان و متن مطلب الزامی است')
    return
  }
  submitting.value = true
  confirmingDelete.value = false

  if (isCreate.value) {
    // A manually edited slug rides on the create itself, so the operation is atomic: a
    // 409 («این نامک قبلاً استفاده شده است») creates nothing and the form stays intact.
    // The un-edited client-side preview is never sent -- it keeps Persian characters and
    // has no uniqueness suffix; the backend derives the authoritative slug instead.
    const manualSlug = slugDirty.value ? slug.value.trim() : ''
    const { data, error } = await apiFetch<AdminBlogPost>('/admin/blog/posts', {
      method: 'POST',
      body: { ...basePayload(), ...(manualSlug ? { slug: manualSlug } : {}) },
    })
    if (data) {
      submitting.value = false
      await router.replace(`/blog/${data.id}`)
      return
    }
    if (error?.status === 409) slugError.value = error.message
  } else {
    const { data, error } = await apiFetch<AdminBlogPost>(`/admin/blog/posts/${postId.value}`, {
      method: 'PATCH',
      // An emptied slug field is skipped rather than sent: '' fails the backend's
      // SLUG_PATTERN with a raw class-validator message; the server keeps the old slug.
      body: { ...basePayload(), ...(slug.value.trim() ? { slug: slug.value.trim() } : {}) },
    })
    if (data) applyPost(data)
    else if (error?.status === 409) slugError.value = error.message
  }
  submitting.value = false
}

async function publish() {
  await transition('publish')
}

async function unpublish() {
  await transition('unpublish')
}

async function transition(action: 'publish' | 'unpublish') {
  if (submitting.value || !postId.value) return
  submitting.value = true
  confirmingDelete.value = false
  // Deliberately NOT silent: a lost publish/unpublish race answers 409 with a Farsi message
  // that surfaces through the standard toast. Either way the server is the truth afterwards,
  // so always reload instead of patching status locally.
  await apiFetch(`/admin/blog/posts/${postId.value}/${action}`, { method: 'POST' })
  await load()
  submitting.value = false
}

function askDelete() {
  confirmingDelete.value = true
}

function cancelDelete() {
  confirmingDelete.value = false
}

async function confirmDelete() {
  if (submitting.value || !postId.value) return
  submitting.value = true
  const { error } = await apiFetch(`/admin/blog/posts/${postId.value}`, { method: 'DELETE' })
  submitting.value = false
  confirmingDelete.value = false
  if (!error) await router.push('/blog')
}

async function onCoverChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // allow re-picking the same file after a failure
  if (!file || submitting.value || !postId.value) return
  submitting.value = true
  const form = new FormData()
  form.append('file', file) // same multipart field name as the salon-photos upload
  const { error } = await apiFetch(`/admin/blog/posts/${postId.value}/cover`, { method: 'POST', body: form })
  submitting.value = false
  // Reload rather than trusting a locally derived URL -- the GET returns coverImageUrl
  // exactly as the public endpoints will serve it.
  if (!error) await load()
}

async function removeCover() {
  if (submitting.value || !postId.value) return
  submitting.value = true
  const { error } = await apiFetch(`/admin/blog/posts/${postId.value}/cover`, { method: 'DELETE' })
  submitting.value = false
  if (!error) await load()
}
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-5 p-8">
    <EmptyState v-if="notFound" icon="warning" message="مطلب یافت نشد." />

    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <h2 class="text-lg font-bold text-(--color-text)">{{ isCreate ? 'مطلب جدید' : 'ویرایش مطلب' }}</h2>
          <StatusBadge
            v-if="post"
            :label="blogPostStatusLabel(post.status).label"
            :tone="blogPostStatusLabel(post.status).tone"
          />
        </div>

        <div class="flex items-center gap-2">
          <template v-if="confirmingDelete">
            <span class="text-sm font-semibold text-(--tone-danger-text)">مطلب حذف شود؟</span>
            <button
              data-testid="confirm-delete"
              type="button"
              :disabled="submitting"
              class="rounded-lg bg-(--tone-danger-bg) px-3 py-1.5 text-sm font-semibold text-(--tone-danger-text) disabled:opacity-40"
              @click="confirmDelete"
            >
              حذف
            </button>
            <button
              data-testid="cancel-delete"
              type="button"
              :disabled="submitting"
              class="px-2 text-sm font-semibold text-(--color-text-muted) disabled:opacity-40"
              @click="cancelDelete"
            >
              انصراف
            </button>
          </template>
          <template v-else>
            <button
              data-testid="save-button"
              type="button"
              :disabled="submitting"
              class="rounded-lg bg-(--color-accent) px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
              @click="save"
            >
              ذخیره
            </button>
            <button
              v-if="post?.status === 'draft'"
              data-testid="publish-button"
              type="button"
              :disabled="submitting"
              class="rounded-lg bg-(--tone-success-bg) px-4 py-1.5 text-sm font-semibold text-(--tone-success-text) disabled:opacity-40"
              @click="publish"
            >
              انتشار
            </button>
            <button
              v-if="post?.status === 'published'"
              data-testid="unpublish-button"
              type="button"
              :disabled="submitting"
              class="rounded-lg bg-(--tone-warning-bg) px-4 py-1.5 text-sm font-semibold text-(--tone-warning-text) disabled:opacity-40"
              @click="unpublish"
            >
              لغو انتشار
            </button>
            <button
              v-if="!isCreate"
              data-testid="delete-button"
              type="button"
              :disabled="submitting"
              class="rounded-lg px-3 py-1.5 text-sm font-semibold text-(--tone-danger-text) disabled:opacity-40"
              @click="askDelete"
            >
              حذف
            </button>
          </template>
        </div>
      </div>

      <div class="grid gap-5 lg:grid-cols-2">
        <div class="space-y-5">
          <AppCard class="space-y-4">
            <div>
              <label class="mb-1 block text-xs text-(--color-text-muted)" for="post-title">عنوان</label>
              <input
                id="post-title"
                v-model="title"
                data-testid="title-input"
                maxlength="200"
                class="w-full rounded-lg border border-(--color-border) p-2 text-sm"
              />
            </div>

            <div>
              <label class="mb-1 block text-xs text-(--color-text-muted)" for="post-slug">نامک</label>
              <input
                id="post-slug"
                v-model="slug"
                data-testid="slug-input"
                maxlength="220"
                dir="ltr"
                class="w-full rounded-lg border border-(--color-border) p-2 text-left text-sm"
                @input="onSlugInput"
              />
              <p v-if="slugError" data-testid="slug-error" class="mt-1 text-xs text-(--tone-danger-text)">
                {{ slugError }}
              </p>
              <p v-if="isCreate" class="mt-1 text-xs text-(--color-text-muted)">
                تا وقتی این فیلد را دستی ویرایش نکنید فقط پیش‌نمایش است و نامک نهایی را سرور از روی عنوان می‌سازد؛ در صورت ویرایش، همین نامک ثبت می‌شود.
              </p>
              <p v-if="post?.status === 'published'" class="mt-1 text-xs text-(--tone-warning-text)">
                تغییر نامک مطلب منتشرشده، آدرس عمومی آن را تغییر می‌دهد.
              </p>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="mb-1 block text-xs text-(--color-text-muted)">دسته‌بندی</label>
                <AppSelect v-model="categoryId" :options="categoryOptions" width="100%" />
              </div>
              <div>
                <label class="mb-1 block text-xs text-(--color-text-muted)" for="post-author">نویسنده</label>
                <input
                  id="post-author"
                  v-model="authorName"
                  data-testid="author-input"
                  maxlength="80"
                  class="w-full rounded-lg border border-(--color-border) p-2 text-sm"
                />
              </div>
            </div>

            <div>
              <div class="mb-1 flex items-center justify-between">
                <label class="text-xs text-(--color-text-muted)" for="post-excerpt">خلاصه</label>
                <span class="text-xs text-(--color-text-muted)">{{ excerpt.length }} / 500</span>
              </div>
              <!-- maxlength matches the blog DTO's excerpt cap (varchar(500) / @Length(0, 500)) -->
              <textarea
                id="post-excerpt"
                v-model="excerpt"
                data-testid="excerpt-input"
                maxlength="500"
                rows="3"
                class="w-full rounded-lg border border-(--color-border) p-2 text-sm"
              />
            </div>

            <div class="rounded-xl border border-(--color-border-soft)">
              <button
                data-testid="seo-toggle"
                type="button"
                class="flex w-full items-center justify-between p-3 text-sm font-semibold text-(--color-text)"
                @click="toggleSeo"
              >
                <span>تنظیمات سئو</span>
                <AppIcon :name="seoOpen ? 'x' : 'plus'" :size="15" />
              </button>
              <div v-if="seoOpen" class="space-y-3 border-t border-(--color-border-soft) p-3">
                <div>
                  <div class="mb-1 flex items-center justify-between">
                    <label class="text-xs text-(--color-text-muted)" for="post-meta-description">توضیح متا</label>
                    <span class="text-xs text-(--color-text-muted)">{{ metaDescription.length }} / 300</span>
                  </div>
                  <!-- maxlength matches the blog DTO's metaDescription cap (varchar(300) / @Length(0, 300)) -->
                  <textarea
                    id="post-meta-description"
                    v-model="metaDescription"
                    data-testid="meta-description-input"
                    maxlength="300"
                    rows="3"
                    class="w-full rounded-lg border border-(--color-border) p-2 text-sm"
                  />
                </div>
                <div>
                  <label class="mb-1 block text-xs text-(--color-text-muted)" for="post-og-title">عنوان اشتراک‌گذاری (og:title)</label>
                  <!-- maxlength matches the blog DTO's ogTitle cap (varchar(200) / @Length(0, 200)) -->
                  <input
                    id="post-og-title"
                    v-model="ogTitle"
                    data-testid="og-title-input"
                    maxlength="200"
                    class="w-full rounded-lg border border-(--color-border) p-2 text-sm"
                  />
                </div>
              </div>
            </div>

            <div v-if="!isCreate" class="space-y-3">
              <p class="text-sm font-semibold text-(--color-text)">تصویر کاور</p>
              <img
                v-if="post?.coverImageUrl"
                :src="post.coverImageUrl"
                alt="کاور مطلب"
                class="h-40 w-full rounded-xl object-cover"
              />
              <div class="flex items-center gap-3">
                <label class="cursor-pointer rounded-lg bg-(--color-border-soft) px-3 py-1.5 text-sm font-semibold text-(--color-accent)">
                  {{ post?.coverImageUrl ? 'تعویض کاور' : 'بارگذاری کاور' }}
                  <input
                    data-testid="cover-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    class="hidden"
                    :disabled="submitting"
                    @change="onCoverChange"
                  />
                </label>
                <button
                  v-if="post?.coverImageUrl"
                  data-testid="remove-cover"
                  type="button"
                  :disabled="submitting"
                  class="text-sm font-semibold text-(--tone-danger-text) disabled:opacity-40"
                  @click="removeCover"
                >
                  حذف کاور
                </button>
              </div>
            </div>
            <p v-else class="text-xs text-(--color-text-muted)">برای بارگذاری کاور، ابتدا پیش‌نویس را ذخیره کنید.</p>

            <div>
              <label class="mb-1 block text-xs text-(--color-text-muted)" for="post-body">متن مطلب (Markdown)</label>
              <textarea
                id="post-body"
                v-model="bodyMarkdown"
                data-testid="body-input"
                rows="18"
                dir="auto"
                class="w-full rounded-lg border border-(--color-border) p-2 font-mono text-sm leading-6"
              />
            </div>
          </AppCard>
        </div>

        <AppCard class="self-start">
          <p class="mb-3 text-xs font-semibold text-(--color-text-muted)">پیش‌نمایش</p>
          <!-- sanctioned v-html: renderMarkdown uses html:false so raw HTML never parses — see its invariant test -->
          <div data-testid="preview" class="space-y-3 text-sm leading-7 text-(--color-text)" v-html="previewHtml" />
        </AppCard>
      </div>
    </template>
  </div>
</template>
