# 06 — User Panel (`apps/user-app`)

The customer-facing app. Nuxt 4, full SSR (no `ssr: false` anywhere), installable PWA, Persian/RTL only (no i18n library by design — single locale). Port 3003.

## Routing & pages

File-based routing under `app/pages/`. `components: [{ path: '~/components', pathPrefix: false }]` in `nuxt.config.ts` means components resolve without folder-name prefixing (`booking/SlotPicker.vue` → `<SlotPicker>`).

| Route | Access | SSR/SEO | Purpose |
|---|---|---|---|
| `/` (`index.vue`) | Auth required | Client-fetched | Home/search: category pills, city picker, geolocation "near me", list/map toggle |
| `/login` | Public | `bare` layout | 3-step OTP flow (phone → code → profile completion), referral code entry |
| `/profile` | Auth required | — | Name/gender edit, push toggle, favorites, links to wallet/referral, logout |
| `/salons/[slug]` | **Public** | **Yes — `useAsyncData` + `useSeoMeta` + JSON-LD `BeautySalon`** | Salon profile — services, hours, photos, stories, portfolio, reviews, workers, favorite/report actions. **The primary SEO surface.** |
| `/blog`, `/blog/[slug]` | **Public** | **Yes — SSR + `useSeoMeta` + JSON-LD `Article` (article page)** | Content-marketing blog. Second SEO surface. |
| `/booking/[slug]/[serviceId]` | Auth required | `useAsyncData` | Service booking: worker picker, slot picker, coupon validation, wallet-balance apply, deposit math, Zarinpal redirect |
| `/booking/callback` | Auth required, `bare` layout | — | Zarinpal return page — 3 outcomes: success / refunding / failed |
| `/bookings`, `/bookings/[id]` | Auth required | list: no; detail: `useAsyncData` | Booking list/detail, cancel with refund-outcome preview, retry-payment, review prompt |
| `/account/referral` | Auth required | — | Referral code/share link, referral + reward history |
| `/account/wallet` | Auth required | — | Wallet balances + paginated transaction history |
| `/admin/featured` | Auth + `admin` middleware | — | Admin-only tool, embedded inside the customer app, to toggle a salon's featured flag/expiry — an architectural oddity (admin functionality living outside `admin-panel`), see [24-technical-debt.md](./24-technical-debt.md) |

Only `/salons/*` and `/blog*` (plus `/login`) are in `isPublicRoute()` (`app/utils/route-guard.ts`); every other route requires a session.

## Route guard — `middleware/auth.global.ts`

Runs on every navigation:
1. If `!session.checked`, probes `GET /auth/me` (`silent:true, redirectOn401:false`) — probed even on public routes so the UI reflects a logged-in visitor's state everywhere. Guards against a stale-probe race with a `!session.checked` re-check.
2. `!isLoggedIn && !isPublicRoute` → `navigateTo('/login')`.
3. `needsProfileCompletion && path !== '/profile' && !isPublicRoute` → `navigateTo('/profile')`.

`middleware/admin.ts` is a trivial synchronous `role !== 'admin' → navigateTo('/')`, relying on `auth.global.ts` having already hydrated `session.user`.

## Composables (`app/composables/`)

- **`useApi.ts`** — wraps `$fetch`. On the server, manually forwards the `Cookie` header (`useRequestHeaders(['cookie'])`) since SSR fetches to a different origin don't carry the browser's cookies automatically. Reads the API's JSON `message` field (not ofetch's `statusMessage`, which is empty over HTTP/2). 401 → redirect to `/login` unless `redirectOn401:false`; non-401 error → toast unless `silent:true`. **Every API call in the app goes through this — never call `$fetch`/`useFetch` directly.**
- **`useTheme.ts`** — cookie-persisted (`useCookie('theme', {default:'system'})`), `isDark` resolves `'system'` via `matchMedia` client-side only. Must stay in sync with an inline anti-FOUC script in `nuxt.config.ts`'s `app.head.script` that toggles `.dark` before Vue mounts.
- **`useToast.ts`** — `useState`-backed (request-scoped, not a module-level singleton — avoids cross-request leakage under SSR), 5s auto-dismiss.
- **`usePushSubscription.ts`** — VAPID key conversion, `Notification.requestPermission()` → `pushManager.subscribe()` → `POST /push/subscribe`. Detects support only in `onMounted` (avoids SSR hydration mismatch). **Rebinds ownership on every login/status refresh** — a `PushSubscription` is per-browser, not per-user, so `rebindOwnership()` re-POSTs to claim the endpoint for whoever is logged in now, preventing a shared-device scenario where a new user keeps receiving the previous user's notifications.
- **`useDialog.ts`** — shared a11y primitive (focus trap, Escape-to-close, focus restore) used by every hand-rolled dialog (ReportForm, ReviewPromptModal, cancel-confirm, PortfolioGrid lightbox, StoryViewer). Supports nested dialogs.
- **`useLogout.ts`** — unsubscribes push (2s-timeboxed via `Promise.race`, since `serviceWorker.ready` can hang forever) **before** clearing the session cookie.

## State — `app/stores/session.ts`

Single Pinia store: `{ user: SessionUser|null, checked: boolean }`. `SessionUser = { id, phone, name, gender, role }`. **No token is ever stored client-side** — same HttpOnly-cookie-only model as every other app.

## Components (`app/components/`)

- **`booking/`** — `SlotPicker.vue` (fetches per-worker/service availability, day-tab + slot-grid UI), `ReviewPromptModal.vue` (5-phase state machine: form/view/edit/deleted/already-reviewed).
- **`layout/`** — `AppHeader.vue`, `ThemeToggle.vue`, `ToastStack.vue`.
- **`salon/`** — `SalonCard.vue`, `SalonGallery.vue`, `SalonImagePlaceholder.vue` (icon-on-background fallback, deliberately no raster asset for low-bandwidth reasons), `SalonMap.client.vue` (Leaflet, SSR-unsafe), `SalonReviews.vue`, `SalonTeam.vue`, `StoriesRing.vue`, `StoryViewer.client.vue` (full-screen story viewer, CSS-animation progress bars, `prefers-reduced-motion`-aware), `PortfolioGrid.vue`, `ReportForm.vue`.
- **`ui/`** — `BaseButton.vue`, `BaseCard.vue`, `BaseInput.vue`, `BaseSelect.vue`, `BaseIcon.vue` (hand-rolled SVG icon set, no external icon library), `CitySelect.client.vue` (vue-multiselect wrapper), `JalaliDatePicker.vue`.

**`.client.vue` suffix** marks SSR-unsafe components: `SalonMap.client.vue` (Leaflet touches `window`/DOM directly), `StoryViewer.client.vue` (client-only gesture/scroll-lock logic), `CitySelect.client.vue` (`vue-multiselect` touches the DOM during its own `setup()`, not just `onMounted`). All three are lazy-loaded (`<LazySalonMap>` etc.).

## PWA & push

`@vite-pwa/nuxt` with the `injectManifest` strategy — a custom service worker at `app/sw.ts` (Workbox precaching + hand-written `push`/`notificationclick` handlers). Manifest: Persian name `قیچی`, `lang:'fa' dir:'rtl'`, standalone display. End-to-end push flow documented in [16-notifications.md](./16-notifications.md). One known limitation: every push notification always opens `/bookings` on tap — no deep-linking to the specific booking it's about.

## Maps & images

- **Maps**: Leaflet + CARTO's free Voyager tile layer — no API key needed. Marker popups link out to the customer's own maps app (Neshan/Google Maps) for directions rather than in-app turn-by-turn routing.
- **Images**: `@nuxt/image` with a custom, minimal ArvanCloud provider (`app/providers/arvancloud.ts`) — appends `?width=&height=` query params only, no format/quality/fit mapping.

## SEO plumbing

`server/api/__sitemap__/urls.ts` and `.../blog.ts` are Nitro handlers feeding `@nuxtjs/sitemap`, each fetching the API's own `GET /sitemap/salon-slugs` / `GET /sitemap/blog-posts` (capped at 50,000 rows each) and mapping to sitemap entries. `robots.txt` explicitly allows `/salons/` and `/blog/`, disallows `/admin/`, `/bookings`, `/profile`, `/booking/`.

## Testing

Three tiers, all under `apps/user-app`:
1. **Unit** (`test/unit/*.spec.ts`, `environment:'node'`) — pure functions (`auth-errors`, `discount`, `gender-map`, `geo`, `markdown-excerpt`, `markdown`, `route-guard`, `salon-seo`, `slot-format`, `story-seen`).
2. **Component/composable** (`test/nuxt/*.spec.ts`, `environment:'nuxt'` via `@nuxt/test-utils`) — page and component tests.
3. **E2E** (`e2e/*.spec.ts`, Playwright, `workers:1` forced serial since both spec files share a live Redis-backed OTP rate limiter on a fixed phone number). `global-setup.ts` does a hard `DROP SCHEMA public CASCADE` + `redis.flushdb()` before every run — a real operational hazard if ever pointed at a non-throwaway database.

## Related documents

- [09-booking-engine.md](./09-booking-engine.md), [10-scheduling.md](./10-scheduling.md), [11-payment-system.md](./11-payment-system.md) — what the booking pages drive
- [16-notifications.md](./16-notifications.md) — push mechanism in full
- [24-technical-debt.md](./24-technical-debt.md) — the `/admin/featured` placement, dual-Vite typecheck workaround, and other findings specific to this app
