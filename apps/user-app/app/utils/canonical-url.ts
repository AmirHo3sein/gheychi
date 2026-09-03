/**
 * Builds the absolute `<link rel="canonical">` url for a page from the app's configured
 * site url (NUXT_PUBLIC_SITE_URL) rather than from the incoming request.
 *
 * That choice is deliberate and differs from the `useRequestURL().origin` used for og:url on
 * the salon/blog/home pages. og:url only has to identify the page a sharer is actually
 * looking at, so echoing the request origin back is harmless; a canonical, by contrast, is a
 * *claim about which single url owns this content*. Deriving it from the request means the
 * very duplicates a canonical exists to collapse each get their own self-consistent
 * canonical: hit the app on the bare origin behind Caddy, on a www host, on http, or on
 * :3003 directly, and every variant would confidently canonicalise to itself. One configured
 * origin -- the same one the sitemap already builds its <loc> entries from
 * (server/utils/sitemap.ts), so the two can never disagree about what a page's url is.
 *
 * @param siteUrl  runtimeConfig.public.siteUrl, with or without a trailing slash
 * @param path     root-relative path, with or without a leading slash; '' / '/' both mean the
 *                 site root
 * @param query    optional query params. An entry whose value is undefined, null or '' is
 *                 DROPPED rather than serialised -- see the callers' own normalisation notes:
 *                 a canonical must be the one url for this content, so a default-valued or
 *                 empty param has to be absent, not present-and-empty.
 */
export function buildCanonicalUrl(
  siteUrl: string,
  path: string,
  query?: Record<string, string | number | undefined | null>,
): string {
  const origin = siteUrl.replace(/\/$/, '')
  const normalizedPath = path === '' || path === '/' ? '' : `/${path.replace(/^\//, '').replace(/\/$/, '')}`

  // URLSearchParams (not hand-rolled concatenation): city slugs and blog category slugs are
  // server-supplied values that still have to be percent-encoded correctly, and Persian
  // category slugs are entirely possible here.
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const search = params.toString()

  // A bare origin with no path is a valid canonical, but the trailing-slash form is the one
  // convention worth pinning: '/' and '' are the same page, and emitting both across pages
  // would be exactly the inconsistency this helper exists to prevent.
  return `${origin}${normalizedPath || '/'}${search ? `?${search}` : ''}`
}
