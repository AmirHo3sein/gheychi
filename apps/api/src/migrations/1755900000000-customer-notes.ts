import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 5 of the monetization initiative -- see
// docs/superpowers/specs/2026-08-30-monetization-platform-design.md. Salon-private notes on
// a customer, the only genuinely new storage the CRM feature needs -- the customer list
// itself is derived entirely from existing bookings/payments/financial_transactions rows,
// no separate Customer entity.
export class CustomerNotes1755900000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE customer_notes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        salon_id uuid NOT NULL REFERENCES salons(id),
        customer_id uuid NOT NULL REFERENCES users(id),
        note varchar(1000) NOT NULL,
        created_by uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX customer_notes_salon_customer_idx ON customer_notes (salon_id, customer_id, created_at DESC)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE customer_notes`);
  }
}
