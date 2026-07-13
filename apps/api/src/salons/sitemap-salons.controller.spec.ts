import { Repository } from 'typeorm';
import { Salon } from './salon.entity';
import { SitemapSalonsController } from './sitemap-salons.controller';

describe('SitemapSalonsController', () => {
  it('emits slugs for approved salons only, capped at the sitemap URL limit', async () => {
    const rows = [{ slug: 'rose-beauty' }, { slug: 'golden-scissors' }];
    const salons = { find: jest.fn().mockResolvedValue(rows) };
    const controller = new SitemapSalonsController(salons as unknown as Repository<Salon>);

    const result = await controller.list();

    expect(salons.find).toHaveBeenCalledWith({
      where: { status: 'approved' },
      select: ['slug'],
      take: 50_000,
    });
    expect(result).toEqual(['rose-beauty', 'golden-scissors']);
  });
});
