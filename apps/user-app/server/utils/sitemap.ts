// Pure, framework-free helpers behind the hand-rolled sitemap endpoints
// (server/handlers/sitemap-*-page.ts, server/routes/sitemap*.ts). No h3/Nuxt imports on
// purpose: they're exercised directly by test/unit/sitemap.spec.ts under Vitest's plain
// 'node' environment (no Nuxt test context needed), and it keeps the handler files
// themselves down to thin fetch-then-render wiring.
//
// The sitemap protocol hard-caps a single sitemap file at 50,000 URLs
// (https://www.sitemaps.org/protocol.html#index). SITEMAP_PAGE_SIZE must match the API's
// own page size (apps/api/src/common/sitemap-pagination.ts) -- it exists here only as the
// fallback used if a source response is somehow missing `pageSize`; the real value driving
// how many sub-sitemap files get listed always comes from each source's own response.
export const SITEMAP_PAGE_SIZE = 5_000;

// nuxt.config.ts's `nitro:config` hook pre-registers exactly this many `/sitemap-salons-N.xml`
// and `/sitemap-posts-N.xml` static routes at startup (N = 1..MAX_SITEMAP_PAGES) -- see the
// comment there for why these can't be a single file-based dynamic route. At SITEMAP_PAGE_SIZE
// URLs/page that's 500,000 rows of headroom per source; computeSitemapPageCount clamps to it
// so the index never advertises a page number nothing is registered to serve. Bump both this
// and the loop bound in nuxt.config.ts together if a source ever genuinely approaches it.
export const MAX_SITEMAP_PAGES = 100;

export interface SitemapUrlEntry {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
}

export interface SitemapPageResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

export function buildUrlsetXml(entries: SitemapUrlEntry[]): string {
  const urls = entries
    .map((entry) => {
      const parts = [`<loc>${escapeXml(entry.loc)}</loc>`];
      if (entry.lastmod) parts.push(`<lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
      if (entry.changefreq) parts.push(`<changefreq>${entry.changefreq}</changefreq>`);
      if (entry.priority !== undefined) parts.push(`<priority>${entry.priority}</priority>`);
      return `<url>${parts.join('')}</url>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

export function buildSitemapIndexXml(sitemapLocs: string[]): string {
  const sitemaps = sitemapLocs.map((loc) => `<sitemap><loc>${escapeXml(loc)}</loc></sitemap>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemaps}</sitemapindex>`;
}

// A page beyond the real last page (a stale crawler-cached URL, or the table shrank since
// the index was generated) must come back as a valid, empty sitemap, never a 404/500 --
// that's the API's job (skip/take past `total` naturally yields items: []). This only
// guards the route param itself: anything that isn't a positive integer (missing,
// non-numeric, zero, negative, decimal) is treated the same way here, before ever calling
// the API -- parsePageParam returns null and the route responds with an empty <urlset/>.
export function parsePageParam(raw: string | undefined): number | null {
  if (!raw) return null;
  if (!/^[1-9]\d*$/.test(raw)) return null;
  return Number(raw);
}

// However many sub-sitemap pages currently exist for a source, from that source's own
// total/pageSize -- always at least 1, so the index has something to point at (an empty
// <urlset/> is a valid sitemap) even when the source has zero rows. Clamped to
// MAX_SITEMAP_PAGES (see its comment) so the index can never list a page number beyond what
// nuxt.config.ts actually pre-registered a route for.
export function computeSitemapPageCount(total: number, pageSize: number): number {
  return Math.min(MAX_SITEMAP_PAGES, Math.max(1, Math.ceil(total / pageSize)));
}

// Pre-registered static routes (see MAX_SITEMAP_PAGES) have no route param, so the shared
// handler recovers the requested page number by matching the request path itself against
// `/<prefix>-N.xml`, e.g. prefix "sitemap-salons" matches "/sitemap-salons-42.xml" -> 42.
// Returns null for anything that doesn't fit that exact shape (never reachable for a path
// that matched one of the pre-registered routes in the first place, but kept total rather
// than assuming).
export function parsePageFromSitemapPath(path: string, prefix: string): number | null {
  const match = new RegExp(`^/${prefix}-(\\d+)\\.xml$`).exec(path);
  if (!match) return null;
  return parsePageParam(match[1]);
}
