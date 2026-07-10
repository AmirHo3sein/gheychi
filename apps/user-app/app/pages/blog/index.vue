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

const { data: categories } = await useAsyncData('blog-categories', async () => {
  const { data } = await apiFetch<BlogCategory[]>('/blog/categories', { silent: true })
  return data ?? []
})

// Filter/page state lives in the route query, so a chip click or page turn is one
// router.push: both watched computeds change in the same flush and useAsyncData refetches
// exactly once (single-fetch idiom -- never the page-reset-then-load double-fetch form).
const { data: list } = await useAsyncData(
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
  <div class="p-4 space-y-4">
    <h1 class="text-xl font-bold">بلاگ</h1>

    <div class="flex gap-2 overflow-x-auto">
      <button
        type="button"
        class="whitespace-nowrap rounded-full px-3 py-1 text-sm"
        :class="categorySlug === '' ? 'bg-(--color-accent) text-white' : 'bg-(--color-surface-card)'"
        @click="selectCategory('')"
      >
        همه
      </button>
      <button
        v-for="cat in categories"
        :key="cat.id"
        type="button"
        class="whitespace-nowrap rounded-full px-3 py-1 text-sm"
        :class="categorySlug === cat.slug ? 'bg-(--color-accent) text-white' : 'bg-(--color-surface-card)'"
        @click="selectCategory(cat.slug)"
      >
        {{ cat.name }}
      </button>
    </div>

    <p v-if="!list?.items?.length" data-testid="empty-state" class="py-10 text-center text-sm">
      مطلبی برای نمایش پیدا نشد
    </p>

    <div v-else class="grid gap-4 sm:grid-cols-2">
      <NuxtLink
        v-for="post in list.items"
        :key="post.id"
        :to="`/blog/${post.slug}`"
        class="overflow-hidden rounded-xl bg-(--color-surface-card)"
      >
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
        <div v-else class="h-40 w-full bg-(--color-surface)" />
        <div class="space-y-1 p-3 text-sm">
          <p v-if="post.categoryName" class="text-xs text-(--color-accent)">{{ post.categoryName }}</p>
          <h2 class="font-bold">{{ post.title }}</h2>
          <p v-if="post.excerpt" class="line-clamp-2 opacity-80">{{ post.excerpt }}</p>
          <p class="text-xs opacity-60">
            <span v-if="post.authorName">{{ post.authorName }} · </span>
            <time :datetime="post.publishedAt">{{ formatDate(post.publishedAt) }}</time>
          </p>
        </div>
      </NuxtLink>
    </div>

    <nav v-if="totalPages > 1" class="flex items-center justify-center gap-3 pt-2 text-sm" aria-label="صفحه‌بندی">
      <button
        type="button"
        data-testid="prev-page"
        class="rounded-full bg-(--color-surface-card) px-3 py-1 disabled:opacity-40"
        :disabled="page <= 1"
        @click="goToPage(page - 1)"
      >
        قبلی
      </button>
      <span class="text-xs">صفحه {{ page.toLocaleString('fa-IR') }} از {{ totalPages.toLocaleString('fa-IR') }}</span>
      <button
        type="button"
        data-testid="next-page"
        class="rounded-full bg-(--color-surface-card) px-3 py-1 disabled:opacity-40"
        :disabled="page >= totalPages"
        @click="goToPage(page + 1)"
      >
        بعدی
      </button>
    </nav>
  </div>
</template>
