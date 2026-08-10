import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AdminSalonsController } from './admin-salons.controller';
import { PortfolioItem } from './portfolio-item.entity';
import { SalonStory } from './salon-story.entity';
import { Salon } from './salon.entity';
import { SalonsService } from './salons.service';

// AdminSalonsController.setStatus/setFeatured are pure delegation to SalonsService --
// the actual business rules (owner-suspended approval guard, suspended_cause bookkeeping,
// state transitions) are unit-tested against the service directly in salons.service.spec.ts.
// This spec only proves the controller wires the request through unchanged.
describe('AdminSalonsController (delegates to SalonsService)', () => {
  let controller: AdminSalonsController;
  let salonsService: { setStatus: jest.Mock; setFeatured: jest.Mock };
  let qb: {
    select: jest.Mock;
    orderBy: jest.Mock;
    andWhere: jest.Mock;
    skip: jest.Mock;
    take: jest.Mock;
    getManyAndCount: jest.Mock;
  };
  let salons: { createQueryBuilder: jest.Mock; findOneBy: jest.Mock };
  // Real controller logic (not the interceptor -- see audit.interceptor.spec.ts for
  // that) stashes the salon's before/after status on this plain object, mirroring
  // what AuditInterceptor would read off the real Express request.
  let req: { auditBefore?: unknown; auditAfter?: unknown };

  beforeEach(() => {
    salonsService = {
      setStatus: jest.fn().mockResolvedValue({ id: 's1', status: 'approved', rejectionReason: null, suspendedCause: null }),
      setFeatured: jest.fn().mockResolvedValue({ id: 's1', isFeatured: true }),
    };
    qb = {
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    salons = {
      createQueryBuilder: jest.fn(() => qb),
      findOneBy: jest.fn().mockResolvedValue({ id: 's1', status: 'pending', rejectionReason: null, suspendedCause: null }),
    };
    req = {};
    controller = new AdminSalonsController(
      salons as unknown as Repository<Salon>,
      {} as unknown as Repository<SalonStory>,
      {} as unknown as Repository<PortfolioItem>,
      salonsService as unknown as SalonsService,
    );
  });

  // Regression test for the alphabetical-queue bug (docs/technical-overview/24-technical-debt.md):
  // GET /admin/salons must order the moderation queue oldest-pending-first (createdAt ASC),
  // not alphabetically by name, so admins clear the longest-waiting requests first.
  it('orders the salon list by createdAt ASC, not by name', async () => {
    await controller.list({});

    expect(qb.orderBy).toHaveBeenCalledWith('salon.createdAt', 'ASC');
    expect(qb.orderBy).not.toHaveBeenCalledWith('salon.name', 'ASC');
  });

  it('setStatus passes the id and dto through to SalonsService.setStatus and returns its result', async () => {
    const dto = { status: 'rejected' as const, reason: 'مدارک ناقص است' };
    const result = await controller.setStatus('s1', dto, req as never);

    expect(salonsService.setStatus).toHaveBeenCalledWith('s1', dto);
    expect(result).toEqual({ id: 's1', status: 'approved', rejectionReason: null, suspendedCause: null });
  });

  it('stashes the pre- and post-mutation status on req for AuditInterceptor to diff', async () => {
    salons.findOneBy.mockResolvedValue({ id: 's1', status: 'pending', rejectionReason: null, suspendedCause: null });
    const dto = { status: 'approved' as const };

    await controller.setStatus('s1', dto, req as never);

    expect(req.auditBefore).toEqual({ status: 'pending', rejectionReason: null, suspendedCause: null });
    expect(req.auditAfter).toEqual({ status: 'approved', rejectionReason: null, suspendedCause: null });
  });

  it('leaves req.auditBefore unset when the salon does not exist, still calling through to the service', async () => {
    salons.findOneBy.mockResolvedValue(null);
    salonsService.setStatus.mockRejectedValueOnce(new NotFoundException());
    const dto = { status: 'approved' as const };

    await expect(controller.setStatus('missing', dto, req as never)).rejects.toBeInstanceOf(NotFoundException);

    expect(req.auditBefore).toBeUndefined();
  });

  it('setFeatured passes the id and dto through to SalonsService.setFeatured and returns its result', async () => {
    const dto = { isFeatured: true, featuredUntil: '2026-09-01T00:00:00.000Z' };
    const result = await controller.setFeatured('s1', dto);

    expect(salonsService.setFeatured).toHaveBeenCalledWith('s1', dto);
    expect(result).toEqual({ id: 's1', isFeatured: true });
  });

  it('propagates a NotFoundException from the service unchanged', async () => {
    salonsService.setStatus.mockRejectedValueOnce(new NotFoundException());
    await expect(controller.setStatus('missing', { status: 'approved' }, req as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
