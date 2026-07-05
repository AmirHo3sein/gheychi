# Plan 4 — User App Frontend (Nuxt 4 PWA)

**Date:** 2026-07-05
**Status:** Approved design (brainstorming complete)

> **Correction (during plan-writing):** this doc and the original marketplace spec both say "Nuxt 3." Nuxt 3 reaches end-of-life this same month (July 2026); Nuxt 4 has been the stable release for a while. "Nuxt 3" here was shorthand for "Nuxt," not a deliberate version pin — the implementation plan builds on Nuxt 4. Nothing else in this design changes.

## 1. Product Summary

The customer-facing app for Arayeshgah: discovery, salon profiles, booking, and account management, built as the Nuxt SSR PWA described in the original marketplace design (`2026-07-04-arayeshgah-marketplace-design.md` §5). This plan also introduces two things not in the original MVP scope: an **admin-controlled "featured salon" ad placement**, and **push notifications** (closing Plan 2's undelivered SMS-reminder gap along the way).

Nothing in the API has a consumer yet — Plans 1–3 are backend-only. This plan ships the first real UI.

### Decisions locked during brainstorming

| Decision | Choice |
|---|---|
| Scope | Full customer app in one plan: auth, discovery, salon profile, booking flow, my bookings, profile |
| Sequencing | Blog/content CMS split out to a separate **Plan 5** — independent subsystem (own backend module + admin editor), not blocking the core app |
| Visual style | **Light mode:** "Teal Trust" — white/near-white surfaces, deep teal text/accent, warm coral for CTAs and ad badges. **Dark mode:** "Bold Editorial" — near-black surfaces, violet→pink gradient accent. Same layout/components in both, OS-aware with a manual override toggle |
| Font | Vazirmatn, self-hosted, Persian UI only (fa, RTL) |
| Ad placement mechanic | Inline sponsored card, badged "تبلیغ", within the normal ranked results list — not a separate hero carousel |
| Featured-salon control | Admin-flagged only (no self-serve payment yet); one bare-bones admin page to toggle it, since the real admin-panel doesn't exist yet |
| Map view | Built now (not deferred) — Leaflet + Neshan tiles, list remains the default/primary view |
| PWA | Installable + offline app-shell **and** push notifications |
| SEO priority | Salon profile pages (per original spec); blog pages deferred to Plan 5 |
| Reminders | This plan adds appointment reminders via **both** SMS and push, closing the gap Plan 2 left open |

## 2. Architecture

### Tech stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Nuxt 3, SSR | SEO-indexable salon pages (original spec requirement) |
| Styling | Tailwind CSS + CSS custom properties for theme tokens, `dark:` variant strategy | Fast, consistent, responsive; small purged bundle; trivial light/dark |
| Data fetching | Nuxt's built-in `useFetch`/`useAsyncData` | SSR-native — fetches once on the server, reuses on client hydration; no separate client-cache library needed |
| Auth/session state | Small Pinia store holding only `{ id, name, gender, role }` | Session token itself is an HttpOnly cookie forwarded on SSR requests — never touches JS or Pinia state, matching the API's existing model |
| Font | `@fontsource/vazirmatn`, self-hosted, Arabic/Persian subset only, `font-display: swap` | Avoids a render-blocking third-party font request |
| Maps | Leaflet + Neshan tile layer, client-only component, lazy-loaded only when the map toggle is activated | Neshan's officially supported/documented web SDKs are Leaflet- and OpenLayers-based; no confirmed MapLibre GL vector-tile compatibility, so Leaflet is the verified-correct choice |
| Images | `@nuxt/image`, responsive `srcset`, lazy-loading, WebP/AVIF | Salon photos are ArvanCloud URLs; directly improves LCP on card/gallery-heavy pages |
| PWA | `@vite-pwa/nuxt` — manifest, installability, Workbox service worker precaching the app shell | |
| Push notifications | Web Push (VAPID) via `web-push` npm package on the API; new `push_subscriptions` table | Mirrors the existing `SmsProvider` interface pattern — a `PushProvider`-style abstraction, swappable, not hard-wired |
| SEO | `useSeoMeta`, `@nuxtjs/sitemap`, JSON-LD (`LocalBusiness` + `AggregateRating`), OG tags, robots.txt | |

### App structure

```
apps/
├── api/                   # existing NestJS backend (Plans 1-3)
├── user-app/              # NEW — Nuxt 3 SSR PWA
│   ├── nuxt.config.ts
│   ├── app.vue
│   ├── assets/
│   │   ├── fonts/vazirmatn/           # self-hosted font files
│   │   └── css/tokens.css             # light/dark CSS custom properties
│   ├── pages/
│   │   ├── login.vue
│   │   ├── index.vue                  # Home (discovery)
│   │   ├── salons/[slug].vue          # Salon profile (SSR, SEO)
│   │   ├── booking/[salonId]/[serviceId].vue
│   │   ├── bookings/index.vue         # My bookings
│   │   ├── bookings/[id].vue
│   │   ├── profile.vue
│   │   └── admin/featured.vue         # bare-bones featured-toggle page
│   ├── components/
│   │   ├── salon/SalonCard.vue        # includes Ad badge variant
│   │   ├── salon/SalonMap.vue         # client-only Leaflet wrapper
│   │   ├── booking/SlotPicker.vue
│   │   └── ...
│   ├── composables/
│   │   ├── useAuthSession.ts
│   │   ├── usePushSubscription.ts
│   │   └── useTheme.ts                # light/dark/system toggle
│   ├── stores/session.ts              # Pinia — user identity only
│   └── server/                        # Nuxt server routes/middleware (cookie forwarding)
```

### Backend additions (in `apps/api`)

- `salons.is_featured boolean default false`, `salons.featured_until timestamptz nullable` — new migration.
- `SearchService.search()` — boost matching featured salons to the top of results (still filtered by gender/city/category/radius like every other result), capped at **2 per query**, each row tagged `isFeatured: true`.
- New admin endpoint: `PATCH /admin/salons/:id/featured` (`RolesGuard`, `@Roles('admin')`) — sets `is_featured`/`featured_until`.
- New `push_subscriptions` table (`user_id`, `endpoint`, `p256dh`, `auth`, `created_at`) + `POST /push/subscribe`, `DELETE /push/subscribe` (authenticated).
- New `PushProvider` interface (mirrors `SmsProvider`) + `WebPushProvider` implementation using VAPID keys from env.
- Push sends added alongside the existing SMS sends in `payments.service.ts` (booking confirmed → customer + salon owner).
- New `booking-reminder.job.ts` (`@Cron`, same pattern as `booking-expiry.job.ts`/`payment-reconciliation.job.ts`): finds confirmed bookings starting in `reminder_lead_hours` (new `platform_config` tunable, seeded e.g. 3 hours), sends **both** SMS and push, marks booking as reminded (new `reminded_at` column) so it never double-sends.
- New env vars: `NESHAN_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

## 3. Screens & UX

- **Login:** phone number → OTP (matches existing API flow) → name + gender on first login only.
- **Home:** city selector, search box, category chips, list of ranked `SalonCard`s (cover photo, name, rating+count, distance, "from" price), sort by distance/rating, list/map toggle (map lazy-loads Leaflet+Neshan only when tapped). Featured salons render as a normal card with a small "تبلیغ" badge (top-left in RTL), positioned first among matching results, capped at 2. Respects the gender filter like every other result — never a bypass.
- **Salon profile** (`/salons/[slug]`, SSR): photo gallery, rating summary, services with price/duration (booking entry point), hours, address + static/embedded map, reviews with salon replies, JSON-LD `LocalBusiness`/`AggregateRating`, OG image = cover photo.
- **Booking flow:** service → date/slot picker → confirm sheet (price, deposit, cancellation policy) → Zarinpal redirect → success screen. A pending-payment booking surfaces as a retry banner on return.
- **My bookings:** upcoming/past, cancel action (respecting cancellation window), review prompt after a booking is marked `completed`.
- **Profile:** name/gender, saved salons, push-notification opt-in toggle.
- **Admin — featured toggle** (`/admin/featured`, role-gated): unstyled table of approved salons with a checkbox + optional expiry date input, calling the new admin endpoint. No design polish — functional only, superseded whenever the real admin-panel is built.

Both themes (light "Teal Trust" / dark "Bold Editorial") apply to every screen above via the same components — no screen-specific palette forks.

## 4. Notifications

- **Push:** subscribe on first login (permission prompt after a meaningful action, not on page load — avoids the dismiss-and-never-ask-again trap). Events: booking confirmed (customer + salon owner), appointment reminder.
- **SMS:** unchanged existing events (booking confirmed, new booking for salon), **plus** the new appointment reminder.
- Both channels are best-effort — a notification failure never rolls back or blocks a booking/reminder job run (matches the existing `.catch(() => {})` pattern already used for SMS sends).

## 5. Performance & SEO

- SSR for all public pages (home, salon profile) — meaningful content in the initial HTML response, not client-rendered after the fact.
- Self-hosted subset font, responsive/lazy images, lazy-loaded map — all chosen specifically to protect Core Web Vitals (LCP, CLS, INP) on a photo- and map-heavy app.
- `@nuxtjs/sitemap` generates sitemap entries from live salon slugs; robots.txt allows public pages, disallows `/admin`, `/bookings`, `/profile`.
- JSON-LD structured data + OG tags on salon profile pages, per original spec's "each salon page is a landing page for Google traffic."

## 6. Error Handling

- Global 401 → redirect to `/login` (client) / redirect response (SSR), matching the API's existing session model.
- Toast-by-default error surface; `silent` mode for components handling errors locally (e.g. booking-slot-taken retries).
- Push subscription failures (permission denied, unsupported browser) degrade silently — SMS remains the reliable channel.
- Map load failures fall back to the list view without blocking the rest of the page.

## 7. Testing

- Component tests for logic-bearing pieces: slot picker, booking status states, ad-badge rendering rule (featured + within cap).
- API-side: unit tests for the featured-boost query logic and the reminder job's idempotency (`reminded_at` guard against double-send), same rigor as Plans 1–3.
- E2E (Playwright): happy path — search → salon profile → book → pay (mock gateway) → review; a second path covering the admin featured-toggle → home page reflecting the badge.

## 8. Out of Scope (this plan)

- Blog/content CMS (backend module, admin editor, public pages) — **Plan 5**.
- Self-serve, salon-paid promotion (pricing, payment flow) — admin-flagged only for now.
- Native store wrapper (Capacitor) — unchanged from original spec, still deferred.
- Provider-panel and the full admin-panel — still their own future plans; the featured-toggle page here is intentionally minimal and not a preview of that work.
- Full `fa`/`en` i18n — unchanged from original spec, Persian-only UI.

## 9. Open Risks

- **Neshan API terms/quota** for a production map integration haven't been checked against expected traffic — verify before launch, same class of risk as Zarinpal's refund mechanics flagged in the original spec.
- **Push notification opt-in rates** on mobile web are typically low; SMS remains the primary reliable channel and push is additive, not a replacement.
- **Ad density:** capping featured salons at 2 per query is a starting point, not validated against real inventory — revisit once real salons sign up for featured placement.
