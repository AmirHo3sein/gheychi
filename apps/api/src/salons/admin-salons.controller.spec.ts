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

  beforeEach(() => {
    salonsService = {
      setStatus: jest.fn().mockResolvedValue({ id: 's1', status: 'approved' }),
      setFeatured: jest.fn().mockResolvedValue({ id: 's1', isFeatured: true }),
    };
    controller = new AdminSalonsController(
      {} as unknown as Repository<Salon>,
      {} as unknown as Repository<SalonStory>,
      {} as unknown as Repository<PortfolioItem>,
      salonsService as unknown as SalonsService,
    );
  });

  it('setStatus passes the id and dto through to SalonsService.setStatus and returns its result', async () => {
    const dto = { status: 'rejected' as const, reason: 'مدارک ناقص است' };
    const result = await controller.setStatus('s1', dto);

    expect(salonsService.setStatus).toHaveBeenCalledWith('s1', dto);
    expect(result).toEqual({ id: 's1', status: 'approved' });
  });

  it('setFeatured passes the id and dto through to SalonsService.setFeatured and returns its result', async () => {
    const dto = { isFeatured: true, featuredUntil: '2026-09-01T00:00:00.000Z' };
    const result = await controller.setFeatured('s1', dto);

    expect(salonsService.setFeatured).toHaveBeenCalledWith('s1', dto);
    expect(result).toEqual({ id: 's1', isFeatured: true });
  });

  it('propagates a NotFoundException from the service unchanged', async () => {
    salonsService.setStatus.mockRejectedValueOnce(new NotFoundException());
    await expect(controller.setStatus('missing', { status: 'approved' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
