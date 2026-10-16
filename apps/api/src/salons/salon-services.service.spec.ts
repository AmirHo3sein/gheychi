import { ConflictException, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { SalonService } from './salon-service.entity';
import { SalonServicesService } from './salon-services.service';

const SALON_ID = 'salon-1';
const SERVICE_ID = 'service-1';

async function validImage() {
  return sharp({ create: { width: 400, height: 300, channels: 3, background: '#c08060' } }).png().toBuffer();
}

function serviceRow(overrides: Partial<SalonService> = {}): SalonService {
  return { id: SERVICE_ID, salonId: SALON_ID, imageUrl: null, imageStorageKey: null, ...overrides } as SalonService;
}

describe('SalonServicesService -- service image lifecycle', () => {
  // One shared call log so ordering between storage and the DB transaction is assertable.
  let events: string[];
  let row: SalonService | null;
  let saveImpl: (entity: SalonService) => Promise<SalonService>;
  let storage: { upload: jest.Mock; delete: jest.Mock };
  let findOne: jest.Mock;
  let service: SalonServicesService;

  beforeEach(() => {
    events = [];
    row = serviceRow();
    saveImpl = async (entity) => entity;
    findOne = jest.fn(async () => {
      events.push('db:lock');
      return row;
    });
    const manager = {
      findOne,
      save: jest.fn(async (entity: SalonService) => {
        events.push('db:save');
        return saveImpl(entity);
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (fn: (m: typeof manager) => Promise<unknown>) => {
        const result = await fn(manager);
        events.push('db:commit');
        return result;
      }),
    };
    storage = {
      upload: jest.fn(async (_buf: Buffer, key: string) => {
        events.push(`storage:upload:${key}`);
        return `http://cdn/${key}`;
      }),
      delete: jest.fn(async (key: string) => {
        events.push(`storage:delete:${key}`);
      }),
    };
    service = new SalonServicesService({} as never, {} as never, dataSource as never, storage as never);
  });

  describe('setImage', () => {
    it('uploads a normalized JPEG under a server-generated key and locks the row scoped to salon + active', async () => {
      const saved = await service.setImage(SALON_ID, SERVICE_ID, await validImage());

      const [buffer, key, contentType] = storage.upload.mock.calls[0];
      expect((await sharp(buffer).metadata()).format).toBe('jpeg');
      expect(contentType).toBe('image/jpeg');
      expect(key).toMatch(new RegExp(`^salons/${SALON_ID}/services/${SERVICE_ID}/[0-9a-f-]{36}\\.jpg$`));
      expect(findOne).toHaveBeenCalledWith(SalonService, {
        where: { id: SERVICE_ID, salonId: SALON_ID, isActive: true },
        lock: { mode: 'pessimistic_write' },
      });
      expect(saved.imageStorageKey).toBe(key);
      expect(saved.imageUrl).toBe(`http://cdn/${key}`);
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('deletes the previous object only after the transaction commits', async () => {
      row = serviceRow({ imageUrl: 'http://cdn/old.jpg', imageStorageKey: 'salons/salon-1/services/service-1/old.jpg' });

      await service.setImage(SALON_ID, SERVICE_ID, await validImage());

      const deleteIdx = events.indexOf('storage:delete:salons/salon-1/services/service-1/old.jpg');
      expect(deleteIdx).toBeGreaterThan(events.indexOf('db:commit'));
      expect(events.findIndex((e) => e.startsWith('storage:upload:'))).toBeLessThan(events.indexOf('db:lock'));
    });

    it('removes the new object and rethrows 404 when the service is missing / another salon / archived; old object untouched', async () => {
      row = null;

      await expect(service.setImage(SALON_ID, SERVICE_ID, await validImage())).rejects.toBeInstanceOf(NotFoundException);

      const newKey = storage.upload.mock.calls[0][1];
      expect(storage.delete).toHaveBeenCalledTimes(1);
      expect(storage.delete).toHaveBeenCalledWith(newKey);
    });

    it('removes the new object and keeps the old one when the save throws', async () => {
      row = serviceRow({ imageUrl: 'http://cdn/old.jpg', imageStorageKey: 'old-key' });
      saveImpl = async () => {
        throw new Error('db down');
      };

      await expect(service.setImage(SALON_ID, SERVICE_ID, await validImage())).rejects.toThrow('db down');

      const newKey = storage.upload.mock.calls[0][1];
      expect(storage.delete).toHaveBeenCalledWith(newKey);
      expect(storage.delete).not.toHaveBeenCalledWith('old-key');
    });

    it('propagates a storage upload failure without opening a transaction or deleting anything', async () => {
      row = serviceRow({ imageUrl: 'http://cdn/old.jpg', imageStorageKey: 'old-key' });
      storage.upload.mockRejectedValueOnce(new Error('s3 down'));

      await expect(service.setImage(SALON_ID, SERVICE_ID, await validImage())).rejects.toThrow('s3 down');

      expect(findOne).not.toHaveBeenCalled();
      expect(events).not.toContain('db:save');
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('never uploads or touches the DB when the image fails normalization', async () => {
      await expect(service.setImage(SALON_ID, SERVICE_ID, Buffer.from('garbage'))).rejects.toThrow();

      expect(storage.upload).not.toHaveBeenCalled();
      expect(findOne).not.toHaveBeenCalled();
    });

    it('clears an admin-takedown notice in the same locked save as the new image', async () => {
      row = serviceRow({ imageRemovedByAdminAt: new Date('2026-10-01T10:00:00Z') });
      let savedInTx: Partial<SalonService> = {};
      saveImpl = async (entity) => {
        savedInTx = { ...entity };
        return entity;
      };

      const saved = await service.setImage(SALON_ID, SERVICE_ID, await validImage());

      expect(savedInTx.imageRemovedByAdminAt).toBeNull();
      expect(savedInTx.imageStorageKey).toBe(saved.imageStorageKey);
      expect(saved.imageRemovedByAdminAt).toBeNull();
    });

    it('logs (never throws) when deleting the old object fails', async () => {
      row = serviceRow({ imageUrl: 'http://cdn/old.jpg', imageStorageKey: 'old-key' });
      storage.delete.mockRejectedValueOnce(new Error('storage down'));
      const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation();

      const saved = await service.setImage(SALON_ID, SERVICE_ID, await validImage());

      expect(saved.imageStorageKey).not.toBe('old-key');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('old-key'), expect.anything());
    });
  });

  describe('removeImage', () => {
    it('clears both columns and deletes the old object after commit', async () => {
      row = serviceRow({ imageUrl: 'http://cdn/old.jpg', imageStorageKey: 'old-key' });

      const saved = await service.removeImage(SALON_ID, SERVICE_ID);

      expect(saved.imageUrl).toBeNull();
      expect(saved.imageStorageKey).toBeNull();
      expect(events.indexOf('storage:delete:old-key')).toBeGreaterThan(events.indexOf('db:commit'));
    });

    it('clears an admin-takedown notice along with the image', async () => {
      row = serviceRow({ imageUrl: 'http://cdn/old.jpg', imageStorageKey: 'old-key', imageRemovedByAdminAt: new Date() });

      const saved = await service.removeImage(SALON_ID, SERVICE_ID);

      expect(saved).toMatchObject({ imageUrl: null, imageStorageKey: null, imageRemovedByAdminAt: null });
    });

    it('with no image but a pending takedown notice: clears the notice (saves), no storage call', async () => {
      row = serviceRow({ imageRemovedByAdminAt: new Date() });

      const saved = await service.removeImage(SALON_ID, SERVICE_ID);

      expect(saved.imageRemovedByAdminAt).toBeNull();
      expect(events).toContain('db:save');
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('is idempotent: no image -> returned unchanged, no save, no storage call', async () => {
      const saved = await service.removeImage(SALON_ID, SERVICE_ID);

      expect(saved.imageUrl).toBeNull();
      expect(events).not.toContain('db:save');
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('404s for a missing / other-salon / archived service without touching storage', async () => {
      row = null;

      await expect(service.removeImage(SALON_ID, SERVICE_ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('logs (never throws) when deleting the old object fails', async () => {
      row = serviceRow({ imageUrl: 'http://cdn/old.jpg', imageStorageKey: 'old-key' });
      storage.delete.mockRejectedValueOnce(new Error('storage down'));
      const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation();

      await expect(service.removeImage(SALON_ID, SERVICE_ID)).resolves.toMatchObject({ imageUrl: null });
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('archive', () => {
    it('archives and clears the image in one locked tx (scoped to salon, any isActive), deleting the object after commit', async () => {
      row = serviceRow({ isActive: true, imageUrl: 'http://cdn/old.jpg', imageStorageKey: 'old-key' });

      await service.archive(SALON_ID, SERVICE_ID);

      expect(findOne).toHaveBeenCalledWith(SalonService, {
        where: { id: SERVICE_ID, salonId: SALON_ID },
        lock: { mode: 'pessimistic_write' },
      });
      expect(row).toMatchObject({ isActive: false, imageUrl: null, imageStorageKey: null });
      expect(events.indexOf('storage:delete:old-key')).toBeGreaterThan(events.indexOf('db:commit'));
    });

    it('archives a service with no image without any storage call', async () => {
      row = serviceRow({ isActive: true });

      await service.archive(SALON_ID, SERVICE_ID);

      expect(row).toMatchObject({ isActive: false });
      expect(events).toContain('db:save');
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('404s for a missing / other-salon service without touching storage', async () => {
      row = null;

      await expect(service.archive(SALON_ID, SERVICE_ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('never deletes the object when the transaction fails', async () => {
      row = serviceRow({ isActive: true, imageUrl: 'http://cdn/old.jpg', imageStorageKey: 'old-key' });
      saveImpl = async () => {
        throw new Error('db down');
      };

      await expect(service.archive(SALON_ID, SERVICE_ID)).rejects.toThrow('db down');
      expect(storage.delete).not.toHaveBeenCalled();
    });
  });

  describe('adminRemoveImage', () => {
    it('locks by id alone (active or archived), clears only the image columns and deletes after commit', async () => {
      row = serviceRow({
        isActive: false, name: 'کوتاهی', price: 100, durationMin: 30, imageUrl: 'http://cdn/old.jpg', imageStorageKey: 'old-key',
      } as Partial<SalonService>);

      const { before, saved } = await service.adminRemoveImage(SERVICE_ID);

      expect(findOne).toHaveBeenCalledWith(SalonService, { where: { id: SERVICE_ID }, lock: { mode: 'pessimistic_write' } });
      expect(before).toMatchObject({ imageUrl: 'http://cdn/old.jpg', imageStorageKey: 'old-key', salonId: SALON_ID, name: 'کوتاهی' });
      expect(saved).toMatchObject({ isActive: false, price: 100, durationMin: 30, imageUrl: null, imageStorageKey: null });
      expect(events.indexOf('storage:delete:old-key')).toBeGreaterThan(events.indexOf('db:commit'));
    });

    it('stamps imageRemovedByAdminAt in the same locked save that clears the image (before commit)', async () => {
      row = serviceRow({ imageUrl: 'http://cdn/old.jpg', imageStorageKey: 'old-key', imageRemovedByAdminAt: null });
      let savedInTx: Partial<SalonService> = {};
      saveImpl = async (entity) => {
        savedInTx = { ...entity };
        return entity;
      };
      const t0 = Date.now();

      const { before, saved } = await service.adminRemoveImage(SERVICE_ID);

      expect(savedInTx).toMatchObject({ imageUrl: null, imageStorageKey: null });
      expect(savedInTx.imageRemovedByAdminAt).toBeInstanceOf(Date);
      expect(savedInTx.imageRemovedByAdminAt!.getTime()).toBeGreaterThanOrEqual(t0);
      expect(saved.imageRemovedByAdminAt).toBe(savedInTx.imageRemovedByAdminAt);
      expect(before.imageRemovedByAdminAt).toBeNull();
      expect(events).toEqual(['db:lock', 'db:save', 'db:commit', 'storage:delete:old-key']);
    });

    it('409s with the Persian message when the row has no image, without saving or deleting', async () => {
      await expect(service.adminRemoveImage(SERVICE_ID)).rejects.toMatchObject({
        constructor: ConflictException,
        message: 'این خدمت تصویری ندارد',
      });
      expect(events).not.toContain('db:save');
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('404s an unknown id', async () => {
      row = null;
      await expect(service.adminRemoveImage(SERVICE_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('never deletes the object when the transaction fails', async () => {
      row = serviceRow({ imageUrl: 'http://cdn/old.jpg', imageStorageKey: 'old-key' });
      saveImpl = async () => {
        throw new Error('db down');
      };

      await expect(service.adminRemoveImage(SERVICE_ID)).rejects.toThrow('db down');
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('logs (never throws) when the post-commit delete fails', async () => {
      row = serviceRow({ imageUrl: 'http://cdn/old.jpg', imageStorageKey: 'old-key' });
      storage.delete.mockRejectedValueOnce(new Error('storage down'));
      const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation();

      await expect(service.adminRemoveImage(SERVICE_ID)).resolves.toMatchObject({ saved: { imageUrl: null } });
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('old-key'), expect.anything());
    });
  });
});
