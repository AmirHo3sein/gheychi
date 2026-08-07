import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { SalonOwnerGuard } from './salon-owner.guard';
import { SalonsService } from './salons.service';

function mockContext(user: unknown): { context: ExecutionContext; req: Record<string, unknown> } {
  const req: Record<string, unknown> = { user };
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

describe('SalonOwnerGuard', () => {
  it('attaches req.salonId from the caller\'s own salon and allows the request through', async () => {
    const salons = { findMine: jest.fn().mockResolvedValue({ id: 'salon-1' }) } as unknown as SalonsService;
    const guard = new SalonOwnerGuard(salons);
    const { context, req } = mockContext({ id: 'owner-1' });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(salons.findMine).toHaveBeenCalledWith('owner-1');
    expect(req.salonId).toBe('salon-1');
  });

  it('propagates the 404 from SalonsService.findMine when the caller has no salon', async () => {
    const salons = {
      findMine: jest.fn().mockRejectedValue(new NotFoundException('No salon for this account')),
    } as unknown as SalonsService;
    const guard = new SalonOwnerGuard(salons);
    const { context } = mockContext({ id: 'owner-1' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(NotFoundException);
  });
});
