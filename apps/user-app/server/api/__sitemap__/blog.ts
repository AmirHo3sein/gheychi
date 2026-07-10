import type { SitemapUrlInput } from '#sitemap/types'
import { defineEventHandler } from 'h3'

// Same h3-direct-import rationale as urls.ts (see the comment there): defineSitemapEventHandler
// is just defineEventHandler narrowed to return SitemapUrlInput[], and the app-side TS program
// can't see it. Consumes the API's sitemap-blog controller: published posts only, with
// updated_at as lastmod.
export default defineEventHandler(async () => {
  const config = useRuntimeConfig()
  const posts = await $fetch<{ slug: string; updatedAt: string }[]>(`${config.public.apiBase}/sitemap/blog-posts`)

  return posts.map((post) => ({
    loc: `/blog/${post.slug}`,
    lastmod: post.updatedAt,
    changefreq: 'monthly',
    priority: 0.6,
  })) satisfies SitemapUrlInput[]
})
