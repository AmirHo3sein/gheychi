# 25 — Future Improvements

This document lists **extension points already visible in the code** — reserved columns, explicit "not yet built" comments, and structural seams the team left for future work — as distinct from open-ended wishlist items. Each entry traces to something concrete already in the codebase.

## Automated payout / settlement

`invoices.settlement_id` is a nullable, un-FK'd column, explicitly commented as "a reserved seam for a future automated-payout batch table (Settlement), deliberately not built yet — an empty table with no writer would just invite half-wiring." `invoice_payments.method` already reserves `'automatic_payout'` and `'wallet_credit'` as CHECK-allowed values with zero current writers. **Extension path**: build a `Settlement` entity, a payout-provider abstraction (following the existing interface/token/env-var pattern used for SMS/Payments/Push/Storage — see [02-system-architecture.md](./02-system-architecture.md)), and wire `settlement_id` + the two reserved `method` values into `InvoicingService`.

## Backup-failure alerting

`AlertsService` already exists and is fully wired into every money-critical payment/referral path (see [16-notifications.md](./16-notifications.md)). The daily Postgres backup script (`docker/backup/backup.sh`) currently only logs to stdout on failure with no paging. **Extension path**: have `backup.sh` (or a thin wrapper around it) call the same alerting mechanism — the hardest part (dedup, SMS cap, in-app notification) is already built and just needs a new call site.

## Shared code package across frontends

`pnpm-workspace.yaml` already globs `packages/*`, but no such directory exists. **Extension path**: introduce `packages/ui` (or similar) and migrate the byte-identical duplicates catalogued in [24-technical-debt.md](./24-technical-debt.md) (`AppButton`, `AppCard`, `AppInput`, `EmptyState`, `useTheme`, `useToast`, the digit-normalization helper, the `.app-select` CSS block) — this is explicitly a policy choice today ("cross-app isolation convention"), not a technical blocker, so this would require a deliberate decision to reverse that policy rather than a pure mechanical extraction.

## Worker SMS invite flow

Adding a worker today requires the owner to already know a phone number that resolves via `findOrCreateByPhone` — there's no invite-by-link/SMS flow. **Extension path**: the SMS abstraction (`SmsProvider`) is already in place and used for OTP/reminders; a worker-invite message template plus a short-lived invite-token flow would follow the same pattern.

## Wallet spend-at-checkout beyond deposits

Wallet balance can currently only be applied toward a booking's deposit at creation time (`applyWalletBalance`). Any broader "pay for anything with wallet balance" flow would build on the existing `booking_spend`/`booking_spend_reversal` transaction types and the `debit()`/`credit()` primitives already in place — see [12-wallet.md](./12-wallet.md).

## Before/after portfolio comparison slider

Named explicitly as a fast-follow in the salon-showcase design spec (`docs/superpowers/specs/2026-07-17-salon-showcase-design.md`) — not built, no code scaffolding exists for it yet.

## Related documents

- [24-technical-debt.md](./24-technical-debt.md) — gaps without an obvious existing seam to extend
- [23-known-limitations.md](./23-known-limitations.md) — deliberate cuts, some of which overlap with entries above
