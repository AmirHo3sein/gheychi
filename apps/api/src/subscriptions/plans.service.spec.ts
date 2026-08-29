import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, QueryFailedError } from 'typeorm';
import { Plan } from './plan.entity';
import { PlansService } from './plans.service';

function pgError(code: string): QueryFailedError {
  const driverError = Object.assign(new Error('db error'), { code });
  return new QueryFailedError('', [], driverError);
}

describe('PlansService', () => {
  let service: PlansService;
  let repo: { find: jest.Mock; findOneBy: jest.Mock; save: jest.Mock; create: jest.Mock; delete: jest.Mock };
  let emUpdate: jest.Mock;
  let emFindOneBy: jest.Mock;
  let qbSet: jest.Mock;
  let qbWhere: jest.Mock;
  let qbExecute: jest.Mock;
  let dataSourceTransaction: jest.Mock;

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      save: jest.fn((p) => p),
      create: jest.fn((p) => p),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    emUpdate = jest.fn().mockResolvedValue(undefined);
    emFindOneBy = jest.fn();
    qbExecute = jest.fn().mockResolvedValue(undefined);
    qbWhere = jest.fn(() => ({ execute: qbExecute }));
    qbSet = jest.fn(() => ({ where: qbWhere }));
    const qb = { update: jest.fn(() => ({ set: qbSet })) };
    dataSourceTransaction = jest.fn((cb: (em: unknown) => unknown) =>
      cb({ update: emUpdate, findOneBy: emFindOneBy, createQueryBuilder: jest.fn(() => qb) }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlansService,
        { provide: getRepositoryToken(Plan), useValue: repo },
        { provide: DataSource, useValue: { transaction: dataSourceTransaction } },
      ],
    }).compile();
    service = moduleRef.get(PlansService);
  });

  describe('create', () => {
    it('defaults optional fields and saves', async () => {
      await service.create({ key: 'plus', name: 'پلاس' });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'plus', name: 'پلاس', monthlyPriceToman: 0, entitlements: {}, sortOrder: 0 }),
      );
    });

    it('translates a duplicate key into a clean ConflictException', async () => {
      repo.save.mockRejectedValue(pgError('23505'));
      await expect(service.create({ key: 'free', name: 'رایگان' })).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update', () => {
    it('404s for an unknown id', async () => {
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.update('missing', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects unsetting isDefault on the currently-default plan', async () => {
      repo.findOneBy.mockResolvedValue({ id: 'p1', isDefault: true });
      await expect(service.update('p1', { isDefault: false })).rejects.toBeInstanceOf(ConflictException);
      expect(dataSourceTransaction).not.toHaveBeenCalled();
    });

    it('unsets every other default plan before setting the new one, in one transaction', async () => {
      repo.findOneBy.mockResolvedValue({ id: 'p2', isDefault: false });
      emFindOneBy.mockResolvedValue({ id: 'p2', isDefault: true });

      await service.update('p2', { isDefault: true });

      expect(qbSet).toHaveBeenCalledWith({ isDefault: false });
      expect(qbWhere).toHaveBeenCalledWith('is_default = true');
      expect(emUpdate).toHaveBeenCalledWith(Plan, { id: 'p2' }, expect.objectContaining({ isDefault: true }));
    });

    it('does not touch other plans when isDefault is not part of the update', async () => {
      repo.findOneBy.mockResolvedValue({ id: 'p1', isDefault: false });
      emFindOneBy.mockResolvedValue({ id: 'p1' });

      await service.update('p1', { name: 'new name' });

      expect(qbSet).not.toHaveBeenCalled();
      expect(emUpdate).toHaveBeenCalledWith(Plan, { id: 'p1' }, { name: 'new name' });
    });
  });

  describe('remove', () => {
    it('404s for an unknown id', async () => {
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to delete the default plan without ever attempting the delete', async () => {
      repo.findOneBy.mockResolvedValue({ id: 'p1', isDefault: true });
      await expect(service.remove('p1')).rejects.toBeInstanceOf(ConflictException);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('translates a foreign-key violation (plan in use) into a clean ConflictException', async () => {
      repo.findOneBy.mockResolvedValue({ id: 'p2', isDefault: false });
      repo.delete.mockRejectedValue(pgError('23503'));
      await expect(service.remove('p2')).rejects.toBeInstanceOf(ConflictException);
    });

    it('deletes an unused, non-default plan cleanly', async () => {
      repo.findOneBy.mockResolvedValue({ id: 'p2', isDefault: false });
      await service.remove('p2');
      expect(repo.delete).toHaveBeenCalledWith('p2');
    });
  });
});
