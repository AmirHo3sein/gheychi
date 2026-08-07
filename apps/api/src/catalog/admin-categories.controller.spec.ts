import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from '../common/postgres-error-codes';
import { AdminCategoriesController } from './admin-categories.controller';
import { ServiceCategory } from './service-category.entity';

function pgError(code: string): QueryFailedError {
  const err = new QueryFailedError('query', [], new Error('driver error'));
  (err as unknown as { code: string }).code = code;
  return err;
}

describe('AdminCategoriesController', () => {
  let controller: AdminCategoriesController;
  let repo: { create: jest.Mock; save: jest.Mock; update: jest.Mock; delete: jest.Mock; findOneBy: jest.Mock };
  let redis: { del: jest.Mock };

  beforeEach(() => {
    repo = {
      create: jest.fn((dto: unknown) => dto),
      save: jest.fn().mockResolvedValue({ id: 1, name: 'کوتاهی مو' }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      findOneBy: jest.fn().mockResolvedValue({ id: 1, name: 'کوتاهی مو' }),
    };
    redis = { del: jest.fn().mockResolvedValue(1) };
    controller = new AdminCategoriesController(repo as unknown as Repository<ServiceCategory>, redis as never);
  });

  it('invalidates the categories cache after a successful create/update/delete', async () => {
    await controller.create({ name: 'کوتاهی مو', icon: 'scissors' });
    await controller.update(1, { name: 'کوتاهی مو' });
    await controller.remove(1);

    expect(redis.del).toHaveBeenCalledTimes(3);
    expect(redis.del).toHaveBeenCalledWith('categories:list');
  });

  // These messages reach the admin panel's toast verbatim -- an English string would land
  // untranslated in an otherwise fully Persian RTL screen.
  it('translates a duplicate-name create into a Persian 409', async () => {
    repo.save.mockRejectedValue(pgError(UNIQUE_VIOLATION));
    await expect(controller.create({ name: 'کوتاهی مو', icon: 'scissors' })).rejects.toBeInstanceOf(ConflictException);
    await expect(controller.create({ name: 'کوتاهی مو', icon: 'scissors' })).rejects.toThrow('دسته‌بندی‌ای با این نام از قبل وجود دارد');
  });

  it('translates a duplicate-name update into a Persian 409', async () => {
    repo.update.mockRejectedValue(pgError(UNIQUE_VIOLATION));
    await expect(controller.update(1, { name: 'کوتاهی مو' })).rejects.toThrow(
      'دسته‌بندی‌ای با این نام از قبل وجود دارد',
    );
  });

  it('rethrows any non-unique failure untouched, rather than mislabelling it a duplicate name', async () => {
    const other = new Error('connection reset');
    repo.save.mockRejectedValueOnce(other);
    await expect(controller.create({ name: 'کوتاهی مو', icon: 'scissors' })).rejects.toBe(other);
  });

  it('404s an update for a category that does not exist', async () => {
    repo.update.mockResolvedValueOnce({ affected: 0 });
    await expect(controller.update(99, { name: 'ناموجود' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps the in-use delete rejection at a Persian 409', async () => {
    repo.delete.mockRejectedValueOnce(pgError(FOREIGN_KEY_VIOLATION));
    await expect(controller.remove(1)).rejects.toThrow('این دسته‌بندی توسط خدمات سالن‌ها استفاده می‌شود');
  });
});
