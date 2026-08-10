import { defineEventHandler, setHeader } from 'h3';
import { buildUrlsetXml, parsePageFromSitemapPath } from '../utils/sitemap';
import type { SitemapPageResponse } from '../utils/sitemap';

// Registered by nuxt.config.ts's `nitro:config` hook against a bounded range of static
// routes (`/sitemap-salons-1.xml` .. `/sitemap-salons-${MAX_SITEMAP_PAGES}.xml`), all
// pointing at this same file -- see that hook's comment for why a single file-based dynamic
// route (`sitemap-salons-[page].xml.ts`) doesn't work here: h3's router (rou3) only matches
// `:param` when it occupies a whole path segment, not embedded in a segment alongside
// literal text like `sitemap-salons-`, so `/sitemap-salons-1.xml` never reached a
// `[page].xml.ts` file in practice -- it silently fell through to Nuxt's page renderer
// instead. With no route param available, this handler recovers the requested page number
// by matching the request path itself.
export default defineEventHandler(async (event) => {
  setHeader(event, 'content-type', 'application/xml; charset=utf-8');

  const page = parsePageFromSitemapPath(event.path, 'sitemap-salons');
  if (page === null) return buildUrlsetXml([]);

  const config = useRuntimeConfig();
  const siteUrl = config.public.siteUrl.replace(/\/$/, '');
  const result = await $fetch<SitemapPageResponse<string>>(`${config.public.apiBase}/sitemap/salon-slugs`, {
    query: { page },
  });

  return buildUrlsetXml(
    result.items.map((slug) => ({
      loc: `${siteUrl}/salons/${slug}`,
      changefreq: 'weekly',
      priority: 0.8,
    })),
  );
});
