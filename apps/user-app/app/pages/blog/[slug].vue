<script setup lang="ts">
import { renderMarkdown } from '../../utils/markdown'
import { resolveBlogDescription } from '../../utils/markdown-excerpt'

interface BlogArticle {
  id: string
  title: string
  slug: string
  excerpt: string | null
  bodyMarkdown: string
  coverImageUrl: string | null
  categoryName: string | null
  categorySlug: string | null
  authorName: string | null
  metaDescription: string | null
  ogTitle: string | null
  publishedAt: string
  updatedAt: string
}

const route = useRoute()
const slug = route.params.slug as string
const { apiFetch } = useApi()

const { data: post } = await useAsyncData(`blog-post-${slug}`, async () => {
  const { data } = await apiFetch<BlogArticle>(`/blog/posts/${slug}`, { silent: true })
  return data
})

if (!post.value) {
  // Unknown or unpublished slug -- the API answered 404; surface the app's standard 404
  // page exactly like salons/[slug].vue does.
  throw createError({ statusCode: 404, statusMessage: 'Post not found' })
}

const requestUrl = useRequestURL()
const canonicalUrl = `${requestUrl.origin}/blog/${post.value.slug}`

const seoTitle = post.value.ogTitle ?? post.value.title
// When both the SEO override and excerpt are null, fall back to a plain-text excerpt derived
// from the raw markdown body (closes the Plan-8 fast-follow gap). An effectively-empty body
// still emits no description tag at all rather than an empty one.
const seoDescription = resolveBlogDescription(
  post.value.metaDescription,
  post.value.excerpt,
  post.value.bodyMarkdown,
)

useSeoMeta({
  title: seoTitle,
  description: seoDescription,
  ogTitle: seoTitle,
  ogDescription: seoDescription,
  ogType: 'article',
  ogUrl: canonicalUrl,
  ogImage: post.value.coverImageUrl ?? undefined,
})

useHead({
  link: [{ rel: 'canonical', href: canonicalUrl }],
  script: [
    {
      type: 'application/ld+json',
      // JSON.stringify drops undefined members, so optional fields simply vanish.
      // The < escaping matters: stringify does NOT escape a closing script tag, so an
      // admin-authored title containing one could otherwise break out of this block.
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: post.value.title,
        datePublished: post.value.publishedAt,
        dateModified: post.value.updatedAt,
        author: post.value.authorName ? { '@type': 'Person', name: post.value.authorName } : undefined,
        image: post.value.coverImageUrl ?? undefined,
      }).replace(/[<]/g, '\\u003c'),
    },
  ],
})

// Rendered once at setup -- the body never changes on this page. useState (not a plain
// const) so the client reuses the value computed during SSR instead of re-running
// renderMarkdown on the same data during hydration -- keyed by slug so navigating between
// two articles in one session never reuses a stale render.
const bodyHtml = useState(`blog-post-body-${slug}`, () => renderMarkdown(post.value!.bodyMarkdown))

const publishedDate = new Date(post.value.publishedAt).toLocaleDateString('fa-IR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})
</script>

<template>
  <!-- Top-level guard, not just the `post!` assertions below: when the createError(404) throw
       above rejects this component's async setup, Vue's Suspense still runs one render pass of
       this template with `post` at its pre-fetch value (undefined) before the rejection is
       handled. Without this v-if, that pass throws inside the render function itself (an
       unhandled rejection, not the createError) -- reproduced by mounting this page with a
       throwing fetch under @nuxt/test-utils' mountSuspended. -->
  <article v-if="post" class="mx-auto max-w-2xl space-y-5 p-4">
    <NuxtImg
      v-if="post.coverImageUrl"
      provider="arvancloud"
      :src="post.coverImageUrl"
      width="768"
      height="432"
      sizes="(min-width: 768px) 672px, 100vw"
      class="w-full rounded-xl object-cover"
      :alt="post.title"
    />

    <div class="space-y-2">
      <NuxtLink
        v-if="post.categorySlug"
        :to="{ path: '/blog', query: { category: post.categorySlug } }"
        class="inline-block rounded-full bg-(--color-surface-card) px-3 py-1 text-xs text-(--color-accent-strong)"
      >
        {{ post.categoryName }}
      </NuxtLink>
      <h1 class="text-2xl font-bold leading-10 break-words">{{ post.title }}</h1>
      <p class="text-xs opacity-70">
        <span v-if="post.authorName">{{ post.authorName }} · </span>
        <time :datetime="post.publishedAt">{{ publishedDate }}</time>
      </p>
    </div>

    <!-- sanctioned v-html: renderMarkdown uses html:false so raw HTML never parses — see its invariant test -->
    <div class="article-body" v-html="bodyHtml" />

    <!-- Conversion bridge: this whole surface exists to pull organic search traffic toward
         salon discovery (PRODUCT.md) -- a finished reader otherwise has nowhere to go but
         back to search. Kept intentionally lightweight (one card, one action), not a
         related-posts recommendation engine. -->
    <BaseCard padding="lg" class="space-y-3 text-center">
      <p class="font-bold text-(--color-text)">دنبال یک سالن مطمئن می‌گردی؟</p>
      <p class="text-sm text-(--color-text-muted)">سالن‌های تأییدشده نزدیک خودت را در آرایشگاه پیدا کن.</p>
      <BaseButton block @click="navigateTo('/')">
        <template #icon><BaseIcon name="search" :size="16" /></template>
        پیدا کردن سالن نزدیک شما
      </BaseButton>
    </BaseCard>
  </article>
</template>

<style scoped>
/* Hand-rolled RTL article typography -- Tailwind v4 here has no typography plugin, and
   scoped styles only reach v-html content through :deep(). Logical properties
   (padding-inline-start, border-inline-start) keep everything RTL-native, with explicit
   LTR islands for code. */
.article-body {
  font-size: 1rem;
  line-height: 1.9;
  /* The body is admin-authored markdown rendered with linkify:true, so a bare URL becomes
     one unbreakable inline token. At 320px that is wider than the 288px column and would
     scroll the page body sideways -- in RTL, off the left edge. `anywhere` (not
     `break-word`) is what also shrinks the min-content width, which matters because this
     text sits inside flex/grid ancestors elsewhere on the page. */
  overflow-wrap: anywhere;
}
.article-body :deep(h1),
.article-body :deep(h2),
.article-body :deep(h3),
.article-body :deep(h4) {
  margin: 1.5em 0 0.5em;
  font-weight: 700;
  line-height: 1.5;
}
.article-body :deep(h1) { font-size: 1.5rem; }
.article-body :deep(h2) { font-size: 1.25rem; }
.article-body :deep(h3) { font-size: 1.1rem; }
.article-body :deep(p) { margin: 0.75em 0; }
.article-body :deep(ul),
.article-body :deep(ol) {
  margin: 0.75em 0;
  padding-inline-start: 1.5em;
}
.article-body :deep(ul) { list-style: disc; }
.article-body :deep(ol) { list-style: persian; }
.article-body :deep(li) { margin: 0.25em 0; }
.article-body :deep(blockquote) {
  margin: 1em 0;
  border-inline-start: 3px solid var(--color-accent);
  padding-inline-start: 1em;
  opacity: 0.85;
}
.article-body :deep(a) {
  color: var(--color-accent);
  text-decoration: underline;
}
.article-body :deep(img) {
  max-width: 100%;
  margin: 1em 0;
  border-radius: 0.75rem;
}
.article-body :deep(code) {
  direction: ltr;
  unicode-bidi: embed;
  font-family: ui-monospace, monospace;
  font-size: 0.875em;
  background: var(--color-surface-card);
  border-radius: 0.375rem;
  padding: 0.125em 0.375em;
}
.article-body :deep(pre) {
  direction: ltr;
  text-align: left;
  margin: 1em 0;
  padding: 1em;
  background: var(--color-surface-card);
  border-radius: 0.75rem;
  overflow-x: auto;
}
.article-body :deep(pre code) {
  background: none;
  padding: 0;
}
/* markdown-it's default preset leaves the `table` rule enabled, so an admin can author a
   GFM table wider than a 320px column. `display: block` turns the table itself into the
   scroll container (its rows still lay out as a table via anonymous table boxes), so a wide
   table scrolls inside its own box instead of scrolling the page body. */
.article-body :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 1em 0;
}
.article-body :deep(th),
.article-body :deep(td) {
  border: 1px solid var(--color-border);
  padding: 0.375em 0.75em;
  text-align: start;
}
.article-body :deep(hr) {
  margin: 2em 0;
  border-color: var(--color-surface-card);
}
.article-body :deep(strong) { font-weight: 700; }
</style>
