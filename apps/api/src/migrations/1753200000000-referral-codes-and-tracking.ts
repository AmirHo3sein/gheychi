import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReferralCodesAndTracking1753200000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // One lifetime code per person (Product Decision 3 -- overrides this design's
    // original per-role-code proposal). No owner_kind/owner_worker_id columns: a code
    // has exactly one owner (a User, full stop). Which reward tier it resolves to at
    // redemption time is computed dynamically from the referrer's role at that moment
    // (see referrals.referral_type below), never stored on this row.
    await q.query(`
      CREATE TABLE referral_codes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(20) NOT NULL UNIQUE,
        owner_user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
        disabled_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX referral_codes_code_idx ON referral_codes(code) WHERE disabled_at IS NULL`);

    // Exactly 3 fixed rows, seeded enabled=false (R12) -- nothing pays out until an
    // admin explicitly configures real reward values and flips a row on via
    // PATCH /admin/referral-reward-types/:type. Slice 3 never grants a reward, so the
    // reward-kind/value/max columns here are placeholders (Product Decision 1).
    await q.query(`
      CREATE TABLE referral_reward_types (
        referral_type varchar(20) PRIMARY KEY CHECK (referral_type IN ('user','salon_owner','worker')),
        enabled boolean NOT NULL DEFAULT false,
        referrer_reward_kind varchar(20) NOT NULL CHECK (referrer_reward_kind IN
          ('wallet_credit','percent_discount','fixed_discount','cashback','loyalty_points')),
        referrer_reward_value numeric(12,2) NOT NULL DEFAULT 0,
        referrer_reward_max numeric(12,2) NULL,
        referred_reward_kind varchar(20) NOT NULL CHECK (referred_reward_kind IN
          ('wallet_credit','percent_discount','fixed_discount','cashback','loyalty_points')),
        referred_reward_value numeric(12,2) NOT NULL DEFAULT 0,
        referred_reward_max numeric(12,2) NULL,
        qualifying_event varchar(30) NOT NULL DEFAULT 'first_paid_booking'
          CHECK (qualifying_event IN ('first_completed_booking','first_paid_booking')),
        grant_holdback_hours int NOT NULL DEFAULT 72,
        expiration_days int NULL,
        max_referrals_per_referrer int NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      INSERT INTO referral_reward_types (referral_type, referrer_reward_kind, referred_reward_kind) VALUES
        ('user',        'wallet_credit', 'percent_discount'),
        ('salon_owner', 'wallet_credit', 'percent_discount'),
        ('worker',      'wallet_credit', 'percent_discount')`);

    // referred_user_id UNIQUE is the load-bearing constraint of the entire design --
    // one row per referred user, ever -- the DB-level enforcement of "a code is usable
    // only at registration" (R2). Reward terms + grant policy are all snapshotted from
    // referral_reward_types at redemption time (R5) and never re-read live again.
    // Slice 3 never moves status past 'awaiting_qualifying_event' except via the admin
    // cancel action -- reward granting (slice 4) and the expiry cron (also slice 4+)
    // are both out of scope here.
    await q.query(`
      CREATE TABLE referrals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        referral_code_id uuid NOT NULL REFERENCES referral_codes(id) ON DELETE RESTRICT,
        referrer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        referred_user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
        referral_type varchar(20) NOT NULL CHECK (referral_type IN ('user','salon_owner','worker')),
        salon_id uuid NULL REFERENCES salons(id) ON DELETE SET NULL,
        referrer_reward_kind varchar(20) NOT NULL,
        referrer_reward_value numeric(12,2) NOT NULL,
        referrer_reward_max numeric(12,2) NULL,
        referred_reward_kind varchar(20) NOT NULL,
        referred_reward_value numeric(12,2) NOT NULL,
        referred_reward_max numeric(12,2) NULL,
        qualifying_event varchar(30) NOT NULL,
        grant_holdback_hours int NOT NULL,
        status varchar(30) NOT NULL DEFAULT 'awaiting_qualifying_event'
          CHECK (status IN ('awaiting_qualifying_event','reward_granted','expired','cancelled')),
        qualifying_booking_id uuid NULL REFERENCES bookings(id) ON DELETE SET NULL,
        reward_granted_at timestamptz NULL,
        expires_at timestamptz NULL,
        cancelled_reason text NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX referrals_referrer_idx ON referrals(referrer_user_id, status)`);
    await q.query(`
      CREATE INDEX referrals_status_expiry_idx ON referrals(status, expires_at) WHERE status = 'awaiting_qualifying_event'`);
    await q.query(`CREATE INDEX referrals_code_idx ON referrals(referral_code_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE referrals`);
    await q.query(`DROP TABLE referral_reward_types`);
    await q.query(`DROP TABLE referral_codes`);
  }
}
