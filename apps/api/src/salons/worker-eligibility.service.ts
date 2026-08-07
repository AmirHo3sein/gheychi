import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';
import { Worker } from './worker.entity';

/**
 * Single source of truth for the worker/service eligibility predicate (see
 * worker-service.entity.ts for the full opt-out-by-default rationale: a worker with NO
 * `worker_services` rows is unrestricted, eligible for every one of the salon's services;
 * a worker WITH rows is narrowed to exactly those). Previously hand-written independently
 * in BookingsService.createHold/assignWorker, AvailabilityService.computeFor, and
 * PublicSalonContentController.listWorkers — a rule change used to require touching all
 * four call sites in sync, with nothing enforcing they stayed consistent.
 */
@Injectable()
export class WorkerEligibilityService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Whether `workerId` is allowed to perform `serviceId`. Pass `manager` to run inside an
   * existing transaction (e.g. BookingsService.createHold's own per-salon-locked critical
   * section) instead of opening a separate connection outside it.
   */
  async isWorkerEligibleForService(workerId: string, serviceId: string, manager?: EntityManager): Promise<boolean> {
    const runner = manager ?? this.dataSource;
    const [{ eligible }] = await runner.query(
      `SELECT
         NOT EXISTS (SELECT 1 FROM worker_services WHERE worker_id = $1)
         OR EXISTS (SELECT 1 FROM worker_services WHERE worker_id = $1 AND service_id = $2)
         AS eligible`,
      [workerId, serviceId],
    );
    return eligible;
  }

  /**
   * Narrows a QueryBuilder selecting from the `worker` table (must be aliased `worker`,
   * matching `createQueryBuilder('worker')`) to only rows eligible for `serviceId`. Used
   * by the public worker-roster listing, which filters a whole set of workers in one query
   * rather than checking eligibility one worker at a time.
   */
  applyEligibilityFilter(qb: SelectQueryBuilder<Worker>, serviceId: string): SelectQueryBuilder<Worker> {
    return qb.andWhere(
      `(
        NOT EXISTS (SELECT 1 FROM worker_services ws WHERE ws.worker_id = worker.id)
        OR EXISTS (
          SELECT 1 FROM worker_services ws
          WHERE ws.worker_id = worker.id AND ws.service_id = :serviceId
        )
      )`,
      { serviceId },
    );
  }
}
