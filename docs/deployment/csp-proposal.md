# Content-Security-Policy proposal

**Status:** draft for review — NOT applied to the Caddyfile. Written by a research/audit pass
on 2026-08-12. Every claim below is either **[VERIFIED]** (checked against a real Docker build
of the production image, driven through a real Chromium browser via Playwright, with actual
`SecurityPolicyViolationEvent`s captured) or **[STATIC]** (read from source only — not
exercised at runtime in this environment, usually because it needs a live database or a real
external network egress this sandbox doesn't have). Confidence and citations are called out
per directive, not just once at the top.

## How this was tested (and what could not be tested)

1. Built the real production image: `docker build -f apps/user-app/Dockerfile -t
   gheychi-user-app-csp-test .` from repo root — succeeded, image `50ad70b4e6ad`, 258MB.
2. Ran it (`docker run -p 18023:3003 -e NUXT_PUBLIC_API_BASE=https://api.gheychi.co/api -e
   NUXT_PUBLIC_SITE_URL=https://gheychi.co ...`) — this container has **no database and no real
   network egress to api.gheychi.co** in this sandbox, so anything that requires seeded salon
   data (a real salon detail page with `SalonMap.client.vue`'s Leaflet/CARTO tiles, a real
   `NuxtImg`-rendered photo) could not be exercised end-to-end. Routes that render without DB
   data (`/`, `/blog`, `/login`, `/salons` shell) could be, and were.
3. Wrote a tiny local Node reverse proxy that forwards to the container and injects the
   proposed `Content-Security-Policy` header (the header does not exist anywhere today — this
   is the first one), then drove real Chromium (Playwright, the same browser binary this repo's
   own e2e suite uses) against it, capturing:
   - real `securitypolicyviolation` DOM events (the authoritative signal — not string-matching
     console text),
   - `page.on('console')` and `page.on('pageerror')`,
   - `page.on('requestfailed')` (to distinguish an actual `net::ERR_BLOCKED_BY_CSP` from an
     unrelated network failure),
   - a genuine interactivity check: clicking the theme-toggle button and confirming
     `<html class="dark">` actually flips — this proves hydration and event-listener wiring
     survived the policy, not just "nothing logged an error."
4. Ran the same check against a **negative control** — the same policy with `'unsafe-inline'`
   removed from `script-src`/`style-src` — to empirically confirm those keywords are load-bearing
   rather than a theoretical worry. Result: real violations, a hydration crash
   (`pageerror: Cannot read properties of undefined (reading 'app')`), and the toggle click doing
   nothing. Chrome's own violation messages also independently produced the exact SHA-256 hashes
   computed by hand below, which is a nice cross-check.
5. Did **not** get to run the equivalent Docker+Playwright loop for provider-panel/admin-panel
   (nginx-served static SPAs) or api — for those, findings are **[STATIC]**: the built `dist/`
   output was inspected directly (hashed external asset filenames, zero inline `<script>`/`<style>`
   in the shipped `index.html`), which is a much easier case to reason about than SSR, but it is
   source/build-artifact analysis, not a live-browser CSP-violation check.
6. Could not verify the *actual production* value of `S3_PUBLIC_BASE_URL` / `VITE_API_BASE_PROD`
   — see the "open items" section. These are deploy-time secrets/CI variables, not committed to
   the repo, so `img-src`/`connect-src` below use the values that are *knowable* from the repo
   (env var names, `DOMAIN_API`, CI variable names) with an explicit flag on what still needs a
   human to confirm against the real `.env` / GitHub Actions repo variables before this is applied.

---

## 1. user-app (`{$DOMAIN_APEX}` and, transparently, `www` before its redirect)

### What it actually loads

- **Inline scripts.** [VERIFIED — both statically and via a real browser] SSR-rendered HTML
  contains exactly two classic (`type`-less, i.e. executable) inline `<script>` blocks, plus two
  non-executable ones that CSP `script-src` does not gate at all (`type="application/ld+json"`
  and `type="application/json" id="__NUXT_DATA__"` — browsers never execute non-JS-typed script
  blocks, so CSP has nothing to check):
  - **Theme/dark-mode detection**, sourced from `apps/user-app/nuxt.config.ts:118-122`
    (`app.head.script[0].innerHTML`). Full content:
    ```js
    (function(){try{var m=document.cookie.match(/(?:^|; )theme=([^;]*)/);var p=m?decodeURIComponent(m[1]):'system';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();
    ```
    It reads `document.cookie` and `matchMedia` **at runtime in the browser** — nothing is
    server-interpolated into the string itself, so the string Nuxt emits is byte-identical on
    every request. Confirmed empirically: fetched `/`, `/blog` with different `Cookie: theme=...`
    headers and the emitted script was byte-for-byte identical every time
    (`sha256-tFgP/88NRdQuKVlyWA1br2m22NVeED35zvktRCwe054=`, 271 bytes). **This one is a legitimate
    hash-allowlist candidate on its own.**
  - **Nuxt's own runtime-config bootstrap**, `window.__NUXT__={};window.__NUXT__.config={public:
    {apiBase:"...",vapidPublicKey:"...",siteUrl:"..."},app:{baseURL:"/",buildId:"<uuid>",...}}` —
    this is emitted by Nuxt/Nitro itself, not app code, and it is **not static**: it embeds a
    `buildId` UUID that Nitro generates fresh on every production build (confirmed by reading
    Nuxt's own build output — a new UUID every `nuxt build`). Within one running deployment it
    is stable (same hash on every request until the next deploy), but a hash pinned in a
    long-lived Caddyfile would break on the very next release. **This script is why a pure
    hash-only `script-src` does not work for this app without also re-generating and
    redeploying the Caddyfile's CSP hash on every single release** — and, worse, CSP's own
    backward-compatibility rule means listing *any* hash/nonce in `script-src` causes
    CSP2+-aware browsers to silently **ignore** `'unsafe-inline'` in the same directive, so a
    "hash the static one, unsafe-inline the rest" split does not work either — the moment a hash
    is present, only hash-matching or nonce-matching scripts run, and this unhashable script
    would be blocked outright. Verified: I ran the app with `script-src 'self'` (no
    `'unsafe-inline'`, no hashes) and watched Chromium literally report both scripts blocked and
    the app crash on hydration (`pageerror: Cannot read properties of undefined (reading 'app')`,
    from Nuxt trying to read `window.__NUXT__.config.app` after the bootstrap script never ran).
  - **Recommendation:** `script-src 'self' 'unsafe-inline'` for now, not a hash list. The real
    fix for a stricter policy is a Nitro server middleware that mints a per-request nonce and
    tags both the theme script (via `app.head.script[0].nonce` / a custom `render:html` hook)
    and Nuxt's own bootstrap script — Nuxt doesn't do this automatically in this version
    (checked `nuxt`@4.4 / `nitropack` — no built-in CSP-nonce hook found), so it would require
    either hand-rolled Nitro plumbing or adopting the `nuxt-security` module, neither of which
    exists in this codebase today. That's real app-level work, out of scope for a Caddyfile-only
    change, and is called out here as a follow-up rather than attempted.

- **Inline style attributes.** [VERIFIED via real browser, both positive and negative control]
  Vue sets `style="..."` directly via the DOM `style` property/attribute for `v-show` (renders
  `style="display:none"`) and for every `:style="..."` binding in the codebase — e.g.
  `apps/user-app/app/components/ui/JalaliDatePicker.vue:190` (`transform: translateX(...)`,
  value computed from live popover-overflow state) and
  `apps/user-app/app/components/salon/StoryViewer.client.vue:221` (dynamic transform/opacity for
  the story progress bar). These are genuinely per-render dynamic values, not enumerable. The
  negative-control run (strict `style-src 'self'`, no `'unsafe-inline'`) produced **eight
  different `style-src-attr` violations with eight different SHA-256 hashes across four routes**
  — concrete proof these values vary too much to hash-allowlist. No `<style>` tag appears in the
  SSR output at all (Vue's scoped CSS compiles to the external hashed `_nuxt/*.css` files, same
  as the rest of the build) — the exposure is only inline **style attributes**, not `<style>`
  blocks or `@import`. **Recommendation:** `style-src 'self' 'unsafe-inline'`.

- **Images / uploaded photos.** [STATIC — the concrete origin is a deploy-time secret, not
  committed]. `apps/user-app/app/providers/arvancloud.ts:7-12` is a pure passthrough
  `@nuxt/image` provider — `getImage(src, ...)` returns `src` (plus a query string) verbatim; it
  does **not** hardcode any ArvanCloud (or any other) domain. Every `<NuxtImg provider=
  "arvancloud">` call site (`PortfolioGrid.vue:65,102`, `StoryViewer.client.vue:232`,
  `SalonHero.vue:86,135`, `SalonCard.vue:32`, `StoriesRing.vue:35`, `SalonGallery.vue:7`,
  `blog/index.vue:115`, `blog/[slug].vue:104`, `account/favorites.vue:61`) is passed a `src`
  that ultimately comes from the API's stored `publicUrl()`. That resolves to one of two origins
  depending on `STORAGE_PROVIDER` (`apps/api/src/storage/storage.module.ts:13-24`):
  - `local`: `apps/api/src/storage/local-disk-storage.provider.ts:20-22` — `${APP_BASE_URL}
    /uploads/${key}`, i.e. **the API's own origin**, `api.gheychi.co` in production (per
    `.env.example:21` / `DOMAIN_API`).
  - `s3`: `apps/api/src/storage/s3-storage.provider.ts:47-49` — `${S3_PUBLIC_BASE_URL}/${key}`,
    an operator-set value (`.env.example:44-50`) that is **never committed to this repo** — it's
    filled in on the real deploy host. The provider is *named* `arvancloud` in the Nuxt image
    config, which strongly suggests the real bucket is ArvanCloud object storage, but that is an
    inference from a variable/file name, not a verified fact — the actual `S3_PUBLIC_BASE_URL`
    domain was not discoverable from this repo. **Open item: confirm the real value with `docker
    compose -f docker-compose.prod.yml exec api env | grep S3_` (or the ops-side secret store)
    before finalizing `img-src`.**
  - Also confirmed: map tiles. `apps/user-app/app/components/salon/SalonMap.client.vue:85-90`
    loads Leaflet raster tiles from `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/...`
    (CARTO's free Voyager tiles, no API key) as `<img>` elements Leaflet manages internally —
    this needs `img-src https://*.basemaps.cartocdn.com`. **[STATIC only]** — could not exercise
    this in the browser test since the container has no seeded salon/coordinates to render a
    real map with.
  - Outbound-only, **not** CSP-relevant: `neshanUrl()`/`googleMapsUrl()`
    (`apps/user-app/app/utils/map-links.ts:9-14`) and the Instagram profile link
    (`apps/user-app/app/pages/salons/[slug].vue:358`) are plain `<a href target="_blank">`
    anchors the user clicks to leave the site — CSP's fetch directives (`img-src`, `connect-src`,
    etc.) do not govern top-level navigation via anchor clicks or `navigateTo(..., {external:
    true})` (confirmed this is also how the Zarinpal payment redirect works — see below — no
    directive blocks it).
  - `data:` is needed too, but not from user-app's own build — see provider-panel/admin-panel
    below; user-app's build was not checked line-by-line for `data:` URIs the same way, but
    since it shares the exact same Tailwind/build toolchain and several of the same UI
    components as the panels (which do emit one), `img-src` should include `data:` defensively
    here as well. **[not independently verified for user-app — inferred from the identical panel
    build pipeline]**.

- **Payment gateway redirect.** [STATIC] `apps/user-app/app/pages/booking/[slug]/
  [serviceId].vue:309` and `apps/user-app/app/pages/bookings/[id].vue:67` call `navigateTo(data.
  paymentUrl, { external: true })` — a full top-level browser navigation to Zarinpal, not a
  `<form action="...">` POST. Grepped the whole frontend for `<form` with an `action=` attribute
  pointing off-origin — none exist (every form in this codebase is `@submit.prevent` + `fetch`).
  So `form-action 'self'` is safe and does **not** need to allow Zarinpal's domain.

- **Fonts.** [VERIFIED via build output] `apps/user-app/app/assets/css/main.css:1-2` — `@import
  "@fontsource-variable/vazirmatn/wght.css"`, a self-hosted variable font package. Grepped the
  entire repo for `fonts.googleapis`/`fonts.gstatic`/any external `@import url(...)` — zero
  hits, in any of the three frontend apps. The equivalent panel builds (see below) confirm the
  font ships as same-origin hashed `.woff2` files, not a CDN reference or a data URI. `font-src
  'self'` is sufficient; no external font host needed anywhere in this project.

- **API/XHR calls.** [STATIC — verified the code path, not a live cross-origin fetch, since this
  sandbox has no route to the real api.gheychi.co]. `apps/user-app/app/composables/useApi.ts:44`
  — `baseURL: config.public.apiBase`, which is `NUXT_PUBLIC_API_BASE`
  (`apps/user-app/nuxt.config.ts:71-82`), i.e. `https://api.gheychi.co/api` in production. In the
  Playwright run, requests to `https://api.gheychi.co/api/cities` and `/categories` failed with
  `net::ERR_FAILED` — **not** `net::ERR_BLOCKED_BY_CSP** — confirming the failure was this
  sandbox's lack of real network egress, not the CSP policy itself blocking the call. This is
  reasonably strong evidence `connect-src https://api.gheychi.co` is correctly shaped, but it is
  not a full proof the real production fetch succeeds end-to-end (that would need the same test
  run somewhere with real DNS/network access to api.gheychi.co).

- **PWA / service worker.** [VERIFIED via build config, STATIC for the SW's own behavior]
  `apps/user-app/nuxt.config.ts:83-110` — `@vite-pwa/nuxt` with `strategies: 'injectManifest'`,
  `srcDir: '.'`, `filename: 'sw.ts'`. The actual worker
  (`apps/user-app/app/sw.ts`) only uses `workbox-precaching` against same-origin precached URLs
  and handles `push`/`notificationclick` events that navigate to same-origin paths
  (`resolveTargetUrl` in `sw.ts` hard-validates the target is a same-origin `/bookings/<uuid>` or
  falls back to `/bookings` — never opens an attacker-controlled URL). Needs `worker-src 'self'`
  (to allow registering `/sw.js` itself) and `manifest-src 'self'` (for `<VitePwaManifest/>`,
  injected per `apps/user-app/app/app.vue:22`, which links `/manifest.webmanifest`). No external
  origins referenced by the worker.

- **Dev-mode only, not relevant to the production CSP but noted per the task:** Vite's HMR client
  injects its own inline bootstrap script and uses a WebSocket (`ws://localhost:*`) in `nuxt
  dev`. That only runs in local development, is never present in the `.output` production build
  this Dockerfile ships, and should **not** be accounted for in the live Caddy CSP.

### Proposed CSP — user-app (apex + www)

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https://api.gheychi.co https://<S3_PUBLIC_BASE_URL host> https://*.basemaps.cartocdn.com;
  font-src 'self';
  connect-src 'self' https://api.gheychi.co;
  worker-src 'self';
  manifest-src 'self';
  frame-ancestors 'none';
  base-uri 'none';
  form-action 'self';
  object-src 'none'
```

*(`https://<S3_PUBLIC_BASE_URL host>` is a placeholder — see open items. If `STORAGE_PROVIDER=
local` in production, drop it entirely: `https://api.gheychi.co` already covers `/uploads/*`
since it's served from the API's own origin.)*

Per-directive confidence:

| Directive | Confidence | Basis |
|---|---|---|
| `default-src 'self'` | High | No `<iframe>`/`<video>`/`<audio>` found anywhere in the frontend (grepped); safe fallback for unlisted fetch types. |
| `script-src 'self' 'unsafe-inline'` | **Verified live** (positive + negative control) | Real browser run: zero violations with `'unsafe-inline'`; real crash without it. |
| `style-src 'self' 'unsafe-inline'` | **Verified live** (positive + negative control) | Same methodology; 8 distinct un-hashable style-attr violations observed in the negative control. |
| `img-src ... api.gheychi.co` | Static, high confidence | `useApi.ts`/`local-disk-storage.provider.ts` code path read directly. |
| `img-src ... S3_PUBLIC_BASE_URL host` | **Static, unverified value** | Env var exists (`.env.example:44-50`) but its real production value is a secret not in this repo — needs manual confirmation. |
| `img-src ... cartocdn.com` | Static only | Confirmed in source (`SalonMap.client.vue:87`); not exercised live (no seeded map data). |
| `img-src data:` | Inferred, not directly verified for this app | Verified present in the *sibling* panel builds' CSS (`SalonInfoStep-C8MCBiDN.css`); user-app's own build wasn't grepped for a `data:` URI, but shares the same toolchain. |
| `font-src 'self'` | High | Self-hosted `@fontsource-variable/vazirmatn`; zero external font references repo-wide. |
| `connect-src 'self' https://api.gheychi.co` | Verified CSP didn't block it; network reachability itself unverified | `net::ERR_FAILED` (sandbox network limit) vs. `net::ERR_BLOCKED_BY_CSP` (would indicate a real CSP problem) — the latter was never seen. |
| `worker-src 'self'`, `manifest-src 'self'` | Static, high confidence | `sw.ts` and `app.vue:22` read directly; no external references. |
| `frame-ancestors 'none'` | High | No embedding use case found; matches existing `X-Frame-Options: DENY`. |
| `base-uri 'none'` | High | No `<base>` tag anywhere in the repo. |
| `form-action 'self'` | High | No cross-origin `<form action>`; Zarinpal redirect is a JS navigation (`navigateTo(..., {external:true})`), which `form-action` does not govern. |
| `object-src 'none'` | High | No `<object>`/`<embed>`/Flash-era usage found. |

---

## 2. provider-panel (`{$DOMAIN_PANEL}`) and admin-panel (`{$DOMAIN_ADMIN}`)

### What they actually load

- **Inline scripts/styles.** [VERIFIED against the actual `dist/` build output, not just source]
  `apps/provider-panel/index.html` and `apps/admin-panel/index.html` (source) contain no inline
  script or style at all — just `<script type="module" src="/src/main.ts">`. Checked the
  **already-built** `apps/provider-panel/dist/index.html` / `apps/admin-panel/dist/index.html`
  too, since Vite/legacy plugins sometimes inject an inline modulepreload shim: neither does —
  both are exactly `<script type="module" crossorigin src="/assets/index-<hash>.js">` +
  `<link rel="stylesheet" crossorigin href="/assets/index-<hash>.css">`, nothing else. Every JS
  chunk and every CSS file in `dist/assets/` uses a content-hashed filename
  (`index-DfK_ri0m.js`, `index-SH1zcRSa.css`, etc.) — fully external, cacheable, and CSP-clean.
  **`script-src 'self'` with no `'unsafe-inline'` should work for the `<script>`/`<style>`
  *element* case in these two apps** — this is a materially stronger position than user-app,
  which has no choice about the SSR-injected inline scripts.
- **Inline style *attributes* still apply, though** — same Vue runtime, same pattern as
  user-app: `apps/provider-panel/src/components/ui/JalaliDatePicker.vue:194` (shared component,
  identical dynamic `transform: translateX(...)`), `apps/admin-panel/src/components/ui/
  JalaliDatePicker.vue:200`, `apps/admin-panel/src/components/ui/AppSelect.vue:68` (`:style=
  "{ width }"`), `apps/admin-panel/src/components/layout/NotificationBell.vue:163` (dynamic
  transform). These are dynamic per-instance values, same reasoning as user-app — not
  hash-enumerable. **`style-src` still needs `'unsafe-inline'` here**, even though `script-src`
  does not. [Static — inferred by code-identity with user-app's already-verified-live case,
  not independently run through Playwright for these two apps.]
- **`data:` images.** [VERIFIED in the actual built CSS] `apps/provider-panel/dist/assets/
  SalonInfoStep-C8MCBiDN.css` contains one `url(data:image/png;base64,...)` — a decorative
  background image baked in by the build, not user content. `img-src` needs `data:`.
- **Uploaded photos.** [STATIC] `apps/provider-panel/src/pages/PhotosView.vue:103`,
  `PortfolioView.vue:166`, `StoriesView.vue:171` (`<img :src="p.url">` /
  `s.url`) and `apps/admin-panel/src/pages/BlogEditorView.vue:579`, `ReportsView.vue:201,222`,
  `SalonDetailView.vue:287,333` all render a `url` field returned directly by the API — same
  origin(s) as user-app's images (API-served `/uploads/*` or the S3 public base URL). Same open
  item: the real S3 host isn't in this repo.
- **API calls.** [STATIC] `apps/provider-panel/src/composables/useApi.ts:21` and
  `apps/admin-panel/src/composables/useApi.ts:21` both read `import.meta.env.VITE_API_BASE`,
  a **build-time** Vite env var (baked into the static JS bundle at image-build time, unlike
  user-app's server-side-readable runtime config). `apps/provider-panel/Dockerfile` (`ARG
  VITE_API_BASE=http://localhost:3002/api` / `ENV VITE_API_BASE=$VITE_API_BASE`) shows the
  default is a dev fallback; `.github/workflows/ci.yml:267-268,279-280` show the real production
  build passes `VITE_API_BASE=${{ vars.VITE_API_BASE_PROD }}` — a GitHub Actions repository
  variable **not visible from this repo's source**, presumably `https://api.gheychi.co/api` by
  naming convention and by matching `DOMAIN_API`, but not directly confirmed. **Open item:
  confirm `vars.VITE_API_BASE_PROD`'s actual value in the repo's GitHub Actions settings.**
- **Fonts.** [VERIFIED in built CSS] Same `@fontsource-variable/vazirmatn` self-hosted setup
  (`apps/provider-panel/src/assets/css/main.css:1-2`, `apps/admin-panel/src/assets/css/
  main.css:1-2`); confirmed in the actual built CSS that the `.woff2` files are served as
  same-origin hashed files under `/assets/` (`vazirmatn-arabic-wght-normal-Cafbb7Zc.woff2`
  etc.), not inlined as data URIs and not fetched from any font CDN. `font-src 'self'`.
- **nginx.** `docker/nginx-spa.conf` adds no security headers of its own (Caddy is the layer
  that should own CSP, consistent with the existing `security_headers` snippet) and does a plain
  SPA `try_files ... /index.html` fallback — no CSP-relevant behavior there.

### Proposed CSP — provider-panel and admin-panel (identical policy for both)

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https://api.gheychi.co https://<S3_PUBLIC_BASE_URL host>;
  font-src 'self';
  connect-src 'self' https://api.gheychi.co;
  frame-ancestors 'none';
  base-uri 'none';
  form-action 'self';
  object-src 'none'
```

(No `worker-src`/`manifest-src` needed — neither panel registers a service worker or PWA
manifest; grepped both `src/` trees for `serviceWorker`/`vite-plugin-pwa` — no hits.)

| Directive | Confidence | Basis |
|---|---|---|
| `script-src 'self'` (no unsafe-inline) | High, static | Verified against the actual `dist/index.html` build output — zero inline script anywhere in either app's shipped HTML. Not run through a live CSP-violation browser check the way user-app was. |
| `style-src 'self' 'unsafe-inline'` | Medium — inferred from identical, already-verified-live pattern in user-app | Same `:style` binding mechanism, same shared `JalaliDatePicker` component; not independently browser-tested for these two apps in this session. |
| `img-src ... data:` | High, static | Confirmed literal `url(data:image/png;...)` in the built `SalonInfoStep-C8MCBiDN.css`. |
| `img-src ... api.gheychi.co / S3 host` | Same caveat as user-app | S3 host unconfirmed; API origin high-confidence. |
| `connect-src` | Medium — build-time var not visible in repo | `VITE_API_BASE_PROD` GH Actions variable value needs confirming. |
| `font-src 'self'` | High, static | Confirmed via built CSS asset paths. |

---

## 3. api (`{$DOMAIN_API}`)

[STATIC — grepped the whole `apps/api` tree] No Swagger/OpenAPI UI: `@nestjs/swagger` does not
appear anywhere in `apps/api/src`, `apps/api/package.json`, or `pnpm-lock.yaml` (checked with a
lockfile grep, zero hits) — so no default Swagger HTML page exists to worry about.

`apps/api/src/main.ts:44-52` — `app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix:
'/uploads', setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff') })` is the
one place the API serves files that (in `STORAGE_PROVIDER=local` mode) came from user uploads.
This is already defended in depth against stored-HTML/XSS by
`apps/api/src/common/trusted-image-upload.ts`: every upload call site validates **both** the
real file bytes (NestJS's `FileTypeValidator`, magic-number sniffing) **and** the client-declared
`Content-Type` against the exact same allowlist (`image/jpeg|png|webp` only,
`ALLOWED_IMAGE_MIME_TYPE_PATTERN`), specifically because those two fields can disagree — the doc
comment in that file explains this closes exactly the "JPEG bytes declared as `text/html`" attack.
So `/uploads/*` can never actually serve an HTML file no matter what a malicious upload attempts.

Error responses: `apps/api/src/error-tracking/global-exception.filter.ts` is a `@Catch()`-all
filter that only adds a Sentry-style capture side effect and then delegates to `super.catch()`
(NestJS's own `BaseExceptionFilter`), which is JSON, never HTML, for both `HttpException` and
unknown errors under Nest's default HTTP adapter. No custom error page, no HTML anywhere.

**Conclusion: the API needs essentially no CSP for its own sake — it doesn't render pages a
browser would apply CSP's script/style enforcement to.** The value of adding one anyway is
almost entirely defense-in-depth (in case a future endpoint, a debug page, a health-check
dashboard, or some other route inadvertently starts returning HTML) and cheap to include given
the same `security_headers` snippet already touches this site block.

### Proposed CSP — api

```
Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'
```

Deliberately the strictest of the four — `default-src 'none'` with no per-directive carve-outs,
since the API is not expected to ever load a script, style, image, or font of its own. If this
ever breaks something, that in itself is a useful signal that the API started serving content it
shouldn't be.

| Directive | Confidence | Basis |
|---|---|---|
| `default-src 'none'` | High, static | No Swagger, no HTML error pages, no template rendering anywhere in `apps/api/src` (verified by reading `main.ts` bootstrap end-to-end and the global exception filter). |

---

## Summary table — all four site blocks

| Site block | `script-src` | `style-src` | Needs `'unsafe-inline'`? | Verified how |
|---|---|---|---|---|
| apex/www → user-app | `'self' 'unsafe-inline'` | `'self' 'unsafe-inline'` | Yes, both — SSR-injected dynamic scripts + Vue inline style attrs | **Live browser test, positive + negative control** |
| panel.gheychi.co → provider-panel | `'self'` | `'self' 'unsafe-inline'` | style only | Static (build-output analysis); style-src inferred from user-app's verified result |
| admin.gheychi.co → admin-panel | `'self'` | `'self' 'unsafe-inline'` | style only | Same as provider-panel |
| api.gheychi.co → api | `'none'` (via default-src) | `'none'` | No | Static (no HTML surface at all) |

## Open items before this can be applied

1. **Confirm the real `S3_PUBLIC_BASE_URL`** (if `STORAGE_PROVIDER=s3` in production — check
   with `docker compose -f docker-compose.prod.yml exec api env | grep -E 'STORAGE_PROVIDER|S3_'`
   on the real host) and put its exact host in `img-src` for user-app, provider-panel, and
   admin-panel. If it's `local`, drop the S3 entry — `api.gheychi.co` already covers it.
2. **Confirm `vars.VITE_API_BASE_PROD`** in this repo's GitHub Actions settings matches
   `https://api.gheychi.co/api` as assumed.
3. **Decide on the `script-src 'unsafe-inline'` relaxation for user-app.** This proposal takes it
   as the pragmatic, verified-working answer given the constraints found (SSR-injected,
   per-build-unhashable bootstrap script). A stricter nonce-based policy is possible but requires
   real app-level work (Nitro middleware or the `nuxt-security` module) that is out of scope for
   a Caddyfile-only change — flagging it as a legitimate follow-up, not doing it silently as part
   of "just the CSP."
4. **Provider/admin-panel's `style-src 'unsafe-inline'` and img-src/connect-src were not
   independently live-browser-tested** the way user-app was (time/scope) — recommend running the
   same Docker-build + Playwright-negative-control methodology against
   `apps/provider-panel/Dockerfile` and `apps/admin-panel/Dockerfile` before shipping, since it's
   cheap (nginx + static files, no DB dependency at all — likely *easier* to fully verify live
   than user-app was) and would upgrade several "static, inferred" rows above to "verified."
5. Once applied, deploy in **`Content-Security-Policy-Report-Only`** first for a burn-in period
   (Caddy supports this as just a different header name via the same `header` directive) with a
   `report-to`/`report-uri` collector, to catch anything this audit missed on real production
   traffic (real salon photos, real map renders, real logged-in sessions) before enforcing.
