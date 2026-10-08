# 37 — Beauty Guide

A customer uploads an inspiration photo (or taps «توضیح این استایل» on a salon portfolio
image); an AI vision model describes it in a controlled beauty vocabulary; Gheychi maps that
to **real** services, salons and portfolio work and hands off to the **existing** booking flow.
Spec and owner decisions: `docs/superpowers/specs/2026-10-07-beauty-guide-design.md`.

**Core rule: AI interprets inspiration; Gheychi's database decides what can be booked.** No AI
output is ever read by pricing, deposit, availability, booking, payment, refund, wallet,
coupon, subscription or commission code.

## Moving parts (`apps/api/src/beauty-guide/`)

| Piece | Role |
|---|---|
| `beauty_concepts` | Controlled vocabulary (39 seeded). Each concept → at most one global `service_categories` row (the only vocabulary shared across salons) + Persian/English names + keywords (ranking boost only) + curated, hedged maintenance copy. Admin-managed at `/admin/beauty-concepts` (audited; retire with `isActive=false`, no delete). |
| `analysis/beauty-analysis.contract.ts` | The strict output contract and `parseBeautyAnalysis()` — the only gate between model output and the DB. Structural problems → `invalid_output`; bad values (unknown concept keys, out-of-enum attributes, impossible durations, over-long strings) are dropped, never repaired. Confidence leaves the API only as `high/medium/low`. |
| `BeautyAnalysisProvider` (`BEAUTY_ANALYSIS_PROVIDER` token) | `mock` (deterministic fixtures, tests/dev), `openai-compatible` (any `/chat/completions` vision endpoint — Gemini's OpenAI-compatible endpoint locally, an Iran-reachable gateway in production; config only), `unconfigured` (default; fails cleanly). Selected by `BEAUTY_ANALYSIS_PROVIDER`. Deliberately separate from the unused generic `src/ai` seam. |
| `image-processing.ts` | `sharp`: validate (format, ≥200 px, ≤40 MP, ≤5 MB) → auto-rotate → ≤1024 px → re-encode JPEG (drops EXIF/GPS). Only the processed image is stored or sent to the provider. |
| `PrivateImageStore` (`PRIVATE_IMAGE_STORE`) | Local dir **outside** the publicly served `uploads/` (`PRIVATE_UPLOADS_DIR`, prod volume `api_private_uploads`), traversal-proof keys, no URL concept. Not reconciled by `StorageReconciliationJob`, not backed up (deleting must really delete). |
| `beauty_guides` / `beauty_guide_concepts` | The private guide + its concept set. Customer corrections (`removed`, `source='user'`) are authoritative and never overwritten by the AI's original output. Provider/model/prompt/schema versions stored; guides are never silently regenerated. |
| `BeautyGuideUsageService` | Durable daily counts (Tehran day) of real provider calls: `beauty_guide_daily_limit_per_user` (3), `beauty_guide_daily_limit_global` (300). One in-flight analysis per user (Redis lock, fails closed). Per-user duplicate cache (same image hash + prompt/schema version → earlier guide, no call, no quota; never shared across users). |
| `beauty-guide-matching.ts` | Pure, explainable ranking over SQL-filtered candidates: active services in mapped categories at **approved** salons whose `gender_target` matches the **session user** (server-side), within radius. Order: concept coverage → keyword hit → has portfolio → rating (if reviews on) → distance. No featured boost. Only `fixed` services are bookable online; others show "coordinate with the salon". Low-confidence AI concepts don't drive matching until the customer confirms them. |
| `BeautyGuideRetentionJob` (hourly, `CronJobRunner`) | Fails guides stuck in `processing` >5 min; deletes guides older than `beauty_guide_retention_days` (90) with their image, unless attached to a still-upcoming booking. |
| `bookings.beauty_guide_id` | Nullable FK (`ON DELETE SET NULL`), set by `createHold` only for the caller's own guide (else 400). Context for the salon; nothing financial reads it. |

Synchronous analysis (no queue exists): the row is persisted as `processing` first; the
provider call has its own timeout (default 45 s) and no automatic retry (cost) — the customer
retries manually.

## API

Customer (authenticated, 404 for another user's guide, whole surface 404 while
`feature_beauty_guide_enabled` is off): `POST /beauty-guides` (multipart `file`),
`POST /beauty-guides/from-portfolio/:portfolioItemId`, `GET /beauty-guides`,
`GET /beauty-guides/concepts`, `GET /beauty-guides/:id`, `GET /beauty-guides/:id/image`
(`private, no-store`), `GET /beauty-guides/:id/matches?lat&lng&radiusKm`,
`POST /beauty-guides/:id/retry`, `PATCH /beauty-guides/:id`, `DELETE /beauty-guides/:id`.

Salon: `GET /salons/mine/bookings/:bookingId/beauty-guide` (+ `/image`) — only for a booking at
the caller's salon that carries the guide. Admin: `GET/POST/PATCH /admin/beauty-concepts`.

## Frontends

- user-app: `/beauty-guide` (create; also `?portfolioItemId=`), `/beauty-guide/[id]`,
  `/account/beauty-guides`; home CTA, profile link and portfolio-lightbox button appear only
  when the flag is on (this flag **fails closed** in `useFeatureFlags`). Prices render through
  the shared `ServicePriceTag.vue` / `utils/service-price.ts` (also used by the salon page);
  never totalled. Private routes; `/beauty-guide` is in `robots.ts` disallow.
- provider-panel: `BeautyGuideCard.vue` inside booking cards when `beautyGuideId` is set.
- admin-panel: `/beauty-concepts`, the feature flag, and the three numeric config keys.

## Analytics & metrics

Server-side events: `beauty_guide_created`, `_reused`, `_analysis_started`,
`_analysis_completed`, `_analysis_failed`, `_updated`, `_deleted`, `_matches_viewed`,
`beauty_guide_booking_started`, `beauty_guide_booking_confirmed`. Metrics:
`beauty_guide_analyses_total{provider,outcome}`, `beauty_guide_analysis_duration_seconds`,
`beauty_guide_limit_rejections_total{scope}`. Image bytes, prompts and model output are
never logged.

## Reaching the AI endpoint (local and production)

Verified locally with Gemini (`gemini-3-flash-preview`, ~10 s per analysis, good Persian output):

- **System-wide VPN (TUN mode, e.g. Windscribe):** works with no configuration.
- **Local HTTP proxy (e.g. v2rayN on `127.0.0.1:10808`):** Node's built-in `fetch()` ignores
  `HTTPS_PROXY` by default — requests silently go out on the direct (Iranian) IP and Google
  answers with an HTML `403`. Start the API with `NODE_USE_ENV_PROXY=1` plus
  `HTTPS_PROXY`/`NO_PROXY` in the **process** environment. `turbo.json`'s `dev` task passes these
  through (Turbo 2's strict env mode otherwise strips them).
- **Production:** the same proxy route is the simplest way out of Iran, but `NODE_USE_ENV_PROXY`
  needs Node 24 — the API image is `node:20-alpine`. Either bump the image's Node version or wire
  an undici `ProxyAgent` dispatcher into `OpenAiCompatibleBeautyAnalysisProvider` (a small,
  contained change). Alternatively, point `BEAUTY_AI_BASE_URL` at an Iran-reachable
  OpenAI-compatible gateway and skip the proxy entirely.
- **Gemini free tier:** low rate limits (429/503 are frequent — these map to `provider_busy`, are
  retryable, and never consume the customer's quota) and Google may use free-tier inputs to
  improve its products. Use a paid tier before real customer photos are analysed.
- Failure codes: `provider_busy` (429/503) and `provider_unreachable` (connection never made —
  VPN/proxy down; the cause, e.g. `ECONNREFUSED`, is logged) don't consume quota; `timeout`,
  `provider_error` and `invalid_output` do (the provider may have done the work).

## Known limitations (V1, deliberate)

- Precision is category-level: salons don't tag services with concepts, so balayage vs root
  melt can't be told apart below «رنگ مو» except by free-text keyword hits. The real fix is a
  salon-tagged `salon_service_concepts` (V2).
- Services filed under a salon's *custom* category are invisible to matching.
- No client-side click analytics (no client event endpoint exists).
- Production AI reachability from Iran is unresolved — keep the flag off until an
  Iran-reachable endpoint is configured.
- No visual/embedding similarity; portfolio matching is service-category + keyword.
