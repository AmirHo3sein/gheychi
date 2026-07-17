import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { StorageProvider } from '../storage/storage.provider';
import { SalonService } from './salon-service.entity';
import { SalonStoriesController } from './salon-stories.controller';
import { SalonStory } from './salon-story.entity';

const FILE = { buffer: Buffer.from('bytes'), mimetype: 'image/jpeg' } as Express.Multer.File;
const REQ = { salonId: 'salon-1' } as unknown as Request;

describe('SalonStoriesController cap and ownership logic', () => {
  let controller: SalonStoriesController;
  let qb: { where: jest.Mock; andWhere: jest.Mock; orderBy: jest.Mock; getCount: jest.Mock; getMany: jest.Mock };
  let stories: {
    createQueryBuilder: jest.Mock;
    insert: jest.Mock;
    findOneByOrFail: jest.Mock;
    findOneBy: jest.Mock;
    delete: jest.Mock;
  };
  let services: { findOneBy: jest.Mock };
  let storage: { upload: jest.Mock; delete: jest.Mock };

  beforeEach(() => {
    qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
      getMany: jest.fn().mockResolvedValue([]),
    };
    stories = {
      createQueryBuilder: jest.fn(() => qb),
      insert: jest.fn().mockResolvedValue({ identifiers: [{ id: 'story-1' }] }),
      findOneByOrFail: jest.fn().mockResolvedValue({ id: 'story-1' }),
      findOneBy: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    services = { findOneBy: jest.fn().mockResolvedValue({ id: 'svc-1', salonId: 'salon-1' }) };
    storage = { upload: jest.fn().mockResolvedValue('http://x/uploads/key'), delete: jest.fn().mockResolvedValue(undefined) };
    controller = new SalonStoriesController(
      stories as unknown as Repository<SalonStory>,
      services as unknown as Repository<SalonService>,
      storage as unknown as StorageProvider,
    );
  });

  it('409s with the exact Persian message once 10 unexpired stories exist', async () => {
    qb.getCount.mockResolvedValue(10);

    const attempt = controller.upload(REQ, FILE, {});
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toMatchObject({ message: 'حداکثر ۱۰ استوری فعال مجاز است' });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(stories.insert).not.toHaveBeenCalled();
  });

  it('counts the cap by expiry only, regardless of status (a removed story keeps its slot)', async () => {
    qb.getCount.mockResolvedValue(9);

    await controller.upload(REQ, FILE, {});

    expect(qb.where).toHaveBeenCalledWith('story.salon_id = :salonId', { salonId: 'salon-1' });
    expect(qb.andWhere).toHaveBeenCalledWith('story.expires_at > now()');
    const allClauses = [...qb.where.mock.calls, ...qb.andWhere.mock.calls].map((c) => String(c[0]));
    expect(allClauses.some((sql) => sql.includes('status'))).toBe(false);
  });

  it('400s when the serviceId does not belong to the caller salon', async () => {
    services.findOneBy.mockResolvedValue(null);

    await expect(
      controller.upload(REQ, FILE, { serviceId: '3f8a72fe-0000-4000-8000-000000000001' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(services.findOneBy).toHaveBeenCalledWith({
      id: '3f8a72fe-0000-4000-8000-000000000001',
      salonId: 'salon-1',
    });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('uploads under the stories key scheme and stamps expires_at with the DB clock', async () => {
    await controller.upload(REQ, FILE, { caption: 'کوتاهی مو', serviceId: 'svc-1' });

    const key = storage.upload.mock.calls[0][1] as string;
    expect(key).toMatch(/^salons\/salon-1\/stories\/[0-9a-f-]{36}\.jpg$/);

    const values = stories.insert.mock.calls[0][0];
    expect(values).toMatchObject({
      salonId: 'salon-1',
      storageKey: key,
      caption: 'کوتاهی مو',
      serviceId: 'svc-1',
    });
    // The TTL must be a raw-SQL function value evaluated by Postgres -- the same
    // clock the read filter's `expires_at > now()` uses -- not an app-side Date.
    expect(typeof values.expiresAt).toBe('function');
    expect(values.expiresAt()).toBe("now() + interval '24 hours'");
  });

  it('stores caption and serviceId as null when omitted', async () => {
    await controller.upload(REQ, FILE, {});

    expect(services.findOneBy).not.toHaveBeenCalled();
    expect(stories.insert.mock.calls[0][0]).toMatchObject({ caption: null, serviceId: null });
  });

  it('404s a delete for a story owned by another salon', async () => {
    await expect(controller.remove(REQ, 'story-9')).rejects.toBeInstanceOf(NotFoundException);
    expect(stories.delete).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });
});
