import { Controller, Get, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Public } from '../auth/public.decorator';
import { SITEMAP_PAGE_SIZE, SitemapPage, SitemapPageQueryDto } from '../common/sitemap-pagination';
import { Salon } from './salon.entity';

@Controller('sitemap')
@Public()
export class SitemapSalonsController {
  constructor(@InjectRepository(Salon) private readonly salons: Repository<Salon>) {}

  // Paginated -- the user-app's sitemap-salons-N.xml route requests exactly the page it
  // needs (never the whole table), and its sitemap-index route reads `total`/`pageSize`
  // from a single page-1 call to know how many sub-sitemap files to list.
  @Get('salon-slugs')
  async list(@Query() query: SitemapPageQueryDto): Promise<SitemapPage<string>> {
    const page = query.page ?? 1;
    const [rows, total] = await this.salons.findAndCount({
      where: { status: 'approved' },
      select: ['slug'],
      // Deterministic order is required for skip/take to yield a stable, non-overlapping
      // partition across separately-requested pages -- id is the primary key, so it's
      // always a valid, cheap tiebreak.
      order: { id: 'ASC' },
      skip: (page - 1) * SITEMAP_PAGE_SIZE,
      take: SITEMAP_PAGE_SIZE,
    });
    return { items: rows.map((r) => r.slug), total, page, pageSize: SITEMAP_PAGE_SIZE };
  }
}
