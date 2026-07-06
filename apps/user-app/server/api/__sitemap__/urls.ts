import type { SitemapUrlInput } from '#sitemap/types'
import { defineEventHandler } from 'h3'

// Nuxt 4's typed internal-API-map feature (used by $fetch<T>/useFetch's route inference)
// resolves every server route file's types by importing it into the *app*-side TS program
// (see .nuxt/types/nitro-routes.d.ts) -- not just the server-side one. This repo's
// tsconfig.json doesn't declare TS project references, so `nuxt typecheck` runs a single,
// non-composite `vue-tsc` pass and the app-side program's `#imports` (which only re-exports
// app auto-imports) gets used here instead of the server-side one that actually has
// `defineSitemapEventHandler`. Importing h3's `defineEventHandler` directly sidesteps this --
// `defineSitemapEventHandler` (from @nuxtjs/sitemap) is just `defineEventHandler` narrowed to
// return `SitemapUrlInput[]`, so behavior is identical.
export default defineEventHandler(async () => {
  const config = useRuntimeConfig()
  const slugs = await $fetch<string[]>(`${config.public.apiBase}/sitemap/salon-slugs`)

  return slugs.map((slug) => ({
    loc: `/salons/${slug}`,
    changefreq: 'weekly',
    priority: 0.8,
  })) satisfies SitemapUrlInput[]
})
