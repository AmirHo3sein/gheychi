// Public salon handle = salon.slug, reused directly as the shareable link
// (gheychi.co/salons/<handle>) rather than a separate /s/<handle> route -- see
// docs/superpowers/specs/2026-08-30-monetization-platform-design.md's owner decision. A
// provider-chosen handle is checked against this list before it's ever written.
//
// Two distinct reasons a word is here: (1) a genuine route collision -- 'mine' is a literal
// path SalonsController already registers ahead of the `:slug` route (GET/PATCH
// /salons/mine), so a salon whose slug were literally "mine" would make its own public
// profile permanently unreachable, silently resolving to the caller's own salon instead;
// (2) plain hygiene -- a public link reading gheychi.co/salons/admin looks like a system
// page regardless of whether it happens to collide with a real route today.
export const RESERVED_SALON_HANDLES = new Set([
  // Genuine route collisions under /salons/:slug's own path depth (see salons.module.ts).
  'mine',
  // Hygiene: words that would read as a platform/system page, not a salon.
  'admin', 'api', 'login', 'logout', 'new', 'edit', 'settings', 'search', 'favorites',
  'help', 'about', 'contact', 'terms', 'privacy', 'blog', 'salons', 's', 'app', 'www',
  'static', 'assets', 'support', 'null', 'undefined',
]);
