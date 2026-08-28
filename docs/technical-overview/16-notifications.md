# 16 — Notifications

Three distinct channels exist: **SMS**, **Web Push**, and an in-app **admin notification queue**, plus an **operator alerting** layer built on top of all three.

## SMS

Interface `SmsProvider` (`apps/api/src/sms/sms.provider.ts`), selected via `SMS_PROVIDER=console|kavenegar`.

- **`ConsoleSmsProvider`** — logs only, default outside `kavenegar` mode.
- **`KavenegarSmsProvider`** — calls Kavenegar's REST API (`fetch`, 10s timeout). OTP uses a template-based lookup endpoint (`KAVENEGAR_OTP_TEMPLATE`, default `gheychi-otp`); everything else uses the plain send endpoint. Both throw on a non-200 HTTP response or a Kavenegar-level failure status. The OTP send URL embeds the raw code as a query parameter — flagged in code as something request-logging middleware must never log verbatim.

**Every SMS actually sent, by trigger:**

| Trigger | Source | Message |
|---|---|---|
| OTP login | `auth.controller.ts` | the 6-digit code |
| Booking confirmed | `payments.service.ts` `notifyConfirmed` | to customer: confirmation + address; to salon owner: new-booking notice |
| Appointment reminder | `booking-reminder.job.ts` | reminder + address, configurable lead time |
| Refund issued | `payments.service.ts` `notifyRefunded` | "your deposit was refunded" |
| Critical operator alert | `alerts.service.ts` | paged to `ALERT_ADMIN_PHONE` |

Confirmation/reminder/refund sends are all `.catch(()=>{})` — best-effort, never roll back booking/payment state. Alert SMS is the one channel with its own dedup + hourly cap (below).

## Web Push

Interface `PushProvider` (`apps/api/src/push/push.provider.ts`), selected via `PUSH_PROVIDER=console|webpush`.

- **`WebPushProvider`** wraps the `web-push` npm library, configured once at construction with `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`.
- `push.service.ts`'s `sendToUser(userId, payload)` fans a notification out to **every** subscription the user has registered (multiple devices/browsers), each independently `.catch(()=>{})`'d so one dead device never blocks or fails the others.

```mermaid
sequenceDiagram
    participant Browser
    participant User as usePushSubscription (user-app)
    participant API
    participant SW as sw.ts (service worker)

    Browser->>User: Notification.requestPermission()
    User->>Browser: pushManager.subscribe({applicationServerKey: VAPID public key})
    User->>API: POST /push/subscribe {endpoint, p256dh, auth}
    API->>API: upsert push_subscriptions (unique on endpoint)
    Note over API: later, some trigger (booking confirmed, reminder, refund)
    API->>SW: web-push sendNotification(subscription, JSON payload)
    SW->>SW: self.addEventListener('push', ...) shows the notification
    Browser->>SW: user taps notification
    SW->>Browser: notificationclick -> opens/focuses '/bookings' (always, no deep link)
```

**Ownership rebinding**: because a `PushSubscription` is per-browser, not per-user, `usePushSubscription.rebindOwnership()` (user-app) re-POSTs `/push/subscribe` on every login/status refresh to reclaim the endpoint for whoever is currently logged in — this prevents a shared-device scenario where a second user keeps receiving the first user's push notifications.

**Known limitation**: every push notification always opens `/bookings` on tap, regardless of what it's actually about — no deep-linking to the specific booking.

## Admin notification queue

Not a push channel — an in-app, polled (60s cadence per the admin panel) queue of `admin_notifications` rows. `AdminNotificationsService.emit(type, title, body, link, manager?)` — **throws on failure by contract**, so each caller decides whether to swallow it.

Two emit points exist:
1. **`report_created`** (`ReportsService.create`) — called **with** the enclosing transaction's `EntityManager`, so the report and its notification commit or roll back together (a strict guarantee).
2. **`salon_resubmitted`** (`SalonsService.resubmitMine`) — called **without** a transaction, wrapped in try/catch that only logs on failure ("a fire-safe side effect... a lost notification must never fail the owner's resubmission"). This is a genuinely lossy delivery path — no retry, no dead-letter.

**Known limitation, confirmed at the schema level**: `read_at` is a single column on the notification row — there is **no per-admin read state**. Any admin marking a notification read clears it for every admin. A real multi-admin operations team will need a join table (`admin_notification_reads`) before this scales past a single-operator setup.

## Operator alerting — `AlertsService.raise()`

`apps/api/src/alerts/alerts.service.ts`. The paging layer for money-critical conditions: stuck refunds, refused refunds, captured money on a dead booking, orphaned payment authorities, referral-reward shortfalls, referral-grant failures, notification-persist failures.

```mermaid
flowchart TD
    A["AlertsService.raise({key, severity, title, body, dedupHours?})"] --> B["Redis SET alert:dedup:{key} NX EX dedupSeconds"]
    B -->|already claimed = duplicate| Z[return, no-op]
    B -->|claimed fresh| C["AdminNotificationsService.emit('alert', ...)\nALWAYS, regardless of severity, uncapped"]
    C --> D{severity == critical?}
    D -->|no| E[done]
    D -->|yes| F["for each phone in ALERT_ADMIN_PHONE"]
    F --> G["Redis INCR+EXPIRE alert:sms-count:{hourBucket}"]
    G -->|under ALERT_SMS_HOURLY_CAP, default 30| H[send SMS]
    G -->|cap exceeded| I["stop sending, break loop"]
    H --> J{anything actually delivered?}
    I --> J
    J -->|nothing delivered at all| K["DEL the dedup claim -\nnext cron retry isn't silently muted"]
    J -->|in-app succeeded, at least| L["keep dedup claim"]
```

- **Dedup window**: default 6 hours (`ALERT_DEDUP_HOURS`), overridden to 24h for stuck-refund escalation and referral-reward-shortfall alerts.
- **Fails open on Redis errors** for both dedup and the SMS cap check — the stated philosophy is "a duplicate alert beats a dropped one."
- **The SMS cap is per-phone, per-hour-bucket, not per-incident** — with multiple `ALERT_ADMIN_PHONE` numbers configured, the effective "distinct incidents paged per hour" is `cap / numberOfPhones`, since the loop increments a shared bucket per phone and breaks (not continues) once any phone hits the cap.
- `raise()` itself can never throw — it runs inline inside payment/booking-adjacent code paths that must not fail because of an alerting bug.

Known `alert:dedup:` key identities in use: `authority-persist:{bookingId}`, `verify-persist:{paymentId}`, `late-capture:{paymentId}`, `refund-no-authority:{paymentId}`, `refund-refused:{paymentId}`, `refund-stuck:{paymentId}` (24h), `reconcile-failed:{paymentId}`, `referral-grant-failed:{userId}:{bookingId}`, `referral-reward-shortfall:{rewardId}` (24h), `referral-reversal-failed:{bookingId}`.

## Related documents

- [11-payment-system.md](./11-payment-system.md) — the money-critical conditions that trigger most alerts
- [13-financial-system.md](./13-financial-system.md) — referral-reward shortfall alerting
- [19-third-party-services.md](./19-third-party-services.md) — Kavenegar/Web Push provider configuration

## Manual-approval notifications

Five additional customer/owner messages, all through the same `PaymentsService.notifyOne`
helper and the same `SmsProvider`/`PushService` abstractions:
`notifyApprovalRequested` (customer + owner), `notifyApproved`, `notifyRejected`,
`notifyApprovalExpired`, and `notifyPaymentExpired`.

Every one of them states explicitly whether money changed hands — "your request expired" is
easily misread as "you lost your deposit", and in this flow nothing was ever charged.
`notifyPaymentExpired` also closed a pre-existing silence: `BookingExpiryJob` never told the
customer anything. All five are best-effort and fired after their transaction commits, so a
failed SMS can never roll back a booking decision. See
[28-booking-approval-workflow.md](./28-booking-approval-workflow.md).
