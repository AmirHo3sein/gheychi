# 25 — Future Improvements

This document lists **extension points already visible in the code** — reserved columns, explicit "not yet built" comments, and structural seams the team left for future work — as distinct from open-ended wishlist items. Each entry traces to something concrete already in the codebase.

## Automated payout / settlement

`invoices.settlement_id` is a nullable, un-FK'd column, explicitly commented as "a reserved seam for a future automated-payout batch table (Settlement), deliberately not built yet — an empty table with no writer would just invite half-wiring." `invoice_payments.method` already reserves `'automatic_payout'` and `'wallet_credit'` as CHECK-allowed values with zero current writers. **Extension path**: build a `Settlement` entity, a payout-provider abstraction (following the existing interface/token/env-var pattern used for SMS/Payments/Push/Storage — see [02-system-architecture.md](./02-system-architecture.md)), and wire `settlement_id` + the two reserved `method` values into `InvoicingService`.

## Backup-failure alerting — done; uploads backup is the remaining seam

Shipped: `docker/backup/backup.sh` `report_backup()` POSTs each run's outcome to `POST /api/internal/backup-report` (`BackupReportSecretGuard`), which pages `AlertsService` (`backup-failed`, critical) on failure and stamps `backup:last-success` in Redis on success; `BackupStalenessCheckJob` (every 4h) pages `backup-stale` when that stamp is missing or older than 27h, catching a container that never even ran. **Remaining extension path**: the `api_uploads` volume (production runs `STORAGE_PROVIDER=local`) is not part of any backup — either extend `backup.sh` to `mc mirror` the volume to the same bucket, or switch production to `STORAGE_PROVIDER=s3`, which the existing `StorageProvider` abstraction already supports with no code change.

## Shared code package across frontends

`pnpm-workspace.yaml` already globs `packages/*`, but no such directory exists. **Extension path**: introduce `packages/ui` (or similar) and migrate the byte-identical duplicates catalogued in [24-technical-debt.md](./24-technical-debt.md) (`AppButton`, `AppCard`, `AppInput`, `EmptyState`, `useTheme`, `useToast`, the digit-normalization helper, the `.app-select` CSS block) — this is explicitly a policy choice today ("cross-app isolation convention"), not a technical blocker, so this would require a deliberate decision to reverse that policy rather than a pure mechanical extraction.

## Worker invite acceptance flow

Adding a worker today requires the owner to already know a phone number that resolves via `findOrCreateByPhone`; the worker is SMS-notified on add (`salon-workers.controller.ts` `notifyWorkerAdded`, approved salons only, pointing at the login page) but the roster row exists immediately with no accept/decline step. **Extension path**: a short-lived invite token (Redis, like OTP state) carried in that SMS's link, with the `workers` row created — or activated — only on acceptance, would turn the existing notification into a real consent flow without touching `SmsProvider`.

## Wallet spend-at-checkout beyond deposits

Wallet balance can currently only be applied toward a booking's deposit at creation time (`applyWalletBalance`). Any broader "pay for anything with wallet balance" flow would build on the existing `booking_spend`/`booking_spend_reversal` transaction types and the `debit()`/`credit()` primitives already in place — see [12-wallet.md](./12-wallet.md).

## Before/after portfolio comparison slider

Named explicitly as a fast-follow in the salon-showcase design spec (`docs/superpowers/specs/2026-07-17-salon-showcase-design.md`) — not built, no code scaffolding exists for it yet.

## Related documents

- [24-technical-debt.md](./24-technical-debt.md) — gaps without an obvious existing seam to extend
- [23-known-limitations.md](./23-known-limitations.md) — deliberate cuts, some of which overlap with entries above
