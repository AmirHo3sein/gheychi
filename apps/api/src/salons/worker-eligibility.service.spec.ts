import { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';
import { Worker } from './worker.entity';
import { WorkerEligibilityService } from './worker-eligibility.service';

describe('WorkerEligibilityService', () => {
  describe('isWorkerEligibleForService', () => {
    let dataSourceQuery: jest.Mock;
    let service: WorkerEligibilityService;

    beforeEach(() => {
      dataSourceQuery = jest.fn().mockResolvedValue([{ eligible: true }]);
      service = new WorkerEligibilityService({ query: dataSourceQuery } as unknown as DataSource);
    });

    it('queries the worker_services opt-out predicate with the worker/service ids as params', async () => {
      await service.isWorkerEligibleForService('worker-1', 'service-1');

      expect(dataSourceQuery).toHaveBeenCalledWith(expect.stringContaining('worker_services'), [
        'worker-1',
        'service-1',
      ]);
    });

    it('returns true when the worker has no worker_services rows (unrestricted)', async () => {
      dataSourceQuery.mockResolvedValue([{ eligible: true }]);

      await expect(service.isWorkerEligibleForService('worker-1', 'service-1')).resolves.toBe(true);
    });

    it('returns false when the worker is restricted to a different set of services', async () => {
      dataSourceQuery.mockResolvedValue([{ eligible: false }]);

      await expect(service.isWorkerEligibleForService('worker-1', 'service-2')).resolves.toBe(false);
    });

    it('runs the query against the given EntityManager instead of the DataSource when one is passed', async () => {
      const managerQuery = jest.fn().mockResolvedValue([{ eligible: true }]);
      const manager = { query: managerQuery } as unknown as EntityManager;

      await service.isWorkerEligibleForService('worker-1', 'service-1', manager);

      expect(managerQuery).toHaveBeenCalled();
      expect(dataSourceQuery).not.toHaveBeenCalled();
    });
  });

  describe('applyEligibilityFilter', () => {
    let service: WorkerEligibilityService;

    beforeEach(() => {
      service = new WorkerEligibilityService({} as unknown as DataSource);
    });

    it('adds the opt-out predicate as an andWhere clause aliased against "worker", and returns the same builder', () => {
      const andWhere = jest.fn().mockReturnThis();
      const qb = { andWhere } as unknown as SelectQueryBuilder<Worker>;

      const result = service.applyEligibilityFilter(qb, 'service-1');

      expect(andWhere).toHaveBeenCalledWith(expect.stringContaining('worker_services'), { serviceId: 'service-1' });
      expect(andWhere.mock.calls[0][0]).toContain('worker.id');
      expect(result).toBe(qb);
    });
  });
});
