import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReferralRewardGranting1753300000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // The exactly-once backstop referenced throughout the design spec (section 7):
    // even a retried background job hitting tryGrantReward from two non-overlapping
    // transactions can't produce two reward rows for the same referral+role -- the
    // second insert 23505s and is caught as an idempotent no-op. This table doubles
    // as the payout record (wallet_transaction_id for wallet-kind rewards; coupon_id
    // for discount-kind rewards, slice 5+) and the reversal-tracking row -- not a
    // separate reward-ledger table beyond what's needed for those two jobs.
    //
    // Slice 4 (this migration) only ever produces rows with wallet_transaction_id set
    // -- percent_discount/fixed_discount sides are skipped entirely (not yet
    // supported, see ReferralsService.tryGrantReward), so coupon_id stays unused
    // until slice 5.
    await q.query(`
      CREATE TABLE referral_rewards (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        referral_id uuid NOT NULL REFERENCES referrals(id) ON DELETE RESTRICT,
        beneficiary_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        beneficiary_role varchar(10) NOT NULL CHECK (beneficiary_role IN ('referrer','referred')),
        reward_kind varchar(20) NOT NULL,
        reward_value numeric(12,2) NOT NULL,
        wallet_transaction_id uuid NULL REFERENCES wallet_transactions(id) ON DELETE RESTRICT,
        coupon_id uuid NULL REFERENCES coupons(id) ON DELETE RESTRICT,
        status varchar(20) NOT NULL DEFAULT 'granted' CHECK (status IN ('granted','reversed')),
        granted_at timestamptz NOT NULL DEFAULT now(),
        reversed_at timestamptz NULL,
        reversal_reason text NULL,
        reversal_shortfall_amount numeric(12,2) NULL
      )`);
    await q.query(`CREATE UNIQUE INDEX referral_rewards_referral_role_uidx ON referral_rewards(referral_id, beneficiary_role)`);

    // A referral now has two independently-grantable sides (referrer/referred), each
    // possibly a different reward_kind (e.g. the seeded default: referrer=wallet_credit,
    // grantable now; referred=percent_discount, not until slice 5). 'partially_granted'
    // covers "one side granted, the other side's kind isn't supported yet" -- see
    // tryGrantReward's status-transition logic. Confirmed via psql that the inline
    // column-level CHECK from the slice-3 migration was named
    // 'referrals_status_check' (Postgres's deterministic <table>_<column>_check
    // naming for the first/only check on that column).
    await q.query(`ALTER TABLE referrals DROP CONSTRAINT referrals_status_check`);
    await q.query(`
      ALTER TABLE referrals ADD CONSTRAINT referrals_status_check
        CHECK (status IN ('awaiting_qualifying_event','partially_granted','reward_granted','expired','cancelled'))`);

    // R7's grant hold-back check ("at least grant_holdback_hours since the triggering
    // payment became paid") needs an actual "when did this payment become paid"
    // timestamp -- the existing `payments` table had no such column (only
    // refund_requested_at/refunded_at, both refund-side). Set at the exact same spot
    // PaymentsService/PaymentReconciliationJob already flip status to 'paid'.
    await q.query(`ALTER TABLE payments ADD COLUMN paid_at timestamptz NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE payments DROP COLUMN paid_at`);
    await q.query(`ALTER TABLE referrals DROP CONSTRAINT referrals_status_check`);
    await q.query(`
      ALTER TABLE referrals ADD CONSTRAINT referrals_status_check
        CHECK (status IN ('awaiting_qualifying_event','reward_granted','expired','cancelled'))`);
    await q.query(`DROP TABLE referral_rewards`);
  }
}
