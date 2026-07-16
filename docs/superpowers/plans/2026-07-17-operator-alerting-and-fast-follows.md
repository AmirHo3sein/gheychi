# Operator Alerting + Plan-8 Fast-Follows — Execution Record

**Date:** 2026-07-17
**Spec:** `docs/superpowers/specs/2026-07-17-operator-alerting-design.md` (alerting; the three fast-follows were small documented bug fixes, no spec needed)
**Status:** Complete

This record covers one plan-sized feature and three fast-follow fixes executed together, plus the Zarinpal refund research that replaced an impossible verification prerequisite with an executable one.

## 1. Operator alerting (`apps/api/src/alerts/`)

Implemented per the spec, chosen by a three-design judge panel (SMS via the existing `SmsProvider` beat Telegram-based designs on delivery reliability in Iran, zero new integrations, and convention fit).

- `AlertsService.notifyOps(dedupeKey, message, opts?)` — never throws/rejects; recipients from `OPS_ALERT_PHONES`; `SET ops-alert:<key> EX <ttl> NX` throttle (default `OPS_ALERT_THROTTLE_HOURS=6`, per-call override); in-process `Map` fallback when Redis errors; hourly circuit breaker (`OPS_ALERT_HOURLY_CAP=30`, atomic `MULTI INCR+EXPIRE`); throttle claim released whenever nothing was delivered (all sends failed *or* cap-suppressed) so the next cron tick retries; boot warnings for console-mode-with-phones, zero-parseable-phones, and invalid numeric config (which falls back to defaults); `[Arayeshgah]` + condition-tag message prefix; IDs-only content rule.
- Wired at exactly three sites: `refund-retry.job.ts` 24 h escalation (`refund-stuck:<id>`, daily re-page), `payments.service.ts` `attemptRefund` no-authority branch (`refund-no-authority:<id>`, `void` fire-and-forget — runs inline in customer-facing `cancel()`), `payment-reconciliation.job.ts` per-payment catch gated on `createdAt` > 24 h (`payment-stuck:<id>`). The CAS-guarded one-shot anomalies are deliberately not wired (self-healing; escalation catches them if the queued refund sticks).
- Config in `.env.example` (all optional, unset = log-only); enablement paragraph in `DEPLOY.md`; `.env.test` untouched; no migrations, no routes.

## 2. Fast-follows (all three closed)

- **Atomic slug on create** — `CreateBlogPostDto` gained optional `slug` (mirrors the category-DTO precedent); `createPost` uses `dto.slug ?? makeSlug(...)`; the editor sends the slug in the create `POST` only when manually edited (`slugDirty` + non-empty), the follow-up `PATCH` is deleted, and a 409 (create or edit) shows a persistent inline error (`data-testid="slug-error"`) with form state intact and no navigation.
- **Storage-delete logging** — the four `.catch(() => {})` sites (salon photo remove; blog cover set/clear/post-delete) now log key + owning entity + stack via the module's two-arg `logger.error` convention. Fire-and-forget semantics unchanged.
- **Blog meta-description fallback** — new `apps/user-app/app/utils/markdown-excerpt.ts` (`markdownToPlainText`, `resolveBlogDescription`): strips everything markdown-it's default preset consumes (both fence styles, indented code, inline/reference links, images, tables, setext underlines, HTML entities decoded), Persian-aware code-point truncation on word boundaries (~160 chars, `…`). `blog/[slug].vue` falls back `metaDescription ?? excerpt ?? body-derived`; empty body still emits no tag.

## 3. Zarinpal refund verification (research outcome)

The old "verify refund codes in Zarinpal's sandbox" prerequisite is **impossible** — no sandbox covers refunds. Research (official docs via Wayback + official SDKs) also found the implemented `refund.json` matches Zarinpal's **legacy, de-documented (~2023) REST contract**; the current official API is GraphQL `AddRefund` (different host, `session_id` not `authority`, required amount, code-less response), with one-refund-per-transaction semantics that undermine the gateway's idempotency assumption. No speculative rewrite was done (unverifiable from a geo-blocked network with no account). Deliverable: `docs/deployment/ZARINPAL-REFUND-VERIFICATION.md` — an executable production runbook (~8,000 toman) that settles endpoint liveness, `session_id` derivation, response shapes, and duplicate-refund behavior, plus the rework checklist. Gateway header/refund comments, README, and CLAUDE.md updated to match reality. Refunds fail safe meanwhile (`refund_pending` + SMS escalation + manual panel refund).

## 4. Verification

Adversarial review workflow over the full diff (5 finder dimensions → 3-lens refutation panel per finding, 47 agents): 13 confirmed findings (2 major, both in the new alerts service: unvalidated numeric config; cap-suppression muting alerts for their TTL), all fixed with regression tests; 1 finding refuted. Final suites: API 300/300 (Jest), user-app 85/85 (Vitest) + typecheck (one pre-existing unrelated `@tailwindcss/vite` type error, proven present on a clean tree), admin-panel 102/102 (Vitest).
