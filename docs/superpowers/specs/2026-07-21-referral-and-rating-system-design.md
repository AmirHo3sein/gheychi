# Referral & Rating System — Design

**Date:** 2026-07-21
**Status:** Approved — product decisions recorded below. Ready to turn into task-by-task plans.
**Chosen by:** synthesis of three competing architect proposals (minimal-extend, event-driven, risk-first) and two independent judge panels. Both panels scored the risk-first design highest on money-moving correctness (9/10) and abuse coverage (7–9/10) and neither found anything in the event-driven design worth keeping. The panels disagreed on which design should be the *base* (one picked minimal-extend + grafted most of risk-first's money-safety machinery onto it; the other picked risk-first outright + grafted three smaller ideas onto it). This document resolves that disagreement — see "Where the judges disagreed" below.

## Problem

Arayeshgah has no referral program and no per-worker rating — only the existing salon-level `Review`. The product wants: (1) a referral system covering three referrer kinds (ordinary customer, salon owner, salon worker), each earning a configurable reward (wallet credit, percent/fixed discount, cashback, or loyalty points) for both referrer and referee once a qualifying booking event fires; (2) a `Worker` concept (none exists today — confirmed by research, zero hits for staff/employee anywhere in the codebase) so a specific stylist can be assigned to a booking, rated, and hold their own referral code; (3) worker-level ratings alongside the existing salon rating. This sits at the same trust tier as Payment/refund/coupon code — it moves real toman — so the design is judged first on race-safety and reversal handling, then on fit and simplicity.

## Where the judges disagreed, and the call made here

Both judges independently converged on the same core money-safety mechanism — an append-only wallet ledger (never a mutable balance column), a `referral_rewards` row with a DB-level `UNIQUE(referral_id, beneficiary_role)` exactly-once backstop, and a reversal/clawback path wired into the existing `AlertsService` — and both explicitly rejected the event-driven design's trigger-catalog/dispatcher abstraction, its `scope_country_code` stub, and its redundant FK pair as premature generality. Those points are treated as **high-confidence** and adopted outright below.

The judges disagreed on two things, resolved here explicitly:

1. **Which design is the base.** Judge 1 picked minimal-extend for its file/table count, then grafted most of risk-first's money-safety design onto it anyway (wallet ledger, the unique-constraint backstop, `AlertsService` reversal) — by the judge's own admission, only axis (b) of minimal-extend was weak, and the fix was "take risk-first's mechanism." Judge 2 picked risk-first outright by a clear margin (33.5 vs 28.5/40) and had to graft far less onto it. Since Judge 1's own final artifact already imports the majority of risk-first's substance, using risk-first as the literal base is the more internally consistent choice — it avoids describing the same reversal machinery twice under two different table names. **Risk-first is the base of this document.**
2. **How the discount-type reward is delivered.** Risk-first (the chosen base) builds a parallel `referral_discount_grants` table with its own `redeemed_booking_id UNIQUE` tracking column — Judge 1 specifically flagged this as "reinventing the coupon-redemption mechanism it claims to be reusing," a duplicate of `coupon_redemptions`. Judge 2 didn't defend the parallel table (it praised risk-first's percent-vs-fixed-amount *reconciliation logic*, which is a separable concern). Judge 1's critique stands on its own merits and matches CLAUDE.md's simplicity mandate: **this document drops `referral_discount_grants` and instead inserts a literal, user-restricted row into the existing `coupons` table** (minimal-extend's and event-driven's approach), reusing `coupon_redemptions`, `resolveAndValidate`, and the existing no-stacking resolution verbatim. The percent-vs-fixed-amount nuance Judge 2 praised is preserved (§3) but implemented as a `discount.util.ts` extension available to *any* coupon, not as referral-specific plumbing — and, since a booking only ever has one coupon-code field, it turns out to only matter for the `fixed_discount` reward kind, not for `percent_discount` (see §3), which lets it be deferred to its own late slice.

Two smaller ideas were flagged by only one judge; both are adopted here because each closes a gap the base design admits to itself, not because of the judge's confidence:
- **A currency-dimensioned wallet** (`wallet_balances`/`wallet_transactions` carry `currency IN ('toman','points')` instead of a toman-only ledger) — grafted by Judge 2 to close a gap Judge 2 found in risk-first itself: `loyalty_points_granted` was recorded on `referral_rewards` with no balance table to accumulate into or read back from. Without this, `loyalty_points` is a listed-but-broken reward kind.
- **A grant hold-back buffer** for the `first_paid_booking` trigger — from the minimal-extend design, grafted by Judge 1. It's a cheap complement to (not a replacement for) the reversal path: fewer "pay, get rewarded, immediately refund" cycles ever reach the reversal machinery in the first place. (Window length set by product decision below.)

A third graft — **per-role referral codes** (up to two/three codes per person, one per role) — was proposed by the event-driven design and picked up by Judge 2 to remove an ambiguity in risk-first's edge case #6 (a departed worker's code can't be distinguished from an active one). **Product overrode this graft** (see Decision 3 below): this document ships **one lifetime code per person**, and resolves the reward tier dynamically from the referrer's current role at redemption time instead. The ambiguity Judge 2 was closing is absorbed into that dynamic resolution instead (see Decision 3 and Decision 9).

---

## Product decisions (confirmed 2026-07-21)

Every open question from the design review has been decided. Recorded here as the source of truth for implementation — supersedes anything above that reads as still-open.

1. **Reward amounts stay placeholders for now.** `referral_reward_types` ships all three rows `enabled = false` with zero-value reward fields, exactly as designed — real toman/percent/point values and per-type max-reward caps are an admin-panel data-entry task after slice 4 ships, not a schema change. No design impact.
2. **No worker SMS invite flow for now.** Confirmed out of scope for this rollout; kept as a tracked backlog item in §9 ("Suggested Improvements") so it isn't lost — revisit when there's a concrete need for a real invite UX. `findOrCreateByPhone`-on-add stays the only mechanism.
3. **One lifetime referral code per person — not per-role.** Overrides the per-role-codes graft described above. Every user gets exactly one code, minted once, on their `users` row. Consequence: `referral_type` (which reward tier applies) is no longer fixed at code-mint time — it is resolved **dynamically, at redemption time** (when someone registers using the code), from the referrer's role *at that moment*: active `worker` row → `worker`; else owns a salon → `salon_owner`; else → `user`. This is the one place this document knowingly accepts the exact risk Judge 2 flagged against the minimal-extend design ("the same code could pay a different reward months later if the referrer's role changed") — accepted here as a deliberate simplicity trade, not an oversight. Once a referral redeems, R5 still applies unchanged: the resolved type's terms are snapshotted onto the `referrals` row and never re-read live again. See the updated §1/§2/§5 below for the schema and rule consequences.
4. **Grant hold-back window: 72 hours** (was proposed at 48h). Applies only to `qualifying_event = 'first_paid_booking'`.
5. **Review edit/delete window: 72 hours** (was proposed at 48h). Editing is allowed within the window (majority reading confirmed, not reopened).
6. **Worker rating shape confirmed as designed** — new `worker_ratings` table, submitted atomically with the salon review through the existing `POST /api/reviews` call.
7. **`fixed_discount` confirmed out of v1's core rollout, but committed as an immediate follow-on, not indefinite backlog.** Slice 6 (§2, §10) changes from "optional, gated on approval" to **committed — ships as the very next slice after the slice 1–5 core rollout ("phase 1") is live**, not deferred alongside the true backlog items in §9.
8. **No retroactive clawback for an already-redeemed discount reward — confirmed acceptable for v1**, as designed (§6, edge case 2).
9. **Confirmed acceptable, but the mechanism changes as a consequence of Decision 3.** With per-role codes, "departing a worker disables their worker-kind code" was a distinct action on a distinct row. With one lifetime code (Decision 3), there is no separate worker-kind code to disable — a deactivated worker's single code simply resolves to `'user'` (or `'salon_owner'`, if applicable) for any *new* redemptions from the moment they're deactivated onward, automatically, via the same dynamic role lookup in Decision 3. No `disabled_at` flip, no extra code path. Already-redeemed referrals keep their snapshot regardless (R5) — unaffected either way.
10. **Multi-level referrals confirmed out of scope for slice 1** — unanimous across all three proposals, both judges, and product. No design impact.

---

## 1. Overall Architecture

Three new domain modules, matching the existing `src/<domain>/` per-module convention:

```
src/wallet/      -- append-only ledger (wallet_balances cache + wallet_transactions),
                    WalletService.credit()/debit() (row-locked, never-negative),
                    wallet.controller.ts (GET /wallet/mine[/transactions]),
                    admin-wallet.controller.ts (search + manual adjustment)
src/workers/      -- Worker roster entity, provider-facing CRUD (salons/mine/workers),
                    public read (salons/:slug/workers), booking-assign-worker extension
src/referrals/     -- ReferralCode, ReferralRewardType, Referral, ReferralReward entities;
                    code issuance/validation, redemption at registration, grant (tryGrantReward)
                    + reversal (reverseIfNeeded) transactions, admin config/tracking
```

`ratings` is **not** a fourth module — worker ratings live inside the existing `reviews/` module (extended, not duplicated) per Open Question 6.

### Worker

A `Worker` is a **salon roster row backed by a real `User`** (`workers.user_id NOT NULL UNIQUE`, created via `findOrCreateByPhone` if the phone isn't already a user — the same lazy-creation idiom already used for OTP signup, not a new auth surface). A worker:
- belongs to exactly one salon at a time (`workers.salon_id NOT NULL`) — no multi-salon staffing, matching this codebase's existing "one salon per owner" simplicity;
- is never the same person as that salon's owner (`workers.user_id != salon.owner_id`, enforced at creation);
- is soft-deactivated (`active boolean`), never hard-deleted — `bookings.worker_id`, `worker_ratings`, and `referral_codes` (worker-kind) all need to keep resolving to a real historical row after someone leaves.

`bookings.worker_id` (new, nullable) records which worker performed the service — required for both worker rating and worker-referral attribution. Nullable because solo owner-operated salons will simply never populate it, which is correct behavior, not a gap.

### Rating

**Salon rating: the existing `Review` entity, columns unchanged.** It already is the rating-history table the brief asks for (`rating` 1–5, one row per completed booking via `reviews_booking_uidx`, `salons.rating_avg`/`rating_count` recomputed transactionally). No schema change.

**Worker rating: a new, separate `worker_ratings` table**, not a `Review` extension — a booking has zero-or-one worker, so folding worker rating into `Review` would mean two permanently-null columns on every non-worker booking, and it would conflate two different moderation surfaces (a salon's public reply to a customer, versus a stylist's individual conduct record). Kept structurally identical to `Review` (own `status`, own recompute-under-lock aggregate on `workers.rating_avg`/`rating_count`) — consistency of *mechanism*, not consistency of table.

**Submission stays one customer-facing action.** `POST /api/reviews` (existing endpoint, extended) optionally accepts a `workerRating` alongside the salon `rating`; when present, `ReviewsService.create()` inserts both the `Review` row and the linked `worker_ratings` row in the same transaction, and `PATCH`/`DELETE /api/reviews/:id` cascades to the linked worker-rating row within the same edit window. This is the one place this design deliberately extends working `reviews.controller.ts`/`reviews.service.ts` logic (not schema) — flagged per Open Question 5/6, not silently done.

### Referral

Reward *terms* are always snapshotted onto the `referrals` row at redemption time and never re-read live at grant time (mirrors this codebase's existing `booking.price_snapshot` idiom for "terms that must not silently drift").

Reward *type* (`referral_type`) works differently from the design's original proposal, per Product Decision 3: there is **one lifetime referral code per person** (`referral_codes.owner_user_id UNIQUE`, minted once, never reissued), not one code per role. `referral_type` is resolved **dynamically, at the moment a code is redeemed** (i.e. when someone registers using it) — not fixed at code-minting time — by inspecting the referrer's role *at that instant*: an active `workers` row → `'worker'`; else an owned salon → `'salon_owner'`; else → `'user'`. That resolved value is then snapshotted onto `referrals.referral_type` exactly like every other term (R5) and never re-derived again after that point — only the *initial* resolution is dynamic, not the ongoing state. This deliberately accepts the exact risk Judge 2 raised against the minimal-extend design (the same code paying a different tier if shared twice months apart, once before and once after a role change) as a simplicity trade-off, not an oversight.

Discount-type rewards are delivered as **literal rows in the existing `coupons` table** (Open Question resolved above, "Where the judges disagreed" #2) — not a parallel grants table. Wallet-type rewards (`wallet_credit`, `cashback`, `loyalty_points`) are pure `wallet_transactions` inserts. Consequence: "what did this referral produce" is always fully reconstructable as *the `wallet_transactions` row(s) with `reference_type='referral_reward'` plus the `coupons` row with `issued_to_user_id` set*, with no separate reward-ledger table needed beyond `referral_rewards` itself (which exists purely as the exactly-once backstop and reversal-tracking row, not as a payout record).

---

## 2. Database Schema

House style throughout: snake_case columns, explicit `ON DELETE`, inline CHECK constraints, no relation decorators (manual FK columns only). Migrations must postdate `1752900000000` (the latest in-repo migration); slice-numbered below at `100000000`-second spacing matching the existing convention.

### Slice 1 — `1753000000000-workers-and-worker-ratings.ts`

```sql
CREATE TABLE workers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id      uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name          varchar(120) NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  rating_avg    numeric(3,2) NOT NULL DEFAULT 0,
  rating_count  int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX workers_salon_user_uidx ON workers(salon_id, user_id);
CREATE INDEX workers_salon_active_idx ON workers(salon_id, active);

ALTER TABLE bookings ADD COLUMN worker_id uuid NULL REFERENCES workers(id) ON DELETE SET NULL;
CREATE INDEX bookings_worker_idx ON bookings(worker_id) WHERE worker_id IS NOT NULL;

CREATE TABLE worker_ratings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id     uuid NOT NULL UNIQUE REFERENCES reviews(id) ON DELETE CASCADE,
  booking_id    uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  worker_id     uuid NOT NULL REFERENCES workers(id) ON DELETE RESTRICT,
  salon_id      uuid NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rating        int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  status        varchar(20) NOT NULL DEFAULT 'published' CHECK (status IN ('published','rejected')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX worker_ratings_worker_status_idx ON worker_ratings(worker_id, status);

INSERT INTO platform_config (key, value) VALUES ('review_edit_window_hours', '72');
```

`worker_ratings.review_id UNIQUE` (not `booking_id UNIQUE`) is the deliberate lifecycle anchor — one worker rating per `Review` row, inheriting `reviews_booking_uidx`'s one-per-booking guarantee transitively rather than re-deriving it. `booking_id`/`salon_id`/`user_id` are denormalized copies (same rationale as `reviews.salon_id`) purely for query convenience — the row's edit/delete lifecycle is always driven through the parent `Review`, never independently. `ON DELETE RESTRICT` everywhere except `worker_id`'s implicit path (a worker is soft-deactivated, never deleted) and `review_id` (`CASCADE` — a review deletion in this codebase is itself a soft `status→'withdrawn'` flip, so this only fires on a genuine hard delete, which doesn't happen today; defensive only).

`workers.rating_avg`/`rating_count` recomputed exactly like `ReviewsService.recomputeSalonRating`: transaction, `SELECT ... FOR UPDATE` on the `workers` row, `SELECT COALESCE(AVG(rating),0)::numeric(3,2), COUNT(*) FROM worker_ratings WHERE worker_id=$1 AND status='published'`, then `UPDATE`.

### Slice 2 — `1753100000000-wallet-ledger.ts`

```sql
CREATE TABLE wallet_balances (
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  currency      varchar(10) NOT NULL DEFAULT 'toman' CHECK (currency IN ('toman','points')),
  balance       bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, currency)
);

CREATE TABLE wallet_transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  currency          varchar(10) NOT NULL DEFAULT 'toman' CHECK (currency IN ('toman','points')),
  amount            bigint NOT NULL CHECK (amount <> 0),   -- signed: +credit / -debit
  balance_after     bigint NOT NULL,                        -- snapshot, computed inside the same locked tx
  type              varchar(30) NOT NULL CHECK (type IN (
                       'referral_reward','referral_reversal','admin_adjustment'
                     )),
  reference_type    varchar(30) NULL,                        -- 'referral_reward' when applicable
  reference_id      uuid NULL,                                -- referral_rewards.id
  reason            text NULL,                                -- required app-side for admin_adjustment
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallet_transactions_user_idx ON wallet_transactions(user_id, currency, created_at DESC);
CREATE INDEX wallet_transactions_reference_idx ON wallet_transactions(reference_type, reference_id)
  WHERE reference_id IS NOT NULL;
```

**No mutable balance column on `users`, ever.** `wallet_balances` is a read-optimized cache, written **only** inside the same locked transaction as the `wallet_transactions` row that produced it — exactly this codebase's existing "denormalize but recompute-under-lock" discipline already proven by `salons.rating_avg`. `CHECK (balance >= 0)` is the final backstop: any debit that would take a balance negative is capped at the available amount (§6). `reference_id` is intentionally not FK-constrained (points at `referral_rewards` today, may point elsewhere later) — matches this codebase's existing manual-FK-column convention for a genuinely polymorphic case.

### Slice 3 — `1753200000000-referral-codes-and-tracking.ts`

```sql
-- One lifetime code per person (Product Decision 3 -- overrides this design's original
-- per-role-code proposal). owner_kind/owner_worker_id are gone: a code has exactly one
-- owner (a User, full stop), and which reward tier it resolves to at redemption time is
-- computed dynamically from the referrer's role at that moment (see referrals.referral_type
-- below), not fixed on this row.
CREATE TABLE referral_codes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              varchar(20) NOT NULL UNIQUE,
  owner_user_id     uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  disabled_at       timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX referral_codes_code_idx ON referral_codes(code) WHERE disabled_at IS NULL;

CREATE TABLE referral_reward_types (
  referral_type               varchar(20) PRIMARY KEY CHECK (referral_type IN ('user','salon_owner','worker')),
  enabled                      boolean NOT NULL DEFAULT false,
  referrer_reward_kind         varchar(20) NOT NULL CHECK (referrer_reward_kind IN
                                ('wallet_credit','percent_discount','fixed_discount','cashback','loyalty_points')),
  referrer_reward_value        numeric(12,2) NOT NULL DEFAULT 0,
  referrer_reward_max          numeric(12,2) NULL,
  referred_reward_kind         varchar(20) NOT NULL CHECK (referred_reward_kind IN
                                ('wallet_credit','percent_discount','fixed_discount','cashback','loyalty_points')),
  referred_reward_value        numeric(12,2) NOT NULL DEFAULT 0,
  referred_reward_max          numeric(12,2) NULL,
  qualifying_event             varchar(30) NOT NULL DEFAULT 'first_paid_booking'
                                CHECK (qualifying_event IN ('first_completed_booking','first_paid_booking')),
  grant_holdback_hours         int NOT NULL DEFAULT 72,   -- consulted only when qualifying_event = 'first_paid_booking'
  expiration_days              int NULL,                   -- NULL = referral never expires while awaiting the event
  max_referrals_per_referrer   int NULL,
  updated_at                   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO referral_reward_types (referral_type, referrer_reward_kind, referred_reward_kind) VALUES
  ('user',        'wallet_credit', 'percent_discount'),
  ('salon_owner', 'wallet_credit', 'percent_discount'),
  ('worker',      'wallet_credit', 'percent_discount');

CREATE TABLE referrals (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code_id                uuid NOT NULL REFERENCES referral_codes(id) ON DELETE RESTRICT,
  referrer_user_id                uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  referred_user_id                uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  referral_type                   varchar(20) NOT NULL CHECK (referral_type IN ('user','salon_owner','worker')),
  salon_id                        uuid NULL REFERENCES salons(id) ON DELETE SET NULL,   -- salon_owner/worker types only
  -- reward terms + grant policy SNAPSHOTTED at redemption (registration) time -- see R5
  referrer_reward_kind             varchar(20) NOT NULL,
  referrer_reward_value            numeric(12,2) NOT NULL,
  referrer_reward_max              numeric(12,2) NULL,
  referred_reward_kind             varchar(20) NOT NULL,
  referred_reward_value            numeric(12,2) NOT NULL,
  referred_reward_max              numeric(12,2) NULL,
  qualifying_event                 varchar(30) NOT NULL,
  grant_holdback_hours             int NOT NULL,
  status                           varchar(30) NOT NULL DEFAULT 'awaiting_qualifying_event'
                                    CHECK (status IN ('awaiting_qualifying_event','reward_granted','expired','cancelled')),
  qualifying_booking_id            uuid NULL REFERENCES bookings(id) ON DELETE SET NULL,
  reward_granted_at                timestamptz NULL,
  expires_at                       timestamptz NULL,
  cancelled_reason                 text NULL,
  created_at                       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX referrals_referrer_idx ON referrals(referrer_user_id, status);
CREATE INDEX referrals_status_expiry_idx ON referrals(status, expires_at) WHERE status = 'awaiting_qualifying_event';
CREATE INDEX referrals_code_idx ON referrals(referral_code_id);
```

`referred_user_id UNIQUE` is the load-bearing constraint of the entire design: one row per referred user, ever — the DB-level enforcement of "a code is usable only at registration." `referral_type` is computed once, at this row's creation, by looking up the referrer's role at that instant (active `workers` row → `worker`; else owns a salon → `salon_owner`; else → `user`) — never re-derived after that (Product Decision 3).

### Slice 4 — `1753300000000-referral-reward-granting.ts`

```sql
CREATE TABLE referral_rewards (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id                 uuid NOT NULL REFERENCES referrals(id) ON DELETE RESTRICT,
  beneficiary_user_id         uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  beneficiary_role            varchar(10) NOT NULL CHECK (beneficiary_role IN ('referrer','referred')),
  reward_kind                 varchar(20) NOT NULL,
  reward_value                 numeric(12,2) NOT NULL,      -- resolved & capped absolute value at grant time
  wallet_transaction_id       uuid NULL REFERENCES wallet_transactions(id) ON DELETE RESTRICT,
  coupon_id                   uuid NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  status                      varchar(20) NOT NULL DEFAULT 'granted' CHECK (status IN ('granted','reversed')),
  granted_at                   timestamptz NOT NULL DEFAULT now(),
  reversed_at                  timestamptz NULL,
  reversal_reason              text NULL,
  reversal_shortfall_amount    numeric(12,2) NULL
);
CREATE UNIQUE INDEX referral_rewards_referral_role_uidx ON referral_rewards(referral_id, beneficiary_role);
```

`coupon_id` points **directly** at `coupons.id` — one FK, one direction, no reverse column on `coupons` pointing back (the event-driven proposal's redundant FK pair, flagged by both judges, is avoided by construction here). `UNIQUE(referral_id, beneficiary_role)` is the second, DB-enforced, transaction-independent exactly-once backstop (§7).

### Slice 5 — `1753400000000-referral-discount-coupons.ts`

```sql
ALTER TABLE coupons ADD COLUMN issued_to_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX coupons_issued_to_user_idx ON coupons(issued_to_user_id) WHERE issued_to_user_id IS NOT NULL;
```

One column. `coupons.is_active` (existing) is reused as the void mechanism for an unredeemed reversed reward (§6) — no new column needed for that.

### Slice 6 (committed — ships immediately after the slice 1–5 core rollout, Product Decision 7) — `fixed-amount-discount-support.ts`

```sql
ALTER TABLE coupons ADD COLUMN discount_fixed_amount bigint NULL CHECK (discount_fixed_amount IS NULL OR discount_fixed_amount > 0);
ALTER TABLE coupons ALTER COLUMN discount_percent DROP NOT NULL;
ALTER TABLE coupons ADD CONSTRAINT coupons_discount_shape_chk
  CHECK ((discount_percent IS NOT NULL) <> (discount_fixed_amount IS NOT NULL));
```

Not part of the slice-1-through-5 "phase 1" rollout, but not backlog either — see §3 and §10 for why it's still isolated into its own slice (it's the one piece that touches tested, working `discount.util.ts` logic) even though it's firmly scheduled, not optional.

---

## 3. Entity Relationships

```
User ──0..1──> ReferralCode        (one lifetime code per person, Product Decision 3 — no per-role split)
User ──0..1──> Worker              (workers.user_id UNIQUE — a user is staff at, at most, one salon)
Salon ──1:N──> Worker
Booking ──0:1──> Worker            (bookings.worker_id, nullable)
Booking ──0:1──> Review            (existing, unchanged — one per completed booking)
Review ──0:1──> WorkerRating       (worker_ratings.review_id UNIQUE — only when booking had a worker)
User(referred) ──1:1──> Referral   (referred_user_id UNIQUE — a user is referred at most once, ever)
User(referrer) ──1:N──> Referral
Referral ──N:1──> ReferralCode
Referral ──1:0..2──> ReferralReward         (beneficiary_role='referrer' | 'referred', exactly-once each)
ReferralReward ──0:1──> WalletTransaction   (reward_kind ∈ {wallet_credit, cashback, loyalty_points})
ReferralReward ──0:1──> Coupon              (reward_kind ∈ {percent_discount, fixed_discount})
Referral ──0:1──> Booking          (qualifying_booking_id)
User ──1:1──> WalletBalance (per currency)
User ──1:N──> WalletTransaction
```

### Referral discount vs. coupon-code discount — one mechanism, not two

A `percent_discount`/`fixed_discount` referral reward **is** a coupon. Granting it inserts one row into the existing `coupons` table:
- `code`: system-generated, `REF-`-prefixed for support/admin recognizability, collision-retried against `coupons.code UNIQUE` (same defensive pattern already used for coupon code generation).
- `salon_id`: `NULL` (platform-wide) for `user`-type referrals; the referring salon's id for `salon_owner`/`worker`-type referrals.
- `discount_percent`: the resolved, capped value from `referral_rewards.reward_value`.
- `issued_to_user_id`: the referred user's id — the **one** behavioral addition `CouponsService.resolveAndValidate()` needs: reject (same 404 already used for "doesn't exist") unless `coupon.issuedToUserId === null || coupon.issuedToUserId === userId`.
- `max_redemptions`: `1` (belt-and-suspenders on top of `coupon_redemptions`' own uniqueness).
- `expires_at`: the referral's own `expires_at`, or a fixed post-grant redemption window (config-driven, TBD with Open Question 1).

Everything downstream — `resolveDiscountPercent`/`applyDiscount`'s best-single-percent-wins, no-stacking rule, `coupon_redemptions UNIQUE(coupon_id, user_id)` plus `booking_id UNIQUE`, the `isUniqueViolation`-catch pattern — is **reused verbatim**. Because a booking only ever has one coupon-code input field, a referral-issued coupon and a manually-entered coupon code can never both be "in play" for the same booking simultaneously; `resolveDiscountPercent(serviceDiscountPercent, couponDiscountPercent)` needs **zero changes** for `percent_discount` rewards — the referral coupon is just whichever coupon the user happened to enter.

**`fixed_discount` is the one reward kind that genuinely requires touching `discount.util.ts`.** Today `coupons.discount_percent` is percent-only; a fixed-toman reward needs a `discount_fixed_amount` column (slice 6) and `applyDiscount` needs a second branch. Because percent and a fixed toman amount aren't directly comparable, resolving "does the service discount or the coupon win" has to compare **resulting prices**, not raw percentages:

```ts
// Only touched if slice 6 ships (fixed_discount reward kind approved — Open Question 7).
function resolveBestPrice(price: number, candidates: Array<{ kind: 'percent' | 'fixed'; value: number } | null>): number {
  let best = price;
  for (const c of candidates) {
    if (!c) continue;
    const candidatePrice = c.kind === 'percent'
      ? Math.round((price * (100 - c.value)) / 100)
      : Math.max(0, price - c.value);
    if (candidatePrice < best) best = candidatePrice;
  }
  return best;
}
```

This is a real, disclosed extension to tested payment-adjacent code — which is exactly why it's isolated to its own slice (§10) rather than bundled into the discount-coupon slice that ships `percent_discount` rewards.

**Wallet credit is not spendable at checkout in this design.** `wallet_credit`/`cashback`/`loyalty_points` rewards only ever increase a balance; there is no wallet-as-payment-method integration here (§9 — future work). No overlap with the coupon system at all.

---

## 4. API Endpoints

Admin routes: `@UseGuards(AuthGuard, RolesGuard) @Roles('admin')`, mutations individually `@AuditAction(...)` + `@UseInterceptors(AuditInterceptor)`. Customer routes: `@UseGuards(AuthGuard)`. Provider worker-roster routes: `@UseGuards(AuthGuard, SalonOwnerGuard)`.

### Referral
| Method | Path | Guard | Notes |
|---|---|---|---|
| `GET` | `/api/referrals/my-code` | Auth | Lazily mints the caller's one lifetime code on first call if missing. Returns `{code, isActive, shareUrl}` — no `ownerKind`, since the resolved reward tier is computed at redemption time from the referrer's role then, not stored on the code (Product Decision 3) |
| `GET` | `/api/referrals/validate?code=` | public | `{valid: boolean}` only — no owner identity leaked |
| `GET` | `/api/referrals/mine` | Auth | Paginated, as referrer: `{referredUserPhoneMasked, status, referralType, createdAt, rewardGrantedAt}` |
| `GET` | `/api/referrals/mine/rewards` | Auth | My `referral_rewards` rows, either role, with resulting wallet delta or coupon code |
| — | (extends `POST /api/auth/verify-otp`) | public | `VerifyOtpDto` gains optional `referralCode?`, read only on the `isNew` branch of `findOrCreateByPhone`. Response gains `referralStatus?: 'applied' \| 'invalid_code' \| 'referral_type_disabled'` — **registration never fails because of a referral-code problem** |
| `GET` | `/api/salons/mine/workers/:id/referral-code` | Auth+SalonOwnerGuard | Owner fetches the worker's (lifetime, personal) code to relay to them out of band, in case the worker hasn't logged in yet to see it themselves |

### Wallet
| Method | Path | Guard | Notes |
|---|---|---|---|
| `GET` | `/api/wallet/mine` | Auth | `{balances: [{currency, balance}]}` |
| `GET` | `/api/wallet/mine/transactions` | Auth | Paginated, own rows only |

### Worker roster (provider-panel)
| Method | Path | Guard | Notes |
|---|---|---|---|
| `POST` | `/api/salons/mine/workers` | Auth+SalonOwnerGuard | `{name, phone}` — resolves/creates the `User` via `findOrCreateByPhone`; 400 if `phone` resolves to the salon's own owner |
| `GET` | `/api/salons/mine/workers` | Auth+SalonOwnerGuard | List incl. inactive, with `ratingAvg`/`ratingCount` |
| `PATCH` | `/api/salons/mine/workers/:id` | Auth+SalonOwnerGuard | `{name?, active?}` — `active: false` is the "worker leaves" path; also disables their referral code (Open Question 9) |
| `PATCH` | `/api/salons/mine/bookings/:id/assign-worker` | Auth+SalonOwnerGuard | `{workerId}` — must belong to the same salon, `active=true` |

### Rating
| Method | Path | Guard | Notes |
|---|---|---|---|
| `POST` | `/api/reviews` | Auth (existing, extended) | `CreateReviewDto` gains optional `workerRating` (1–5) — required iff `booking.workerId` is set, rejected otherwise. Creates `Review` + `worker_ratings` in one transaction |
| `PATCH` | `/api/reviews/:id` | Auth, owner, within edit window | NEW — recomputes salon (and worker, if linked) aggregates |
| `DELETE` | `/api/reviews/:id` | Auth, owner, within edit window | NEW — soft `status→'withdrawn'`; booking permanently ineligible for a new review |
| `GET` | `/api/salons/:slug/workers` | public | Active workers with `ratingAvg`/`ratingCount`, approved-salon-gated |
| `GET` | `/api/salons/:slug/workers/:id/ratings` | public | Paginated, `status='published'` only |
| `PATCH` | `/api/admin/worker-ratings/:id/status` | admin | Publish/reject, mirrors the existing review-moderation endpoint |

### Admin — referral config & oversight
| Method | Path | Guard | Notes |
|---|---|---|---|
| `GET` | `/api/admin/referral-reward-types` | admin | List the 3 fixed rows |
| `PATCH` | `/api/admin/referral-reward-types/:type` | admin | `type ∈ {user,salon_owner,worker}` — `@AuditAction('referral-reward-type.update', 'referral-reward-type')` |
| `GET` | `/api/admin/referrals` | admin | Filter by `status`/`referralType`/`referrerPhone`, paginated — fraud-review surface |
| `PATCH` | `/api/admin/referrals/:id/cancel` | admin | Body `{reason}` — only from `awaiting_qualifying_event`; 409 otherwise |
| `GET` | `/api/admin/wallet/transactions` | admin | Global ledger search by user/type/date range |
| `POST` | `/api/admin/wallet/adjust` | admin | `{userId, amount, currency, reason}` — `reason` mandatory, audited, routes through the same locked-transaction ledger insert as every other wallet write |

---

## 5. Business Rules

- **R1 — One lifetime referral code per person, lazily minted on first request, never reissued** (Product Decision 3). `referral_type` for a given redemption is computed *once*, at the moment that redemption happens, from the referrer's role at that instant (worker → salon_owner → user precedence) — then frozen onto that `referrals` row forever (R5). The code itself carries no role/kind — the same code can resolve to a different tier on two different redemptions if the referrer's role changed in between; accepted as a deliberate simplicity trade-off, not re-derived retroactively for referrals already created.
- **R2 — Code usable only at registration.** Only read on the `isNew=true` branch of `findOrCreateByPhone` — structurally unavailable to an already-existing account, so there is no separate runtime "already registered" check to get wrong.
- **R3 — No self-referral in the direct sense** (the referred user doesn't exist yet at code-entry time, so they cannot be the code's owner). The real residual risk is duplicate-account fraud — a fraud-review concern (§7), not a hard constraint.
- **R4 — Reward granted exactly once, only after the referral's configured qualifying event fires**, never at registration. `referrals.status` starts at `awaiting_qualifying_event`; only a successful `tryGrantReward` transaction (§7) moves it to `reward_granted`.
- **R5 — Reward terms, qualifying event, and grant hold-back are all snapshotted onto the `referrals` row at redemption time**, never re-read live from `referral_reward_types` at grant time. An admin changing config only affects referrals created after the change.
- **R6 — Qualifying event is `first_completed_booking` or `first_paid_booking`, admin-configurable per referral type.** For `salon_owner`/`worker` types the qualifying booking must be at the referring salon (`booking.salon_id = referrals.salon_id`); for `user`-type referrals it may be at any salon on the platform.
- **R7 — For `first_paid_booking`, the grant additionally requires the triggering payment event to be at least `grant_holdback_hours` old** (default 72h) before `tryGrantReward` will act on it — closes the cheap "pay, get rewarded, immediately refund" loop before it ever reaches the reversal machinery. Not applicable to `first_completed_booking` (a completed booking is terminal in this codebase's state machine).
- **R8 — A referred user's discount reward can only ever apply to their *next* booking, never the qualifying one** — the reward doesn't exist yet at the qualifying booking's checkout time. It's issued as an ordinary coupon usable on any subsequent booking before it expires.
- **R9 — One completed booking allows at most one `Review` and at most one `worker_ratings` row**, submitted together, enforced by `reviews_booking_uidx` (existing) and `worker_ratings.review_id UNIQUE` respectively.
- **R10 — `max_referrals_per_referrer` (if set) is enforced inside the same row-locked transaction that increments the referrer's wallet** (§7) — never a separate, race-prone pre-check.
- **R11 — Wallet balance is never negative.** Every debit (a reversal clawback; any future spend feature) is capped at the available balance; a shortfall is recorded on `referral_rewards.reversal_shortfall_amount`, never silently absorbed.
- **R12 — All three referral types default `enabled=false`.** Nothing pays out until an admin explicitly configures real reward values and turns a type on (Open Question 1).
- **R13 — Disabling a referral type blocks new redemptions only** — already-`awaiting_qualifying_event` referrals of that type still resolve normally per their snapshot.

---

## 6. Edge Cases

| Scenario | Resolution |
|---|---|
| Qualifying booking later cancelled/refunded, reward **not yet** granted | For `first_completed_booking`: structurally can't happen (completed is terminal). For `first_paid_booking`: the hold-back buffer (R7) already screens out the fast case; `tryGrantReward` additionally re-checks the payment is still `'paid'` (not `refund_pending`/`refunded`) at grant time — if it's moved, the grant simply doesn't fire and the referral stays `awaiting_qualifying_event` until it naturally expires. |
| Qualifying booking's payment is refunded **after** the reward was already granted | `reverseIfNeeded(paymentId)` (called from the cancel path, the expiry job, and refund reconciliation — wherever a payment tied to a `referrals.qualifying_booking_id` transitions to `refunded`) reverses each associated `referral_rewards` row: wallet-kind rewards get an offsetting negative `wallet_transactions` row **capped at available balance** (R11); any shortfall is written to `reversal_shortfall_amount` and raised through the existing `AlertsService.raise()` at `critical` severity (key `referral-reward-shortfall:<rewardId>`), the same pattern already used for stuck refunds. Discount-kind rewards: if the coupon is still **unredeemed** (`coupon_redemptions` has no row for it), it's voided in place (`coupons.is_active = false`) — cheap, uses an existing column, no schema addition. If it's already been redeemed on a distinct, completed booking, it is **not** reversible (Open Question 8) — flagged, not solved. |
| Referred user never completes a qualifying action | Sits at `awaiting_qualifying_event` until `expires_at` (from the snapshotted `expiration_days`, or never if that was left null). An hourly cron (mirroring the existing story-cleanup cron's shape) sweeps `expires_at < now() AND status='awaiting_qualifying_event' → 'expired'`. |
| Code entered, referrer later suspended | Reward still grants normally when the qualifying event fires — R5 doesn't depend on the referrer's live status. The credit lands in a suspended user's wallet; they simply can't act on it while suspended, same as every other suspended-user restriction already in the system. |
| Referrer account hard-deleted | Not possible today (users are only suspended, never hard-deleted) — every FK to `users` in this schema uses `ON DELETE RESTRICT`, formalizing that existing invariant rather than introducing a new one. |
| Worker referral, worker later deactivated | No explicit disable action exists or is needed (Product Decision 9, superseding the design's original per-role-code proposal): the worker's one lifetime code keeps working, but since `referral_type` resolves dynamically at *redemption* time (R1), any *new* redemption of that code after deactivation resolves to `'user'` (or `'salon_owner'`, if applicable) instead of `'worker'` — automatically, with zero extra code path. Already-`awaiting_qualifying_event` or already-`reward_granted` referrals from before the deactivation are unaffected either way (terms were snapshotted at redemption, R5); the wallet credit always routes to the worker's own `User` row regardless of current employment status. |
| Concurrent qualifying-event triggers (webhook retry, cron + inline hook racing) | Row-lock + conditional-update, see §7. Second attempt is a guaranteed no-op. |
| Reward config changed mid-flight | No effect on already-redeemed referrals (R5); only referrals created after the change see new terms. |
| A user redeems a second code after already having one on file | Blocked by `referrals.referred_user_id UNIQUE` even if an app-layer pre-check races — surfaces as a clean `409`. |
| Admin manually cancels a referral that's already `reward_granted` | Not permitted — `PATCH /admin/referrals/:id/cancel` only accepts `awaiting_qualifying_event` as its source state (400/409 otherwise); once granted, money/coupons are out the door and cancellation would be misleading without an actual reversal trigger (the payment-refund-driven path above is the only way money comes back). |
| A referral discount coupon expires before the referee ever applies it | Expires exactly like any other coupon (`coupons.expires_at`, checked live inside the booking transaction, not at page-load) — tracked independently of the referral's own `status`, which already flipped to `reward_granted` at issuance, not at redemption. |

---

## 7. Security Considerations

**Self-referral.** Structurally impossible in the literal sense (§5 R3). The real vector is duplicate-account fraud — one person controlling two phone numbers to farm the referrer reward. This codebase has no email, no device fingerprinting, and no request-metadata capture in `auth/` today (confirmed by research) — this design does **not** invent a KYC or fingerprinting system to compensate. Instead:
- **Economic friction as the primary defense**: `qualifying_event` defaults to `first_paid_booking` (Open Question 4) rather than a free action — abusing the system costs the attacker a real deposit per fake account.
- **`max_referrals_per_referrer`** (R10), admin-tunable, defaults conservatively low.
- **The existing Redis-backed rate limiter** (already gating OTP requests per CLAUDE.md) is reused, keyed by IP, on both `POST /auth/verify-otp` (already rate-limited) and `GET /api/referrals/validate` (new — cheap to enumerate otherwise).
- **Admin fraud-review queue, not automated blocking** — `GET /api/admin/referrals` sorted/filterable by referrer and velocity, with manual `cancel`. This matches this codebase's existing preference for reactive moderation (reviews, blog posts, reports) over pre-publish/pre-approval gates; a false-positive auto-block would be a worse failure mode than a human catching an outlier later.

**Race-safety of reward granting — concrete DB mechanism**, the same lock-then-check-then-write shape already proven by `ReviewsService.recomputeSalonRating` and `CouponsService`'s redemption path:

```ts
async tryGrantReward(referredUserId: string, triggeringBookingId: string, eventType: 'completed' | 'paid') {
  await this.dataSource.transaction(async (em) => {
    const referral = await em.query(
      `SELECT * FROM referrals WHERE referred_user_id = $1 FOR UPDATE`, [referredUserId],
    );
    if (!referral) return;                                          // never referred — no-op
    if (referral.status !== 'awaiting_qualifying_event') return;     // already resolved — idempotent no-op
    if (referral.qualifying_event !== mapEventType(eventType)) return;
    if (referral.expires_at && referral.expires_at < new Date()) return;  // let the cron flip it to expired
    if (referral.qualifying_event === 'first_paid_booking') {
      const eventAge = await this.paymentEventAge(triggeringBookingId, em);
      if (eventAge < referral.grant_holdback_hours * 3600_000) return;   // R7 — too soon, try again next pass
    }
    // also row-lock the referrer's row here before writing wallet_balances, so a
    // referrer being credited by two different concurrent referrals serializes too
    await em.query(`SELECT id FROM wallet_balances WHERE user_id = $1 FOR UPDATE`, [referral.referrer_user_id]);

    // ... insert referral_rewards (x2), wallet_transactions / coupon rows, all in this same transaction ...

    const result = await em.query(
      `UPDATE referrals SET status='reward_granted', reward_granted_at=now(), qualifying_booking_id=$2
       WHERE id=$1 AND status='awaiting_qualifying_event'`,
      [referral.id, triggeringBookingId],
    );
    if (result.affected === 0) throw new Error('rollback: lost the race');  // belt-and-suspenders
  });
}
```

1. `SELECT ... FOR UPDATE` on the single `referrals` row (found via `referred_user_id UNIQUE`) is the actual serialization point.
2. The conditional `UPDATE ... WHERE status='awaiting_qualifying_event'` is defense-in-depth inside the same transaction, matching this codebase's own conditional-update idiom (used for the blog CMS's publish workflow).
3. **`referral_rewards_referral_role_uidx UNIQUE(referral_id, beneficiary_role)`** is the third, DB-enforced, transaction-independent backstop — even a retried background job hitting this path from two non-overlapping transactions can't produce two reward rows for the same referral+role; the second insert 23505s, caught via `isUniqueViolation` and treated as an idempotent success, exactly like `CouponsService`'s own redemption-insert handling.
4. Wallet balance, `wallet_transactions`, and the `referrals` status flip all commit in the same transaction — no path exists where a reward is marked `granted` without its wallet/coupon row existing, or vice versa.

**Admin wallet adjustment.** `POST /api/admin/wallet/adjust` requires a mandatory, non-empty `reason` (`@IsNotEmpty()`) — unlike most admin DTOs elsewhere in this codebase, since real money moves here with no underlying business-event trigger. Every call is audited with its full payload.

---

## 8. Admin Panel Requirements (`apps/admin-panel`)

**Referral Settings** (new nav item, `/referrals/settings`) — three fixed rows (User / Salon Owner / Worker), Pattern-A-style: enable toggle, referrer reward section (kind dropdown → conditional value/max fields), referee reward section (same), qualifying-event dropdown, grant hold-back hours, expiration days, max referrals per referrer. `PATCH`-only, audited.

**Referrals** (`/referrals`) — paginated, filterable table (status, type, referrer phone), mirroring the Audit Log screen's filter/paginate UX. Row detail shows the full snapshot, linked wallet transaction(s)/coupon, and — only when `status='awaiting_qualifying_event'` — a **Cancel** action with a required reason field (mirrors the existing reject/suspend reason-required pattern).

**Wallet Ledger** (`/wallet`) — search by user (phone), paginated transaction list, plus an **Adjust Balance** action (user picker, signed amount, currency, mandatory reason, confirmation modal given it moves real balance).

**Worker Ratings Moderation** (`/worker-ratings`) — mirrors the existing Reviews moderation screen exactly (list, filter by status/salon, publish/reject toggle).

**Review moderation** (existing screen) — minor extension: display the linked `workerRating`/worker name alongside the salon rating in each row; no new screen.

### `apps/provider-panel` additions
- **Team** (new nav item, alongside Services/Hours/Photos): worker list + add form (name, phone), status toggle (active/inactive — the "leaves the salon" path), read-only `ratingAvg`/`ratingCount` per worker, referral code with copy-to-clipboard.
- **Booking detail**: optional worker-assignment field at confirm/complete time.
- No provider-panel referral or wallet UI for the owner themselves — the owner's own `salon_owner`-kind code and wallet live in the user-app, same as a customer's (they're a `User` too).

### `apps/user-app` additions
- New `/account/referral` page: my code(s) (shareable text/link per role), my referral list, my rewards (wallet credits + issued coupons), wallet balance(s).
- No change to the login/OTP screens — referral entry is a post-login prompt shown once to a freshly-registered user, not wedged into the OTP form itself.

---

## 9. Suggested Improvements (explicitly not required for this rollout)

- **Worker SMS invite flow** (Product Decision 2 — explicitly confirmed deferred, tracked here on purpose so it isn't lost) — today linking a worker requires the owner to already know a phone number that resolves cleanly via `findOrCreateByPhone`; a proper invite (reusing the existing `SmsProvider` abstraction) would be a natural, low-cost follow-up once there's a concrete need.
- **Wallet-as-payment-method at checkout** — this design deliberately scopes wallet balance as accrue-only. Spending it meaningfully touches `BookingsService.createHold`'s money path and deserves its own spec, not a footnote here.
- **Referral campaigns/tiers/multi-level referrals** — explicitly out of scope (Open Question 10). The snapshot-at-redemption design (R5) is chosen specifically so a future `referral_campaigns` table could slot in as an additional config source resolved at redemption time without touching `referrals`' shape.
- **IP/device capture on `verify-otp`**, purely as an admin fraud-review signal, not a blocking control — no such infrastructure exists anywhere in this codebase today; flagged, not built.
- **A retroactive-reward leak report** — a scheduled admin-notification entry (reusing the existing polled-queue pattern) surfacing "reward granted, later found un-reversible" cases (the discount-already-redeemed branch of edge case 2) for manual, human follow-up, cheaper than building true cross-booking clawback.
- **Salon owner reply on a worker rating**, mirroring `salonReply`/`salonReplyAt` on `Review` — trivial to add if wanted, deliberately left out of the core ask.

---

## 10. Migration / Rollout Plan (independently shippable slices)

Each slice below maps to its own `docs/superpowers/specs/` + `docs/superpowers/plans/` pair per this repo's existing brainstorm → spec → plan → execute workflow.

1. **Slice 1 — Worker + worker rating, zero money/referral coupling.** `workers`, `bookings.worker_id`, `worker_ratings`, `recomputeWorkerRating`, provider-panel Team screen, public `GET /salons/:slug/workers[+ratings]`, `PATCH`/`DELETE /reviews/:id` + `review_edit_window_hours`. Ships value (worker profiles, worker ratings, editable reviews) with zero referral/wallet complexity — fully demoable alone.
2. **Slice 2 — Wallet ledger, admin-adjust only, no referrals yet.** `wallet_balances`, `wallet_transactions`, `WalletService`'s row-locked credit/debit primitive, `GET /wallet/mine[/transactions]`, `POST /admin/wallet/adjust`. Proves the never-negative, row-locked, currency-dimensioned ledger against real (manually-triggered) traffic before referrals — the highest-value-at-risk piece — start writing to it.
3. **Slice 3 — Referral codes + tracking, all types disabled, no rewards yet.** `referral_codes`, `referral_reward_types` (seeded `enabled=false`), `referrals`, code minting/validation, `verify-otp` extension, admin Referral Settings + Referrals screens. Referrals reach `awaiting_qualifying_event` and can `expire` — validates the entire redemption UX and admin visibility with zero financial exposure.
4. **Slice 4 — Reward granting (wallet-kind rewards only) + reversal.** `referral_rewards`, `tryGrantReward` wired to booking-completion/payment-paid state transitions, the hold-back check (R7), `reverseIfNeeded` wired to cancel/refund paths and `AlertsService`. Deliberately ships `wallet_credit`/`cashback`/`loyalty_points` first — no coupon-system interaction, smaller diff surface.
5. **Slice 5 — Discount-kind (`percent_discount`) rewards via literal coupon rows.** `coupons.issued_to_user_id`, `resolveAndValidate`'s ownership check, the coupon-issuing branch of the reward grant. Depends on slice 4's grant transaction already existing; zero changes to `discount.util.ts` (§3).
6. **Slice 6 — committed, ships right after slices 1–5 ("phase 1") are live (Product Decision 7).** `coupons.discount_fixed_amount`, the `resolveBestPrice` extension to `discount.util.ts` (§3), touched in isolation with its own regression tests against the existing coupon test suite to prove no-stacking still holds. Scheduled as the immediate next slice, not indefinite backlog — it's isolated into its own slice because it's the one piece touching already-working, heavily-tested payment-adjacent code, not because it's optional.
7. **User-app UI** (`/account/referral`, wallet display, first-login referral prompt) ships incrementally alongside slices 3–5: "my code" UI after slice 3, "my rewards" UI after slice 5.
8. **True backlog, not scheduled as part of this rollout** — worker SMS invite flow (Product Decision 2), wallet-as-payment-method, campaigns/tiers/multi-level referrals, IP/device fraud signal capture — all §9, all additive to what's above.

---

## 11. Implementation Addenda (recorded after all 6 slices shipped, 2026-07-22)

All six slices are built, adversarially verified slice-by-slice (each slice's own verify pass audited money-safety live against a real Postgres instance, not just code review), and green: **1,312 tests passing across all four apps** (525 API unit, 413 API e2e, 66 provider-panel, 146 admin-panel, 162 user-app). A handful of real, load-bearing decisions were made or corrected during implementation that this document didn't originally specify precisely enough — recorded here so the schema/behavior described above and the shipped code stay in agreement:

- **`referrals.status` gained a sixth value: `'partially_granted'`, not in this document's original schema.** A single referral has two independent beneficiary sides (referrer/referred), each with its own `reward_kind` — the seeded default pairs a grantable `wallet_credit` referrer side with a `percent_discount` referred side, and slices 4–5–6 shipped support for those kinds one at a time. `partially_granted` is the honest state for "one side granted, the other side's kind wasn't supported yet" — never silently stuck, always resumable (the exactly-once `UNIQUE(referral_id, beneficiary_role)` backstop makes re-attempting safe). As of slice 6, all five reward kinds are supported, so a referral can always reach `reward_granted` once both sides use a supported kind — `partially_granted` remains reachable only while an admin has one side still configured to a kind this rollout doesn't build (there is none left; it is now purely a transient state between the two sides' processing within one `tryGrantReward` call, not a durable dead-end).
- **R10 (`max_referrals_per_referrer`) required a fix during Slice 5's verification pass.** The first implementation enforced the cap via a plain count-then-insert with no locking — proven exploitable with a forced 8-way concurrent redemption against a cap of 2 (all 8 succeeded). Fixed with `SELECT ... FOR UPDATE` on the `referral_codes` row before the count, serializing concurrent redemptions of the same code; re-verified with the same adversarial probe (exactly 2 succeed now), kept as a permanent regression test.
- **Referral-issued coupons are excluded from the manual coupon-management lists** (`GET /salons/mine/coupons`, `GET /admin/coupons`) — a design call made in Slice 6, not originally specified. A salon-owner/worker-type referral coupon carries the referring salon's `salon_id`, so without this filter it would appear in that salon's own coupon list looking like an editable/deactivatable manual coupon — which it isn't (deactivating it would silently break a reward the platform already promised a specific customer). Referral-issued coupons remain fully visible through the Referrals admin screens (`GET /admin/referrals/:id/rewards`, Slice 5) instead.
- **`bookings` gained a real `discount_fixed_amount` column (Slice 6)**, not an approximated percent. When a fixed-toman coupon wins over a percent-based discount, the booking record stores the literal mechanism (exactly one of `discount_percent`/`discount_fixed_amount`, DB-CHECK-enforced mutual exclusivity), never a lossy percent conversion.
- **`payments` gained a `paid_at` timestamp (Slice 4)**, not originally listed in this document's schema sections — required to implement R7's hold-back check (`grant_holdback_hours` measured from when a payment actually became `paid`, not from `created_at` or the booking's own timestamps).
- **The "already-redeemed, non-reversible" discount-reward state (§6, edge case 2) is marked by reusing `referral_rewards.reversal_reason`** with `status` left at `'granted'` (never flipped to `'reversed'`, since it genuinely wasn't) — no new column. The queryable signature is `status = 'granted' AND reversal_reason IS NOT NULL`, distinguishable from both a normal fresh grant (`reversal_reason IS NULL`) and a real reversal (`status = 'reversed'`).
- **`POST /coupons/validate`'s response gained `couponDiscountKind`/`couponDiscountValue` (Slice 6)**, additive fields alongside the original `couponDiscountPercent`/`appliedDiscountPercent` (both now legitimately `null`/`undefined` when a fixed-amount coupon wins, never fabricated) — the frontend now displays discount savings as a toman amount (`originalPrice - finalPrice`, always correct regardless of mechanism) rather than assuming every win is expressible as a percent.
- **Zero regressions in the original (pre-referral) coupon feature** — independently re-verified at the end of every slice from 5 onward, including a live adversarial re-run of the exact `service discount + coupon: larger single percentage wins, no stacking` test at the end of Slice 6.
