<!-- apps/admin-panel/src/pages/BlogEditorView.vue -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
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
// Only ever flips true on the very first load (see load()) -- a background refetch after a
// successful action never wipes already-known-good editor state back to a blank/loading form.
const loading = ref(false)
// Distinct from "genuinely no post": a fetch failure must not be silently repainted as if the
// form were just empty (matches SalonsView.load()'s loadError, styled the same way below).
const loadError = ref(false)

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

const coverInputRef = ref<HTMLInputElement | null>(null)

const submitting = ref(false)
const confirmingDelete = ref(false)
// Mirrors confirmingDelete's two-step shape for publish/unpublish (askX/confirmX/cancelX),
// per DESIGN.md's Uniform Consequence Rule -- a state-visibility transition gets the same
// confirm-before-commit weight as delete rather than firing immediately on click. One ref
// (not two booleans) since only one of the publish/unpublish buttons is ever visible at a time.
const confirmingTransition = ref<'publish' | 'unpublish' | null>(null)
// Same shape again for cover removal -- it previously fired immediately despite carrying the
// same danger-variant visual weight as delete.
const confirmingCoverRemove = ref(false)
// Same shape again, but conditional: only gates save() when the currently-loaded post is
// published AND the slug field has been edited away from its original value (see askSave()) --
// a plain edit-and-save, or any edit on a draft post, keeps the existing single-click save.
const confirmingSlugChange = ref(false)

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
  // Only show the full-page loading state on the very first load, not on a background
  // refetch triggered after a successful publish/unpublish/cover action (mirrors
  // SalonDetailView.load()).
  loading.value = post.value === null
  loadError.value = false
  // Deliberately NOT silent -- a real failure here surfaces via the standard toast, same as
  // SalonDetailView.load() (the function this one has always claimed to mirror).
  const { data, error } = await apiFetch<AdminBlogPost>(`/admin/blog/posts/${postId.value}`)
  loading.value = false
  if (data) {
    applyPost(data)
    notFound.value = false
    return
  }
  // Only a confirmed 404 flips to not-found -- a transient failure right after a
  // successful action must not wipe known-good editor state (same rationale as
  // SalonDetailView.load()).
  if (error?.status === 404) {
    notFound.value = true
    return
  }
  // Only surface a persistent, retryable error state when there's nothing already on screen --
  // a transient post-action refetch failure keeps showing the known-good post.
  if (!post.value) loadError.value = true
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

// Entry point for the save button. A published post's slug controls its public URL, so
// changing it gets the same confirm-before-commit weight as delete/publish-transition rather
// than riding along with every other harmless field edit on a single click.
function askSave() {
  if (!title.value.trim() || !bodyMarkdown.value.trim()) {
    useToast().push('عنوان و متن مطلب الزامی است')
    return
  }
  const trimmedSlug = slug.value.trim()
  const slugChanged = trimmedSlug !== '' && trimmedSlug !== post.value?.slug
  if (post.value?.status === 'published' && slugChanged) {
    confirmingSlugChange.value = true
    confirmingDelete.value = false
    confirmingTransition.value = null
    confirmingCoverRemove.value = false
    return
  }
  save()
}

function cancelSlugChange() {
  confirmingSlugChange.value = false
}

async function confirmSlugChangeSave() {
  confirmingSlugChange.value = false
  await save()
}

async function save() {
  if (submitting.value) return
  if (!title.value.trim() || !bodyMarkdown.value.trim()) {
    useToast().push('عنوان و متن مطلب الزامی است')
    return
  }
  submitting.value = true
  confirmingDelete.value = false
  confirmingTransition.value = null
  confirmingCoverRemove.value = false
  confirmingSlugChange.value = false

  if (isCreate.value) {
    // A manually edited slug rides on the create itself, so the operation is atomic: a
    // 409 («این نامک قبلاً استفاده شده است») creates nothing and the form stays intact.
    // The un-edited client-side preview is never sent -- it keeps Persian characters and
    // has no uniqueness suffix; the backend derives the authoritative slug instead.
    const manualSlug = slugDirty.value ? slug.value.trim() : ''
    // silent: true -- a 409 is carried by the inline, field-associated slugError below;
    // surfacing it as a toast too would show the identical message twice.
    const { data, error } = await apiFetch<AdminBlogPost>('/admin/blog/posts', {
      method: 'POST',
      body: { ...basePayload(), ...(manualSlug ? { slug: manualSlug } : {}) },
      silent: true,
    })
    if (data) {
      submitting.value = false
      await router.replace(`/blog/${data.id}`)
      return
    }
    if (error?.status === 409) slugError.value = error.message
    else if (error) useToast().push(error.message)
  } else {
    // silent: true -- same reasoning as the create branch above.
    const { data, error } = await apiFetch<AdminBlogPost>(`/admin/blog/posts/${postId.value}`, {
      method: 'PATCH',
      // An emptied slug field is skipped rather than sent: '' fails the backend's
      // SLUG_PATTERN with a raw class-validator message; the server keeps the old slug.
      body: { ...basePayload(), ...(slug.value.trim() ? { slug: slug.value.trim() } : {}) },
      silent: true,
    })
    if (data) applyPost(data)
    else if (error?.status === 409) slugError.value = error.message
    else if (error) useToast().push(error.message)
  }
  submitting.value = false
}

function askPublish() {
  confirmingTransition.value = 'publish'
  confirmingDelete.value = false
  confirmingCoverRemove.value = false
  confirmingSlugChange.value = false
}

function askUnpublish() {
  confirmingTransition.value = 'unpublish'
  confirmingDelete.value = false
  confirmingCoverRemove.value = false
  confirmingSlugChange.value = false
}

function cancelTransition() {
  confirmingTransition.value = null
}

async function confirmTransition() {
  const action = confirmingTransition.value
  if (!action) return
  confirmingTransition.value = null
  await transition(action)
}

async function transition(action: 'publish' | 'unpublish') {
  if (submitting.value || !postId.value) return
  submitting.value = true
  confirmingDelete.value = false
  confirmingTransition.value = null
  // Deliberately NOT silent: a lost publish/unpublish race answers 409 with a Farsi message
  // that surfaces through the standard toast. Either way the server is the truth afterwards,
  // so always reload instead of patching status locally.
  await apiFetch(`/admin/blog/posts/${postId.value}/${action}`, { method: 'POST' })
  await load()
  submitting.value = false
}

function askDelete() {
  confirmingDelete.value = true
  confirmingTransition.value = null
  confirmingCoverRemove.value = false
  confirmingSlugChange.value = false
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

function triggerCoverPicker() {
  coverInputRef.value?.click()
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

function askRemoveCover() {
  confirmingCoverRemove.value = true
  confirmingDelete.value = false
  confirmingTransition.value = null
  confirmingSlugChange.value = false
}

function cancelRemoveCover() {
  confirmingCoverRemove.value = false
}

async function confirmRemoveCover() {
  if (submitting.value || !postId.value) return
  submitting.value = true
  confirmingCoverRemove.value = false
  const { error } = await apiFetch(`/admin/blog/posts/${postId.value}/cover`, { method: 'DELETE' })
  submitting.value = false
  if (!error) await load()
}
</script>

<!-- p-8 from `sm` up (unchanged); below that 64px of gutter is a fifth of a 320px screen. -->
<template>
  <div class="mx-auto max-w-6xl space-y-5 p-4 sm:p-8">
    <EmptyState v-if="notFound" icon="warning" message="مطلب یافت نشد." />

    <AppCard
      v-else-if="loadError"
      :padded="false"
      data-testid="load-error"
      class="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center"
    >
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-(--tone-danger-bg) text-(--tone-danger-text)">
        <AppIcon name="warning" :size="22" />
      </div>
      <p class="text-sm text-(--color-text-muted)">خطا در بارگذاری مطلب.</p>
      <AppButton type="button" variant="secondary" data-testid="retry-load" @click="load">تلاش دوباره</AppButton>
    </AppCard>

    <div v-else-if="loading" data-testid="loading-indicator" class="flex justify-center py-16">
      <AppIcon name="spinner" :size="24" class="animate-spin text-(--color-text-muted)" />
    </div>

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

        <!-- flex-wrap: every confirm branch below injects a full sentence plus two buttons
             into this strip, which is far wider than a narrow viewport -- without wrapping the
             trailing "cancel" button is pushed out of the page's content column. -->
        <div class="flex flex-wrap items-center gap-2">
          <template v-if="confirmingDelete">
            <span class="text-sm font-semibold text-(--tone-danger-text)">مطلب حذف شود؟</span>
            <AppButton data-testid="confirm-delete" variant="danger" :disabled="submitting" :loading="submitting" @click="confirmDelete">
              حذف
            </AppButton>
            <AppButton data-testid="cancel-delete" variant="ghost" :disabled="submitting" @click="cancelDelete">
              انصراف
            </AppButton>
          </template>
          <template v-else-if="confirmingTransition === 'publish'">
            <span class="text-sm font-semibold text-(--color-text)">
              این مطلب منتشر شود؟ محتوا برای عموم قابل مشاهده خواهد شد.
            </span>
            <AppButton data-testid="confirm-publish" variant="primary" :disabled="submitting" :loading="submitting" @click="confirmTransition">
              انتشار
            </AppButton>
            <AppButton data-testid="cancel-publish" variant="ghost" :disabled="submitting" @click="cancelTransition">
              انصراف
            </AppButton>
          </template>
          <template v-else-if="confirmingTransition === 'unpublish'">
            <span class="text-sm font-semibold text-(--tone-warning-text)">
              انتشار این مطلب لغو شود؟ محتوا از دسترس عموم خارج می‌شود.
            </span>
            <AppButton data-testid="confirm-unpublish" variant="danger" :disabled="submitting" :loading="submitting" @click="confirmTransition">
              لغو انتشار
            </AppButton>
            <AppButton data-testid="cancel-unpublish" variant="ghost" :disabled="submitting" @click="cancelTransition">
              انصراف
            </AppButton>
          </template>
          <template v-else-if="confirmingSlugChange">
            <span class="text-sm font-semibold text-(--tone-warning-text)">
              تغییر نامک، آدرس عمومی این مطلب منتشرشده را تغییر می‌دهد. ذخیره شود؟
            </span>
            <AppButton data-testid="confirm-save-slug-change" variant="primary" :disabled="submitting" :loading="submitting" @click="confirmSlugChangeSave">
              ذخیره
            </AppButton>
            <AppButton data-testid="cancel-save-slug-change" variant="ghost" :disabled="submitting" @click="cancelSlugChange">
              انصراف
            </AppButton>
          </template>
          <template v-else>
            <AppButton data-testid="save-button" variant="primary" :disabled="submitting" :loading="submitting" @click="askSave">
              ذخیره
            </AppButton>
            <!-- No "success" variant exists on AppButton -- publish/unpublish are non-destructive
                 state transitions with no clean match among primary/secondary/ghost/danger, so
                 they map to secondary rather than borrowing primary's accent (reserved for save). -->
            <AppButton
              v-if="post?.status === 'draft'"
              data-testid="publish-button"
              variant="secondary"
              :disabled="submitting"
              @click="askPublish"
            >
              انتشار
            </AppButton>
            <AppButton
              v-if="post?.status === 'published'"
              data-testid="unpublish-button"
              variant="secondary"
              :disabled="submitting"
              @click="askUnpublish"
            >
              لغو انتشار
            </AppButton>
            <AppButton
              v-if="!isCreate"
              data-testid="delete-button"
              variant="danger"
              :disabled="submitting"
              @click="askDelete"
            >
              حذف
            </AppButton>
          </template>
        </div>
      </div>

      <!-- Editor and preview sit side by side from `lg` up and stack below it (unchanged).
           `min-w-0` on both columns is what makes the stacked case honest: a grid item
           defaults to `min-width: auto`, so an unbroken string in the preview -- or the
           fixed-width fields in the editor -- would otherwise force the column wider than
           its track and push the whole page. -->
      <div class="grid gap-5 lg:grid-cols-2">
        <div class="min-w-0 space-y-5">
          <AppCard class="space-y-4">
            <div>
              <label class="mb-1 block text-xs text-(--color-text-muted)" for="post-title">عنوان</label>
              <AppInput
                id="post-title"
                v-model="title"
                data-testid="title-input"
                :maxlength="200"
              />
            </div>

            <div>
              <label class="mb-1 block text-xs text-(--color-text-muted)" for="post-slug">نامک</label>
              <AppInput
                id="post-slug"
                v-model="slug"
                data-testid="slug-input"
                :maxlength="220"
                dir="ltr"
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

            <!-- min-w-0 on both cells: a grid item's automatic minimum size is its content,
                 so a text field's intrinsic width would otherwise overflow a narrow track. -->
            <div class="grid grid-cols-2 gap-3">
              <div class="min-w-0">
                <label class="mb-1 block text-xs text-(--color-text-muted)">دسته‌بندی</label>
                <AppSelect v-model="categoryId" :options="categoryOptions" width="100%" />
              </div>
              <div class="min-w-0">
                <label class="mb-1 block text-xs text-(--color-text-muted)" for="post-author">نویسنده</label>
                <AppInput
                  id="post-author"
                  v-model="authorName"
                  data-testid="author-input"
                  :maxlength="80"
                />
              </div>
            </div>

            <div>
              <div class="mb-1 flex items-center justify-between">
                <label class="text-xs text-(--color-text-muted)" for="post-excerpt">خلاصه</label>
                <span class="text-xs text-(--color-text-muted)">{{ excerpt.length.toLocaleString('fa-IR') }}/۵۰۰</span>
              </div>
              <!-- maxlength matches the blog DTO's excerpt cap (varchar(500) / @Length(0, 500)) -->
              <textarea
                id="post-excerpt"
                v-model="excerpt"
                data-testid="excerpt-input"
                maxlength="500"
                rows="3"
                class="w-full rounded-xl border border-(--color-border) p-2 text-sm focus:outline-none focus:ring-2 focus:ring-(--color-accent)/30 focus:border-(--color-accent)"
              />
            </div>

            <div class="rounded-xl border border-(--color-border-soft)">
              <button
                data-testid="seo-toggle"
                type="button"
                class="flex w-full items-center justify-between p-3 text-sm font-semibold text-(--color-text)"
                :aria-expanded="seoOpen"
                aria-controls="post-seo-panel"
                @click="toggleSeo"
              >
                <span>تنظیمات سئو</span>
                <AppIcon :name="seoOpen ? 'x' : 'plus'" :size="15" />
              </button>
              <div v-if="seoOpen" id="post-seo-panel" class="space-y-3 border-t border-(--color-border-soft) p-3">
                <div>
                  <div class="mb-1 flex items-center justify-between">
                    <label class="text-xs text-(--color-text-muted)" for="post-meta-description">توضیح متا</label>
                    <span class="text-xs text-(--color-text-muted)">{{ metaDescription.length.toLocaleString('fa-IR') }}/۳۰۰</span>
                  </div>
                  <!-- maxlength matches the blog DTO's metaDescription cap (varchar(300) / @Length(0, 300)) -->
                  <textarea
                    id="post-meta-description"
                    v-model="metaDescription"
                    data-testid="meta-description-input"
                    maxlength="300"
                    rows="3"
                    class="w-full rounded-xl border border-(--color-border) p-2 text-sm focus:outline-none focus:ring-2 focus:ring-(--color-accent)/30 focus:border-(--color-accent)"
                  />
                </div>
                <div>
                  <label class="mb-1 block text-xs text-(--color-text-muted)" for="post-og-title">عنوان اشتراک‌گذاری (og:title)</label>
                  <!-- maxlength matches the blog DTO's ogTitle cap (varchar(200) / @Length(0, 200)) -->
                  <AppInput
                    id="post-og-title"
                    v-model="ogTitle"
                    data-testid="og-title-input"
                    :maxlength="200"
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
              <input
                ref="coverInputRef"
                data-testid="cover-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                class="hidden"
                :disabled="submitting"
                @change="onCoverChange"
              />
              <!-- flex-wrap for the same reason as the action strip above: the remove-cover
                   confirm branch adds a question plus two more buttons to this row. -->
              <div class="flex flex-wrap items-center gap-3">
                <AppButton
                  data-testid="cover-upload"
                  variant="secondary"
                  :disabled="submitting"
                  :loading="submitting"
                  @click="triggerCoverPicker"
                >
                  <template #icon><AppIcon name="plus" :size="15" /></template>
                  {{ post?.coverImageUrl ? 'تعویض کاور' : 'بارگذاری کاور' }}
                </AppButton>
                <template v-if="confirmingCoverRemove">
                  <span class="text-sm font-semibold text-(--tone-danger-text)">کاور حذف شود؟</span>
                  <AppButton data-testid="confirm-remove-cover" variant="danger" :disabled="submitting" :loading="submitting" @click="confirmRemoveCover">
                    حذف
                  </AppButton>
                  <AppButton data-testid="cancel-remove-cover" variant="ghost" :disabled="submitting" @click="cancelRemoveCover">
                    انصراف
                  </AppButton>
                </template>
                <AppButton
                  v-else-if="post?.coverImageUrl"
                  data-testid="remove-cover"
                  variant="danger"
                  :disabled="submitting"
                  @click="askRemoveCover"
                >
                  حذف کاور
                </AppButton>
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
                class="w-full rounded-xl border border-(--color-border) p-2 font-mono text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-(--color-accent)/30 focus:border-(--color-accent)"
              />
            </div>
          </AppCard>
        </div>

        <AppCard class="min-w-0 self-start">
          <p class="mb-3 text-xs font-semibold text-(--color-text-muted)">پیش‌نمایش</p>
          <!-- sanctioned v-html: renderMarkdown uses html:false so raw HTML never parses — see its invariant test -->
          <!-- The rendered body is arbitrary author markdown: long URLs and long words get
               `break-words`, and the two constructs that genuinely cannot wrap -- fenced code
               blocks and tables -- scroll inside themselves rather than widening the page. -->
          <div
            data-testid="preview"
            class="space-y-3 break-words text-sm leading-7 text-(--color-text) [&_img]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto"
            v-html="previewHtml"
          />
        </AppCard>
      </div>
    </template>
  </div>
</template>
