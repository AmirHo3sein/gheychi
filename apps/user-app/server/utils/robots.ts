// Pure, framework-free builder behind server/routes/robots.txt.ts -- same split (and same
// reasoning) as server/utils/sitemap.ts: no h3/Nuxt imports, so test/unit/robots.spec.ts can
// exercise it directly under Vitest's plain 'node' environment.
//
// This used to be a static public/robots.txt, which could not do the one thing robots.txt
// most needs a runtime value for: Google requires the `Sitemap:` directive to be a FULLY
// QUALIFIED url and silently ignores a relative one (the old file shipped `Sitemap:
// /sitemap.xml`, i.e. the sitemap index was never actually discovered through robots.txt at
// all). The origin is only known from NUXT_PUBLIC_SITE_URL at runtime, so the file has to be
// generated. Nitro serves public/ assets ahead of server routes, so public/robots.txt was
// deleted in the same change -- leaving it in place would have shadowed this route entirely.

// Paths kept out of the index. Everything here is either a private per-user surface or a
// mid-transaction step that is meaningless without the session that created it:
//   /admin/    -- the user-app's own admin-only featured-salons screen
//   /account/  -- wallet, referral, activity, favorites (all per-user, all previously
//                 crawlable: this is the gap this list exists to close)
//   /bookings  -- the customer's own booking list AND /bookings/:id detail
//   /booking/  -- the checkout flow itself (/booking/:slug/:serviceId, /booking/callback)
//   /profile   -- the customer's own account settings
// Note the deliberate asymmetry: `/bookings` has no trailing slash so it covers both the
// list route and every `/bookings/:id` beneath it (robots.txt matching is a bare prefix
// match, not a path-segment match), while `/booking/` keeps its slash so it cannot also
// swallow `/bookings`.
const DISALLOWED_PATHS = ['/admin/', '/account/', '/bookings', '/booking/', '/profile'];

export function buildRobotsTxt(siteUrl: string): string {
  // Trailing slash stripped before concatenating, exactly as the sitemap handlers do -- a
  // configured value of "https://gheychi.co/" must not yield "https://gheychi.co//sitemap.xml".
  const origin = siteUrl.replace(/\/$/, '');
  return [
    'User-agent: *',
    'Allow: /',
    // Redundant against `Allow: /` on its own, but kept deliberately: the public salon
    // listing and every salon profile are the whole point of this site being crawlable, and
    // an explicit line here is what stops a future broad Disallow from silently taking them
    // out. It also documents intent for the next person editing this list.
    'Allow: /salons/',
    ...DISALLOWED_PATHS.map((path) => `Disallow: ${path}`),
    '',
    // /sitemap.xml (not /sitemap-index.xml) -- both serve the identical sitemap index, and
    // this is the URL that has always been advertised here. See server/routes/sitemap.xml.ts.
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}
