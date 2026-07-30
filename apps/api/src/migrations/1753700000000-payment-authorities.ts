import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentAuthorities1753700000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // `payments.booking_id` is UNIQUE -- one payment row per booking -- so
    // BookingsService.retryPayment used to OVERWRITE payments.authority with the
    // freshly-minted Zarinpal session and lose the previous one. The customer's
    // still-open first Zarinpal tab remains chargeable, and PaymentsService
    // resolved the callback solely by payments.authority, so paying through the
    // superseded session landed on a 404 with the money recorded nowhere.
    //
    // This table is the append-only record of every authority ever issued for a
    // payment: the callback can resolve ANY of them back to the payment, and
    // reconciliation can re-verify all of them instead of only the newest.
    // payments.authority stays the "current/paying" session (it's what a refund
    // is issued against, and it's re-pointed at whichever authority actually
    // captured), so nothing that reads it changes meaning.
    await q.query(`
      CREATE TABLE payment_authorities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
        authority varchar(64) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    // Zarinpal authorities are globally unique; the unique index is what lets the
    // callback resolve an authority to exactly one payment, and makes the insert
    // safely repeatable (ON CONFLICT DO NOTHING) if a session mint is retried.
    await q.query(`CREATE UNIQUE INDEX payment_authorities_authority_uidx ON payment_authorities(authority)`);
    await q.query(`CREATE INDEX payment_authorities_payment_idx ON payment_authorities(payment_id, created_at DESC)`);

    // Backfill the authority every existing payment currently carries, so the
    // callback's ledger lookup works for rows created before this migration too.
    await q.query(
      `INSERT INTO payment_authorities (payment_id, authority)
       SELECT id, authority FROM payments WHERE authority IS NOT NULL
       ON CONFLICT (authority) DO NOTHING`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    // Dropping the table loses superseded authorities (the current one survives on
    // payments.authority, which is what the pre-migration code reads) -- acceptable
    // for a down migration: the old code can't do anything with them anyway.
    await q.query(`DROP TABLE payment_authorities`);
  }
}
