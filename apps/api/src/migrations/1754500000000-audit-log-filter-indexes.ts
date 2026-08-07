import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuditLogFilterIndexes1754500000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // AuditService.listForAdmin lets an admin filter by action or targetType alone
    // (no actorId, no date range required) -- without these, either filter falls back
    // to audit_log_created_idx's full index scan (effectively a full-table scan once
    // the table, which is written on every admin/security-sensitive mutation, grows
    // past a few tens of thousands of rows). created_at DESC is always the sort, so
    // both are composite to also cover the sort without a separate filesort.
    await q.query(`CREATE INDEX audit_log_action_created_idx ON audit_log (action, created_at DESC)`);
    await q.query(`CREATE INDEX audit_log_target_type_created_idx ON audit_log (target_type, created_at DESC)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX audit_log_target_type_created_idx`);
    await q.query(`DROP INDEX audit_log_action_created_idx`);
  }
}
