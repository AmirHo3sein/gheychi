# Phase Q — Production Readiness Audit (Capstone)

**Status: synthesis + explicit sign-off placeholders, not a launch authorization.** This is the final phase of a staff-engineer production-readiness initiative spanning Phases A–Q. Phases A–N were hands-on: audit → independently verify → implement with tests → full-suite-verify, each phase's fixes confirmed via the real test suites (not just code review) before moving to the next. Phases O and P were strategy documents with explicit business-decision placeholders, per an earlier explicit choice in this initiative to draft rather than implement for those two. This phase closes the loop: it synthesizes what changed, corrects documentation that had gone stale (including from fixes made *during* this very initiative), and lists what only a human with business/legal authority can actually sign off on before a real launch.

## 1. What this initiative actually did (Phases A–N)

Each phase followed the same discipline: background-audit via subagents, independent verification of every finding before accepting it as real, implementation with test coverage, full regression run (unit + e2e, sometimes real browser automation) before moving on. All work is in the actual codebase, not just this document — this section is a pointer, not a duplicate.

| Phase | Focus | Representative fixes |
|---|---|---|
| A | Background job reliability | `CronJobRunner` (distributed lock + failure paging + slow-job warning) adopted by all 9 cron jobs |
| B | Security | Stored-XSS closed via `assertTrustedImageMimeType()`, OTP per-IP rate limiting, `X-Content-Type-Options: nosniff` |
| C | Scalability | Cursor-paginated search, Redis caching for platform config/categories/cities, N+1 fixes |
| D | Code quality | `getEarnings()` ledger-correctness fix (was live-recomputing against a frozen invariant), naming-convention renames |
| E | Architecture | Audited module boundaries/circular deps — found the codebase unusually disciplined; documented one deliberate `forwardRef()` cycle, formalized the "simple CRUD may skip the service layer" convention |
| F | Observability | Real DB/Redis health check (was an unconditional 200), request-ID correlation middleware, alerting gap closed for per-salon invoice-generation failures |
| G | Performance | Batched/capped a previously-unbounded storage-reconciliation loop, added missing indexes, parallelized a hot-path query pair |
| H | API consistency | Fixed 201-vs-200 status codes on pure state-mutation actions, PATCH→POST convention fix, DTO naming |
| I | Frontend consistency | Fixed real design-token bugs (undefined CSS variable, stale pre-WCAG-fix hex values, dark-mode-broken chevron), added missing error states to 9 list views |
| J | Testing (API/unit) | Added guard unit specs, a regression test pinning the Redis-flush fix that had already caused two separate cross-file test-pollution incidents this session |
| K | Documentation | Corrected `CLAUDE.md`'s stale background-jobs convention and other drift |
| L | DevOps | Resource ceilings on every `docker-compose.prod.yml` service, pre-migration-backup step documented, `.env` permissions note |
| M | E2E testing | Found and fixed a genuine Playwright `globalSetup`/`webServer` race (empirically confirmed, not from docs) across all three frontend apps' e2e suites, plus 4 real pre-existing test bugs uncovered while getting them to actually pass |
| N | CI/CD | Playwright browser caching, `dependabot.yml`; confirmed the documented rollback procedure is actually backed by real SHA-tagged images |

**Every phase's changes are covered by the existing test suites** (835 API unit tests, 516 API e2e tests, 330/219/275 frontend unit tests across the three apps, 5 Playwright e2e specs across 3 apps) — all green as of this phase.

## 2. Documentation debt found and corrected during this phase

Auditing "is our own known-gaps documentation accurate" turned up real staleness — some from fixes made in an earlier session (before this 17-phase initiative even began) that were never reflected in `docs/technical-overview/`, and at least one from a fix made *during* this initiative (Phase M's `global-setup.ts` → `prepare-db.cjs` rename, referenced by its old name in `24-technical-debt.md` until this phase). Corrected in `docs/technical-overview/23-known-limitations.md`, `24-technical-debt.md`, and `25-future-improvements.md`:

- Per-admin notification read state — **was already built**, no longer a limitation or a future-improvement seam.
- Referral `'expired'` status sweep — **was already built** (`referral-expiry.job.ts`, hourly cron), no longer unreachable.
- Cities as a real DB table with an FK — **was already built**; `salons.city_id` exists, though the free-text `salons.city` column itself still has no enforced validation (corrected to the nuanced truth, not just deleted).
- Search pagination — **was already built** (cursor-based, `{items, nextCursor, hasMore}`, 1000-row safety ceiling) — the doc still described a flat unpaginated 50-result cap.
- `provider-panel`/`admin-panel` `DESIGN.md` staleness, and `user-app`'s `BaseSelect.vue` chevron bug — **both already fixed** (the first at the very start of this session's work, the second during this initiative's own Phase I).
- Horizontal-scaling cron-lock extension path — **was already built** (`CronLockService`/`CronJobRunner`, confirmed adopted by all 9 jobs), not a future seam anymore.

**This is not exhaustive.** Only `23-known-limitations.md`, `24-technical-debt.md`, and `25-future-improvements.md` were audited against current code — the broader `docs/technical-overview/` tree (`00-index.md` through `22-performance.md` and others) was not re-verified line-by-line in this pass and may contain similar drift. Worth a dedicated pass if these docs are treated as authoritative by the team.

## 3. What remains — genuinely open, not resolved by this initiative

Pulled directly from the now-corrected `docs/technical-overview/23-known-limitations.md` (deliberate cuts) and `24-technical-debt.md` (unintentional gaps) — this section doesn't repeat their full content, just flags the ones with the highest launch-relevance:

- **Payments run through `MockPaymentGateway` by default**, and the real refund contract is explicitly documented as "production-unverified" with no sandbox to test against — `docs/deployment/ZARINPAL-REFUND-VERIFICATION.md` must be executed against production before real refunds can be trusted. **This is very likely the single highest-risk open item for an actual launch handling real money.**
- Daily-only backups (24h RPO, no point-in-time recovery), no automated alerting on backup failure.
- No i18n (Persian/RTL only) — confirmed as deliberate product decision, not an oversight, but worth restating here since "can we serve other markets" is exactly the kind of question a readiness audit should surface even when the answer is "not yet, on purpose."
- `PlatformConfigService`'s numeric config getter throws an unguarded raw `Error` (not a NestJS exception) if a config key is ever missing — would 500 every request path touching deposit/commission/cancellation-window/hold-TTL/reminder-lead/review-edit-window config, with no schema validation catching a bad state before it's hit live.
- Admin salon-approval mutations bypass the service layer (raw repository calls in the controller) — inconsistent with the rest of the domain, harder to unit-test, not itself a known bug but a structural inconsistency worth closing before it causes one.

## 4. PLACEHOLDER — sign-offs only a human with real authority can give

This initiative was an engineering production-readiness pass. It cannot and did not make business, legal, or go/no-go decisions. None of the following were decided by any phase of this work:

- **[ PLACEHOLDER: real payment-gateway cutover approval ]** — someone with actual authority over the business's money needs to explicitly approve executing `ZARINPAL-REFUND-VERIFICATION.md` against production and flipping `PAYMENT_GATEWAY=zarinpal` for real. This is the one item on this whole list where "an engineer decided it was fine" would be the wrong process.
- **[ PLACEHOLDER: legal review ]** — terms of service, refund/cancellation policy (does the documented business logic in `booking.entity.ts`'s cancellation-window rules actually match what legal has approved customers be told?), privacy policy (see Phase O's product-analytics placeholder doc — there currently is no privacy policy or consent mechanism anywhere in the app), and any Iran-specific regulatory requirements this initiative did not and could not research.
- **[ PLACEHOLDER: who is on call ]** — `AlertsService` pages via SMS to `ALERT_ADMIN_PHONE` on money-critical failures. Is that number staffed, monitored, and does the person receiving it know what to do? This is an org-design question, not a code question.
- **[ PLACEHOLDER: insurance/liability ]** — a marketplace handling real payments and real in-person service bookings (haircuts, salon visits) likely has liability/insurance considerations entirely outside this initiative's scope.
- **[ PLACEHOLDER: actual launch go/no-go ]** — the honest engineering answer after this initiative is "the application layer is in materially better shape than it was, with real bugs found and fixed across reliability/security/scalability/quality/performance/consistency/testing/ops, but the payment-gateway verification in §3 is unresolved and payment is this app's core function." Whether that's an acceptable state to launch into, with what mitigations, is a business call.

## 5. Suggested next step

If the business wants to proceed toward launch, the highest-leverage next action is executing `docs/deployment/ZARINPAL-REFUND-VERIFICATION.md` (§3's top item) — everything else this audit surfaced is either already fixed, a deliberate and reasonable cut for this stage, or a lower-severity technical-debt item that doesn't block a launch. If the business wants to keep hardening before launch, `PlatformConfigService`'s unguarded config-getter (§3) and the admin-salon-mutation service-layer bypass (§3) are the two cheapest, lowest-risk engineering fixes left on the table.
