import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Salon } from './salon.entity';

@Controller('sitemap')
export class SitemapSalonsController {
  constructor(@InjectRepository(Salon) private readonly salons: Repository<Salon>) {}

  @Get('salon-slugs')
  async list(): Promise<string[]> {
    const rows = await this.salons.find({ where: { status: 'approved' }, select: ['slug'] });
    return rows.map((r) => r.slug);
  }
}
