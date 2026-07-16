# Money-Critical Alerting — Design

**Date:** 2026-07-16
**Status:** Approved
**Closes:** the "no real alerting/paging on operator `logger.error` signals" MVP scope cut carried in CLAUDE.md/README since Plan 2, made urgent by Plan 8's refund pipeline.

## Problem

The payment/refund pipeline emits ~10 operator-facing `logger.error` signals (stuck refunds, refused refunds, money captured for dead bookings, orphaned payment authorities). They are plain application logs: nobody is notified, and several are re-emitted by cron jobs every 5 minutes. An admin who doesn't tail logs finds out about stranded money never.

## Decision summary

- **Channels:** every alert becomes an in-app admin notification (existing `admin_notifications` infra, already rendered by the admin panel with bell + unread count); `critical` alerts additionally SMS a configured admin phone via the existing `SmsProvider`.
- **Scope:** explicit opt-in at money-critical call sites only — no app-wide log interception (rejected: couples paging to log-message strings). No new tables, no digest job (rejected: trades away immediacy for machinery).
- **Storm control:** Redis-keyed dedup per alert key — one alert per key per window, because the retry/reconciliation crons re-detect the same condition every 5 minutes.

## `AlertsService` (new `src/alerts/` module)

```ts
export interface AlertInput {
  key: string;                       // dedup identity, e.g. 'refund-stuck:<paymentId>'
  severity: 'critical' | 'warning';  // critical => also SMS
  title: string;                     // Persian; becomes the notification title / SMS lead
  body: string;                      // Persian; notification body / SMS remainder
  link?: string;                     // optional admin-panel deep link
}

@Injectable()
export class AlertsService {
  async raise(input: AlertInput): Promise<void>; // NEVER throws
}
```

`raise()` flow:

1. **Dedup:** `SET alert:dedup:<key> 1 NX EX <ALERT_DEDUP_HOURS>` against the existing Redis connection (`REDIS` token). Key already present → return silently. `ALERT_DEDUP_HOURS = 6` (code constant). Per-entity keys mean two different stuck payments each alert; the same stuck payment alerts at most 4×/day instead of 288×.
2. **In-app:** `AdminNotificationsService.emit('alert', title, body, link ?? null)` (no transaction manager — alerts are independent of the caller's transaction).
3. **SMS (critical only):** if `severity === 'critical'` and the `ALERT_ADMIN_PHONE` config value is non-empty, `sms.send(phone, `${title} — ${body}`)`.
4. **Failure policy:** each step is individually try/caught and logged with the service's own `Logger`; nothing ever propagates to the caller — alerting must not be able to break a payment path. A Redis failure falls through to *sending* (fail-open: a duplicate alert beats a dropped one).

Module wiring: `AlertsModule` imports `AdminNotificationsModule` (already exports its service), `SmsModule`, `RedisModule`; exports `AlertsService`. `BookingModule` imports `AlertsModule`. No circular imports (`AdminNotificationsModule` imports neither).

## Call sites (7)

| # | Site | Key | Severity | Rationale |
|---|---|---|---|---|
| 1 | `RefundRetryJob` 24h escalation | `refund-stuck:<paymentId>` | **critical** | won't self-heal; money owed to a customer |
| 2 | `attemptRefund` — refund_pending with null authority | `refund-no-authority:<paymentId>` | **critical** | automation impossible; manual refund required |
| 3 | `BookingsService.createPaymentSession` — authority persist failure | `authority-persist:<bookingId>` | **critical** | orphaned chargeable Zarinpal session; manual reconciliation |
| 4 | `attemptRefund` — gateway refused the refund | `refund-refused:<paymentId>` | warning | auto-retried every 5 min; #1 escalates it at 24h |
| 5 | Captured money on a dead booking, refund queued — both producers: `PaymentReconciliationJob` late-capture branch and `handleCallback` lost-CAS recovery | `late-capture:<paymentId>` | warning | self-heals via the refund pipeline; admin should still see it happened |
| 6 | `PaymentReconciliationJob` — per-payment reconcile failure | `reconcile-failed:<paymentId>` | warning | retried next tick |
| 7 | `handleCallback` — paid/confirmed persist failure after successful verify | `verify-persist:<paymentId>` | warning | reconciliation self-heals it |

Both #5 producers share one key on purpose — same underlying event, whichever path detects it first wins the dedup.

Explicitly **not** alerted (log-only): Zarinpal gateway-level request/verify/refund errors (the service-level signals above already cover the actionable cases), the inline `attemptRefund` throw in `cancel()` and the retry job's per-payment throw (self-healing, covered by #1 if persistent), audit/salon notification emit failures (not money).

Each call site keeps its existing `logger.error` (logs remain the complete record; alerts are the paging layer) and adds a `raise()` call beside it. In `@Injectable()` classes the service is constructor-injected; all 7 sites live in `BookingModule` providers.

## Config

- `ALERT_ADMIN_PHONE` — optional; empty/unset disables SMS entirely (local dev, tests). In-app notifications flow regardless. Added to `.env.example` with a comment. Read via `config.get('ALERT_ADMIN_PHONE', '')` — deliberately not `getOrThrow`.

## Frontend

None required — the admin panel already lists `admin_notifications` with unread badge. Implementation checks whether the notifications page maps `type` values to Persian labels; if such a mapping exists, add an `alert` entry («هشدار سیستم»). No new pages.

## Testing

- **Unit — `alerts.service.spec.ts`:** first raise sends (notification emitted; SMS iff critical); duplicate key inside window is suppressed (no emit, no SMS); warning never SMSes; empty `ALERT_ADMIN_PHONE` disables SMS but not the notification; emit/SMS/Redis failures are swallowed (never throw); Redis failure still sends (fail-open).
- **Unit — call sites:** existing specs for `RefundRetryJob`, `PaymentsService` (attemptRefund + handleCallback), `PaymentReconciliationJob`, `BookingsService` gain an `AlertsService` mock provider and assertions that `raise()` fires with the right key/severity at each of the 7 sites (and does NOT fire on happy paths).
- **Backend e2e:** one flow — force a refused refund (`MOCK-REFUND-FAIL` authority) via a cancel, then assert `GET /api/admin/notifications` (admin cookie) contains a `type='alert'` row for it and the unread count reflects it.

## Out of scope

- Telegram/email channels, alert acknowledgement/resolution workflow, alert history page beyond the existing notifications list, metrics/dashboards (Grafana etc.), and log aggregation — all future work if the platform grows.
- Alerting on non-money signals (audit insert failures, salon notification failures).

## Docs to update

- `CLAUDE.md`: Known Gaps — replace "no real alerting/paging" with a pointer to this system and `ALERT_ADMIN_PHONE`.
- `README.md`: the "plain application logs with no alerting" sentence (Plan 8 wording) updated.
- `.env.example`: `ALERT_ADMIN_PHONE=`.
- `docs/deployment/DEPLOY.md`: env-var table row.
