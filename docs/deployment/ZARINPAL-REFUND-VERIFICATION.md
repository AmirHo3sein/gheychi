# Zarinpal Refund Verification Runbook

**Date:** 2026-07-17
**Status:** Blocking pre-production step — refunds must not go live until this runbook has been executed.
**Supersedes:** every "verify the refund success codes against Zarinpal's sandbox" note in this repo (gateway header comment, refunds design doc, CLAUDE.md/README). **Sandbox verification is impossible** — see "Why there is no sandbox path" below.

## What the research found (2026-07-17)

Verified against Zarinpal's official docs (partly via Wayback snapshots — zarinpal.com hosts reset TLS connections from non-Iranian networks) and the official `ZarinPal/ZarinPal-node-SDK` / `zarinpal-php-sdk`:

1. **Our gateway implements a legacy contract.** `ZarinpalGateway.refundPayment()` POSTs `{merchant_id, authority}` to `payment.zarinpal.com/pg/v4/payment/refund.json` with a Bearer token. That exact contract (including the `ref_id`/`session`/`iban` response fields) matches the old `docs.zarinpal.com/paymentGateway/other/` page — which was **removed from Zarinpal's documentation around 2023**. The legacy doc also used host `api.zarinpal.com`, not `payment.zarinpal.com`. Whether the REST endpoint still answers in production is **unknown**.
2. **The current official refund API is GraphQL.** `POST https://next.zarinpal.com/api/v4/graphql/`, Bearer auth, mutation `AddRefund(session_id, amount, description, method, reason)`:
   - `session_id` = the transaction number ("شماره تراکنش" in the panel) — **not** the authority. No documented API maps authority → session_id (candidates to test: the authority's trailing digits after stripping `A`+zeros; the verify `ref_id`; the GraphQL `Session(terminal_id, filter: VERIFIED)` listing).
   - `amount` is **required**, in IRR (rial), minimum 20,000 IRR; partial refunds supported. Our `PaymentGateway.refundPayment(authority)` interface carries no amount — an interface change is needed if we migrate (`payment.amount` is toman; ×10 like verify).
   - `method`: `PAYA` (next ACH cycle) or `CARD` (instant); `reason`: `CUSTOMER_REQUEST | DUPLICATE_TRANSACTION | SUSPICIOUS_TRANSACTION | OTHER`.
   - Response has **no numeric `code`** — success is the `resource` object (`timeline.refund_status: "PENDING"`, etc.); failures are GraphQL `errors`. Our `data.code === 100 || 101` parser would misread a successful GraphQL response as a refusal.
3. **The idempotency assumption is unsupported.** The gateway treats code `101` as "already refunded → success". Official docs define 101 only for *verify*. The refund FAQ states **one refund request per transaction** — a repeat attempt after a crash is likely an *error*, not an idempotent success. (Additional legacy-doc wrinkle: its example returns `"code": "100"` as a JSON **string**, which our strict `=== 100` would misclassify.)
4. **Operational constraints** (official refund landing page):
   - The refund service must be **activated via a support ticket** before first use.
   - Refunds are **funded from the merchant panel/wallet balance** — top it up first or requests fail (this is the expected cause of repeated `Zarinpal refused the refund` log lines / `refund-stuck` alerts).
   - Fee charged to the merchant: 1,500 toman + 250 toman per additional 1M toman refunded.
   - Window: one refund request per transaction, up to **2 months** after payment.
5. **Why there is no sandbox path:** the official sandbox swaps exactly three URLs (`request.json`, `verify.json`, `StartPay`). No refund endpoint, REST or GraphQL, exists in sandbox; the official Node SDK hard-codes GraphQL to production even with `sandbox: true`. Refund verification therefore requires a **real, verified production transaction**.

## Verification procedure (~8,000 toman total cost)

Prerequisites: approved terminal (merchant_id); refund service activated (support ticket); personal access token from the panel (نشست‌های فعال → نشست‌های شخصی → ایجاد مجوز دسترسی); wallet balance ≥ 20,000 IRR + fees; **an Iran-reachable network** (all zarinpal.com hosts are geo-blocked otherwise — run this from the production VPS).

1. **Make test payment A**: 20,000 IRR (2,000 toman — the refund minimum) through the normal `request.json` → `StartPay` → `verify.json` flow with a real card. Record `authority` and the verify `ref_id`.
2. **Probe the legacy REST path first** (settles whether our current code works at all), on payment A:
   ```bash
   curl -sS -X POST https://payment.zarinpal.com/pg/v4/payment/refund.json \
     -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
     -d '{"merchant_id":"'$MERCHANT_ID'","authority":"'$AUTHORITY_A'"}'
   # repeat once against https://api.zarinpal.com/pg/v4/payment/refund.json
   ```
   Record: HTTP status, full body, whether `code` is string or number. **If this succeeds**, the existing gateway may only need host/`code`-type/idempotency fixes. **If it 404s or returns HTML**, the REST path is dead and the gateway must migrate to GraphQL.
3. **Make test payment B** (same as step 1) for the GraphQL path.
4. **Resolve `session_id` three ways** and record which agree: (a) panel → Transactions → شماره تراکنش; (b) GraphQL `Session(terminal_id: ..., filter: VERIFIED) { id, amount, created_at }`; (c) compare against payment B's authority tail and verify `ref_id`.
5. **Run `AddRefund`** on payment B (GraphiQL playground is linked from the refund docs page, or curl):
   ```graphql
   mutation { resource: AddRefund(session_id: "...", amount: 20000,
     method: PAYA, reason: CUSTOMER_REQUEST)
     { terminal_id, id, amount, timeline { refund_amount, refund_time, refund_status } } }
   ```
   Record the exact success response shape.
6. **Immediately re-run the same `AddRefund`** — record the exact error shape. This is what `RefundRetryJob` will actually see after a crash-retry, and settles the idempotency question.
7. **Poll** `GetRefund(id)` (or the panel) until `refund_status` reaches its terminal value; record the enum values observed.
8. **Bring the findings back to the repo**: update `zarinpal-payment.gateway.ts` (endpoint/contract/success detection/idempotency handling per what steps 2–7 showed), its header comment, the refunds design doc, and the Known Gaps entries. If migrating to GraphQL: `refundPayment` needs an `amountToman` parameter (callers already have `payment.amount`), `session_id` storage or derivation, and GraphQL-errors-based failure classification — treat "already refunded" as success **only if step 6's error is unambiguous about it**, otherwise store a "refund already requested" terminal state instead of retrying forever.

## Consequences for the current deployment posture

- `PAYMENT_GATEWAY=zarinpal` **payments** (request/verify) are unaffected — those follow the current documented REST API.
- Real **refunds must be considered unverified and probably broken** until this runbook is executed. The failure mode is safe-by-design: every refund attempt throws or is refused, payments stay `refund_pending`, the 24h escalation fires (now a real SMS alert via the operator-alerting feature), and an operator refunds manually from the Zarinpal panel — but customers wait on a human.
- The `RefundRetryJob` retry loop is harmless against a dead endpoint (it logs and re-tries), but do not raise retry frequency before the one-refund-per-transaction semantics are confirmed.
