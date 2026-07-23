import { MigrationInterface, QueryRunner } from 'typeorm';

export class WalletLedger1753100000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // Read-optimized balance cache -- written ONLY inside the same locked transaction
    // as the wallet_transactions row that produced it (WalletService.credit/debit),
    // exactly this codebase's existing "denormalize but recompute-under-lock"
    // discipline already proven by salons.rating_avg / workers.rating_avg. No mutable
    // balance column on `users`, ever. CHECK (balance >= 0) is the final backstop --
    // any debit that would take a balance negative is capped at the available amount
    // by the service layer (R11), never enforced by relying on this constraint to reject.
    await q.query(`
      CREATE TABLE wallet_balances (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        currency varchar(10) NOT NULL DEFAULT 'toman' CHECK (currency IN ('toman','points')),
        balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, currency)
      )`);

    // Append-only ledger. `type` already lists referral_reward/referral_reversal even
    // though nothing produces them yet -- referrals don't exist until slices 3-5; this
    // slice is wallet-ledger-only, admin-adjustment-only. amount is signed
    // (+credit / -debit); balance_after is a snapshot computed inside the same locked
    // transaction as the balance update, never recomputed later. reference_id is
    // intentionally not FK-constrained (will point at referral_rewards.id once slice 4
    // ships, may point elsewhere later) -- matches this codebase's existing manual-FK
    // -column convention for a genuinely polymorphic case.
    await q.query(`
      CREATE TABLE wallet_transactions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        currency varchar(10) NOT NULL DEFAULT 'toman' CHECK (currency IN ('toman','points')),
        amount bigint NOT NULL CHECK (amount <> 0),
        balance_after bigint NOT NULL,
        type varchar(30) NOT NULL CHECK (type IN ('referral_reward','referral_reversal','admin_adjustment')),
        reference_type varchar(30) NULL,
        reference_id uuid NULL,
        reason text NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(
      `CREATE INDEX wallet_transactions_user_idx ON wallet_transactions(user_id, currency, created_at DESC)`,
    );
    await q.query(`
      CREATE INDEX wallet_transactions_reference_idx ON wallet_transactions(reference_type, reference_id)
        WHERE reference_id IS NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE wallet_transactions`);
    await q.query(`DROP TABLE wallet_balances`);
  }
}
