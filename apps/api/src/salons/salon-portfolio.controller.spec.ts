import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { StorageProvider } from '../storage/storage.provider';
import { PortfolioItem } from './portfolio-item.entity';
import { SalonPortfolioController } from './salon-portfolio.controller';
import { SalonService } from './salon-service.entity';

const FILE = { buffer: Buffer.from('bytes'), mimetype: 'image/png' } as Express.Multer.File;
const REQ = { salonId: 'salon-1' } as unknown as Request;

describe('SalonPortfolioController cap and ownership logic', () => {
  let controller: SalonPortfolioController;
  let items: {
    count: jest.Mock;
    maximum: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    findOneBy: jest.Mock;
    find: jest.Mock;
    delete: jest.Mock;
  };
  let services: { findOneBy: jest.Mock };
  let storage: { upload: jest.Mock; delete: jest.Mock };

  beforeEach(() => {
    items = {
      count: jest.fn().mockResolvedValue(0),
      maximum: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((v) => Promise.resolve(v)),
      create: jest.fn().mockImplementation((v) => v),
      findOneBy: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    services = { findOneBy: jest.fn().mockResolvedValue({ id: 'svc-1', salonId: 'salon-1' }) };
    storage = { upload: jest.fn().mockResolvedValue('http://x/uploads/key'), delete: jest.fn().mockResolvedValue(undefined) };
    controller = new SalonPortfolioController(
      items as unknown as Repository<PortfolioItem>,
      services as unknown as Repository<SalonService>,
      storage as unknown as StorageProvider,
    );
  });

  it('409s with the exact Persian message once 40 items exist', async () => {
    items.count.mockResolvedValue(40);

    const attempt = controller.upload(REQ, FILE, {});
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toMatchObject({ message: 'حداکثر ۴۰ نمونه کار مجاز است' });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(items.save).not.toHaveBeenCalled();
  });

  it('400s when the serviceId does not belong to the caller salon', async () => {
    services.findOneBy.mockResolvedValue(null);

    await expect(
      controller.upload(REQ, FILE, { serviceId: '3f8a72fe-0000-4000-8000-000000000002' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('appends at MAX(sort_order)+1 under the portfolio key scheme', async () => {
    items.count.mockResolvedValue(3);
    items.maximum.mockResolvedValue(2);

    await controller.upload(REQ, FILE, { caption: 'رنگ مو' });

    const key = storage.upload.mock.calls[0][1] as string;
    expect(key).toMatch(/^salons\/salon-1\/portfolio\/[0-9a-f-]{36}\.png$/);
    expect(items.maximum).toHaveBeenCalledWith('sortOrder', { salonId: 'salon-1' });
    expect(items.create).toHaveBeenCalledWith({
      salonId: 'salon-1',
      url: 'http://x/uploads/key',
      storageKey: key,
      caption: 'رنگ مو',
      serviceId: null,
      sortOrder: 3,
    });
  });

  it('starts at sort_order 0 for an empty portfolio (MAX is null)', async () => {
    items.count.mockResolvedValue(0);
    items.maximum.mockResolvedValue(null);

    await controller.upload(REQ, FILE, {});

    expect(items.create).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 0 }));
  });

  it('never reuses an existing sort_order after delete-then-upload (count < MAX+1)', async () => {
    // Rows at {1, 2} after the sortOrder-0 row was deleted: count=2 would collide
    // with the existing sortOrder-2 row and kill the panel's swap-based reorder.
    items.count.mockResolvedValue(2);
    items.maximum.mockResolvedValue(2);

    await controller.upload(REQ, FILE, {});

    expect(items.create).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 3 }));
  });

  it('404s a PATCH for an item owned by another salon', async () => {
    await expect(controller.update(REQ, 'item-9', { sortOrder: 1 })).rejects.toBeInstanceOf(NotFoundException);
    expect(items.save).not.toHaveBeenCalled();
  });

  it('ownership-checks a serviceId change on PATCH', async () => {
    items.findOneBy.mockResolvedValue({ id: 'item-1', salonId: 'salon-1', serviceId: null });
    services.findOneBy.mockResolvedValue(null);

    await expect(
      controller.update(REQ, 'item-1', { serviceId: '3f8a72fe-0000-4000-8000-000000000003' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(items.save).not.toHaveBeenCalled();
  });

  it('clears the service link on PATCH serviceId: null without an ownership lookup', async () => {
    items.findOneBy.mockResolvedValue({ id: 'item-1', salonId: 'salon-1', serviceId: 'svc-1' });

    const saved = await controller.update(REQ, 'item-1', { serviceId: null });

    expect(services.findOneBy).not.toHaveBeenCalled();
    expect(saved.serviceId).toBeNull();
  });
});
