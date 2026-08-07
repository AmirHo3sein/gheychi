# 19 — Third-Party Services

Every external integration follows the same pattern: an interface, a DI token, two-or-more implementations, selected by an env var — so local dev and automated tests never require real credentials. See [02-system-architecture.md](./02-system-architecture.md) for the pattern table.

## Zarinpal — payments

`PAYMENT_GATEWAY=zarinpal` (default `mock`). `ZARINPAL_MERCHANT_ID`, `ZARINPAL_ACCESS_TOKEN` (panel-issued; required for refund auth — the API refuses to start in zarinpal mode without it).

- `request.json` — mint a payment session (amount in rial, toman×10).
- `verify.json` — confirm a captured payment; codes `100`/`101` both mean success (101 = already-verified, keeps repeat calls safe).
- `refund.json` — **⚠️ implements a legacy, de-documented REST contract** (see [11-payment-system.md](./11-payment-system.md) for the full risk writeup). Must be verified against production per `docs/deployment/ZARINPAL-REFUND-VERIFICATION.md` before real refunds are trusted.

Sandbox exists for request/verify/StartPay but **not for refunds at all**.

## Kavenegar — SMS

`SMS_PROVIDER=kavenegar` (default `console`, which just logs). `KAVENEGAR_API_KEY`, `KAVENEGAR_OTP_TEMPLATE` (default `gheychi-otp`). Two REST endpoints used: template-based OTP lookup, and plain message send. See [16-notifications.md](./16-notifications.md) for every message actually sent.

## Web Push — VAPID

`PUSH_PROVIDER=webpush` (default `console`). `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. The public key must also be set as `NUXT_PUBLIC_VAPID_PUBLIC_KEY` on `user-app` — **both halves of the same keypair**, generated once via `npx web-push generate-vapid-keys` and split across the two `.env` files. Push degrades gracefully to a no-op UI with no real keys configured; nothing else in the app depends on it.

## Storage — local disk or S3-compatible

`STORAGE_PROVIDER=local|s3` (default `local`).

- **Local**: writes under `apps/api/uploads/`, served at `/uploads/*` via Express static middleware on the API's own origin. Zero config needed for local dev.
- **S3**: `@aws-sdk/client-s3`, `forcePathStyle: true` (works with any S3-compatible endpoint — MinIO, ArvanCloud, Liara — not just AWS). Requires `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL` — all via `getOrThrow`, so misconfiguration fails fast **at boot**, not at first upload.

Every consumer (salon photos, stories, portfolio, blog covers) shares the same upload pattern: 5MB hard cap (Multer), real magic-number MIME sniffing (`file-type` package, not the client's `Content-Type` header), server-generated storage keys (never the client's filename — path-traversal defense).

## Maps — Leaflet + CARTO

No API key or paid SDK anywhere. `user-app`'s `SalonMap.client.vue` and `provider-panel`'s `SalonPinPicker.vue` both use the bundled `leaflet` npm package + CARTO's free Voyager tile layer. Marker popups link out to the customer's own maps app (Neshan `nshn.ir/?lat=&lng=` or Google Maps `google.com/maps/dir/?api=1&destination=`) for directions — no in-app turn-by-turn routing.

## Images — ArvanCloud (via `@nuxt/image`)

`user-app`'s custom, minimal provider (`app/providers/arvancloud.ts`) — appends `?width=&height=` query params to the source URL and relies entirely on ArvanCloud's own image-processing service to interpret them. No format/quality/fit mapping.

## PostGIS

Not a network service, but a Postgres extension the whole search subsystem depends on (`ST_DWithin`, `ST_Distance`, geography-typed `location` column). See [04-database.md](./04-database.md).

## Provider cutover checklist (production)

`docs/deployment/DEPLOY.md` documents, per concern, the exact env vars to flip and confirms no code changes are ever needed to switch a provider — SMS/Payments/Storage/Push/Alerts are all covered. A manual smoke test (real OTP SMS, a real minimum-value Zarinpal payment, an image upload URL, a real push delivery) is the only way to validate third-party credentials, since none of this is exercised by CI.

## Related documents

- [11-payment-system.md](./11-payment-system.md) — Zarinpal integration detail and the refund-contract risk
- [16-notifications.md](./16-notifications.md) — SMS/Push message inventory
- [21-security.md](./21-security.md) — upload validation detail
