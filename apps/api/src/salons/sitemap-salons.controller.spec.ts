import { Repository } from 'typeorm';
import { Salon } from './salon.entity';
import { SitemapSalonsController } from './sitemap-salons.controller';

describe('SitemapSalonsController', () => {
  it('emits slugs for approved salons only, on page 1 by default', async () => {
    const rows = [{ slug: 'rose-beauty' }, { slug: 'golden-scissors' }];
    const salons = { findAndCount: jest.fn().mockResolvedValue([rows, 2]) };
    const controller = new SitemapSalonsController(salons as unknown as Repository<Salon>);

    const result = await controller.list({});

    expect(salons.findAndCount).toHaveBeenCalledWith({
      where: { status: 'approved' },
      select: ['slug'],
      order: { id: 'ASC' },
      skip: 0,
      take: 5_000,
    });
    expect(result).toEqual({ items: ['rose-beauty', 'golden-scissors'], total: 2, page: 1, pageSize: 5_000 });
  });

  it('returns the right slice for an explicit page, computed from the page size', async () => {
    const rows = [{ slug: 'page-two-salon' }];
    const salons = { findAndCount: jest.fn().mockResolvedValue([rows, 5_001]) };
    const controller = new SitemapSalonsController(salons as unknown as Repository<Salon>);

    const result = await controller.list({ page: 2 });

    expect(salons.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5_000, take: 5_000 }),
    );
    expect(result).toEqual({ items: ['page-two-salon'], total: 5_001, page: 2, pageSize: 5_000 });
  });

  it('returns an empty-but-valid page for a page past the real last page, not an error', async () => {
    const salons = { findAndCount: jest.fn().mockResolvedValue([[], 2]) };
    const controller = new SitemapSalonsController(salons as unknown as Repository<Salon>);

    const result = await controller.list({ page: 99 });

    expect(salons.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ skip: 490_000, take: 5_000 }));
    expect(result).toEqual({ items: [], total: 2, page: 99, pageSize: 5_000 });
  });
});
