# Provider Panel (Vue 3 + Vite SPA)

**Date:** 2026-07-07
**Status:** Approved design (brainstorming complete)

## 1. Product Summary

The salon-owner-facing app for Gheychi: onboarding, day-to-day booking management, service/price/hours CRUD, reviews, and earnings. Built as a Vue 3 + Vite SPA, mobile-friendly (owners will use phones), per the original marketplace design (`2026-07-04-gheychi-marketplace-design.md` §6).

Nearly all provider CRUD capability already exists in the API (`/salons/mine/*` for services, hours, exceptions, bookings status, review replies). This plan is primarily a **frontend build**, plus two bounded backend additions: salon photo upload (new endpoints + swappable storage abstraction) and provider-visible salon-status display (no new admin approve/reject workflow yet).

### Decisions locked during brainstorming

| Decision | Choice |
|---|---|
| Stack | Vue 3 + Vite SPA (matches original design doc; no SSR/SEO need for an authenticated-only tool) |
| Scaffold | Fresh minimal Vite scaffold — hand-picked deps, no cloning from any existing app |
| Photo storage | Generic S3-compatible object storage (not ArvanCloud-specific), via a new swappable `StorageProvider` abstraction matching the existing SMS/payment/push pattern |
| Approval workflow | Provider-side status display only (`pending`/`approved`/`suspended` + "awaiting approval" state). No new admin approve/reject endpoints in this plan — stays a manual DB step until Admin Panel is planned |
| Earnings | Computed from existing `bookings` + `payments` data (deposit amount, `commission_percent` from `platform_config`) — no new payment infra, Zarinpal integration already exists from Plan 2 |
| Real-time | Manual refresh / refetch-on-load — no shared runtime infra with `user-app` (no sockets) |
| Onboarding | Multi-step wizard: salon info → gender target → address/map pin → hours → first service → (optional) photos → submit as `pending` |
| Isolation | No references to or reuse of the unrelated DiGRC project's `tprm-panel`/`user-panel`/`admin-panel`, and no runtime coupling to Gheychi's own `user-app` |

## 2. Architecture

### Tech stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Vue 3.5 (Composition API, `<script setup>`) + Vite | Matches locked decision; no SSR needed |
| Routing | `vue-router` 4, manual route definitions | No file-based routing available outside Nuxt; small enough route count that this is simple |
| State | Pinia — single `session` store, same shape as user-app (`{ id, phone, name, gender, role }`) | Consistency with the one existing frontend, not because we're reusing its code |
| Data fetching | New `useApi()` composable, same contract as user-app's (`{ data, error }`, `silent`/`redirectOn401` options) but simpler — no SSR cookie-forwarding logic needed since this is a pure client-side SPA; `credentials: 'include'` on `fetch` is enough | Matches Gheychi's own established pattern; no TanStack Query — user-app doesn't use it either |
| Forms | Plain `ref()`s + manual validation + local error message, no form library | Matches user-app's actual pattern (no vee-validate/yup anywhere in this codebase) |
| Styling | Tailwind CSS v4 via `@tailwindcss/vite`, reusing the same "Teal Trust" CSS-custom-property tokens as user-app's light theme | Brand consistency; single theme only (no dark mode) — internal tool, not a stated requirement |
| Photos | New `multer`-based upload endpoints on the API + new `StorageProvider` abstraction (mirrors the existing `SmsProvider`/`PaymentGateway`/`PushProvider` pattern) | Fits the codebase's established swappable-provider convention exactly |
| Testing | Vitest (unit + component) + Playwright (e2e) | Matches user-app's setup exactly |

### App structure

```
apps/provider-panel/
├── vite.config.ts
├── index.html
├── src/
│   ├── main.ts
│   ├── App.vue
│   ├── router/index.ts            # routes + auth guard (redirect to /login if no session)
│   ├── pages/
│   │   ├── LoginView.vue           # phone + OTP (same flow as user-app)
│   │   ├── OnboardingView.vue      # multi-step wizard
│   │   ├── PendingApprovalView.vue # shown whenever salon.status !== 'approved'
│   │   ├── DashboardView.vue       # today's bookings, next appointments
│   │   ├── BookingsView.vue
│   │   ├── ServicesView.vue
│   │   ├── HoursView.vue
│   │   ├── PhotosView.vue
│   │   ├── ReviewsView.vue
│   │   └── EarningsView.vue
│   ├── components/
│   │   ├── onboarding/             # one component per wizard step
│   │   ├── bookings/
│   │   ├── services/
│   │   ├── photos/                 # PhotoUploader, PhotoGrid (drag-to-reorder, set cover)
│   │   └── layout/                 # AppHeader, bottom nav (mobile-first)
│   ├── composables/
│   │   ├── useApi.ts
│   │   ├── useToast.ts
│   │   └── useSalon.ts             # fetch/refetch the caller's own salon; drives status gating
│   ├── stores/session.ts
│   └── assets/css/{main.css,tokens.css}
├── test/unit/  test/component/
├── e2e/
└── .env.example
```

### Backend additions (in `apps/api`)

- **New `StorageProvider` abstraction** (`storage/storage.provider.ts`), following the exact SMS/payment/push pattern: interface `{ upload(file, key): Promise<string>; delete(key): Promise<void> }`, token `STORAGE_PROVIDER`, implementations `LocalDiskStorageProvider` (dev/test default) and `S3StorageProvider` (generic S3-compatible, `@aws-sdk/client-s3`), selected via `STORAGE_PROVIDER=local|s3`. New env vars: `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`.
- **New `salons/mine/photos` endpoints** (`AuthGuard` + `SalonOwnerGuard`, same as every other `mine` route): `POST` (multipart upload via `multer`, memory storage, 5MB limit, jpeg/png/webp only) → stores via `StorageProvider`, inserts a `SalonPhoto` row; `DELETE /:id`; `PATCH /:id` (`isCover`/`sortOrder` updates). The existing `SalonPhoto` entity and public `GET /salons/:slug/photos` endpoint already exist — this only adds the provider-facing write side.
- **No new approval-workflow endpoints.** `GET /salons/mine` already returns `status`, which is all `PendingApprovalView` needs.
- **Earnings**: a new read-oriented `GET /salons/mine/earnings` that aggregates `Payment`/`Booking` rows for the salon — sums of `paid` deposits, commission (`platform_config.commission_percent`) deducted, forfeited no-show/late-cancel deposits paid out. New query logic, not new payment infrastructure.

## 3. Screens & UX

- **Login:** phone → OTP (same flow/endpoints as user-app, separate implementation — no shared code between apps).
- **Onboarding wizard** (first-time providers only, i.e. a `customer` about to become a `provider`): salon name/description → gender target (women/men) → address + map pin (Leaflet+Neshan picker, own implementation, not shared with user-app) → weekly hours + capacity → first service (name/price/duration) → optional photos → submit (`POST /salons`, lands as `pending`). Ends on **Pending Approval** screen.
- **Pending Approval:** friendly "your salon is under review" state, shown whenever `salon.status !== 'approved'` (covers both fresh onboarding and a `suspended` salon) — manual refresh button, no polling.
- **Dashboard** (only reachable once `approved`): today's bookings, next few upcoming appointments.
- **Bookings:** upcoming/past list; mark `completed`/`no_show`; cancel with a penalty warning (per original spec).
- **Services & prices:** CRUD list with active/inactive toggle (maps to existing soft-delete via `isActive`).
- **Hours & days off:** weekly template editor (7-day open/close times) + exception-date list (add/remove one-off closures).
- **Photos:** grid — upload, delete, set cover, reorder.
- **Reviews:** read-only list (public `GET /salons/:salonId/reviews`, salon already knows its own id) + one editable reply per review.
- **Earnings:** summary view — deposits collected, commission deducted, forfeited-deposit payouts, simple date-range filter. Kept intentionally simple for v1.
- **Navigation:** mobile-first bottom nav (Dashboard / Bookings / Services / Reviews / Earnings), with Hours and Photos reachable from a salon-settings entry point rather than the primary tab bar — keeps the tab bar to 5 items on a phone screen.

## 4. Error Handling

- Same policy as user-app's `useApi()`: global 401 → redirect to `/login`; toast-by-default; `silent` mode for local handling (e.g. OTP retry, photo-upload validation errors shown inline).
- Map pin picker falls back to manual address-only entry (no pin) if Neshan fails to load — never blocks onboarding.
- Photo upload validates file type/size client-side before sending; server-side `multer` limits are the enforced backstop.

## 5. Testing

- Unit (Vitest): composables (`useApi`, `useSalon`), utils (deposit/earnings math helpers if any duplicated client-side for display).
- Component (Vitest): onboarding step components, photo uploader, booking status actions.
- E2E (Playwright): onboarding happy path (signup → wizard → pending-approval screen), and bookings list → mark-completed action.

## 6. Out of Scope (this plan)

- Salon approve/reject workflow (endpoints + admin UI) — future Admin Panel plan.
- Multi-salon-per-owner support — current schema is one salon per owner.
- Real-time updates / shared socket infrastructure with user-app.
- Dark mode, i18n (Persian/RTL only, matching user-app).
- Native app wrapper (Capacitor) — unchanged from original spec.
- Self-serve "featured" placement management — stays admin-only.

## 7. Open Risks

- **Storage vendor unpicked**: `StorageProvider` is env-driven/swappable, but no actual S3-compatible account is provisioned yet — needs to happen before photo upload can be tested against a real bucket (local disk works for dev in the meantime).
- **Map pin-drop is new territory**: user-app only ever *displays* a Neshan map; onboarding needs forward/reverse geocoding or drag-to-pin, which hasn't been exercised anywhere in this codebase yet — verify Neshan's API supports it before committing to the UX.
- **Commission-rate drift**: `platform_config.commission_percent` is a single current-value global, not versioned per-booking. If it changes over time, recomputing "earnings" for old bookings after a rate change could disagree with what was actually charged at the time — worth a decision (snapshot the rate on the booking, or accept the drift) before implementing earnings math.
- **No wizard draft-save**: onboarding is all-or-nothing in v1 — a provider abandoning mid-wizard starts over. Acceptable for a first version, called out for later.
