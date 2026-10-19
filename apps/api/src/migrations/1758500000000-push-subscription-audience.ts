import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `push_subscriptions.audience` -- which app a browser subscription came from: the customer
 * app ('customer') or the provider panel ('provider'). They are different origins with their
 * own service workers, and a notification only makes sense in one of them: a salon owner's
 * "new booking request" opened by the customer app's worker landed on a customer booking page
 * that is not theirs. Owner notifications now go to 'provider' subscriptions only.
 *
 * Every existing row came from the customer app (the provider panel had no push until this
 * column), so the default backfills them correctly.
 */
export class PushSubscriptionAudience1758500000000 implements MigrationInterface {
  name = 'PushSubscriptionAudience1758500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE push_subscriptions
         ADD COLUMN audience varchar(16) NOT NULL DEFAULT 'customer'
         CONSTRAINT push_subscriptions_audience_chk CHECK (audience IN ('customer', 'provider'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE push_subscriptions DROP COLUMN audience`);
  }
}
