# Admin Panel (Vue 3 + Vite SPA)

**Date:** 2026-07-07
**Status:** Approved design (brainstorming complete)

## 1. Product Summary

Admin Panel: a Vue 3 + Vite SPA (identical minimal stack to Provider Panel — plain refs, no form library, same brand tokens, Persian/RTL only) covering all 5 areas from the original marketplace design (`2026-07-04-arayeshgah-marketplace-design.md` §7): salon approvals, review moderation, categories, users/salons search+suspend, and platform_config editing. Built as **vertical slices in priority order** — each slice ships backend + frontend together, so the most urgent gap (salon approval currently requires a manual SQL update) becomes usable early rather than only at the end of a large plan.

### Decisions locked during brainstorming

| Decision | Choice |
|---|---|
| Scope | Full 5-area suite (not split into separate plans) |
| Frontend stack | Same minimal Vue 3 + Vite as Provider Panel — no new dependencies |
| Task ordering | Vertical slices per area, most-impactful first: salon approvals → review moderation → categories → users/salons → config |
| Salon rejection | New `'rejected'` status added to the enum; rejected salons stay editable via Provider Panel, provider can resubmit (flips back to `pending`) |
| User suspend | Blocks login only (OTP verification fails with a clear message) — does not cascade to auto-suspend their salon |
| Category icon | Plain text field, no upload |
| Config editor | Generic numeric key/value list — no per-field curation, new keys show up automatically |
| First admin bootstrap | Stays a manual DB update, same as today — out of scope for this plan |
| Search scope | Salons: name/city/status/genderTarget. Users: phone/name/role/date-joined range |
| Isolation | Same rule as Provider Panel — no references to the unrelated DiGRC project, no runtime coupling to `user-app`/`provider-panel` |

## 2. Architecture

### Tech stack

Identical to Provider Panel — same reasoning applies (internal tool, no SSR/SEO need, established minimal-dependency pattern already proven in this monorepo):

| Concern | Choice |
|---|---|
| Framework | Vue 3.5 + Vite, `vue-router` 4, Pinia session store |
| Data fetching | New `useApi()`/`useToast()` composables, same contract as Provider Panel's (separate copies, per the isolation rule — no shared code) |
| Styling | Tailwind v4, same "Teal Trust" brand tokens |
| Forms | Plain refs, no form library |
| Testing | Vitest + Playwright, same conventions |

### Backend additions, grouped by vertical slice

**Slice 1 — Salon approvals** (biggest gap, built first)
- `SalonStatus` gains `'rejected'`; new `rejection_reason` column (migration).
- `AdminSalonsController.list()` generalized to accept `status`/`city`/`name`/`genderTarget` query filters (currently hardcoded to `approved` only) — this same enhanced list also serves Slice 4's salon search.
- New `PATCH /admin/salons/:id/status` — body `{ status: 'approved'|'rejected'|'suspended', reason?: string }` (reason required for reject/suspend). This single endpoint covers both "approve a pending salon" and "suspend an already-approved one," so Slice 4 doesn't need a separate salon-suspend endpoint.
- **Provider Panel gets a small addition**: a new `POST /salons/mine/resubmit` endpoint (flips `rejected` → `pending`, guarded to only allow from `rejected`), plus a new **Salon Settings** page in Provider Panel reusing the existing `SalonInfoStep.vue` component in a standalone "edit" context (bound to the existing `PATCH /salons/mine`) — reachable from Dashboard like Hours/Photos already are. `PendingApprovalView` gets a `rejected`-status branch showing the reason + a link to Settings + a resubmit button.

**Slice 2 — Review moderation** (backend ~90% done)
- Only new piece: `GET /admin/reviews` (filterable by salon/status/rating) — the existing `PATCH /admin/reviews/:id` already does the moderation action itself. Reports arrive out-of-band (support ticket, phone call — unchanged from the original design's accepted scope), so this list is how an admin *finds* the review a report was about, not an in-system flag queue.

**Slice 3 — Categories**
- `POST /admin/categories`, `PATCH /admin/categories/:id` (name/icon). **No delete** — `salon_services.category_id` has a FK to categories, so deleting one in use would need a restrict-or-cascade decision; simplest and safest for v1 is create+rename only.

**Slice 4 — Users & salons search/suspend**
- New `User.status` column (`'active'|'suspended'`, default `active`) + migration.
- OTP verification checks `status !== 'suspended'` and rejects with a clear message (small change to the existing auth flow).
- New `GET /admin/users` (phone/name/role/date-joined-range filters) + `PATCH /admin/users/:id/status`.
- Salon search reuses Slice 1's enhanced `AdminSalonsController.list()` — no new salon endpoint here.

**Slice 5 — Config**
- `PlatformConfigService.set(key, value)` (upsert).
- `GET /admin/config` (all rows) + `PATCH /admin/config` (bulk update, `{ updates: [{ key, value }] }`).

All new admin endpoints reuse the exact existing pattern: `@UseGuards(AuthGuard, RolesGuard)` + `@Roles('admin')`, no new guard machinery needed.

## 3. Screens & UX

- **Login:** phone → OTP (same flow/endpoints as Provider Panel — separate implementation, no shared code).
- **Navigation:** unlike Provider Panel (explicitly mobile-first per the original spec), the design doc doesn't call for mobile-first here — admins are more likely working from a desktop back-office context. A simple top nav / sidebar with the 5 area links replaces Provider Panel's bottom tab bar.

**Slice 1 — Salon approvals**
- Salon queue: list filterable by status (default: `pending`), city, name, gender target — each row shows name/city/gender/status/created date.
- Salon detail: full info (services, hours, photos if any) + Approve / Reject (reason required) / Suspend (reason required, for already-approved salons) actions.

**Slice 2 — Review moderation**
- Reviews list: filterable by salon/status/rating — each row shows rating, comment, salon's reply, current status, with a moderate action (flip published ↔ rejected).

**Slice 3 — Categories**
- Simple list + inline add (name + icon text) + inline rename. No delete (per the FK constraint above).

**Slice 4 — Users & salons**
- Users list: searchable/filterable (phone, name, role, date-joined range), suspend/unsuspend action per row.
- Salons list: the same list view built in Slice 1, now with its full filter set exposed (not just the `pending` default) and the same approve/reject/suspend actions available inline.

**Slice 5 — Config**
- One table: key, editable numeric value, save.

**Provider Panel addition (from Slice 1):**
- New **Salon Settings** page (Dashboard → Settings, alongside Hours/Photos) reusing `SalonInfoStep.vue` in edit mode.
- `PendingApprovalView` gains a `rejected` branch: shows the rejection reason, a link to Settings, and a "resubmit for review" button.

## 4. Error Handling

- Same `useApi()`/toast pattern as Provider Panel (with a working `ToastContainer` mounted from the start, learned from that plan's final review).
- Reason-required actions (reject/suspend) validate client-side that the reason isn't empty before submitting.

## 5. Testing

- Component tests for the interactive/logic-bearing pieces: salon approve/reject/suspend actions (with reason validation), review moderation action, user suspend action. Plain list/search views and the config editor stay untested, matching Provider Panel's established testing philosophy.
- One e2e test tying together the loop this plan exists to close: admin logs in → approves a pending salon → the salon's status genuinely flips (verified via a follow-up API call, not just a UI assertion).

## 6. Out of Scope (this plan)

- The report/flag mechanism itself — reports still arrive out-of-band (support ticket, phone call), unchanged from the original design.
- Category delete.
- Auto-suspending a user's salon when the user is suspended.
- A first-admin bootstrap script (stays a manual DB update).
- Any audit log of admin actions (who approved/rejected/suspended what, when).
- Notifying an admin when a provider resubmits a rejected salon — no notification system exists yet.

## 7. Open Risks

- **No audit trail**: approve/reject/suspend actions overwrite the row's status with no history. Fine for v1; worth flagging if disputes/compliance ever need "who did this and when."
- **Config editor has no per-key bounds**: a typo (e.g. `commission_percent = 1000`) would silently corrupt booking math with no guard rail. Acceptable for a trusted-admin-only tool now.
- **Config editor save re-sends the entire loaded snapshot, not a diff**: `save()` sends every row currently in memory rather than just the changed ones, and the backend's `setMany()` unconditionally overwrites every key it's given. Two admins editing different config keys concurrently could have the second save silently clobber the first admin's unrelated edit back to its stale in-memory value — a last-writer-wins risk across unrelated fields. Not fixed for v1 (trusted-admin-only tool, edits presumably rare); worth revisiting if the config editor sees concurrent use.
- **Rejection reason is free text, not structured**: the system doesn't distinguish "bad salon info" from "bad photo" from "missing hours" — it's on the admin to write a clear reason, and on the provider to know which existing Provider Panel view (Settings/Photos/Hours) to go fix.
