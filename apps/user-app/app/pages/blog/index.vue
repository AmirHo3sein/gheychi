<script setup lang="ts">
import type { BlogCategory, BlogListResponse } from '../../utils/types'

const route = useRoute()
const router = useRouter()
const { apiFetch } = useApi()

const PAGE_SIZE = 12

const page = computed(() => {
  const n = Number(route.query.page)
  return Number.isInteger(n) && n > 0 ? n : 1
})
const categorySlug = computed(() => (typeof route.query.category === 'string' ? route.query.category : ''))

const { data: categories, pending: categoriesPending } = await useAsyncData('blog-categories', async () => {
  const { data } = await apiFetch<BlogCategory[]>('/blog/categories', { silent: true })
  return data ?? []
})

// Filter/page state lives in the route query, so a chip click or page turn is one
// router.push: both watched computeds change in the same flush and useAsyncData refetches
// exactly once (single-fetch idiom -- never the page-reset-then-load double-fetch form).
const { data: list, pending: postsPending } = await useAsyncData(
  'blog-posts',
  async () => {
    const { data } = await apiFetch<BlogListResponse>('/blog/posts', {
      query: {
        category: categorySlug.value || undefined,
        page: page.value,
        pageSize: PAGE_SIZE,
      },
      silent: true,
    })
    return data
  },
  { watch: [page, categorySlug] },
)

// A light, local loading signal (disabled chips/pagination + dimmed grid) rather than a
// full-page skeleton -- both async calls can be in flight together (e.g. first paint).
const isLoading = computed(() => categoriesPending.value || postsPending.value)

const totalPages = computed(() => (list.value ? Math.max(1, Math.ceil(list.value.total / list.value.pageSize)) : 1))

function selectCategory(slug: string) {
  // Switching category always lands on page 1 by dropping the page param entirely.
  router.push({ query: slug ? { category: slug } : {} })
}

function goToPage(target: number) {
  if (target < 1 || target > totalPages.value || target === page.value) return
  router.push({
    query: {
      ...(categorySlug.value ? { category: categorySlug.value } : {}),
      ...(target > 1 ? { page: target } : {}),
    },
  })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' })
}

useSeoMeta({
  title: 'بلاگ — راهنمای زیبایی و مراقبت',
  description: 'مقالات و راهنمای زیبایی، مو، پوست و ناخن از آرایشگاه',
})
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-4 p-4">
    <h1 class="text-xl font-bold text-(--color-text)">بلاگ</h1>

    <div class="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="فیلتر دسته‌بندی">
      <button
        type="button"
        :aria-pressed="categorySlug === ''"
        :disabled="isLoading"
        class="min-h-9 shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
        :class="categorySlug === ''
          ? 'bg-(--color-accent-strong) text-(--color-fill-text)'
          : 'border border-(--color-border) bg-(--color-surface-card) text-(--color-text-muted) hover:text-(--color-text)'"
        @click="selectCategory('')"
      >
        همه
      </button>
      <button
        v-for="cat in categories"
        :key="cat.id"
        type="button"
        :aria-pressed="categorySlug === cat.slug"
        :disabled="isLoading"
        class="min-h-9 shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
        :class="categorySlug === cat.slug
          ? 'bg-(--color-accent-strong) text-(--color-fill-text)'
          : 'border border-(--color-border) bg-(--color-surface-card) text-(--color-text-muted) hover:text-(--color-text)'"
        @click="selectCategory(cat.slug)"
      >
        {{ cat.name }}
      </button>
    </div>

    <p v-if="!list?.items?.length" data-testid="empty-state" aria-live="polite" class="py-10 text-center text-sm text-(--color-text-muted)">
      مطلبی برای نمایش پیدا نشد
    </p>

    <div
      v-else
      class="grid gap-4 transition-opacity sm:grid-cols-2"
      :class="{ 'pointer-events-none opacity-60': postsPending }"
    >
      <NuxtLink v-for="post in list.items" :key="post.id" :to="`/blog/${post.slug}`" class="block">
        <BaseCard padding="none" class="overflow-hidden transition-shadow hover:shadow-(--shadow-md)">
          <NuxtImg
            v-if="post.coverImageUrl"
            provider="arvancloud"
            :src="post.coverImageUrl"
            width="400"
            height="225"
            loading="lazy"
            class="h-40 w-full object-cover"
            :alt="post.title"
          />
          <div v-else class="flex h-40 w-full items-center justify-center bg-(--color-surface-subtle)">
            <BaseIcon name="camera" :size="28" class="text-(--color-text-muted)" />
          </div>
          <div class="space-y-1 p-3 text-sm">
            <p v-if="post.categoryName" class="text-xs text-(--color-accent-text)">{{ post.categoryName }}</p>
            <!-- BaseCard here is overflow-hidden, so an unbreakable title doesn't scroll
                 the body -- it gets silently clipped instead, which loses meaning. Let it
                 break. -->
            <h2 class="font-bold break-words text-(--color-text)">{{ post.title }}</h2>
            <p v-if="post.excerpt" class="line-clamp-2 text-(--color-text-muted)">{{ post.excerpt }}</p>
            <p class="text-xs text-(--color-text-muted)">
              <span v-if="post.authorName">{{ post.authorName }} · </span>
              <time :datetime="post.publishedAt">{{ formatDate(post.publishedAt) }}</time>
            </p>
          </div>
        </BaseCard>
      </NuxtLink>
    </div>

    <nav v-if="totalPages > 1" class="flex items-center justify-center gap-3 pt-2 text-sm" aria-label="صفحه‌بندی">
      <button
        type="button"
        data-testid="prev-page"
        class="min-h-9 rounded-full border border-(--color-border) bg-(--color-surface-card) px-4 py-2 text-(--color-text) disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="page <= 1 || postsPending"
        @click="goToPage(page - 1)"
      >
        قبلی
      </button>
      <span class="flex items-center gap-1.5 text-xs text-(--color-text-muted)">
        <BaseIcon v-if="postsPending" name="spinner" :size="14" class="animate-spin" />
        صفحه {{ page.toLocaleString('fa-IR') }} از {{ totalPages.toLocaleString('fa-IR') }}
      </span>
      <button
        type="button"
        data-testid="next-page"
        class="min-h-9 rounded-full border border-(--color-border) bg-(--color-surface-card) px-4 py-2 text-(--color-text) disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="page >= totalPages || postsPending"
        @click="goToPage(page + 1)"
      >
        بعدی
      </button>
    </nav>
  </div>
</template>
