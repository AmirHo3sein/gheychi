# Operator Alerting for Payment/Refund Signals — Design

**Date:** 2026-07-17
**Status:** Approved
**Closes:** the "no real alerting/paging on the `logger.error(...)` operator signals (stuck refunds, payments needing review)" MVP scope cut recorded in the README, CLAUDE.md, and the real-payment-refunds design doc.

## Problem

Three conditions in the booking module require a human operator to act, and today their only signal is a `logger.error` line nobody is paged about:

1. **Stuck refund** — `RefundRetryJob` escalates when a payment has been `refund_pending` for over 24 h (`refund-retry.job.ts`, `ESCALATE_AFTER_HOURS` branch). The "escalation" is a repeated log line every 5-minute cron tick.
2. **Refund impossible** — `PaymentsService.attemptRefund()` finds a `refund_pending` payment with no `authority`; a gateway refund can never succeed and the payment re-logs every 5 minutes forever (`payments.service.ts`, "needs manual refund").
3. **Payment stuck in reconciliation** — `PaymentReconciliationJob`'s per-payment catch fires on transient errors by design; a payment that stays `initiated` for a full day despite a retry every 5 minutes is no longer transient and needs review.

## Decision: SMS via the existing provider, no new integration

Chosen by a three-design judge panel (MVP-first / ops-first / risk-first candidates, three scoring lenses; unanimous winner). Alerts go out as **SMS through the existing `SmsProvider` abstraction** — Kavenegar in production, Console in dev/test:

- `SmsProvider.send(phone, message)` already exists and is prod-proven (booking-confirmation SMS). Zero new third parties, zero new secrets, domestic delivery (no filtering risk, unlike Telegram).
- With the default `SMS_PROVIDER=console` and no `OPS_ALERT_PHONES`, the whole feature degrades to log lines — tests and local dev need no changes.
- **No new `ALERT_PROVIDER` interface/token/factory.** The repo's provider pattern exists for new *external integrations*; this feature composes two existing tokens (`SMS_PROVIDER`, `REDIS`). An abstraction is added when a second channel actually exists, not before.

## Architecture

One new module, `apps/api/src/alerts/`:

- **`alerts.service.ts`** — `AlertsService.notifyOps(dedupeKey: string, message: string, opts?: { ttlSeconds?: number }): Promise<void>`.
  Contract: **never throws, never rejects** (whole body guarded; every failure path logs and returns). Injects `@Inject(SMS_PROVIDER)`, `@Inject(REDIS)`, `ConfigService`.
  1. Recipients come from `OPS_ALERT_PHONES` (comma-separated, parsed once). Empty/unset → log the alert as `[unrouted ops alert] <message>` at warn level and return.
  2. **Throttle:** `SET ops-alert:<dedupeKey> 1 EX <ttl> NX` — non-`'OK'` means already alerted inside the window; return. Default TTL from `OPS_ALERT_THROTTLE_HOURS` (default 6); callers may override per alert (the 24 h stuck-refund escalation re-pages daily via `ttlSeconds: 86400`).
  3. **Redis outage fallback:** if the `SET` throws, fall back to an in-process `Map<dedupeKey, expiresAtMs>` — per-process at-most-once-per-TTL instead of either spam or silence.
  4. **Hourly circuit breaker:** `INCR ops-alert:count:<floor(epoch/3600)>` (+`EXPIRE` on first incr); above `OPS_ALERT_HOURLY_CAP` (default 30) log-warn and suppress the send — bounds worst-case SMS cost in a mass incident. Breaker errors are non-fatal (proceed to send).
  5. Send `[Arayeshgah] <message>` to each recipient; each `sms.send()` failure is caught and logged individually. **If every send fails, `DEL` the throttle key** so the next 5-minute job tick retries delivery instead of a transient Kavenegar blip muting the alert for the full TTL.
  6. **Boot-time misconfig warnings** (constructor): `OPS_ALERT_PHONES` set while `SMS_PROVIDER` ≠ `kavenegar` ("alerts will only print to logs"); `OPS_ALERT_PHONES` non-empty but zero parseable phone numbers.
- **`alerts.module.ts`** — imports `SmsModule`, provides + exports `AlertsService`. Not global; only `BookingModule` imports it.
- **Message content rule:** alert text carries **internal IDs and timestamps only** (payment id, booking id, condition tag) — never customer phone numbers, amounts, OTPs, or tokens. SMS is not a secure sink. Each message starts with a stable condition tag (`refund-stuck` / `refund-no-authority` / `payment-stuck`) so operators can triage from the preview.

## Wiring (three call sites, all in `apps/api/src/booking/`)

Each site keeps its existing `logger.error` and adds one `notifyOps` call:

| Site | Dedupe key | TTL | Note |
|---|---|---|---|
| `refund-retry.job.ts` 24 h escalation branch | `refund-stuck:<paymentId>` | 24 h | re-pages daily while stuck |
| `payments.service.ts` `attemptRefund()` no-authority branch | `refund-no-authority:<paymentId>` | default | `void this.alerts.notifyOps(...)` — fire-and-forget; this path runs inline in the customer-facing `cancel()` |
| `payment-reconciliation.job.ts` per-payment catch | `payment-stuck:<paymentId>` | default | **only when `payment.createdAt` is older than 24 h** (new `STUCK_INITIATED_ALERT_HOURS = 24`) — the catch fires on transient errors by design |

**Deliberately not wired:** the two CAS-guarded one-shot anomalies (late-capture refund queue, capture-vs-cancel race) — both self-heal via `RefundRetryJob` within minutes, and if the queued refund then sticks, the 24 h escalation catches it. Alerting on them is noise.

## Config

New optional env vars (in `.env.example`, all with safe defaults; `config.get` with default, no `getOrThrow` — nothing new can crash a boot):

```
OPS_ALERT_PHONES=            # comma-separated 09x numbers; empty = alerting disabled (log-only)
OPS_ALERT_THROTTLE_HOURS=6   # default per-condition re-alert window
OPS_ALERT_HOURLY_CAP=30      # global SMS-per-hour circuit breaker
```

`DEPLOY.md` gains a paragraph in the env checklist: how to enable alerting, the degradation modes (console mode, empty phones), and the throttle semantics.

## Testing

- `alerts.service.spec.ts` (colocated, `ioredis-mock` for real `SET NX EX` semantics): fan-out to all phones with prefix; same-key-inside-TTL suppressed; different key sends; TTL override honored; empty `OPS_ALERT_PHONES` → warn, no send; all-sends-fail → throttle key released; partial failure → key kept; Redis `SET` throws → in-process fallback still dedupes and sends; hourly cap suppresses; **torture case: Redis throws + sms rejects simultaneously → `notifyOps` still resolves**.
- Existing specs gain a `{ provide: AlertsService, useValue: { notifyOps: jest.fn() } }` mock (three consumers) plus assertions: escalation calls `notifyOps` (and under-24 h does not); reconciliation alerts only for >24 h-old payments (both sides); no-authority path fires.
- E2E unaffected: no routes, no migrations, no new required env vars; `.env.test` untouched.

## Out of scope

- Telegram / any second channel (add behind an abstraction when actually needed).
- Severity levels, structured alert objects, per-channel routing.
- Alerting on self-healing conditions.
- Delivery guarantees beyond the throttle-release retry (SMS is best-effort; the log line remains the source of truth).
- Kavenegar plain-text `send` has never been fired with real credits for *alerts* specifically — same verify-once-in-production status as the refund API itself.
