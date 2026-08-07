import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CronJobRunner } from '../common/cron-job-runner.service';
import { STORAGE_PROVIDER } from './storage.provider';
import { StorageReconciliationJob } from './storage-reconciliation.job';

const HOUR_MS = 60 * 60_000;

describe('StorageReconciliationJob', () => {
  let job: StorageReconciliationJob;
  let query: jest.Mock;
  let exists: jest.Mock;
  let list: jest.Mock;
  let del: jest.Mock;

  beforeEach(async () => {
    query = jest.fn().mockResolvedValue([]);
    exists = jest.fn().mockResolvedValue(true);
    list = jest.fn().mockResolvedValue([]);
    del = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        StorageReconciliationJob,
        { provide: DataSource, useValue: { query } },
        { provide: STORAGE_PROVIDER, useValue: { exists, list, delete: del } },
        { provide: CronJobRunner, useValue: { run: jest.fn((_name: string, fn: () => Promise<void>) => fn()) } },
      ],
    }).compile();

    job = moduleRef.get(StorageReconciliationJob);
  });

  describe('pass 1 -- missing objects', () => {
    it('logs (but does not delete anything) when a known key 404s in storage', async () => {
      query.mockResolvedValue([{ storage_key: 'salons/a/photo.jpg' }]);
      exists.mockResolvedValue(false);
      const errorSpy = jest.spyOn(job['logger'], 'error').mockImplementation();

      const result = await job.run();

      expect(result.missingObjectsLogged).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('salons/a/photo.jpg'));
      expect(del).not.toHaveBeenCalled();
    });

    it('reports 0 missing when every known key exists', async () => {
      query.mockResolvedValue([{ storage_key: 'salons/a/photo.jpg' }, { storage_key: 'blog/p1/cover.jpg' }]);
      exists.mockResolvedValue(true);

      const result = await job.run();

      expect(result.missingObjectsLogged).toBe(0);
    });

    it('continues checking the rest of the batch when one existence check throws (per-key isolation)', async () => {
      query.mockResolvedValue([{ storage_key: 'salons/a/1.jpg' }, { storage_key: 'salons/a/2.jpg' }]);
      exists.mockRejectedValueOnce(new Error('storage down')).mockResolvedValueOnce(true);
      const errorSpy = jest.spyOn(job['logger'], 'error').mockImplementation();

      const result = await job.run();

      expect(exists).toHaveBeenCalledTimes(2);
      expect(result.missingObjectsLogged).toBe(0);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('salons/a/1.jpg'));
    });

    it('caps the number of existence checks in one run at CHECK_BATCH_SIZE (2000), leaving the rest for a later hourly tick', async () => {
      query.mockResolvedValue(Array.from({ length: 2005 }, (_, i) => ({ storage_key: `salons/a/${i}.jpg` })));

      await job.run();

      expect(exists).toHaveBeenCalledTimes(2000);
    });
  });

  describe('pass 2 -- orphaned objects', () => {
    it('deletes an object under a known prefix past the grace period with no matching DB row', async () => {
      query.mockResolvedValue([]);
      list.mockImplementation(async (prefix: string) =>
        prefix === 'salons/' ? [{ key: 'salons/a/orphan.jpg', lastModified: new Date(Date.now() - 25 * HOUR_MS) }] : [],
      );

      const result = await job.run();

      expect(result.orphansDeleted).toBe(1);
      expect(del).toHaveBeenCalledWith('salons/a/orphan.jpg');
    });

    it('leaves an object alone if it is referenced by a known DB row', async () => {
      query.mockResolvedValue([{ storage_key: 'salons/a/live.jpg' }]);
      list.mockImplementation(async (prefix: string) =>
        prefix === 'salons/' ? [{ key: 'salons/a/live.jpg', lastModified: new Date(Date.now() - 25 * HOUR_MS) }] : [],
      );

      const result = await job.run();

      expect(result.orphansDeleted).toBe(0);
      expect(del).not.toHaveBeenCalled();
    });

    it('leaves a recently-uploaded object alone even if unreferenced, inside the grace period', async () => {
      query.mockResolvedValue([]);
      list.mockImplementation(async (prefix: string) =>
        prefix === 'salons/' ? [{ key: 'salons/a/fresh.jpg', lastModified: new Date(Date.now() - 1 * HOUR_MS) }] : [],
      );

      const result = await job.run();

      expect(result.orphansDeleted).toBe(0);
      expect(del).not.toHaveBeenCalled();
    });

    it('checks both the salons/ and blog/ prefixes', async () => {
      await job.run();

      expect(list).toHaveBeenCalledWith('salons/');
      expect(list).toHaveBeenCalledWith('blog/');
    });

    it('continues deleting the rest of the batch when one delete throws (per-object isolation)', async () => {
      query.mockResolvedValue([]);
      list.mockImplementation(async (prefix: string) =>
        prefix === 'salons/'
          ? [
              { key: 'salons/a/bad.jpg', lastModified: new Date(Date.now() - 25 * HOUR_MS) },
              { key: 'salons/a/good.jpg', lastModified: new Date(Date.now() - 25 * HOUR_MS) },
            ]
          : [],
      );
      del.mockRejectedValueOnce(new Error('delete failed')).mockResolvedValueOnce(undefined);
      const errorSpy = jest.spyOn(job['logger'], 'error').mockImplementation();

      const result = await job.run();

      expect(result.orphansDeleted).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('salons/a/bad.jpg'));
    });
  });

  it('handleCron delegates to run() through the cron lock', async () => {
    const runSpy = jest.spyOn(job, 'run').mockResolvedValue({ missingObjectsLogged: 0, orphansDeleted: 0 });

    await job.handleCron();

    expect(runSpy).toHaveBeenCalled();
  });
});
