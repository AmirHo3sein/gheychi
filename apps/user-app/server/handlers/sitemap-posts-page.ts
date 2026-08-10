import { defineEventHandler, setHeader } from 'h3';
import { buildUrlsetXml, parsePageFromSitemapPath } from '../utils/sitemap';
import type { SitemapPageResponse } from '../utils/sitemap';

// Same routing rationale as sitemap-salons-page.ts (see the comment there) -- registered
// against `/sitemap-posts-1.xml` .. `/sitemap-posts-${MAX_SITEMAP_PAGES}.xml` by
// nuxt.config.ts's `nitro:config` hook. Consumes the API's sitemap-blog source: published
// posts only, one page at a time, with updated_at mapped to lastmod.
export default defineEventHandler(async (event) => {
  setHeader(event, 'content-type', 'application/xml; charset=utf-8');

  const page = parsePageFromSitemapPath(event.path, 'sitemap-posts');
  if (page === null) return buildUrlsetXml([]);

  const config = useRuntimeConfig();
  const siteUrl = config.public.siteUrl.replace(/\/$/, '');
  const result = await $fetch<SitemapPageResponse<{ slug: string; updatedAt: string }>>(
    `${config.public.apiBase}/sitemap/blog-posts`,
    { query: { page } },
  );

  return buildUrlsetXml(
    result.items.map((post) => ({
      loc: `${siteUrl}/blog/${post.slug}`,
      lastmod: post.updatedAt,
      changefreq: 'monthly',
      priority: 0.6,
    })),
  );
});
