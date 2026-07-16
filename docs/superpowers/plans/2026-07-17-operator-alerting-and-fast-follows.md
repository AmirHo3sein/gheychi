# Plan-8 Fast-Follows + Alerting Hardening + Zarinpal Research — Execution Record

**Date:** 2026-07-17
**Status:** Complete

This record covers three fast-follow fixes, the resolution of two parallel alerting implementations, and the Zarinpal refund research that replaced an impossible verification prerequisite with an executable one.

## 1. Alerting: two parallel implementations, one survivor

Two sessions independently closed the "no alerting/paging on operator signals" gap within a day of each other:

- **2026-07-16 (survived, on `main`):** *money-critical alerting* (spec: `docs/superpowers/specs/2026-07-16-money-critical-alerting-design.md`, plan: `2026-07-16-plan-9-money-critical-alerting.md`) — `AlertsService.raise()` routes every money-critical condition to **in-app admin notifications** (the admin-panel bell, zero-config, persistent), with SMS for `critical` severity via `ALERT_ADMIN_PHONE`; Redis `SET NX EX` dedup, fail-open; 7 sites; e2e-tested.
- **2026-07-17 (dropped):** an SMS-only design (multi-phone `OPS_ALERT_PHONES`, throttle-release-on-failure, hourly cap, Redis-outage fallback, 3 sites). Architecturally the in-app + severity-tier design was judged better (persistent surface, more sites, no config needed for the primary channel), so it won as the base.

**Grafted from the dropped design onto the survivor** (its adversarial review had confirmed these as real delivery-mechanics gaps): (1) the dedup claim is released when nothing was delivered — a transient notification/SMS failure no longer mutes an alert for the full dedup window; the next 5-minute cron tick retries; (2) per-alert dedup TTL override, used to make stuck-refund escalations re-page daily rather than every 6 h; (3) `ALERT_ADMIN_PHONE` accepts a comma-separated list (fan-out, per-recipient failure isolation); (4) an hourly SMS circuit breaker (`ALERT_SMS_HOURLY_CAP`, default 30, atomic `MULTI INCR+EXPIRE`, breaker errors fail open) bounds SMS cost during mass incidents.

## 2. Fast-follows (all three closed)

- **Atomic slug on create** — `CreateBlogPostDto` gained optional `slug` (mirrors the category-DTO precedent); `createPost` uses `dto.slug ?? makeSlug(...)`; the editor sends the slug in the create `POST` only when manually edited (`slugDirty` + non-empty), the follow-up `PATCH` is deleted, and a 409 (create or edit) shows a persistent inline error (`data-testid="slug-error"`) with form state intact and no navigation.
- **Storage-delete logging** — the four `.catch(() => {})` sites (salon photo remove; blog cover set/clear/post-delete) now log key + owning entity + stack via the module's two-arg `logger.error` convention. Fire-and-forget semantics unchanged.
- **Blog meta-description fallback** — new `apps/user-app/app/utils/markdown-excerpt.ts` (`markdownToPlainText`, `resolveBlogDescription`): strips everything markdown-it's default preset consumes (both fence styles, indented code, inline/reference links, images, tables, setext underlines, HTML entities decoded), Persian-aware code-point truncation on word boundaries (~160 chars, `…`). `blog/[slug].vue` falls back `metaDescription ?? excerpt ?? body-derived`; empty body still emits no tag.

## 3. Zarinpal refund verification (research outcome)

The old "verify refund codes in Zarinpal's sandbox" prerequisite is **impossible** — no sandbox covers refunds. Research (official docs via Wayback + official SDKs) also found the implemented `refund.json` matches Zarinpal's **legacy, de-documented (~2023) REST contract**; the current official API is GraphQL `AddRefund` (different host, `session_id` not `authority`, required amount, code-less response), with one-refund-per-transaction semantics that undermine the gateway's idempotency assumption. No speculative rewrite was done (unverifiable from a geo-blocked network with no account). Deliverable: `docs/deployment/ZARINPAL-REFUND-VERIFICATION.md` — an executable production runbook (~8,000 toman) that settles endpoint liveness, `session_id` derivation, response shapes, and duplicate-refund behavior, plus the rework checklist. Gateway header/refund comments, README, and CLAUDE.md updated to match reality. Refunds fail safe meanwhile (`refund_pending` + escalation to a human).

## 4. Verification

The fast-follow and dropped-alerting diffs went through an adversarial review workflow (5 finder dimensions → 3-lens refutation panel per finding, 47 agents): 13 confirmed findings, all fixed with regression tests; the alerting-mechanics findings were re-applied to the surviving implementation as the grafts in §1. Full suites green at integration time: API unit + e2e, user-app (one pre-existing unrelated `@tailwindcss/vite` typecheck error, proven present on a clean tree), admin-panel.
