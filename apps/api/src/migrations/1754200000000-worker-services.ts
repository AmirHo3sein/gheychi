import { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkerServices1754200000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // No backfill, deliberately: a worker with zero rows here is UNRESTRICTED (eligible
    // for every one of the salon's services) -- this is the exact behavior every existing
    // worker already has today (nothing anywhere currently filters workers by service), so
    // starting every worker with an empty set changes nothing until an owner opts a
    // specific worker INTO a restricted set by assigning it services explicitly. Both FKs
    // cascade: a worker or service row only ever really disappears via a hard delete of
    // its own parent salon (both are otherwise soft-deleted via active/isActive flags), at
    // which point an assignment referencing it is meaningless too.
    await q.query(`
      CREATE TABLE worker_services (
        worker_id uuid NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
        service_id uuid NOT NULL REFERENCES salon_services(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (worker_id, service_id)
      )`);
    await q.query(`CREATE INDEX worker_services_service_idx ON worker_services(service_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE worker_services`);
  }
}
