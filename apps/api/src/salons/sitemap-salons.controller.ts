import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Salon } from './salon.entity';

// Google's sitemap protocol caps a single sitemap file at 50,000 URLs. This source is
// unpaginated (fetch-all), so the cap exists purely as a safety ceiling against ever
// emitting an invalid oversized file -- if the platform ever approaches this many
// approved salons, replace this with a real sitemap index (multiple files).
const SITEMAP_URL_CAP = 50_000;

@Controller('sitemap')
export class SitemapSalonsController {
  constructor(@InjectRepository(Salon) private readonly salons: Repository<Salon>) {}

  @Get('salon-slugs')
  async list(): Promise<string[]> {
    const rows = await this.salons.find({
      where: { status: 'approved' },
      select: ['slug'],
      take: SITEMAP_URL_CAP,
    });
    return rows.map((r) => r.slug);
  }
}
