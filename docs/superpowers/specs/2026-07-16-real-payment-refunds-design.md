# Real Payment Refunds — Design

**Date:** 2026-07-16
**Status:** Approved
**Supersedes:** the "bookkeeping-only refunds" MVP scope cut recorded in the marketplace design doc, Plan 2, README, and CLAUDE.md.

## Problem

Today `Payment.status = 'refunded'` is a bookkeeping label: `BookingsService.cancel()` flips the row inside a transaction and no money moves. Separately, `PaymentReconciliationJob` has an edge case (Zarinpal captured the deposit after the booking already expired or was cancelled) that only emits a `logger.error(... needs manual refund review)`. Customers who are owed money get it back only if an operator notices and acts by hand.

This feature makes both paths actually return the money through Zarinpal's refund API, fully automatically, and surfaces refund state to the customer.

## Zarinpal refund contract

Verified against Zarinpal's official docs/SDKs (`ZarinPal/zarinpal-node-sdk`, `peymanr34/riviera-zarinpal`):

- **Endpoint:** `POST https://payment.zarinpal.com/pg/v4/payment/refund.json`
- **Body:** `{ "authority": "<authority>", "merchant_id": "<merchant id>" }` — refunds the full captured amount of that transaction. We always refund the full deposit, so no partial-refund support is needed.
- **Auth:** `Authorization: Bearer <access token>` — a personal access token generated in the Zarinpal panel, *separate from* the merchant ID.
- **Response:** `{ data: { code, message, ref_id, session, iban }, errors }` — `ref_id` is the refund reference; store it.
- Zarinpal also offers a GraphQL `AddRefund` mutation (requires a `session_id` lookup) and `reverse.json` (fee-free but only within 30 minutes). The REST refund-by-authority fits our stored data and gateway abstraction; the others are not used.

**Sandbox caveat (same as the existing gateway code):** no real merchant account or access token exists in dev. The exact success/"already refunded" response codes MUST be verified against Zarinpal's sandbox before taking real refunds; the implementation documents this in the same style as `zarinpal-payment.gateway.ts`'s existing header comment. Every automated test uses `MockPaymentGateway`.

## Status model

`PaymentStatus` gains one value:

```
initiated → paid → refund_pending → refunded
     │    ↘ failed        ↑
     └────────────────────┘  (reconciliation: captured after the booking
                              already left pending_payment — money was
                              taken, so it goes straight to refund_pending)
```

- `refund_pending` — a refund is owed (cancel decided it, or reconciliation detected a late capture) but the gateway has not yet confirmed it.
- `refunded` — **redefined**: the gateway confirmed the refund (`refund_ref_id` recorded). With the mock gateway this happens immediately.

**Migration:** add three nullable columns to `payments`: `refund_ref_id varchar`, `refunded_at timestamptz`, and `refund_requested_at timestamptz`. `refund_requested_at` is set by whichever producer marks the payment `refund_pending` — the `payments` table has no `updated_at`, and both the retry job's grace period and its 24-hour escalation need to know when the refund became owed. `status` is already a plain varchar — no type change.

## Gateway interface

```ts
export interface PaymentRefundResult {
  success: boolean;
  refundRefId: string | null;
}

export interface PaymentGateway {
  requestPayment(...): Promise<PaymentRequestResult>;   // unchanged
  verifyPayment(...): Promise<PaymentVerifyResult>;     // unchanged
  refundPayment(authority: string): Promise<PaymentRefundResult>;
}
```

- **ZarinpalGateway:** calls `refund.json` as above. An "already refunded" response code is treated as `success: true` (with `refundRefId` from the response when present) — this makes the pipeline idempotent even if the process crashes between the gateway call and the DB write. Network errors / non-ok HTTP / unexpected codes throw, mirroring `verifyPayment`'s policy (a decline-shaped answer returns `success: false`; an infrastructure failure throws).
- **MockPaymentGateway:** returns `{ success: true, refundRefId: 'MOCKREFUND-<authority>' }`; an authority containing `MOCK-REFUND-FAIL` returns `{ success: false, refundRefId: null }` so tests can exercise the failure path.
- **Config:** new env var `ZARINPAL_ACCESS_TOKEN`, read in the existing gateway factory and passed to the `ZarinpalGateway` constructor. Required (via `getOrThrow`) only when `PAYMENT_GATEWAY=zarinpal`, so mock-mode dev/test needs nothing new. Added to `.env.example` with a comment.

## Flows

Three producers mark `refund_pending`; one consumer performs refunds.

### 1. `BookingsService.cancel()`

Inside the existing status-guarded transaction, where it writes `refunded` today it writes `refund_pending`. After the transaction commits, it calls `PaymentsService.attemptRefund(bookingId)` wrapped in try/catch — a gateway failure is logged and never fails the cancel response; the payment simply stays `refund_pending` for the retry job. In the mock/happy path the refund confirms within the same request, so the customer usually sees the final state immediately.

### 2. `PaymentReconciliationJob`

In the "verify succeeded but the booking already left `pending_payment`" branch, set the payment directly to `refund_pending` (instead of `paid`) and keep a log line noting an automatic refund was queued. The retry job picks it up on the same 5-minute cadence.

### 3. `RefundRetryJob` (new, `booking/refund-retry.job.ts`)

Same shape as the reconciliation job: `@Cron('*/5 * * * *')` → `run()`. Finds payments with `status = 'refund_pending'` older than a short grace period (avoids racing a just-committed cancel's inline attempt), and calls `attemptRefund` for each; per-payment errors are logged and don't block the rest of the batch. A payment `refund_pending` for more than 24 hours gets a loud `logger.error` (operator signal — real alerting remains a separate future feature). A `refund_pending` payment with a null authority can't be refunded and is logged as an error (shouldn't occur: captured payments always have one).

### `PaymentsService.attemptRefund(bookingId)` (new, the single consumer)

1. Load the payment; return early unless `status = 'refund_pending'` and `authority` is set.
2. `gateway.refundPayment(authority)`.
3. On `success`: `UPDATE payments SET status='refunded', refund_ref_id=?, refunded_at=now() WHERE id=? AND status='refund_pending'` — the same race-safe conditional-update idiom used everywhere else in the module. Only the winner (`affected = 1`) proceeds to notify.
4. On success (winner only): best-effort SMS + push to the customer — «مبلغ ودیعه به حساب شما بازگردانده شد» — via the existing notify helpers; failures never roll anything back.
5. On `success: false` or a throw: log and leave `refund_pending` (the retry job self-heals).

Double-gateway-call safety: the conditional update prevents double *recording*; treating "already refunded" as success prevents a second gateway call from being harmful; the retry job's grace period makes the overlap rare in the first place.

## Customer-facing state (user-app)

- `GET /api/bookings/:id` (`findMine`) gains `refundStatus: 'pending' | 'done' | null`, derived from the booking's payment (`refund_pending` → `'pending'`, `refunded` → `'done'`, anything else → `null`).
- `bookings/[id].vue` shows one line on cancelled bookings when `refundStatus` is non-null: «بازگشت وجه در حال انجام است» (pending) / «وجه بازگردانده شد» (done).
- No other frontend changes; nothing else in any app reads payment status.

## Error handling summary

| Failure | Behaviour |
|---|---|
| Gateway refund throws / returns failure during cancel | Cancel still succeeds; payment stays `refund_pending`; retry job retries every 5 min |
| Crash between gateway success and DB write | Retry job re-calls the gateway; "already refunded" is treated as success and the DB write completes |
| Concurrent inline attempt + retry job | Conditional `WHERE status='refund_pending'` — one winner, one no-op; single notification |
| Refund stuck > 24 h | `logger.error` operator signal (alerting itself is out of scope) |
| SMS/push failure after refund | Swallowed; never affects payment state |

## Testing

- **Unit (colocated `.spec.ts`):** `attemptRefund` (success, gateway failure, gateway throw, lost conditional update → no notification, null authority), `cancel()` writes `refund_pending` and triggers the inline attempt without failing on gateway errors, reconciliation's changed branch, `RefundRetryJob.run()` (picks up eligible rows, respects grace period, per-payment error isolation, 24 h escalation log), `ZarinpalGateway.refundPayment` response handling with mocked `fetch`.
- **Backend e2e:** extend `booking-cancellation.e2e-spec.ts` — an owner cancel of a confirmed booking ends with the payment `refunded` (+ `refund_ref_id`) via the mock gateway; a `MOCK-REFUND-FAIL` authority leaves it `refund_pending`; the retry job's `run()` called directly then completes it once the authority is made refundable.
- **Frontend:** Nuxt component test for the refund status line on the booking detail page (both texts, and absence for non-cancelled bookings).

## Out of scope

- Real Zarinpal sandbox verification (no merchant account in dev) — must happen before production, tracked as a deploy prerequisite.
- Partial refunds, provider payouts, and the commission ledger.
- Real alerting/paging on the operator `logger.error` signals.
- Admin UI for refunds (the retry job plus logs cover MVP; an admin queue can come with the analytics dashboard work).

## Docs to update

- `CLAUDE.md`: domain-model table row for `Payment.status`, Known Gaps ("no real payment refunds" — remove/replace), Development Mindset note stays accurate.
- `README.md`: the bookkeeping-only refund note.
- `.env.example`: `ZARINPAL_ACCESS_TOKEN`.
