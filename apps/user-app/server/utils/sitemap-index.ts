import { buildSitemapIndexXml, computeSitemapPageCount } from './sitemap';
import type { SitemapPageResponse } from './sitemap';

// Shared by server/routes/sitemap-index.xml.ts and sitemap.xml.ts (the latter preserves the
// URL robots.txt has always advertised by serving the same content). Only ever fetches page
// 1 of each source -- just enough to read `total`/`pageSize` and compute how many
// sitemap-salons-N.xml / sitemap-posts-N.xml files to list. The actual URL rows for a given
// page are fetched only once, by the sub-sitemap route a crawler subsequently requests, not
// here.
//
// useRuntimeConfig/$fetch are Nitro's own ambient globals (unlike defineSitemapEventHandler
// in the old @nuxtjs/sitemap-backed handlers this replaces, they don't go through the
// `#imports` virtual module, so they don't hit the vue-tsc app-side-program issue documented
// in docs/technical-overview/24-technical-debt.md) -- no explicit import needed here, same
// as the rest of this codebase's Nitro server code.
export async function buildSitemapIndexPayload(): Promise<string> {
  const config = useRuntimeConfig();
  const siteUrl = config.public.siteUrl.replace(/\/$/, '');
  const apiBase = config.public.apiBase;

  const [salonsFirstPage, postsFirstPage] = await Promise.all([
    $fetch<SitemapPageResponse<string>>(`${apiBase}/sitemap/salon-slugs`, { query: { page: 1 } }),
    $fetch<SitemapPageResponse<{ slug: string; updatedAt: string }>>(`${apiBase}/sitemap/blog-posts`, {
      query: { page: 1 },
    }),
  ]);

  const salonPageCount = computeSitemapPageCount(salonsFirstPage.total, salonsFirstPage.pageSize);
  const postPageCount = computeSitemapPageCount(postsFirstPage.total, postsFirstPage.pageSize);

  const sitemapLocs = [
    ...Array.from({ length: salonPageCount }, (_, i) => `${siteUrl}/sitemap-salons-${i + 1}.xml`),
    ...Array.from({ length: postPageCount }, (_, i) => `${siteUrl}/sitemap-posts-${i + 1}.xml`),
  ];

  return buildSitemapIndexXml(sitemapLocs);
}
