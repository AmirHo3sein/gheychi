import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { STORAGE_PROVIDER } from '../storage/storage.provider';
import { SalonStory } from './salon-story.entity';
import { StoryCleanupJob } from './story-cleanup.job';

function makeStory(overrides: Partial<SalonStory> = {}): SalonStory {
  return {
    id: 'story-1',
    salonId: 'salon-1',
    url: 'http://x/uploads/salons/salon-1/stories/a.jpg',
    storageKey: 'salons/salon-1/stories/a.jpg',
    caption: null,
    serviceId: null,
    status: 'published',
    createdAt: new Date(Date.now() - 26 * 3_600_000),
    expiresAt: new Date(Date.now() - 2 * 3_600_000),
    ...overrides,
  };
}

describe('StoryCleanupJob', () => {
  let job: StoryCleanupJob;
  let qb: {
    where: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    take: jest.Mock;
    getMany: jest.Mock;
  };
  let rowDelete: jest.Mock;
  let storageDelete: jest.Mock;

  beforeEach(async () => {
    qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    rowDelete = jest.fn().mockResolvedValue({ affected: 1 });
    storageDelete = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        StoryCleanupJob,
        {
          provide: getRepositoryToken(SalonStory),
          useValue: { createQueryBuilder: jest.fn(() => qb), delete: rowDelete },
        },
        { provide: STORAGE_PROVIDER, useValue: { delete: storageDelete } },
      ],
    }).compile();

    job = moduleRef.get(StoryCleanupJob);
  });

  it('only collects stories a full grace hour past expiry (DB clock, not app clock)', async () => {
    await job.run();

    // The grace window keeps a just-expired image visible to an admin resolving a
    // fresh report, and using SQL now() keeps the filter on the same clock that
    // stamped expires_at at insert.
    expect(qb.where).toHaveBeenCalledWith("story.expires_at < now() - interval '1 hour'");
    expect(qb.take).toHaveBeenCalledWith(200);
  });

  it('pins evidence: rows referenced by an OPEN report are excluded from collection', async () => {
    await job.run();

    const notExists = qb.andWhere.mock.calls.map((c) => c[0]).find((sql: string) => sql.includes('NOT EXISTS'));
    expect(notExists).toBeDefined();
    expect(notExists).toContain('r.story_id = story.id');
    expect(notExists).toContain("r.status = 'open'");
  });

  it('deletes the storage object BEFORE the DB row (the row is the GC tracking record)', async () => {
    qb.getMany.mockResolvedValue([makeStory()]);

    const deleted = await job.run();

    expect(deleted).toBe(1);
    expect(storageDelete).toHaveBeenCalledWith('salons/salon-1/stories/a.jpg');
    expect(rowDelete).toHaveBeenCalledWith('story-1');
    expect(storageDelete.mock.invocationCallOrder[0]).toBeLessThan(rowDelete.mock.invocationCallOrder[0]);
  });

  it('keeps the row when the storage delete fails, so the next run retries it', async () => {
    const errorSpy = jest.spyOn(job['logger'], 'error').mockImplementation();
    qb.getMany.mockResolvedValue([makeStory()]);
    storageDelete.mockRejectedValue(new Error('storage backend down'));

    const deleted = await job.run();

    expect(deleted).toBe(0);
    expect(rowDelete).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('story-1'),
      expect.stringContaining('storage backend down'),
    );
    // The log must carry enough to find the orphan by hand: key AND salon id.
    expect(errorSpy.mock.calls[0][0]).toContain('salons/salon-1/stories/a.jpg');
    expect(errorSpy.mock.calls[0][0]).toContain('salon-1');
  });

  it('continues the batch when one row fails (per-row isolation)', async () => {
    const errorSpy = jest.spyOn(job['logger'], 'error').mockImplementation();
    qb.getMany.mockResolvedValue([
      makeStory({ id: 'story-bad', storageKey: 'salons/salon-1/stories/bad.jpg' }),
      makeStory({ id: 'story-ok', storageKey: 'salons/salon-1/stories/ok.jpg' }),
    ]);
    storageDelete.mockRejectedValueOnce(new Error('transient failure')).mockResolvedValueOnce(undefined);

    const deleted = await job.run();

    expect(deleted).toBe(1);
    expect(storageDelete).toHaveBeenCalledTimes(2);
    expect(rowDelete).toHaveBeenCalledTimes(1);
    expect(rowDelete).toHaveBeenCalledWith('story-ok');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('story-bad'), expect.any(String));
  });
});
