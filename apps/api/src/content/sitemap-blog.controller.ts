import { Controller, Get, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SITEMAP_PAGE_SIZE, SitemapPage, SitemapPageQueryDto } from '../common/sitemap-pagination';
import { BlogPost } from './blog-post.entity';

/**
 * Sitemap source for /blog/<slug>, mirroring SitemapSalonsController. Unlike the
 * salons source (bare slugs), each entry carries updatedAt so the user-app's
 * sitemap route can emit lastmod (spec §3.5).
 *
 * Paginated -- see SitemapSalonsController's comment for why (query only the slice a
 * given sitemap-posts-N.xml request needs, and let the sitemap-index route derive page
 * counts from `total`/`pageSize`).
 */
@Controller('sitemap')
export class SitemapBlogController {
  constructor(@InjectRepository(BlogPost) private readonly posts: Repository<BlogPost>) {}

  @Get('blog-posts')
  async list(@Query() query: SitemapPageQueryDto): Promise<SitemapPage<{ slug: string; updatedAt: Date }>> {
    const page = query.page ?? 1;
    const [rows, total] = await this.posts.findAndCount({
      where: { status: 'published' },
      select: ['slug', 'updatedAt'],
      // publishedAt alone isn't a safe pagination key (ties are possible, and it isn't
      // unique) -- id as a secondary sort keeps skip/take deterministic across pages.
      order: { publishedAt: 'DESC', id: 'ASC' },
      skip: (page - 1) * SITEMAP_PAGE_SIZE,
      take: SITEMAP_PAGE_SIZE,
    });
    return {
      items: rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt })),
      total,
      page,
      pageSize: SITEMAP_PAGE_SIZE,
    };
  }
}
