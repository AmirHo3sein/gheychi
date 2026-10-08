# Gheychi Beauty Guide — Design (Phase 0 audit + Phase 1 plan)

**Date:** 2026-10-07
**Status:** Draft — awaiting owner approval. No implementation code written yet.

Core principle: **AI interprets inspiration; Gheychi's database decides what can be booked.**
AI output is advisory. Prices, durations, availability, bookings and money are never
derived from it.

---

## 1. Phase 0 — audit findings that shape the design

| Area | Fact (verified in code) | Design consequence |
|---|---|---|
| AI | `apps/api/src/ai/` is an unwired string-in/string-out seam (`AiProvider.complete`), `UnconfiguredAiProvider` throws. No vendor SDK anywhere. Its own doc says add a purpose-built method rather than stretch `complete()`. | New domain-specific `BeautyAnalysisProvider` interface; `AiModule` stays untouched. |
| Vendor access | `docs/phase-p-ai-readiness.md` §2: OpenAI/Anthropic/Gemini generally unavailable to Iranian accounts/IPs. Prod runs on an Iran-reachable host (Zarinpal runbook). No proxy support in code. Where prod can reach is **not documented**. | One **OpenAI-compatible chat-completions** adapter (base URL + key + model from env). Works with region-serving aggregators, OpenRouter-style gateways, or a self-hosted vLLM vision model — vendor choice becomes config, not code. **Must be verified from the prod host before enabling.** |
| Queue/worker | No queue library, no worker app/service; 11 cron jobs via `CronJobRunner`. Node `requestTimeout` 300 s; no Caddy timeout. | **Synchronous** analysis inside the request (45 s abort), with the guide row persisted as `processing` first, and a cron sweeper that fails stale `processing` rows. No new queue. |
| Storage | `StorageProvider` is public-only (`upload()` returns a URL). Local mode serves **everything under `uploads/`** publicly via `useStaticAssets` (`main.ts:74-82`). Prod = `STORAGE_PROVIDER=local`. Backup `mc mirror` (no `--remove`) copies the uploads volume forever. Reconciliation job deletes unknown keys under `salons/`. | Customer images must **never** go through `StorageProvider` or `uploads/`. New small `PrivateImageStore` (local dir outside `uploads/`, own volume, not backed up), served only through authenticated streaming endpoints. |
| Image processing | No sharp/jimp; EXIF (incl. GPS) never stripped anywhere. Uploads: multer memory, 5 MB, `FileTypeValidator` + `assertTrustedImageMimeType`. | Add `sharp`: decode → auto-rotate → max 1024 px → re-encode JPEG (drops EXIF/GPS). Only the processed image is stored or sent to AI. Reuse the existing validation pipe + mime guard. |
| Entitlements | Plans/entitlements are **salon** subscriptions only. Customers have no plan. | Customer limits come from `platform_config` numeric keys, not entitlements. No new billing. |
| Rate limiting | No throttler; Redis INCR copied inline (OTP, referral). SMS quota uses durable count-of-log rows per Jalali month. | Durable count of the user's analysis attempts per Tehran day (`iran-time.util`), plus a global daily cost breaker. Fail closed. |
| Categories | Flat `service_categories` (14 seeded Persian names, int ids, no slug). Admin CRUD exists. | Concepts map to **categories** (the only shared vocabulary across salons). |
| Services | `salon_services.name` is free text; no tags. Pricing `fixed/from/range/quote`; only `fixed` bookable online (`createHold` 400s otherwise). `duration_min` is the only duration availability reads. | Category = deterministic filter; concept keywords = ranking boost only. Non-fixed services shown with existing "coordinate with salon" copy, no booking link. |
| Search | `/search` filters `salon_categories` (owner tags, not services), single `categoryId`, gender is client-sent. | Separate `BeautyGuideMatchService` reusing search's WHERE semantics but filtering on **active services** in mapped categories, gender from the **session user**. `/search` untouched. |
| Portfolio | `portfolio_items` has no tags; optional `service_id` (→ category). No cross-salon query; index only `(salon_id, sort_order)`. | Cross-salon portfolio via `service_id → category`, with a new index on `portfolio_items(service_id)`. |
| Booking | `CreateBookingDto.attributionSource` is CHECK-pinned to qr/direct/search. `buildBookingLink()` is the single link builder. | New nullable `bookings.beauty_guide_id` (FK, `ON DELETE SET NULL`); attribution untouched. Ownership checked in `createHold`. No financial code touched. |
| Price display | FIXED/FROM/RANGE/QUOTE formatting is inline in `pages/salons/[slug].vue:530-583` (+ provider-panel copies). | Extract a shared `utils/service-price.ts` in user-app; salon page reuses it (pure refactor, behaviour pinned by existing specs). |
| Flags | `FEATURE_FLAG_KEYS` + boot check + public flag endpoint; user-app composable **fails open** to all-true. | `feature_beauty_guide_enabled`, seeded **false**; user-app default for this flag **fails closed**. |
| Analytics | `AnalyticsService.track(string, …)`, fire-and-forget, no client event endpoint. | Server-side events only in V1 (see §9). |
| Frontend | No upload in user-app; `useApi` has no FormData branch (provider-panel has one to copy). No sheet/skeleton components. `--color-ai` token exists. Provider bookings are inline cards (no drawer). | Small FormData branch in user-app `useApi`; feature-local components only. |

Pre-existing bug noted, **not** in scope: `no_show_grace_minutes` has no write-side max
(`admin-config.dto.ts`), so an admin value > 1440 bricks boot. Must be mirrored correctly
when we add our own numeric keys; fixing the existing one needs separate approval.

---

## 2. Data model (one migration, additive only)

### `beauty_concepts` — controlled vocabulary (admin-managed)
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| key | varchar(60) UNIQUE | stable machine key, e.g. `balayage` — the only thing the AI may emit |
| domain | varchar(20) CHECK | `hair_color`, `hair_cut_style`, `nails`, `brows_lashes`, `makeup` |
| name_fa / name_en | varchar(80) | rendered as «بالیاژ (Balayage)» |
| category_id | int NULL FK → service_categories ON DELETE RESTRICT | deterministic link to real services; NULL = informational only |
| keywords | text[] | Persian/English synonyms; **ranking boost only**, never a filter |
| maintenance_fa | text NULL | curated, hedged maintenance copy (preferred over AI text) |
| is_active / sort_order | bool / int | |

One concept → one category in V1. A later many-to-many `beauty_concept_categories`
can be added and backfilled non-destructively if ever needed.

### `beauty_guides`
| column | notes |
|---|---|
| id uuid, user_id FK users ON DELETE CASCADE | private to the owner |
| status | `processing` → `ready` \| `unsuitable` \| `failed` (CHECK) |
| image_key, image_sha256 | private-store key of the processed image; hash for per-user dedupe |
| source_portfolio_item_id NULL | set when created via "Explain this look" |
| domain | detected primary domain |
| look_summary_fa, stylist_request_fa | AI text, validated, length-capped |
| duration_min_estimate, duration_max_estimate | informational only, never read by booking |
| attributes jsonb | small closed set (length, color family, finish, shape); user edits overwrite |
| discussion_points jsonb, maintenance_ai jsonb | short string arrays, capped |
| safety_note | `medical_concern` flag → show "consult a professional", no diagnosis |
| raw_analysis jsonb | the validated contract payload, for audit/reproducibility |
| provider, model, prompt_version, schema_version | versioning; never silently regenerated |
| failure_code | `timeout`, `provider_error`, `invalid_output`, `unsuitable` |
| analyzed_at, created_at, updated_at | |

### `beauty_guide_concepts`
`(guide_id, concept_id)` PK, `confidence` (`high|medium|low`), `source` (`ai|user`),
`removed` bool, `evidence_fa`, `sort_order`. User corrections flip `removed`, or insert
`source='user'` rows. The authoritative set = rows where `removed = false`; a re-render
never re-applies the AI's original set over user edits.

### `bookings.beauty_guide_id` — nullable FK → beauty_guides ON DELETE SET NULL
Existing bookings stay valid. No financial column touched.

Indexes: `beauty_guides(user_id, created_at)`, `beauty_guides(user_id, image_sha256)`,
`portfolio_items(service_id)`.

---

## 3. AI architecture

```
BeautyAnalysisProvider (token BEAUTY_ANALYSIS_PROVIDER)
  analyze(input: { imageJpeg: Buffer; conceptKeys: ConceptVocabularyEntry[] }): Promise<unknown>
    ├─ MockBeautyAnalysisProvider        (tests/dev: deterministic fixtures)
    ├─ OpenAiCompatibleVisionProvider    (env: BEAUTY_AI_BASE_URL, _API_KEY, _MODEL)
    └─ UnconfiguredBeautyAnalysisProvider (throws → guide fails cleanly)
selector: BEAUTY_ANALYSIS_PROVIDER=mock|openai-compatible|unconfigured (default unconfigured;
.env.test = mock). getOrThrow for credentials in openai-compatible mode.
```

- Provider returns `unknown`; **`parseBeautyAnalysis()`** (pure, unit-tested) validates the
  strict contract: domain enum, `suitable` boolean, concepts `[{key, confidence 0–1,
  evidence}]` with keys **filtered to the active vocabulary** (unknown keys dropped),
  attributes from closed enums, duration integers in a sane range (15–720), strings
  length-capped, arrays capped. Any violation → `failed/invalid_output`; never partially
  trusted.
- Prompt: system instructions + closed vocabulary + JSON schema; the image is passed as
  data (base64), and the prompt states that any text inside the image is content to
  ignore, never instructions. No tools/function calling. Output can only ever populate
  the guide's own advisory fields — no write path exists from AI output to services,
  prices, bookings or money.
- Confidence buckets: ≥0.75 high («به احتمال زیاد»), 0.45–0.75 medium («احتمالاً»),
  <0.45 low («شاید»). Raw numbers are never sent to the client. Low-confidence concepts
  are shown as suggestions and excluded from matching unless the user confirms them.
- Timeout 45 s (`AbortSignal.timeout`), **no automatic retry** (cost); the user can retry
  manually (counts against the limit only if the provider was actually called).
- The image is EXIF-stripped and ≤1024 px before leaving the process. Image bytes and
  prompts are never logged.

---

## 4. API (customer routes private by default; no `@Public()`)

| Method & path | Purpose |
|---|---|
| `POST /beauty-guides` (multipart `file`) | validate → process → private store → create `processing` guide → analyze synchronously → return the guide (any terminal status) |
| `POST /beauty-guides/from-portfolio/:portfolioItemId` | "Explain this look": copies a **published** portfolio image of an approved salon into the private store, same pipeline |
| `POST /beauty-guides/:id/retry` | re-run a `failed` guide (limit-checked) |
| `GET /beauty-guides` / `GET /beauty-guides/:id` | owner's list / detail (404 for non-owner — no existence leak) |
| `GET /beauty-guides/:id/image` | owner-only stream, `Cache-Control: private, no-store`, nosniff |
| `PATCH /beauty-guides/:id` | corrections: concept add/remove, attribute edits |
| `DELETE /beauty-guides/:id` | hard delete row + private image; attached bookings keep `beauty_guide_id = NULL` |
| `GET /beauty-guides/:id/matches?lat&lng&radiusKm` | services per salon + salon cards (SearchResult shape) + portfolio |
| `GET /salons/mine/bookings/:bookingId/beauty-guide` (+ `/image`) | provider read, `SalonOwnerGuard`, only when that booking belongs to this salon and carries the guide |
| `admin/beauty-concepts` CRUD | taxonomy + category mapping (audited via `@AuditAction`) |

Feature flag off → every customer route returns 404-equivalent `NotFoundException`
(entry points also hidden); provider read of guides already attached keeps working
(read-only history). `route-guard-audit.spec.ts` updated.

`createHold`: optional `beautyGuideId`; must belong to the booking user or → 400.
Stored on the row; added to `booking_started` analytics properties. Nothing else in the
booking/payment path changes.

---

## 5. Matching (deterministic, explainable)

Effective concepts = non-removed, (high/medium or user-confirmed) → mapped category set.

**Services/salons:** active `salon_services` with `category_id ∈ set`, salon `approved`,
`gender_target` = session user's gender (server-side), within radius of the given
location. Rank salons by: (1) number of distinct matched concepts covered, (2) a matched
service whose name/description contains a concept keyword, (3) has published portfolio on a
matched service, (4) rating (only when reviews flag on), (5) distance. No featured boost in
V1 (keeps results explainable). Each salon carries its matched services with real
pricing; `fixed` → `buildBookingLink(slug, serviceId, { beautyGuideId })`, others →
existing "باید با سالن هماهنگ کنید" copy. Capped (e.g. 20 salons).

**Portfolio:** published items of approved, gender-matched salons whose `service_id` is an
active service in the category set, keyword-in-caption boost, capped (e.g. 24), each item
carrying its salon slug. Respects `feature_portfolio_enabled`.

**Price text:** shared formatter preserves FIXED / FROM («از …») / RANGE («… تا …») /
QUOTE («قیمت توافقی», the existing copy). **No totals.** Multi-service guides show the note
«هزینه نهایی بسته به خدمات انتخابی و مشاوره سالن متفاوت است.»

**Duration:** AI estimate shown as «حدود ۳ تا ۵ ساعت (تخمینی)». Booking uses
`service.durationMin` exactly as today.

Packages: shown nowhere in guide matching in V1 (constituent services only).

---

## 6. Privacy & retention

- Private store dir (`PRIVATE_UPLOADS_DIR`, default `./private-uploads`; prod: new volume
  `api_private_uploads`), keys `beauty-guides/<userId>/<uuid>.jpg`. Not served statically,
  not reconciled by `StorageReconciliationJob`, **excluded from backups** (deleting must
  really delete).
- Visibility: owner; a salon owner **only** through a booking at their salon that carries
  the guide (the booking page tells the customer «سالن این راهنما را خواهد دید»). Admins:
  no image access in V1.
- Retention: `BeautyGuideRetentionJob` (daily, `CronJobRunner`) deletes guides older than
  `beauty_guide_retention_days` (default 90) unless attached to a booking that is still
  upcoming; guides stuck in `processing` > 5 min → `failed/timeout`.
- Not public, not indexable: `/beauty-guide` added to `robots.ts` disallow; private
  route by default in `route-guard.ts`.

---

## 7. Cost control

| Control | Value (admin-editable `platform_config`) |
|---|---|
| Per-user analyses per Tehran day | `beauty_guide_daily_limit_per_user` = 3 |
| Global analyses per Tehran day (cost breaker) | `beauty_guide_daily_limit_global` = 300 |
| Retention | `beauty_guide_retention_days` = 90 |
| Upload size | 5 MB raw (existing convention); AI sees ≤1024 px JPEG |
| Dedupe | same user + same image hash + same prompt/schema version → reuse the stored analysis, no AI call, no quota use. **No cross-user sharing.** |
| Auth | required on every customer route |

Counting = durable rows (attempts where the provider was actually called), check →
call → record, like the SMS quota. Write-side DTO bounds mirror service bounds exactly.

---

## 8. User-app UX

Routes: `/beauty-guide` (create: upload / camera), `/beauty-guide/[id]` (guide),
`/account/beauty-guides` (history, linked from `profile.vue`). Entry: CTA card on home
(below "مرور همه سالن‌ها") and a «توضیح این استایل» button in the portfolio lightbox — both
only when the flag is on.

Guide page sections (visual cards, RTL, mobile-first, `--color-ai` accent for AI-derived
items): image → «چه چیزی تشخیص دادیم» concept chips with confidence wording + remove /
"not this" → attribute chips (editable) → «به آرایشگر بگویید» copyable request →
services at Gheychi (real prices) → «زمان تقریبی» (labelled estimate) → maintenance
(curated concept text first, AI text secondary, hedged) → «با آرایشگر درباره این‌ها
صحبت کنید» → matching salons (`SalonCard`) → similar work (portfolio grid) → book.
States: uploading, analyzing (progress copy), ready, unsuitable (the specified helpful
message), failed (retry), limit reached, empty matches (suggest widening radius).

Provider panel: `BeautyGuideCard.vue` (expandable) inside booking cards when
`beautyGuideId` is set. Admin panel: `BeautyConceptsView.vue` (copy of `CategoriesView`
pattern), flag in `FeatureFlagsView`, three keys in `CONFIG_META`.

---

## 9. Analytics & observability

Server-side `track()` (no PII, ids only): `beauty_guide_analysis_started`,
`_analysis_completed`, `_analysis_failed` (with `failure_code`), `_created`, `_updated`,
`_deleted`, `_matches_viewed` (on the matches endpoint), `beauty_guide_booking_started`
(createHold with guide), `beauty_guide_booking_completed` (booking confirmed with guide).
Click-level events (`service_selected`, `salon_viewed`, `portfolio_viewed`) need a
client-event endpoint, which doesn't exist — deferred to V2 (or approve adding a small
authenticated `POST /analytics/events` with an allowlist).

Metrics: `beauty_guide_analyses_total{outcome}`, `beauty_guide_analysis_duration_seconds`,
`beauty_guide_limit_rejections_total{scope}`. Logs: provider, model, latency, outcome —
never image bytes or prompt content.

---

## 10. V1 taxonomy seed (~35 concepts, mapped by category **name** at migration time)

- رنگ مو: balayage, highlights, lowlights, babylights, root_melt, root_shadow,
  face_framing_highlights, ombre, color_correction, gloss_toner, full_color, platinum_blonde
- کوتاهی مو: layered_cut, bob, lob, pixie, curtain_bangs, blunt_cut, wolf_cut
- مراقبت و درمان مو / کراتین و صافی مو: keratin_smoothing, hair_treatment
- ناخن: almond_shape, coffin_shape, square_shape, oval_shape, french_tip, chrome,
  cat_eye, glazed, marble, matte, nail_art, gel_extension
- ابرو و مژه / اکستنشن و لمینت مژه: brow_lamination, lash_lift, lash_extension
- آرایش / آرایش عروس و مهمانی: soft_glam, natural_makeup, bridal_makeup

Unmatched category name → concept seeded with `category_id NULL` (informational, admin can
map later). Admin can add/edit/deactivate concepts.

---

## 11. Testing plan

- **API unit:** contract parser (valid, unknown keys dropped, invalid shapes, oversized
  strings, non-suitable, medical flag), confidence bucketing, price formatting parity,
  matching ranking, limit counting (per-user, global, dedupe doesn't count), correction
  authority, retention job, provider adapters (mocked `fetch`: success, HTTP error,
  timeout, non-JSON).
- **API e2e** (`test/beauty-guide.e2e-spec.ts`, mock provider via env): all 20 scenarios
  in the brief — create/validate (real PNG, 422 non-image, 400 spoofed mime), success,
  provider failure, invalid output, mapping to real services only, inactive/custom-category
  services excluded, salon matching w/ gender + approval, portfolio privacy, IDOR (other
  user 404, unrelated provider 404, booked provider 200), booking with guide id (ownership
  enforced; deposit/price/duration identical to a booking without it; slot generation
  unchanged), QUOTE never priced, rate limits, dedupe, deletion (image gone, booking FK
  nulled), flag off.
- **user-app:** unit (confidence copy, price formatter incl. salon-page parity, booking
  link), nuxt specs (create page states, guide page: corrections, matches, booking
  handoff, RTL), `booking-confirm.spec.ts` guide-id payload, Playwright
  `e2e/04-beauty-guide.spec.ts` (mock provider).
- **provider/admin:** component specs for `BeautyGuideCard`, `BeautyConceptsView`,
  `FeatureFlagsView`, `SidebarNav`.
- **Regression:** full API unit + e2e, all three frontend unit suites + typecheck, all
  Playwright suites (run **separately** from API e2e — shared Redis).

---

## 12. Deferred to V2

Visual/embedding similarity, client click analytics, provider feedback on guides, quote
workflow, multi-service booking, service variants, salon-tagged services
(`salon_service_concepts` — the real fix for below-category precision, e.g. balayage vs
root melt), public sharing, collections, maintenance reminders, S3-backed private store,
admin review of failed analyses, multi-provider failover.

---

## 13. Owner decisions (2026-10-07)

1. **AI vendor:** Google Gemini for local testing (owner reaches it over VPN), through the
   vendor-agnostic OpenAI-compatible adapter (`BEAUTY_AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`,
   `BEAUTY_AI_MODEL` = a current Gemini vision model). Making the production server reach
   an AI endpoint from Iran is a separate follow-up (gateway/aggregator/proxy) — expected
   to be a config change only. Production stays flag-off until then.
2. **`sharp` approved.**
3. **Privacy defaults approved** (private dir, 90-day retention, excluded from backups,
   salon access only via an attached booking).
4. **Limits approved:** 3/user/day, 300/day global.
5. Price-formatter extraction: proceeding as a behaviour-preserving refactor pinned by the
   existing salon-page specs.
